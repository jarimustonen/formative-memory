# Research-06: Nykyinen muistijärjestelmä

> **Tavoite:** Ymmärtää OpenClaw:n nykyinen muistijärjestelmä kokonaisuutena – tiedon tallennus, indeksointi, haku ja muistin käyttö agentin kontekstissa. Tunnistaa, mitä assosiatiivisen muistin plugin korvaa, laajentaa tai hyödyntää.

---

## 1. Yhteenveto

OpenClaw:n muistijärjestelmä on **embedding-pohjainen hybridihakujärjestelmä**, joka indeksoi Markdown-muistitiedostoja SQLite-tietokantaan ja tarjoaa agentille kaksi työkalua: `memory_search` (semanttinen haku) ja `memory_get` (tarkka rivihaku). Järjestelmä tukee kahta backendia: **builtin** (SQLite + embeddings) ja **qmd** (ulkoinen `qmd`-työkalu).

Arkkitehtuurin ydinpiirteet:

- **Flat-tiedostot ovat totuuden lähde** – muistot ovat `MEMORY.md`, `memory.md` ja `memory/*.md` -tiedostoja
- **SQLite on pelkkä indeksi** – se on johdettu tiedostoista, ei primäärinen tallennus
- **Chunking on lennossa** – tiedostot pilkotaan chunkeiksi indeksoinnissa; chunkeilla ei ole stabiilia identiteettiä
- **Haku on hybridi** – vektori (cosine) + BM25 (full-text), painotettu yhdistelmä
- **Embedding-provideri on konfiguloitavissa** – OpenAI, Gemini, Voyage, Mistral, local (node-llama)
- **FTS-only fallback** – jos embedding-provideria ei ole, käytetään pelkkää full-text-hakua

---

## 2. Arkkitehtuurikaavio

```
┌─────────────────────────────────────────────────────────────────────┐
│                       Muistitiedostot (flat)                        │
│  MEMORY.md  │  memory.md  │  memory/*.md  │  (extra paths)         │
└──────┬──────────────┬───────────────┬──────────────────────────────┘
       │              │               │
       ▼              ▼               ▼
┌────────────────────────────────────────────────────────────────────┐
│                  MemoryManagerSyncOps                               │
│  chokidar-watcher │ interval-timer │ session-listener              │
│  syncMemoryFiles() │ syncSessionFiles()                            │
└──────────────┬─────────────────────────────────────────────────────┘
               │
               ▼
┌────────────────────────────────────────────────────────────────────┐
│                  MemoryManagerEmbeddingOps                          │
│  chunkMarkdown() → embed batches → SQLite write                    │
│  indexFile() │ indexSessionEntry()                                  │
└──────────────┬─────────────────────────────────────────────────────┘
               │
               ▼
┌────────────────────────────────────────────────────────────────────┐
│                  SQLite-tietokanta                                  │
│  chunks (text + embedding) │ chunks_fts (FTS5) │ chunks_vec (vec0) │
│  files (metadata) │ embedding_cache │ meta (key-value)             │
└──────────────┬──────────────────────────┬──────────────────────────┘
               │                          │
               ▼                          ▼
┌──────────────────────────┐  ┌──────────────────────────────────────┐
│    searchVector()        │  │    searchKeyword()                   │
│  vec_distance_cosine()   │  │    FTS5 bm25()                      │
│  tai in-memory cosine    │  │                                      │
└──────────┬───────────────┘  └───────────┬──────────────────────────┘
           │                              │
           ▼                              ▼
┌────────────────────────────────────────────────────────────────────┐
│                  mergeHybridResults()                               │
│  weighted merge → temporal decay → sort → MMR (valinnainen)        │
└──────────────┬─────────────────────────────────────────────────────┘
               │
               ▼
┌────────────────────────────────────────────────────────────────────┐
│            memory_search / memory_get (agentin työkalut)            │
│            memory-core plugin rekisteröi nämä                       │
└────────────────────────────────────────────────────────────────────┘
```

---

## 3. Tietolähteet

### 3.1 Muistitiedostot (primäärinen)

Muistin lähdeaineisto ovat tavallisia Markdown-tiedostoja:

| Polku         | Rooli                                       | Luonne                                    |
| ------------- | ------------------------------------------- | ----------------------------------------- |
| `MEMORY.md`   | Pitkäkestoinen muisti, kuratoitu            | "Evergreen" – ei ajallista rapautumista   |
| `memory.md`   | Vaihtoehtoinen nimi MEMORY.md:lle           | Sama rooli                                |
| `memory/*.md` | Päivittäiset muistiinpanot ja sessiomuistot | Päivätyt tiedostot rapautuvat ajallisesti |
| Extra paths   | Lisäpolut konfiguraatiosta                  | Vaihtelee                                 |

**Lähde:** `src/memory/internal.ts`, rivi 80–146 (`listMemoryFiles`)

Tiedostojen listaus:

1. Tarkistetaan `MEMORY.md` ja `memory.md` (workspace root)
2. Kävellään `memory/`-kansio rekursiivisesti (vain `.md`-tiedostot, ei symlinkkejä)
3. Lisätään konfiguraation `extraPaths`-polut
4. Deduplikoidaan `realpath`:illa

### 3.2 Sessiotranskriptit (kokeellinen)

Toinen lähde ovat **JSONL-sessiotranskriptit** (`~/.openclaw/agents/<agentId>/sessions/*.jsonl`). Tämä on kokeellinen ominaisuus, joka indeksoi keskusteluhistoriaa.

**Lähde:** `src/memory/session-files.ts`, `src/memory/manager-sync-ops.ts`

Sessiotiedostot parsitaan `buildSessionEntry()`:llä, joka:

- Lukee JSONL-rivit
- Poimii `user`/`assistant`-viestit tekstiksi (`User: .../Assistant: ...`)
- Redaktoi herkät tiedot
- Tuottaa `lineMap`-taulukon, joka mahdollistaa chunkkien rivien mahdollistaa takaisin alkuperäiseen JSONL:ään

---

## 4. SQLite-skeema

Tietokanta sijaitsee: `~/.openclaw/memory/<agentId>.sqlite`

**Lähde:** `src/memory/memory-schema.ts`

### 4.1 Taulut

```sql
-- Metadatataulu (avain-arvo)
CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Indeksoidut tiedostot ja niiden hashit
CREATE TABLE files (
  path TEXT PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'memory',
  hash TEXT NOT NULL,
  mtime INTEGER NOT NULL,
  size INTEGER NOT NULL
);

-- Chunkit: teksti + embedding
CREATE TABLE chunks (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'memory',
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  hash TEXT NOT NULL,
  model TEXT NOT NULL,
  text TEXT NOT NULL,
  embedding TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Embedding-välimuisti (per provider/model/avain)
CREATE TABLE embedding_cache (
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  provider_key TEXT NOT NULL,
  hash TEXT NOT NULL,
  embedding TEXT NOT NULL,
  dims INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (provider, model, provider_key, hash)
);

-- Full-text-haku (FTS5)
CREATE VIRTUAL TABLE chunks_fts USING fts5(
  text,
  id UNINDEXED,
  path UNINDEXED,
  source UNINDEXED,
  model UNINDEXED,
  start_line UNINDEXED,
  end_line UNINDEXED
);

-- Vektorihaku (sqlite-vec, luodaan runtime:ssa)
-- chunks_vec: vec0-taulu embeddingeille
```

### 4.2 Indeksit

```sql
CREATE INDEX idx_chunks_path ON chunks(path);
CREATE INDEX idx_chunks_source ON chunks(source);
CREATE INDEX idx_embedding_cache_updated_at ON embedding_cache(updated_at);
```

### 4.3 Skeeman avainhuomiot

- **`chunks.id`** on **SHA-256-hash** komposiittiavaimesta: `"${source}:${path}:${startLine}:${endLine}:${chunkHash}:${providerModel}"` → **ei stabiili** (muuttuu jos tiedostoa muokataan ja rivit siirtyvät)
- **`chunks.embedding`** on JSON-serialisoitu `number[]` (TEXT-sarake)
- **`chunks.model`** erittelee eri embedding-providereilla luodut chunkit (sama tiedosto voi tuottaa eri embeddingit eri mallilla)
- **`source`** on joko `"memory"` tai `"sessions"`
- **`chunks_vec`** on `vec0`-taulu (`sqlite-vec`-laajennus), jota käytetään nopeaan kosinietäisyyshakuun. Jos `sqlite-vec` ei ole saatavilla, käytetään in-memory fallbackia.
- **FTS5** voi epäonnistua alustuksessa (esim. jos SQLite-versio ei tue sitä) → tarkistetaan `ftsAvailable`-lipulla

---

## 5. Chunking-algoritmi

**Lähde:** `src/memory/internal.ts`, rivi 184–265 (`chunkMarkdown`)

### 5.1 Toimintaperiaate

Chunking on **rivipohjainen** (ei Markdown-semanttinen):

1. Tiedoston sisältö jaetaan riveiksi (`content.split("\n")`)
2. Rivejä kerätään puskuriin kunnes `maxChars`-raja ylittyy
3. Kun raja ylittyy, puskuri flushataan chunkiksi
4. Overlap-mekanismi: flushin jälkeen viimeiset `overlapChars`-merkin verran rivejä siirretään seuraavan chunkin alkuun

### 5.2 Konfiguraatio

| Parametri | Oletusarvo | Merkitys                      |
| --------- | ---------- | ----------------------------- |
| `tokens`  | 400        | Chunkin maksimikoko tokeneina |
| `overlap` | 80         | Päällekkäisyys tokeneina      |

**Huom:** Tokenit muunnetaan merkeiksi kertoimella 4: `maxChars = tokens * 4 = 1600`, `overlapChars = overlap * 4 = 320`.

### 5.3 Chunkin rakenne

```typescript
type MemoryChunk = {
  startLine: number; // 1-indeksoitu
  endLine: number; // 1-indeksoitu
  text: string; // Chunkin teksti
  hash: string; // SHA-256(text)
};
```

### 5.4 Pitkät rivit

Jos yksittäinen rivi on pidempi kuin `maxChars`, se segmentoidaan `maxChars`-kokoisiin osiin. Jokainen segmentti käsitellään omana "rivinään" (sama `lineNo`).

### 5.5 Chunk ID:n laskenta (indeksoinnissa)

**Lähde:** `src/memory/manager-embedding-ops.ts`

```typescript
const chunkId = hashText(
  `${source}:${relPath}:${chunk.startLine}:${chunk.endLine}:${chunk.hash}:${providerModel}`,
);
```

**Kriittinen havainto:** ID riippuu `startLine`:sta ja `endLine`:sta. Jos tiedostoon lisätään tai poistetaan rivejä, kaikki alla olevien chunkkien rivit siirtyvät → ID:t muuttuvat → vanhat chunkit poistetaan ja uudet luodaan.

---

## 6. Embedding-providerit

**Lähde:** `src/memory/embeddings.ts`, `src/memory/manager-embedding-ops.ts`

### 6.1 Tuetut providerit

| Provideri | Malli                    | Dimensiot | Huom                    |
| --------- | ------------------------ | --------- | ----------------------- |
| OpenAI    | `text-embedding-3-small` | 1536      | Oletus, batch-tuki      |
| Gemini    | `gemini-embedding-001`   | 768       | Batch-tuki              |
| Voyage    | `voyage-4-large`         | 1024      | Batch-tuki              |
| Mistral   | `mistral-embed`          | 1024      |                         |
| Local     | node-llama               | vaihtelee | Ei tarvitse API-avainta |

### 6.2 Auto-detection

Provideri valitaan automaattisesti (`"auto"`-moodi) tarkistamalla API-avainten saatavuus. Järjestelmä käyttää ensimmäistä saatavilla olevaa provideria.

### 6.3 Batch-prosessointi

Chunkit ryhmitellään eräiksi (`buildEmbeddingBatches`) max. 8000 tokenia per erä. Kunkin erän chunkit lähetetään providerille yhdessä API-kutsussa.

Virheenhallinta:

- Max. 3 uudelleenyritystä per erä (eksponentiaalinen backoff)
- Jos virheitä kertyy `BATCH_FAILURE_LIMIT` (2) kappaletta, embedding-operaatiot lopetetaan ja siirrytään FTS-only-tilaan

### 6.4 Embedding-välimuisti

Embeddingit talletetaan `embedding_cache`-tauluun avaimella `(provider, model, provider_key, hash)`. Jos chunkin teksti ei ole muuttunut (sama hash), embedding haetaan välimuistista eikä API-kutsua tehdä. LRU-pruning siistii vanhat merkinnät.

---

## 7. Hakuputki

### 7.1 Haun päävaiheet

Kun agentti kutsuu `memory_search`:ia querylla:

```
1. Synkronoi tiedostot (jos dirty)
2. Valitse hakutila:
   a) Hybrid (vektori + FTS)  ← normaali
   b) FTS-only                ← jos ei embedding-provideria
3. Suorita haut
4. Yhdistä tulokset (merge)
5. Sovella temporal decay (valinnainen)
6. Lajittele pistemäärän mukaan
7. Sovella MMR-uudelleenjärjestys (valinnainen)
8. Palauta top-N tulokset
```

### 7.2 Vektorihaku (`searchVector`)

**Lähde:** `src/memory/manager-search.ts`, rivi 20–94

Kaksi polkua:

1. **sqlite-vec saatavilla:** Käytetään `vec_distance_cosine()`:ia suoraan SQL-kyselyssä (`chunks_vec`-taulusta). Score = `1 - distance`.
2. **Fallback:** Ladataan kaikki chunkit muistiin (`listChunks`), lasketaan `cosineSimilarity()` jokaiselle ja lajitellaan.

### 7.3 Avainsanahaku (`searchKeyword`)

**Lähde:** `src/memory/manager-search.ts`, rivi 136–191

FTS5-haku `chunks_fts`-taulusta:

- Query tokenisoidaan ja muunnetaan AND-yhdistetyksi FTS5-kyselyksi: `"sana1" AND "sana2"`
- BM25-rank muunnetaan [0,1]-pisteytykseksi: `1 / (1 + rank)`

### 7.4 Hybridiyhdistäminen (`mergeHybridResults`)

**Lähde:** `src/memory/hybrid.ts`, rivi 51–149

Vektori- ja avainsanatulokset yhdistetään chunk-ID:n perusteella:

```
score = vectorWeight × vectorScore + textWeight × textScore
```

Oletuspainot: `vectorWeight = 0.7`, `textWeight = 0.3`.

Jos chunk löytyy vain toisesta hausta, puuttuva pisteytys on 0.

### 7.5 FTS-only-tila

**Lähde:** `src/memory/query-expansion.ts`

Kun embedding-provideria ei ole:

- Käytetään pelkkää FTS5-hakua
- Query laajennetaan: poistetaan stop-sanat (monikielinen: EN, ES, PT, AR, KO, JA, ZH), validoidaan avainsanat
- Korean kielessä poistetaan sanan lopun partikkelit
- CJK-kielille generoidaan n-grammeja

---

## 8. Temporal Decay (ajallinen rapautuminen)

**Lähde:** `src/memory/temporal-decay.ts`

### 8.1 Toimintaperiaate

Eksponentiaalinen rapautuminen pistemäärään:

```
decayed_score = score × exp(-λ × age_in_days)
λ = ln(2) / halfLifeDays
```

Oletuskonfiguraatio:

- **Käytössä:** `false` (disabled by default)
- **Puoliintumisaika:** 30 päivää

### 8.2 Ajan lähde

1. **Polun päiväys:** `memory/YYYY-MM-DD.md` → päiväys polusta (regex: `/memory\/(\d{4})-(\d{2})-(\d{2})\.md$/`)
2. **Tiedoston mtime:** fallback jos polusta ei löydy päiväystä
3. **Evergreen:** `MEMORY.md`, `memory.md` ja päiväämättömät `memory/` -tiedostot eivät rapaudu koskaan (`null` timestamp → ei rapautumista)

### 8.3 Merkitys assosiatiivisen muistin pluginille

Nykyinen temporal decay on **tiedostotasoinen** (kaikki chunkit samasta tiedostosta rapautuvat samalla nopeudella). Assosiatiivisen muistin design-dokin rapautuminen on **chunk-tasoinen** (jokainen muisto rapautuu itsenäisesti riippuen käyttötiheydestä ja assosiaatiovahvuudesta).

---

## 9. MMR (Maximal Marginal Relevance)

**Lähde:** `src/memory/mmr.ts`

MMR-uudelleenjärjestys parantaa tulosten **diversiteettiä** vähentämällä samankaltaisten tulosten kasautumista:

```
MMR_score = λ × relevance - (1-λ) × max_similarity(chunk, selected_chunks)
```

- **Samankaltaisuus:** Jaccard-samankaltaisuus tokenisoiduilla snippet-teksteillä
- **λ (lambda):** 0.7 (oletus) – painottaa relevanssia diversiteetin yli
- **Käytössä:** `false` (disabled by default)

MMR sovelletaan **lajittelun jälkeen** – se uudelleenjärjestää jo pistemääräksi lajitellut tulokset.

---

## 10. Synkronointimekanismit

**Lähde:** `src/memory/manager-sync-ops.ts`

### 10.1 Triggeret

| Triggeri         | Mekanismi                                    | Kohdistus        |
| ---------------- | -------------------------------------------- | ---------------- |
| Session start    | `ensureWatcher()`, `ensureSessionListener()` | Molemmat lähteet |
| Haku (jos dirty) | `runSync()` ennen hakua                      | Molemmat lähteet |
| Tiedostomuutos   | chokidar-watcher, 2s debounce                | Memory-tiedostot |
| Sessiopäivitys   | Transcript update -tapahtuma, 5s debounce    | Sessiotiedostot  |
| Interval-timer   | Säännöllinen tarkistus                       | Molemmat         |
| Full reindex     | Jos skeema muuttunut tai provider vaihtunut  | Kaikki tiedostot |

### 10.2 Synkronointiprosessi (`syncMemoryFiles`)

1. Listaa kaikki muistitiedostot (`listMemoryFiles`)
2. Vertaa hasheja `files`-tauluun
3. Muuttuneet tiedostot uudelleenindeksoidaan (`indexFile`)
4. Poistetut tiedostot siivotaan (`chunks`, `files`, FTS, vec)

### 10.3 Tiedostovahti

chokidar valvoo:

- `MEMORY.md`, `memory.md`
- `memory/**/*.md`
- Extra paths -konfiguraation polut

Muutostapahtumissa asetetaan `dirty = true` ja synkronoidaan debouncen jälkeen.

### 10.4 Safe Reindex

Täydellinen uudelleenindeksointi käyttää **atomista swap-mekanismia**:

1. Luo väliaikainen tietokanta
2. Indeksoi kaikki tiedostot sinne
3. Vaihda vanhan tilalle
4. Säilytä varmuuskopio

---

## 11. Agentin muistityökalut

### 11.1 memory_search

**Lähde:** `src/agents/tools/memory-tool.ts` (`createMemorySearchTool`)

Schema:

```json
{
  "query": "string (required)",
  "maxResults": "number (optional, default 6)",
  "minScore": "number (optional, default 0.35)"
}
```

Toiminta:

1. Hae `MemorySearchManager` → kutsu `search(query, { maxResults, minScore })`
2. Muotoile tulokset citation-muodossa: `path#startLine-endLine`
3. Chat-tyyppisissä kanavissa (esim. Telegram) viittaukset voivat olla erilaisia

### 11.2 memory_get

**Lähde:** `src/agents/tools/memory-tool.ts` (`createMemoryGetTool`)

Schema:

```json
{
  "path": "string (required)",
  "from": "number (optional, start line)",
  "lines": "number (optional, default 50)"
}
```

Toiminta:

1. Validoi polku: `isMemoryPath()` tai sallittu extra path
2. Lue tiedosto, palauta pyydetty rivialue
3. Vain `.md`-tiedostot sallittu

### 11.3 Rekisteröinti: memory-core plugin

**Lähde:** `extensions/memory-core/index.ts` (38 riviä)

```typescript
const memoryCore = {
  id: "memory-core",
  kind: "memory" as const, // eksklusiivinen slotti
  register(api: OpenClawPluginApi) {
    api.registerTool(api.runtime.tools.createMemorySearchTool());
    api.registerTool(api.runtime.tools.createMemoryGetTool());
    api.runtime.tools.registerMemoryCli(api);
  },
};
```

Plugin käyttää **runtime.tools-factory-funktioita** – varsinainen logiikka on core-koodissa. Plugin on pelkkä "liimakerros".

---

## 12. System Prompt: Memory Recall

**Lähde:** `src/agents/system-prompt.ts`, rivi 37–63

System prompt sisältää hardkoodatun osion:

```
## Memory Recall
Before answering anything about prior work, decisions, dates, people,
preferences, or todos: run memory_search on MEMORY.md + memory/*.md;
then use memory_get to pull only the needed lines.
Citations: include Source: <path#line> when it helps the user verify
memory snippets.
```

**Ehdot:**

- Ei näytetä `isMinimal`-tilassa (aliagentti/cron) → aliagentti ei käytä muistia automaattisesti
- Ei näytetä jos `memory_search` ja `memory_get` eivät ole saatavilla (ei memory-pluginia)
- Citations-moodi `"off"` → "do not mention file paths or line numbers"

---

## 13. Session-memory bundled-hook

**Lähde:** `src/hooks/bundled/session-memory/handler.ts` (329 riviä)

Tämä on **bundled-hook** (ei plugin), joka tallentaa session-kontekstin muistitiedostoon.

### 13.1 Laukaisu

Laukaistaan **`/new` tai `/reset`** -komennolla (session_reset-tapahtuma).

### 13.2 Toiminta

1. Lue JSONL-transkripti (nykyinen tai edellinen sessio)
2. Poimi viimeiset ~15 user/assistant-viestiä
3. Generoi LLM:llä slug tiedostonimelle
4. Kirjoita `memory/YYYY-MM-DD-<slug>.md` -tiedosto sisältäen:
   - Session key, ID, lähde
   - Keskustelun yhteenveto

### 13.3 Suhde memory-core:en

Session-memory on **itsenäinen** memory-core:sta. Se kirjoittaa tiedostoja `memory/`-kansioon, ja memory-core indeksoi ne automaattisesti chokidar-watcherin kautta.

Jos assosiatiivinen muisti -plugin korvaa memory-core:n, session-memory-hook **jatkaa silti toimintaansa**. Plugin joko hyödyntää nämä tiedostot tai session-memory pitää disabloida.

---

## 14. Backendit

### 14.1 Builtin (oletus)

**Lähde:** `src/memory/manager.ts`

- SQLite + embeddings + FTS5 + sqlite-vec
- Kaikki yllä kuvattu arkkitehtuuri
- Singleton-instanssi per agentti (`INDEX_CACHE`)

### 14.2 QMD (ulkoinen)

**Lähde:** `src/memory/backend-config.ts`

- Ulkoinen `qmd`-työkalu, joka hallitsee omia kokoelmiaan
- Erilaiset hakumoodit: `search`, `vsearch`, `query`
- Omat päivitysintervallit ja -rajat
- `FallbackMemoryManager` wrappaa QMD:n builtin-fallbackilla: jos QMD epäonnistuu, vaihdetaan automaattisesti builtin-backendiin

### 14.3 Backendin valinta

`getMemorySearchManager()` ratkaisee backendin konfiguraatiosta:

- Jos `qmd`-backend on konfiguroitu, käytetään sitä (fallback builtin:iin)
- Muutoin käytetään builtin-backendia
- Tulos välimuistitetaan (`SEARCH_MANAGER_CACHE`)

---

## 15. MemorySearchManager-rajapinta

**Lähde:** `src/memory/types.ts`

```typescript
interface MemorySearchManager {
  search(
    query: string,
    options?: {
      maxResults?: number;
      minScore?: number;
      sources?: MemorySource[];
    },
  ): Promise<MemorySearchResult[]>;

  readFile(
    relPath: string,
    range?: {
      from?: number;
      lines?: number;
    },
  ): Promise<string | null>;

  status(): Promise<MemoryProviderStatus>;
  sync(): Promise<void>;
  probeEmbeddingAvailability(): Promise<MemoryEmbeddingProbeResult>;
  probeVectorAvailability(): Promise<boolean>;
  close(): Promise<void>;
}
```

Tämä on rajapinta, jonka **sekä builtin- että QMD-backend toteuttavat**. Plugin ei suoraan toteuta tätä – se käyttää factory-funktioita, jotka palauttavat työkaluja, jotka käyttävät tätä rajapintaa.

---

## 16. Hakutuloksen rakenne

**Lähde:** `src/memory/types.ts`

```typescript
type MemorySearchResult = {
  path: string;
  startLine: number;
  endLine: number;
  score: number;
  snippet: string;
  source: MemorySource;
  citation?: string;
};
```

Snippet on rajoitettu 700 merkkiin (`SNIPPET_MAX_CHARS`).

---

## 17. Analyysi assosiatiivisen muistin näkökulmasta

### 17.1 Mitä voidaan hyödyntää sellaisenaan

| Komponentti                 | Hyödynnettävyys | Perustelu                                                |
| --------------------------- | --------------- | -------------------------------------------------------- |
| Flat-tiedostot lähtökohtana | Kyllä           | Ihmisluettava, git-yhteensopiva – hyvä pohja             |
| Embedding-providerit        | Kyllä           | Sama infra toimii assosiatiivisessa haussa               |
| SQLite-tallennus            | Kyllä           | Indeksoinnin pohja, laajennettavissa assosiaatiotaululla |
| FTS5                        | Kyllä           | Avainsanahaku pysyy hyödyllisenä                         |
| Embedding-välimuisti        | Kyllä           | Vähentää API-kutsuja                                     |
| chokidar-watcher            | Mahdollisesti   | Jos muistot ovat edelleen tiedostoja                     |

### 17.2 Mitä pitää korvata tai laajentaa

| Komponentti              | Ongelma                                    | Ratkaisu                                                 |
| ------------------------ | ------------------------------------------ | -------------------------------------------------------- |
| Chunk ID                 | Ei stabiili – muuttuu tiedostoa muokatessa | Plugin tarvitsee **oman chunk-identiteetin**             |
| Chunking-algoritmi       | Ei semanttinen, rivipohjainen              | Plugin voi käyttää omaa chunkkausta (esim. muisto-oliot) |
| Temporal decay           | Tiedostotasoinen, ei chunk-tasoinen        | Plugin toteuttaa oman decay-mallin (per-muisto)          |
| Haku                     | Puhtaasti vektori/BM25, ei assosiaatioita  | Plugin lisää assosiaatiopohjaisen boosting-kerroksen     |
| System prompt            | Hardkoodattu "Memory Recall"               | Osa A: tehtävä ehdolliseksi                              |
| memory_search/memory_get | Palauttaa chunkkeja, ei muisto-olioita     | Plugin rekisteröi omat työkalut                          |

### 17.3 Chunk-identiteetin ongelma (kriittinen)

Nykyinen chunk ID on:

```
SHA-256("${source}:${path}:${startLine}:${endLine}:${chunkHash}:${providerModel}")
```

Tämä tarkoittaa:

- **Rivin lisäys tiedostoon** → kaikki alla olevat chunkit saavat uuden `startLine/endLine` → uudet ID:t
- **Providerin vaihto** → kaikki chunkit saavat uuden ID:n
- **Tiedoston uudelleennimeäminen** → kaikki chunkit saavat uuden ID:n

Assosiatiivinen muisti **ei voi linkittää muistoja näillä ID:illä**, koska assosiaatiot katkeaisivat jokaisella muokkauksella.

**Ratkaisuvaihtoehdot (research-07:ssä tarkemmin):**

1. Plugin generoi omat stabiilit UUID:t muisto-olioille (ei johda tiedostorakenteesta)
2. Yksi tiedosto = yksi muisto (tiedostonimi = ID)
3. Muistot frontmatter-kentillä (YAML id: ...)
4. Erillinen assosiaatiotietokanta, joka ei viittaa chunk-ID:ihin vaan muisto-ID:ihin

### 17.4 Arkkitehtuuristrategia

Plugin voi toimia **kahdella tasolla**:

1. **"Päällekirjoitus"** – Plugin korvaa memory-core:n (eksklusiivisen slotin kautta), rekisteröi omat `memory_search`/`memory_get`-työkalut (tai eri nimiset), ja hallitsee omaa tietomalliaan. Hyödyntää embedding-infraa mutta ei SQLite-skeemaa.

2. **"Kerros päälle"** – Plugin lisää assosiaatiokerroksen nykyisen muistijärjestelmän päälle. Kuuntelee `after_tool_call`:eja, rakentaa assosiaatiot, ja boostaa hakutuloksia assosiaatiovalmiudella. Nykyinen muistijärjestelmä pysyy pohjana.

**Suositus:** Vaihtoehto 1 on puhtaampi – se antaa täyden hallinnan tietomallista. Vaihtoehto 2 on helpompi aloittaa mutta johtaa "kahden järjestelmän" monimutkaisuuteen.

---

## 18. Päivitetty Osa A -muutosten taulukko

Research-06 tuo esiin seuraavat uudet tai tarkennetut Osa A -tarpeet:

| #   | Kohde                                      | Tärkeys          | Tila               | Kuvaus                                                                   |
| --- | ------------------------------------------ | ---------------- | ------------------ | ------------------------------------------------------------------------ |
| 1   | ExtensionFactory-rekisteröinti             | Välttämätön      | Tunnistettu (R-04) | `api.registerExtension(factory)` plugin API:iin                          |
| 2   | `buildMemorySection()` ehdolliseksi        | Välttämätön      | Tunnistettu (R-02) | Memory Recall -osio pois kun memory-plugin korvaa                        |
| 3   | `sessionFile` → after_compaction           | Välttämätön      | Tunnistettu (R-04) | 2 rivin korjaus auto-compaction-polkuun                                  |
| 4   | AGENTS.md muistiosiot                      | Ratkeaa hookilla | Tunnistettu (R-02) | Bootstrap-hook korvaa – ei koodimuutosta                                 |
| 5   | session-memory bundled-hook                | Suositeltava     | **Uusi (R-06)**    | Disablointi/ohitus kun toinen memory-plugin aktiivinen                   |
| 6   | Pi-agent tick-laskuri                      | Pitkä aikaväli   | Tunnistettu (R-04) | Ei kriittinen – after_tool_call riittää                                  |
| 7   | Embedding-provideri pluginin käytettävissä | Selvitettävä     | **Uusi (R-06)**    | Plugin tarvitsee pääsyn embedding-infraan (onko runtime.tools riittävä?) |

---

## 19. Yhteenveto ja johtopäätökset

1. **Nykyinen muistijärjestelmä on hyvin rakennettu** hakukäyttöön: hybrid-haku, batch-embeddings, FTS-fallback ja temporal decay ovat toimivia komponentteja.

2. **Kriittinen puute assosiatiiviselle muistille on chunk-identiteetin epästabiilius.** Plugin ei voi rakentaa assosiaatioita nykyisten chunk-ID:iden varaan.

3. **Plugin korvaa memory-core:n** eksklusiivisen slotin kautta. Tämä on selkein arkkitehtuuripolku: plugin rekisteröi omat työkalut, hallitsee omaa tietomalliaan ja hyödyntää olemassa olevaa embedding-infraa.

4. **Embedding-infra on arvokas resurssi.** Sen uudelleenkäyttö pluginissa on merkittävä etu – ei tarvitse rakentaa omaa embedding-putkea.

5. **Session-memory-hook on itsenäinen riippuvuus**, joka pitää joko hyödyntää (luetaan sen tuottamat tiedostot) tai disabloida.

6. **Seuraava askel (research-07):** Suunnitella assosiatiivisen muistin tietomalli – stabiilit muisto-identiteetit, assosiaatiorakenne, konsolidaatio ja decay – huomioiden tässä dokumentissa tunnistetut rajoitteet ja mahdollisuudet.

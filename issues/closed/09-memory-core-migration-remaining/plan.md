# Plan: Memory-core → Associative Memory Importer

> **Tila:** Draft v3
> **Päivätty:** 4.4.2026
> **Riippuvuudet:** index.ts (plugin registration), types.ts, memory-manager.ts

---

## Tavoite

Importoida OpenClaw:n memory-core-muistijärjestelmän sisältö assosiatiiviseen muistijärjestelmään. Memory-coren muistot ovat tavallisia markdown-tiedostoja (`MEMORY.md`, `memory.md`, `memory/*.md`), jotka ovat totuuden lähde.

Import tapahtuu automaattisesti kun plugin käynnistyy ja havaitsee vanhat muistot. Käyttäjän ei tarvitse tehdä mitään.

---

## Arkkitehtuuri

### Automaattinen migraatio käynnistyksessä

```
Plugin käynnistyy
         │
         ▼
┌────────────────────────────────────────────┐
│  registerService("memory-migration")       │
│  start():                                  │
│                                            │
│  1. Tarkista db-state: "migrated"?         │
│     → Jos kyllä: lopeta                    │
│                                            │
│  2. Skannaa memory-core-tiedostot          │
│     → MEMORY.md, memory.md, memory/*.md    │
│     → Jos ei löydy: merkitse migrated,     │
│       lopeta                               │
│                                            │
│  3. Segmentoi markdown-it:llä              │
│     → Otsikkotasolla (H1/H2/H3)           │
│     → Iso segmentti → pilko kappaleittain  │
│     → Pieni segmentti → yhdistä            │
│                                            │
│  4. Rikasta erissä (runEmbeddedPiAgent)    │
│     → type, temporal_state, temporal_anchor│
│     → 3–5 segmenttiä per LLM-kutsu        │
│                                            │
│  5. Tallenna MemoryManager.store():lla     │
│     → Content-hash-dedupe estää duplikaatit│
│                                            │
│  6. Merkitse db-state: "migrated"          │
│     → Uudelleenkäynnistys ei aja uudelleen│
└────────────────────────────────────────────┘
```

### Miksi tämä arkkitehtuuri

1. **Nolla käyttäjätoimia** — plugin hoitaa migraation itse käynnistyksessä
2. **LLM-rikastus suoraan** — `api.runtime.agent.runEmbeddedPiAgent()` antaa LLM-kutsut
3. **Idempotenssi** — db-state-lippu estää uudelleenajon, content-hash estää duplikaatit
4. **Ei välivaiheen tilaa** — ei JSON-tiedostoja, ei batch-koneistoa

---

## Tiedostojen löytäminen

| Polku | Lähde | Luonne |
|-------|-------|--------|
| `MEMORY.md`, `memory.md` | Workspace root | Evergreen |
| `memory/*.md` | Workspace root | Päivätyt (YYYY-MM-DD.md) |
| Extra paths | `api.config` → memory-core extraPaths | Vaihtelee |

Tiedostojen löytäminen noudattaa samaa logiikkaa kuin memory-core:
1. Tarkista `MEMORY.md` ja `memory.md` (workspace root)
2. Kävele `memory/`-kansio rekursiivisesti (vain `.md`, ei symlinkkejä)
3. Lisää konfiguraation `extraPaths`-polut
4. Deduplikoi `realpathSync`:llä
5. **Järjestä deterministisesti** (root-tiedostot ensin, sitten leksikaalinen polkujärjestys)

---

## Segmentointi

Käytetään **markdown-it**-parseria (jo riippuvuutena openclaw:n kautta). Tämä ratkaisee:
- Koodilohkojen sisällä olevat `#`-rivit eivät aiheuta vääriä jakoja
- YAML-frontmatter tunnistetaan oikein
- CRLF/BOM käsitellään automaattisesti

### Segmentointilogiikka

1. Parsitaan markdown-it:llä token-listaksi
2. Pilkotaan `heading_open`-tokenien kohdalla (H1/H2/H3)
3. Jos segmentti > ~2000 merkkiä → pilko kappaleittain, fallback: sana-/merkkijako
4. Jos segmentti < ~200 merkkiä → yhdistä seuraavan kanssa (vain saman tason sisällä)
5. Pura metadata per segmentti:
   - `heading` (parsittu teksti, ei `#`-syntaksia) + `heading_level`
   - `date` (tiedostonimestä)
   - `evergreen` (MEMORY.md/memory.md = true)

### Segmentin rakenne

```typescript
type ImportSegment = {
  id: number;
  source_file: string;       // Suhteellinen polku workspacesta
  heading: string | null;     // Otsikkoteksti (ei #-syntaksia)
  heading_level: number | null;
  date: string | null;        // ISO-päivä tiedostonimestä
  evergreen: boolean;
  content: string;
  char_count: number;
};
```

---

## LLM-rikastus

Käytetään `api.runtime.agent.runEmbeddedPiAgent()` segmenttien rikastamiseen erissä (3–5 segmenttiä per kutsu).

### Prompt-rakenne

```
Analysoi nämä muistisegmentit ja palauta JSON-taulukko:

Jokaiselle segmentille päättele:
- type: fact | decision | preference | observation | plan | narrative
- temporal_state: none (ajaton) | past | present | future
- temporal_anchor: ISO-päivämäärä (jos tunnistettavissa)
- Jos segmentti sisältää useita erillisiä asioita, pilko ne erillisiksi muistiyksiköiksi
  (palauta useampi rivi samalla id:llä)

Segmentit:
[segmentit tähän]

Palauta JSON: [{ id, type, temporal_state, temporal_anchor }]
```

### Virhetilanteet

- LLM-kutsu epäonnistuu → käytä oletusarvoja (type: "observation", temporal_state: "none")
- Yksittäinen segmentti epäonnistuu → jatka seuraavaan
- Kaikki kutsut epäonnistuvat → logita varoitus, merkitse silti migrated (voidaan ajaa manuaalisesti uudelleen)

---

## Tilan hallinta

Migraation tila tallennetaan `MemoryDatabase.setState()`:lla:

| Avain | Arvo | Tarkoitus |
|-------|------|-----------|
| `migration_completed_at` | ISO-timestamp | Estää uudelleenajon |
| `migration_source_count` | numero | Montako tiedostoa löydettiin |
| `migration_segment_count` | numero | Montako segmenttiä importoitiin |

Uudelleenajo: ei manuaalista triggeriä V1:ssä. Jos käyttäjä haluaa ajaa uudelleen, voi nollata db-staten CLI:n kautta.

---

## Toteutussuunnitelma

### Vaihe 1: Segmentointi (markdown-it)

Päivitä `src/import-preprocess.ts`:
- Vaihda regex-parsinta markdown-it:iin
- Korjaa cross-platform-polut — katso OpenClaw:n omasta koodista miten polkuja käsitellään (`path.isAbsolute()`, `dirname(rel) === "."`, polkujen normalisointi)
- Lisää symlink-suojaus ja per-tiedosto-virheenkäsittely
- Järjestä löydetyt tiedostot deterministisesti
- Lisää fallback-jako ylisuurille kappaleille (sana-/merkkitaso kun kappale > MAX_SEGMENT_CHARS)
- Poista batch-koneisto (`getNextBatch`, `skipBatch`, `ImportState`, jne.)

### Vaihe 2: Testit segmentoinnille

Päivitä `src/import-preprocess.test.ts`:
- Lisää testit: koodilohkojen sisällä olevat headingit
- Lisää testit: CRLF, BOM, frontmatter-reunatapaukset
- Lisää testit: ylisuuret kappaleet (fallback-split)
- Lisää testit: per-tiedosto-virheenkäsittely
- Poista batch-testit

### Vaihe 3: Migraatiopalvelu

Lisää `src/index.ts`:iin:
- `api.registerService("memory-migration", { start, stop })`
- `start()`: tarkista state → discover → segment → enrich → store → mark done
- LLM-rikastus `runEmbeddedPiAgent()`:lla erissä
- Virheenkäsittely ja logging

### Vaihe 4: Testit migraatiopalvelulle

- Service start: ei memory-core-tiedostoja → ei mitään
- Service start: tiedostoja löytyy → importoi
- Service start: jo migratoitu → ohita
- LLM-virhe → fallback-arvot
- Idempotenssi: uudelleenajo ei luo duplikaatteja

---

## Päätökset

### Q1: LLM-provider → `runEmbeddedPiAgent()`
Käytetään OpenClaw:n omaa runtime-API:a. Ei tarvita erillistä konfiguraatiota.

### Q2: Sessiotranskriptit → Ei V1:ssä
Ei `--scope`-flagia, ei session-parsintaa. Myöhemmin erillinen feature.

### Q3: Extra paths → Automaattisesti
`api.config` antaa pääsyn memory-coren konfiguraatioon.

### Q4: Idempotenssi → Content-hash + db-state
- Memory ID on sisällön SHA-256-hash → sama sisältö = sama ID = ohitetaan
- `migration_completed_at` db-state estää uudelleenajon

### Q5: Markdown-parseri → markdown-it
Jo riippuvuutena. Ratkaisee koodilohko-, frontmatter- ja CRLF-ongelmat.

### Q6: Käyttäjäinteraktio → Ei mitään
Migraatio on täysin automaattinen. Ei CLI-komentoja, ei skill-prompteja.

---

## Suunnitteluperiaatteet

1. **Nolla käyttäjätoimia** — migraatio tapahtuu automaattisesti
2. **Olemassa olevan infran hyödyntäminen** — markdown-it, runEmbeddedPiAgent, MemoryManager.store()
3. **Yksinkertaisin ratkaisu** — ei välitilaa, ei batch-koneistoa, ei state-tiedostoja
4. **Luotettava segmentointi** — markdown-it parseri regexin sijaan
5. **Graceful degradation** — virheet eivät estä migraatiota, fallback-arvot käytössä

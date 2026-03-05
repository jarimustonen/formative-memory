# Design-01: Tietomalli – Muisto-olio ja muistotyypit

> **Tila:** Vedos 2 (yksinkertaistettu malli)
> **Päivitetty:** 28.2.2026
> **Riippuvuudet:** Research-sarja (valmis), observations (02-research-07)
> **Ruokkii:** Kaikki muut design-dokumentit

---

## 1. Tarkoitus

Määritellä assosiatiivisen muistin **perusyksikkö** – muisto-olio (Memory) – ja sen ominaisuudet. Tämä on kaiken muun perusta: assosiaatiot, elinkaari, haku ja konsolidaatio rakentuvat tämän päälle.

---

## 2. Muisto-olio (Memory)

### 2.1 Määritelmä

Muisto on **koherentti semanttinen yksikkö** – ei mekaaninen tekstipalanen. Se edustaa yhtä asiaa, joka agentilla on "mielessä": tapahtumaa, faktaa, päätöstä, havaintoa tai tulkintaa.

Erona nykyiseen memory-core-chunkkiin:
- Chunk = mekaaninen tekstipalanen (400 tokenia, 80 tokenin overlap)
- Muisto = semanttinen yksikkö (koko vaihtelee sisällön mukaan)

### 2.2 Rakenne (kenttäluettelo)

| Kenttä | Tyyppi | Kuvaus |
| --- | --- | --- |
| `id` | string | Content hash (SHA-256 tekstisisällöstä) |
| `content` | string | Muiston sisältö (narratiivinen teksti) |
| `type` | enum | Muistotyyppi (ks. luku 3) |
| `temporal_state` | enum | `future` \| `present` \| `past` |
| `temporal_anchor` | ISO datetime? | Päivämäärä johon muisto ankkuroituu |
| `created_at` | ISO datetime | Luontiaika |
| `strength` | float | Muiston vahvuus (0.0–1.0, 1.0 = täysi vahvuus) |
| `source` | enum | Miten muisto syntyi: `agent_tool`, `hook_capture`, `consolidation`, `import` |
| `consolidated` | boolean | Onko muisto konsolidoitu vähintään kerran |
| `embedding` | float[] | Embedding-vektori (dimensio riippuu providerista) |

**Muutokset vedos 1:stä:**
- `decay` → `strength` (selkeämpi semantiikka: korkea = vahva)
- Tick-kentät poistettu (yksinkertaistus: päivätaso riittää V1:ssä)
- `last_retrieved_at`, `retrieval_count` poistettu (johdetaan retrieval.log:sta konsolidaatiossa)
- `tags`, `source_context`, `content_preview` poistettu (MVP-karsinta)
- `consolidated` lisätty (working vs. consolidated -jako)

### 2.3 Content hash identiteettinä

**Päätös #1 (tehty):** Muiston identiteetti = SHA-256(content).

Perusteet:
- Content-addressable: sama sisältö = sama id, deduplikaatio ilmaiseksi
- Ei erillistä ID-rekisteriä
- Kun sisältö muuttuu (konsolidaatio, väritys), uusi hash syntyy → assosiaatiot siirretään atomisesti samassa transaktiossa

**Ulkoisen muokkauksen käsittely:** Jos käyttäjä muokkaa muistitiedostoa käsin, file watcher havaitsee muutoksen. Tietokannassa on vanha hash → diffataan ja siirretään assosiaatiot lähimpiin uusiin muistoihin.

### 2.4 Muiston koko

**Ehdotus:** Dynaaminen koko, semanttinen koherenssi määrää.
- Alaraja: ~20 tokenia (yksittäinen fakta)
- Yläraja: ~500 tokenia (pehmeä raja, varoitus konsolidaatiossa)
- Ei mekaanista pilkkomista – muisto on niin pitkä kuin tarvitsee, mutta ei pidempi

---

## 3. Muistotyypit

### 3.1 Taksonomi

| Tyyppi | Kuvaus | Esimerkki | Retrieval-painotus |
| --- | --- | --- | --- |
| `narrative` | Tapahtuma, kokemus, keskustelu | "Jari kertoi projektipalaverin menneen hyvin" | Embedding-painotteinen |
| `fact` | Faktuaalinen tieto | "Jarin koiran nimi on Namu" | Hybridi |
| `decision` | Tehty päätös ja perustelu | "Päätettiin käyttää SQLiteä koska..." | Hybridi |
| `tool_usage` | Virheviesti, config, komento | "sqlite-vec unavailable -virhe korjattiin..." | BM25-painotteinen |
| `interpretation` | Tulkinta/käsitys (syntyy konsolidaatiossa) | "Jari matkustaa usein Tampereelle" | Embedding-painotteinen |
| `preference` | Käyttäjän tai agentin preferenssi | "Jari haluaa vastaukset suomeksi" | BM25-painotteinen |

### 3.2 Tyypin merkitys

Muistotyyppi **ei ole vain luokittelu** – se vaikuttaa:
1. **Hakustrategiaan** (BM25/embedding-painotus, ks. design-04)
2. **Konsolidaatiokäyttäytymiseen** (interpretationit syntyvät konsolidaatiossa, eivät suoraan)

**V1-yksinkertaistus:** Kaikilla muistotyypeillä on sama decay-nopeus (λ = 0.0231). Muistotyyppikohtainen decay on V2-ominaisuus.

### 3.3 Tyypin määritys

Muistotyyppi asetetaan **luontihetkellä**:
- Agentin luomille muistoille: agentti valitsee tyypin (työkalu-parametri)
- Hook-capturen muistoille: plugin päättelee kontekstista
- Konsolidaation muistoille: yleensä `interpretation`
- Importoiduille: plugin arvaa heuristiikalla (voidaan korjata myöhemmin)

---

## 4. Tallennus

### 4.1 Kaksijakoinen muisti: working + consolidated

Muistot tallennetaan **kahteen tiedostoon** chunkkimerkinnöillä:

```
memory/
├── working.md              ← päivän raakat muistot (ei konsolidoitu)
├── consolidated.md         ← vähintään kerran konsolidoidut muistot
├── retrieval.log           ← co-retrieval-loki (append-only, parsitaan konsolidaatiossa)
├── associations.db         ← SQLite: assosiaatiot, strength, tila, embeddings
└── .layout.json            ← Layout-manifesti
```

**working.md** kerää päivän aikana syntyvät muistot. Konsolidaatio ("uni") prosessoi ne → siirtää `consolidated.md`:hen, mahdollisesti yhdistäen ja tiivistäen.

**consolidated.md** on tyyppijaoteltua – samassa tiedostossa osioittain.

### 4.2 Tiedostoformaatti

**working.md:**

```markdown
# Working Memory

<!-- chunk:a1b2c3d4 type:narrative created:2026-02-28T14:30:00Z -->
Jari kertoi projektipalaverin menneen hyvin. Keskusteltiin muisti-pluginin
arkkitehtuurista ja päätettiin käyttää flat-tiedostoja tietokannan rinnalla.
<!-- /chunk -->

<!-- chunk:e5f6a7b8 type:fact created:2026-02-28T15:00:00Z -->
Jarin koiran nimi on Namu.
<!-- /chunk -->
```

**consolidated.md:**

```markdown
# Consolidated Memory

## Narrative

<!-- chunk:c9d0e1f2 strength:0.85 retrievals:3 created:2026-02-25 -->
Jari kertoi projektipalaverin menneen hyvin. Arkkitehtuuripäätökset tehtiin
yhdessä ja päädyttiin flat-tiedostoihin.
<!-- /chunk -->

## Facts

<!-- chunk:a3b4c5d6 strength:0.92 retrievals:7 created:2026-02-20 -->
Jarin koiran nimi on Namu.
<!-- /chunk -->

## Decisions

...

## Preferences

...

## Tool Usage

...

## Interpretations

...
```

### 4.3 Retrieval-loki

Co-retrieval-tapahtumat kirjataan append-only-lokitiedostoon `memory/retrieval.log` normaalikäytössä. Konsolidaatio parsii lokin ja prosessoi assosiaatiot.

```
2026-03-05T14:30:00Z search a1b2c3d4 e5f6a7b8 c9d0e1f2
2026-03-05T14:35:00Z search a1b2c3d4 f3a4b5c6
2026-03-05T14:35:12Z store  f3a4b5c6 context:a1b2c3d4,e5f6a7b8
```

- `search` = nämä muistot palautuivat yhdessä (co-retrieval)
- `store` = uusi muisto luotiin näiden kontekstissa (co-creation)
- Konsolidaatio parsii lokin, päivittää assosiaatiot, tyhjentää/arkistoi lokin

Retrieval.log palvelee kahta tarkoitusta:
1. **Co-retrieval-parit** → assosiaatiopäivitykset konsolidaatiossa
2. **Yksittäisten muistojen retrieval-kerrat** → strength-vahvistus konsolidaatiossa

**V1-periaate: nolla tietokantakirjoitusta normaalikäytössä.** Kaikki muutokset (strength, assosiaatiot, decay) tapahtuvat konsolidaatiossa. Päivän aikana plugin vain lisää rivejä lokiin ja lukee tietokantaa hakujen yhteydessä.

Perusteet:
- Ei tietokantakirjoituksia normaalikäytössä (vain tiedosto-append)
- Ihmisluettava – näkee suoraan mitä agentti on hakenut
- Debug-ystävällinen – retrieval-patternit näkyvissä ennen konsolidaatiota
- Volyymi pieni (~100–5000 paria/päivä) – ei tarvitse indeksejä

### 4.5 Chunkkimerkinnän formaatti

```
<!-- chunk:<id> [key:value ...] -->
Muiston sisältö (voi olla monirivinen)
<!-- /chunk -->
```

Avainparit ovat valinnaisia metadata-kenttiä. Tietokanta on auktoritatiivinen lähde metadatalle – tiedoston merkinnät ovat informatiivisia (ihmisluettavuus, debug).

### 4.6 SQLite-skeema

```sql
-- Muisto-indeksi
CREATE TABLE memories (
  id TEXT PRIMARY KEY,              -- content hash
  type TEXT NOT NULL,                -- muistotyyppi
  temporal_state TEXT DEFAULT 'past',
  temporal_anchor TEXT,              -- ISO datetime
  created_at TEXT NOT NULL,
  strength REAL DEFAULT 1.0,         -- [0, 1], 1.0 = uusi/vahva
  source TEXT NOT NULL,              -- agent_tool, hook_capture, consolidation, import
  consolidated INTEGER DEFAULT 0,   -- 0 = working, 1 = consolidated
  file_path TEXT NOT NULL            -- 'working.md' tai 'consolidated.md'
);

-- Assosiaatiot (ks. design-02)
CREATE TABLE associations (
  memory_a TEXT NOT NULL,
  memory_b TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 0.0,  -- [0, 1]
  created_at TEXT NOT NULL,
  last_updated_at TEXT,
  PRIMARY KEY (memory_a, memory_b),
  CHECK (memory_a < memory_b)        -- kaksisuuntainen: aina aakkosjärjestyksessä
);

-- Embeddings (regeneroitavissa)
CREATE VIRTUAL TABLE memory_embeddings USING vec0(
  id TEXT PRIMARY KEY,
  embedding float[768]               -- dimensio providerista
);

-- FTS (regeneroitavissa)
CREATE VIRTUAL TABLE memory_fts USING fts5(
  id,
  content,
  type
);

-- Globaali tila
CREATE TABLE state (
  key TEXT PRIMARY KEY,
  value TEXT
);
-- Esimerkkejä: last_consolidation_at, sleep_count, layout_version
```

### 4.7 Layout-manifesti

```json
{
  "layout": "associative-memory-v1",
  "schema_version": 1,
  "created_at": "2026-02-28T10:00:00Z",
  "migrated_from": "memory-core-v1"
}
```

Tallennetaan sekä `memory/.layout.json`-tiedostoon **että** `state`-tauluun tietokannassa.

---

## 5. Strength-malli (decay & retrieval)

Muiston vahvuus (`strength`) muuttuu kahdella tavalla:

### 5.1 Decay (nukkuessa)

```
strength ← strength × e^(-λ)
```

- `λ = ln(2) / 30 ≈ 0.0231` → puoliintumisaika 30 unta
- Käytännössä: `strength ← strength × 0.977` per uni
- Tapahtuu **vain** konsolidaatiossa ("uni"), ei reaaliajassa

### 5.2 Retrieval-vahvistus (nukkuessa)

```
strength ← 1 - (1 - strength) × e^(-η × n)
```

- `η = 0.7` → yksi retrieval puolittaa välimatkan 1.0:aan
- `n` = päivän retrieval-kertojen määrä (lasketaan retrieval.log:sta)
- Tapahtuu **konsolidaatiossa**, ei reaaliajassa

### 5.3 Ominaisuudet

- Aina (0, 1] – molemmat kaavat ovat multiplikatiivisia
- Eksponentiaalinen: rapautuminen kiihtyy ilman retrievalia, vahvistuminen hidastuu lähellä 1.0
- Ebbinghaus-yhteensopiva: ei-haettu muisto noudattaa klassista unohtamiskäyrää
- Kaksi konfiguroitavaa parametria: `λ` (decay-nopeus) ja `η` (reinforcement-vahvuus)

### 5.4 Muiston kuolema

- Strength ≤ 0.05 → konsolidaatio tunnistaa kuolleeksi
- Kuollut muisto poistetaan tiedostosta ja tietokannasta
- Assosiaatiot poistetaan

---

## 6. Avoimet kysymykset

1. **Embedding-dimensio:** Skeemassa hardkoodattu 768 – pitäisikö olla dynaaminen providerin mukaan?
2. **Tiedoston kasvu:** Kun consolidated.md kasvaa suureksi, tarvitaanko pilkkomista (esim. vuosikohtaiset tiedostot)?
3. **Chunk-merkinnän parsi:** Markdown-kommentti (`<!-- chunk:... -->`) on näkymätön renderöinnissä – onko tämä haluttu vai haittaako se luettavuutta?

---

## 7. Päätökset

| # | Päätös | Perustelu |
| - | ------ | --------- |
| 1 | Content hash (SHA-256) identiteettinä | Content-addressable, yksinkertainen, atominen |
| 2 | SQLite backendiksi | ACID, sqlite-vec + FTS5, oikea skaala |
| 3 | Plugin ei valitse embedding-mallia | Käyttäjän konfiguraatio |
| 4 | Kaksi tiedostoa: working.md + consolidated.md | Ihmisluettava, yksinkertainen, selkeä elinkaari |
| 5 | Strength-malli: decay nukkuessa, retrieval vahvistaa | Eksponentiaalinen, [0,1], kaksi parametria |
| 6 | 30 unen puoliintumisaika (λ = 0.0231) | Armollinen, muistot elävät kuukausia |
| 7 | Co-retrieval-seuranta lokitiedostoon (retrieval.log) | Ei DB-kirjoituksia normaalikäytössä, ihmisluettava, debug-ystävällinen |

---

## 8. Kytkökset muihin design-dokumentteihin

- **design-02 (Assosiaatiot):** associations-taulu, retrieval.log
- **design-03 (Elinkaari):** temporal_state-siirtymät, strength-kaavat
- **design-04 (Retrieval):** type-pohjainen hakustrategia, strength-painotus
- **design-05 (Konsolidaatio):** working→consolidated -siirto, decay-batch, pruning
- **design-06 (Integraatio):** skeeman alustus, plugin-rakenne
- **design-07 (Migraatio):** memory-core → associative-memory konversio

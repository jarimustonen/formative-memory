# Plan: Memory-core → Associative Memory Importer

> **Tila:** Draft v2
> **Päivätty:** 3.4.2026
> **Riippuvuudet:** cli.ts, index.ts (plugin registration), types.ts

---

## Tavoite

Importoida OpenClaw:n memory-core-muistijärjestelmän sisältö assosiatiiviseen muistijärjestelmään. Memory-coren muistot ovat tavallisia markdown-tiedostoja (`MEMORY.md`, `memory.md`, `memory/*.md`), jotka ovat totuuden lähde.

Importin tulee olla mahdollisimman vaivatonta: ihanteessa käyttäjä asentaa pluginin ja migraatio on yksi komento.

---

## Arkkitehtuuri

### Kaksi toteutuspolkua

**V1 (tämä suunnitelma): `openclaw memory migrate`**
CLI-komento joka tekee esiprosessoinnin, tuottaa erät ja ohjaa agentin tekemään LLM-rikastuksen.

**V2 (myöhemmin): Automaattinen tunnistus**
Plugin huomaa aktivoituessaan vanhat muistot ja ehdottaa migraatiota agentin kautta. V1:n komponentit suunnitellaan niin, että ne ovat uudelleenkäytettäviä V2:ssa.

### Pipeline

```
openclaw memory migrate
         │
         ▼
┌────────────────────────────────────────────┐
│  Vaihe 1: Esiprosessointi (registerCli)    │
│  Deterministinen, ei LLM:ää               │
│                                            │
│  • api.config → memory-coren polut         │
│  • Skannaa MEMORY.md, memory/*.md, extras  │
│  • Segmentoi otsikkotasolla                │
│  • Pura metadata (date, evergreen, heading)│
│  • Tallenna segmentit plugin-tilaan        │
│  • Tulosta yhteenveto                      │
└──────────────────┬─────────────────────────┘
                   │
                   ▼
┌────────────────────────────────────────────┐
│  Vaihe 2: LLM-rikastus (agentti)          │
│  OpenClaw:n oma LLM tekee työn            │
│                                            │
│  Agentti saa ohjeen:                       │
│  • Kutsu memory_import_batch               │
│  • Rikasta: type, temporal_state, pilko    │
│  • Tallenna memory_store:lla               │
│  • Toista kunnes done: true                │
└────────────────────────────────────────────┘
```

### Miksi tämä arkkitehtuuri

1. **Ei omaa LLM-integraatiota** — käytetään OpenClaw:n konfiguroitua mallia agentin kautta
2. **Muistipolut tulevat automaattisesti** — `api.config` tietää memory-coren polut ja extra paths
3. **Konteksti-ikkuna ei täyty** — erät pitävät sen pienenä
4. **Käyttäjä voi ohjata** — agentti on keskustelussa, käyttäjä voi tarkentaa

---

## Vaihe 1: Esiprosessointi

### Tiedostojen löytäminen

`registerCli`-kontekstissa `api.config` antaa pääsyn memory-coren konfiguraatioon:

| Polku | Lähde | Luonne |
|-------|-------|--------|
| `MEMORY.md`, `memory.md` | Workspace root | Evergreen |
| `memory/*.md` | Workspace root | Päivätyt (YYYY-MM-DD.md) |
| Extra paths | `api.config` → memory-core extraPaths | Vaihtelee |

Tiedostojen löytäminen noudattaa samaa logiikkaa kuin memory-core:
1. Tarkista `MEMORY.md` ja `memory.md` (workspace root)
2. Kävele `memory/`-kansio rekursiivisesti (vain `.md`)
3. Lisää konfiguraation `extraPaths`-polut
4. Deduplikoi `realpath`:illa

### Segmentointilogiikka

1. Pilko otsikkotasolla (H1/H2/H3-rajat)
2. Jos segmentti > ~2000 merkkiä → pilko kappaleittain
3. Jos segmentti < ~200 merkkiä → yhdistä seuraavan kanssa
4. Pura metadata per segmentti

### Segmentin rakenne

```typescript
type ImportSegment = {
  id: number;                  // Juokseva numero
  source_file: string;         // Suhteellinen polku workspacesta
  heading: string | null;      // Otsikko (jos on)
  date: string | null;         // ISO-päivä tiedostonimestä tai null
  evergreen: boolean;          // MEMORY.md/memory.md = true
  content: string;             // Segmentin teksti
  char_count: number;
};
```

### Tilan tallennus

Esiprosessoinnin tulos tallennetaan plugin-hakemistoon:
```
~/.openclaw/memory/associative/import-segments.json
```

Tämä mahdollistaa:
- CLI-komennon ja agentin välisen tiedonsiirron
- Käyttäjä voi halutessaan tarkistaa segmentit ennen jatkamista
- Myöhemmin V2 voi lukea saman tiedoston

### CLI-komento

```bash
$ openclaw memory migrate

Skannataan workspace muisteja...
  MEMORY.md (12 segmenttiä, evergreen)
  memory/2026-03-15.md (4 segmenttiä)
  memory/2026-03-20.md (6 segmenttiä)
  memory/2026-04-01.md (3 segmenttiä)

Yhteensä: 25 segmenttiä, 4 tiedostoa

Segmentit tallennettu. Avaa OpenClaw-keskustelu ja kirjoita:
  /memory import

Tai anna agentille ohje:
  "Importoi vanhat memory-core-muistit"
```

### Toteutus

- Uusi tiedosto: `src/import-preprocess.ts` — segmentointilogiikka
- Rekisteröinti: `api.registerCli()` — `openclaw memory migrate` -komento
- Ei ulkoisia riippuvuuksia — pelkkää tiedostojen lukua ja markdown-parsintaa

---

## Vaihe 2: LLM-rikastus (agentti)

### Työkalu: `memory_import_batch`

Rekisteröidään `api.registerTool()`:lla. Agentti kutsuu tätä erissä.

```typescript
// Parametrit
{
  action: "next"  // tai "status" tai "skip"
}

// Vastaus (erä)
{
  batch: 3,
  total_batches: 9,
  segments: [
    {
      id: 7,
      source_file: "MEMORY.md",
      heading: "## Tietokanta",
      date: null,
      evergreen: true,
      content: "Projekti käyttää SQLite:ä WAL-moodissa..."
    },
    // ... 2-4 lisää
  ],
  remaining: 15,
  done: false
}

// Vastaus (valmis)
{
  done: true,
  summary: {
    total_segments: 25,
    batches_processed: 9,
    skipped: 2
  }
}
```

**Eräkoko:** 3–5 segmenttiä. Riittävän pieni konteksti-ikkunalle, riittävän iso että agentti näkee kontekstia.

**Tilan hallinta:** Työkalu pitää kirjaa käsitellyistä eristä plugin-muistissa (tai `import-segments.json`:n metadata-kentässä).

### Skilli: `/memory import`

Rekisteröidään plugin-manifestissa. Injektoidaan agentille prompt-template kun käyttäjä kirjoittaa `/memory import`.

```markdown
## Memory Import

Importoi memory-core-muistit assosiatiiviseen muistijärjestelmään erissä.

### Prosessi

1. Kutsu `memory_import_batch` (action: "status") nähdäksesi tilanne
2. Jos segmenttejä odottaa, näytä yhteenveto ja kysy käyttäjältä lupa jatkaa
3. Kutsu `memory_import_batch` (action: "next") saadaksesi erä
4. Jokaiselle segmentille erässä:
   - Analysoi sisältö
   - Päättele sopiva `type`: fact | decision | preference | observation | plan | narrative
   - Päättele `temporal_state`: none (ajaton), past (tapahtunut), present (meneillään), future (tuleva)
   - Jos segmentissä on selkeä päivämäärä, aseta `temporal_anchor`
   - Jos segmentti sisältää useita erillisiä asioita, pilko erillisiksi muistiyksiköiksi
   - Kutsu `memory_store` jokaiselle muistiyksikölle
5. Toista vaiheet 3–4 kunnes `done: true`
6. Näytä loppuyhteenveto

### Ohjeita

- Älä tiivistä liikaa — säilytä substanssi
- Korvaa suhteelliset viittaukset absoluuttisilla ("eilen" → "2.4.2026")
- Käytä segmentin `date`-kenttää aikakontekstin päättelyyn
- Evergreen-segmentit ovat usein type: fact tai preference
- Päivätyt segmentit ovat usein type: observation tai decision
```

### `memory_store`-kutsut

Agentti kutsuu olemassa olevaa `memory_store`-työkalua jokaiselle muistiyksikölle:

```json
{
  "content": "Projektin tietokantana käytetään SQLite:ä WAL-moodissa...",
  "type": "decision",
  "temporal_state": "none"
}
```

Muistin `source` on "agent_tool" (normaali store-polku). Provenance-tieto tallennetaan erikseen (ks. alla).

---

## Päätökset (brainstorm-tulokset)

### Q1: LLM-provider → Ratkaistu
Käytetään OpenClaw:n omaa agenttia. Ei tarvita erillistä LLM-integraatiota tai konfiguraatiota.

### Q2: Sessiotranskriptit → Kyllä, toisessa vaiheessa
Ensin importoidaan markdown-muistitiedostot, sen jälkeen sessiotranskriptit (`sessions/*.jsonl`). CLI-flagi: `--scope full` (molemmat) vs `--scope memories` (vain markdownit, oletus). Sessioiden käsittely vaatii eri segmentointilogiikan (keskusteluvuorojen pilkkominen, suodatus).

### Q3: Extra paths → Automaattisesti
`api.config` antaa pääsyn memory-coren konfiguraatioon, joten extra paths tulevat mukaan automaattisesti.

### Q4: Interaktiivinen tarkistus → Agentti toimii itsenäisesti
Agentti ei pyydä lupaa joka erälle vaan etenee itsenäisesti. Epäselvissä tilanteissa (esim. ambivalentti sisältö, mahdollinen PII) voi konsultoida käyttäjää. Keskustelu itsessään toimii review-mekanismina — käyttäjä näkee mitä tapahtuu ja voi puuttua.

### Q5: Idempotenssi → Content-hash-dedupe riittää
- Memory ID on sisällön SHA-256-hash → sama sisältö = sama ID = ohitetaan
- Uudelleenajo on turvallista: duplikaatteja ei synny
- Jos lähdetiedostoa on muokattu, syntyy uusi muisti vanhan rinnalle — vanha rapautuu luonnollisesti decayn kautta
- Ei tarvita provenance-tallennusta, reconciliation-logiikkaa tai ghost deletion -mekanismia V1:ssä

---

## Toteutussuunnitelma

### Vaihe A: Esiprosessointi

1. **`src/import-preprocess.ts`** — Tiedostojen skannaus, segmentointi, provenance
   - `discoverMemoryFiles(workspaceDir, config)` → tiedostolista
   - `segmentMarkdown(content, filePath)` → segmentit
   - `prepareImport(workspaceDir, config)` → koko pipeline

2. **CLI-rekisteröinti** `index.ts`:ssä — `api.registerCli()` lisää `openclaw memory migrate`

3. **Testit** — segmentointilogiikalle yksikötestitestit eri markdown-rakenteilla

### Vaihe B: Agenttityökalu + Skilli

1. **`memory_import_batch`-työkalu** `index.ts`:ssä — `api.registerTool()`
   - Lukee `import-segments.json`
   - Palauttaa erän, pitää kirjaa tilasta
   - `action: "status" | "next" | "skip"`

2. **Skilli** — prompt-template `/memory import` -komennolle
   - Rekisteröidään plugin-manifestissa tai erillisessä tiedostossa

3. **Testit** — batch-logiikalle, tilan hallinnalle

### Vaihe C: Sessiotranskriptit

1. **Sessio-segmentointi** — `sessions/*.jsonl` lukeminen, keskusteluvuorojen parsinta
2. **Suodatus** — poistetaan low-value-vuorot (lyhyet, rutiinivastaukset), PII-varoitukset
3. **CLI-flagi** — `openclaw memory migrate --scope full` aktivoi sessioiden importin
4. **Skilli-laajennus** — `/memory import` -promptiin sessioiden käsittelyohjeet

### Vaihe D: Myöhemmin (ei V1)

- Automaattinen tunnistus plugin-aktivoinnissa (V2)
- Provenance-tallennus ja reconciliation
- Ghost deletion / tombstoning

---

## Suunnitteluperiaatteet

1. **Olemassa olevan infran hyödyntäminen** — `memory_store`, `api.config`, agentin LLM
2. **Erillinen esiprosessointi ja rikastus** — deterministinen osa CLI:ssä, älykäs osa agentissa
3. **Yksinkertaisin ratkaisu ensin** — content-hash-dedupe riittää, provenance ja reconciliation lisätään tarvittaessa
4. **V2-yhteensopivuus** — komponentit (segmentointi, batch) suunnitellaan uudelleenkäytettäviksi automaattisessa migraatiossa

# TODO – Memory-core-migraatio (Phase 6)

> Importoi memory-coren muistot assosiatiiviseen muistijärjestelmään.
> Suunnitelma: `plan-memory-core-importer.md`, sanasto: `../docs/glossary.md`
>
> Arkkitehtuuri: `openclaw memory migrate` (CLI) tekee esiprosessoinnin,
> agentti hoitaa LLM-rikastuksen erissä `memory_import_batch`-työkalulla + `memory_store`:lla.
> Ei omaa LLM-integraatiota — käyttää OpenClaw:n konfiguroitua mallia.

---

## 6.1 Esiprosessointi (markdown) ❌

- [ ] **`src/import-preprocess.ts`** — tiedostojen skannaus ja segmentointi
  - [ ] `discoverMemoryFiles(workspaceDir)` — skannaa `MEMORY.md`, `memory.md`, `memory/*.md` + extra paths
  - [ ] `segmentMarkdown(content, filePath)` — pilko otsikkotasolla (H1/H2/H3)
  - [ ] Liian iso segmentti (>2000 merkkiä) → pilko kappaleittain
  - [ ] Liian pieni segmentti (<200 merkkiä) → yhdistä seuraavan kanssa
  - [ ] Metadata per segmentti: source_file, heading, date (tiedostonimestä), evergreen, char_count
  - [ ] Kirjoita `import-segments.json` plugin-hakemistoon
- [ ] **Testit** — segmentointi eri markdown-rakenteilla
  - [ ] Normaali H1/H2/H3-rakenne
  - [ ] Iso segmentti → kappaleittain pilkkominen
  - [ ] Pieni segmentti → yhdistäminen
  - [ ] Päiväystunnistus tiedostonimestä (`2026-03-15.md`)
  - [ ] Evergreen-tunnistus (`MEMORY.md` vs `memory/*.md`)
  - [ ] Tyhjä/puuttuva tiedosto

## 6.2 CLI-komento: `openclaw memory migrate` ❌

- [ ] **CLI-rekisteröinti** — `api.registerCli()` lisää `openclaw memory migrate`
  - [ ] Lue workspace-polku ja memory-coren konfiguraatio `api.config`:sta
  - [ ] Kutsu `discoverMemoryFiles()` + `segmentMarkdown()`
  - [ ] Kirjoita `import-segments.json`
  - [ ] Tulosta yhteenveto (tiedostot, segmentit, ohje jatkamiseen)
  - [ ] `--scope memories` (oletus) vs `--scope full` (sisältää sessiot, vaihe 6.4)
  - [ ] Virhetilanteet: ei löydy tiedostoja, kirjoitusoikeudet, tyhjä workspace
- [ ] **Testit** — CLI-komennon integraatiotesti

## 6.3 Agenttityökalu + skilli ❌

- [ ] **`memory_import_batch`-työkalu** — `api.registerTool()`
  - [ ] Lue `import-segments.json`
  - [ ] `action: "status"` → palauta yhteenveto (montako segmenttiä, montako käsitelty)
  - [ ] `action: "next"` → palauta seuraava erä (3–5 segmenttiä)
  - [ ] `action: "skip"` → ohita nykyinen erä
  - [ ] Tilan hallinta: pidä kirjaa käsitellyistä eristä
  - [ ] `done: true` kun kaikki käsitelty + loppuyhteenveto
  - [ ] Virhetilanteet: ei import-segments.json:ää, tyhjä segments, korruptoitunut tiedosto
- [ ] **Skilli: `/memory import`** — prompt-template agentille
  - [ ] Prosessiohjeet: status → next → rikasta → memory_store → toista
  - [ ] Type-päättelyohjeet: fact, decision, preference, observation, plan, narrative
  - [ ] Temporal-päättelyohjeet: none, past, present, future + anchor
  - [ ] Segmentin pilkkomis- ja yhdistämisohjeet
  - [ ] Rekisteröinti plugin-manifestissa
- [ ] **Testit**
  - [ ] Batch-logiikka: eräkoko, tilanhallinta, done-ehto
  - [ ] Status-kutsu ilman valmista import-segments.json:ää
  - [ ] Skip-toiminnallisuus

## 6.4 Sessiotranskriptit ❌

> `openclaw memory migrate --scope full`
> Käsitellään markdown-importin jälkeen. Eri segmentointilogiikka.

- [ ] **Sessio-segmentointi** — `sessions/*.jsonl` lukeminen
  - [ ] JSONL-parsinta: user/assistant-vuorojen erottelu
  - [ ] Vuorojen pilkkominen keskusteluikkunoiksi
  - [ ] Suodatus: poistetaan low-value-vuorot (lyhyet, rutiinivastaukset)
  - [ ] PII-varoitukset (API-avaimet, salasanat, henkilötiedot)
- [ ] **Lisää sessio-segmentit `import-segments.json`:iin** — erillinen source-tyyppi
- [ ] **Skilli-laajennus** — `/memory import` -promptiin sessioiden käsittelyohjeet
- [ ] **Testit** — sessio-parsinta, suodatus, PII-tunnistus

## 6.5 Myöhemmin (ei V1)

- [ ] Automaattinen tunnistus plugin-aktivoinnissa (V2) — ehdota migraatiota agentin kautta
- [ ] Provenance-tallennus ja reconciliation
- [ ] Ghost deletion / tombstoning

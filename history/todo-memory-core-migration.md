# TODO – Memory-core-migraatio (Phase 6)

> Importoi memory-coren muistot assosiatiiviseen muistijärjestelmään.
> Suunnitelma: `plan-memory-core-importer.md`, sanasto: `../docs/glossary.md`
>
> Arkkitehtuuri: Automaattinen migraatio plugin-käynnistyksessä.
> `registerService()` havaitsee vanhat muistot, segmentoi markdown-it:llä,
> rikastaa `runEmbeddedPiAgent()`:lla ja tallentaa `MemoryManager.store()`:lla.

---

## 6.1 Esiprosessointi (markdown) ✅

- [x] **`src/import-preprocess.ts`** — tiedostojen skannaus ja segmentointi
  - [x] `discoverMemoryFiles(workspaceDir)` — skannaa `MEMORY.md`, `memory.md`, `memory/*.md` + extra paths
  - [x] `segmentMarkdown(content, filePath)` — pilko otsikkotasolla (H1/H2/H3) markdown-it:llä
  - [x] Liian iso segmentti (>2000 merkkiä) → pilko kappaleittain, fallback sanarajalla
  - [x] Liian pieni segmentti (<200 merkkiä) → yhdistä edelliseen (accumulator)
  - [x] Metadata: source_file (POSIX), heading, heading_level, date, evergreen, char_count
  - [x] Cross-platform polut (isAbsolute, dirname, realpathSync, toPosixRelative)
  - [x] Per-tiedosto-virheenkäsittely (jatkaa seuraavaan)
  - [x] Deterministinen tiedostojärjestys
  - [x] Symlink-suojaus
- [x] **Testit** (50 testiä)
  - [x] Normaali H1/H2/H3-rakenne
  - [x] Iso segmentti → kappaleittain pilkkominen
  - [x] Ylisuuret kappaleet → sanarajalla pilkkominen
  - [x] Pieni segmentti → yhdistäminen (accumulator)
  - [x] Koodilohkojen sisällä olevat headingit (markdown-it)
  - [x] YAML frontmatter (normaali, CRLF, BOM)
  - [x] Päiväystunnistus, evergreen-tunnistus
  - [x] POSIX-polut, deterministinen järjestys
  - [x] Symlinkit, lukukielletyt tiedostot

## 6.2 Migraatiopalvelu ❌

- [ ] **`registerService("memory-migration")`** — `src/index.ts`:ssä
  - [ ] `start()`: tarkista db-state `migration_completed_at`
  - [ ] Jos ei migratoitu: `discoverMemoryFiles()` + `segmentMarkdown()`
  - [ ] Jos ei tiedostoja: merkitse migratoitu, lopeta
  - [ ] LLM-rikastus erissä `runEmbeddedPiAgent()`:lla
    - [ ] Prompt: päättele type, temporal_state, temporal_anchor
    - [ ] Pyydä pilkkomaan jos segmentti sisältää useita erillisiä asioita
  - [ ] Tallenna `MemoryManager.store()`:lla
  - [ ] Merkitse db-state `migration_completed_at`
  - [ ] Virhetilanteet: LLM-virhe → fallback-arvot, yksittäinen virhe → jatka
- [ ] **Testit**
  - [ ] Ei memory-core-tiedostoja → ei mitään
  - [ ] Tiedostoja löytyy → importoi
  - [ ] Jo migratoitu → ohita
  - [ ] LLM-virhe → fallback-arvot
  - [ ] Idempotenssi: uudelleenajo ei luo duplikaatteja

## 6.3 Sessiotranskriptit ❌

> Ei V1:ssä. Myöhemmin erillinen feature.

## 6.4 Myöhemmin (ei V1)

- [ ] Provenance-tallennus ja reconciliation
- [ ] Ghost deletion / tombstoning

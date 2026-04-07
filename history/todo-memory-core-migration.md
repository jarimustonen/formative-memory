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

## 6.2 Migraatiopalvelu ✅

- [x] **`src/migration-service.ts`** — migraatiologiikka
  - [x] `runMigration()`: tarkista db-state → discover → segment → enrich → store → mark done
  - [x] LLM-rikastus erissä `EnrichFn`:lla (4 segmenttiä/erä)
  - [x] `buildEnrichmentPrompt()` + `parseEnrichmentResponse()` — LLM-prompt ja -parsinta
  - [x] Heuristinen fallback: LLM-virhe → inferType/inferTemporalState
  - [x] Per-segmentti-virheenkäsittely
  - [x] Sub-segmenttien tuki (LLM voi pilkkoa)
  - [x] Idempotenssi: db-state lippu estää uudelleenajon (vain virheettömällä ajolla)
- [x] **Testit** (17 testiä + workspace cleanup 10 testiä)
- [x] **index.ts kytkentä** — `api.registerService()` + deps wiring
  - [x] Direct LLM caller (`src/llm-caller.ts`) — Anthropic/OpenAI API suoraan fetchillä
  - [x] Auth-profiilien luku `auth-profiles.json`:sta
  - [x] `createDirectLlmEnrichFn()` — migraation enrichment
  - [x] Workspace cleanup (`cleanupWorkspaceFiles`) ensimmäisellä käynnistyksellä
  - [x] Startup gate — tool-kutsut odottavat migraation valmistumista

## 6.3 Sessiotranskriptit ❌

> Ei V1:ssä. Myöhemmin erillinen feature.

## 6.3.5 Workspace-siivous & OpenClaw PR:t ❌

- [ ] **PR openclaw-repoon:** workspace-template-irroitus (proposal: `history/proposal-decouple-memory-from-workspace-templates.md`)
- [ ] **PR openclaw-repoon:** SDK factory-funktioiden export (`createGeminiEmbeddingProvider`, `createOpenAiEmbeddingProvider`)

## 6.4 Myöhemmin (ei V1)

- [ ] Provenance-tallennus ja reconciliation
- [ ] Ghost deletion / tombstoning

# OpenClaw Release Impact Tracker

Tämä dokumentti seuraa OpenClaw-pääohjelman julkaisuja ja arvioi niiden vaikutukset associative-memory -pluginiin.

## Plugin-rajapinnat joita seurataan

| Rajapinta | Tuonti / Lähde | Käyttö |
|---|---|---|
| Plugin SDK core | `openclaw/plugin-sdk` | `OpenClawPluginApi`, `OpenClawConfig`, `AnyAgentTool` |
| Memory Embedding Registry | `openclaw/plugin-sdk/memory-core-host-engine-embeddings` | `getMemoryEmbeddingProvider`, `listMemoryEmbeddingProviders`, `MemoryEmbeddingProvider` |
| Context Engine | `openclaw/plugin-sdk` | `ContextEngine`, `ContextEngineInfo`, `delegateCompactionToRuntime` |
| Plugin Registration | `api.registerTool`, `api.registerMemoryPromptSection`, `api.registerContextEngine`, `api.registerCommand` | Pluginin rekisteröinti käynnistyksessä |

---

## v2026.3.24

**Julkaistu:** 2026-03-24
**Vaikutus:** 🟡 Kohtalainen — uusia hook-rajapintoja, ei breaking changeja pluginille

### Pluginiin vaikuttavat muutokset

- **Plugins/hooks: `before_dispatch`** — Uusi hook-tyyppi inbound-metadatalla. Ei vaikuta suoraan tähän pluginiin, mutta laajentaa hook-ekosysteemiä johon plugin voisi integroitua tulevaisuudessa.
- **Gateway/OpenAI compatibility: `/v1/embeddings`** — Lisätty embeddings-endpoint gateway-yhteensopivuuteen. Ei vaikuta pluginiin suoraan, mutta embedding-provider-ekosysteemi laajenee.

### Breaking changes

- Ei breaking changeja jotka koskevat tätä pluginia.

### Toimenpiteet

- Ei välittömiä toimenpiteitä. Tämä on pluginin `peerDependency`-minimivaatimus (`>=2026.3.24`).

---

## v2026.3.28

**Julkaistu:** 2026-03-28
**Vaikutus:** 🔴 Merkittävä — memory-plugin-sopimuksen muutoksia, embedding-rekisterin jakaminen

### Pluginiin vaikuttavat muutokset

- **Memory/plugins: pre-compaction memory flush siirretty plugin-sopimuksen taakse** — `memory-core` omistaa nyt flush-promptit ja target-path-politiikan sen sijaan että ne olisivat kovakoodattuna. Tämä muuttaa sitä miten memory-pluginit integroituvat compaction-sykliin. **Tarkistettava:** vaikuttaako `compact()`-metodiin tai `delegateCompactionToRuntime()`-kutsuun.
- **Memory/search: embedding provider -rekisteröinnit jaettu split plugin -runtimejen välillä** (#55945) — Korjaa bugin jossa memory search epäonnistui tuntemattomilla provider-virheillä. Tämä on positiivinen muutos: `listMemoryEmbeddingProviders()` ja `getMemoryEmbeddingProvider()` toimivat nyt luotettavammin split-runtime-tilanteissa.
- **Plugins/context engines: retry legacy `assemble()` ilman uutta `prompt`-kenttää** (#50848) — Runtime yrittää kutsua `assemble()`:a ensin uudella `prompt`-parametrilla, ja jos engine hylkää sen, tekee retryn ilman. **Tarkistettava:** tukeeko meidän `assemble()` jo `prompt`-kenttää vai luottaako se tähän fallbackiin.
- **Plugins/hooks: `requireApproval` lisätty `before_tool_call` -hookkeihin** (#55339) — Tool-kutsujen hyväksyntämekanismi. Ei suora vaikutus, mutta meidän rekisteröimiin työkaluihin (`memory_store`, `memory_search`, `memory_get`, `memory_feedback`) voidaan nyt kohdistaa hyväksyntäpyyntöjä.
- **Agents/compaction: stale-usage preflight compaction säilyttää AGENTS-refreshin** (#49479) — Compaction-sykli säilyttää AGENTS-datan. Positiivinen muutos context engine -käyttäytymiselle.
- **Breaking: Config/Doctor poistaa yli 2kk vanhat automaattiset migraatiot** — Ei suora vaikutus pluginiin.

### Toimenpiteet

- [x] Tarkista `assemble()`-metodi: tukee `prompt`-parametria (rivi 379: `params.prompt ?? null`)
- [x] Tarkista `compact()`-metodi: `delegateCompactionToRuntime()` delegoi runtimelle — yhteensopiva
- [x] Varmista embedding provider -toiminta split-runtime-tilanteessa — toteutettu Phase 6.5:ssa
- [x] Päivitä `peerDependency` — nostettu `>=2026.4.5`

---

## v2026.3.31

**Julkaistu:** 2026-03-31
**Vaikutus:** 🔴 Merkittävä — Plugin SDK:n legacy-polkujen deprecointi, multi-kind plugin -tuki, laaja memory/QMD-refaktorointi

### Breaking changes pluginille

- **Plugin SDK: legacy provider compat -alipoluista deprecoitu** — Vanhat `openclaw/plugin-sdk/*` bundled provider setup- ja channel-runtime-shimejä on deprecoitu migration-varoituksin. Dokumentoidut polut kuten `openclaw/plugin-sdk` ja `openclaw/plugin-sdk/memory-core-host-engine-embeddings` **säilyvät ennallaan** — tämä koskee vain legacy-alireittejä. **Tarkistettava:** käyttääkö pluginimme yhtään deprecoitua polkua.
- **Plugins/install: `critical` security scan -löydökset blokkaavat asennuksen** — Plugin-asennukset jotka sisältävät vaarallisia koodilöydöksiä vaativat nyt `--dangerously-force-unsafe-install` -lipun. **Vaikutus:** meidän pluginin asennukseen voi vaikuttaa jos security scanner hälyttää jostain riippuvuudesta.

### Pluginiin vaikuttavat muutokset

- **Multi-kind plugin -tuki** (#57507) — Pluginit voivat nyt ilmoittaa `kind: ["memory", "context-engine"]` sen sijaan että olisi vain yksi tyyppi. Tällä hetkellä meidän plugin on `kind: "memory"` mutta rekisteröi myös context enginen `api.registerContextEngine()`:lla. **Suositus:** harkittava `kind`-kentän päivittämistä arvoon `["memory", "context-engine"]` jotta dual-slot-omistajuus on eksplisiittinen. Ilman tätä toinen plugin voi ottaa context-engine-slotin haltuun ilman varoitusta, koska meidän plugin ei virallisesti ilmoita omistavansa sitä.
- **Memory/QMD: massiivinen refaktorointi** (30+ committia) — QMD-järjestelmä on saanut valtavan päivityksen:
  - FTS5-tuki konfiguroitavalla tokenizer-valinnalla (`unicode61` / `trigram`) CJK-tukeen
  - FTS-only hakupolku ilman embedding-provideria (#56473, #42714)
  - QMD-kokoelmien uudelleensidonta pattern-drift-tilanteissa
  - Per-agent `memorySearch.qmd.extraCollections` cross-agent-hakuun
  - QMD 1.1+ mcporter-yhteensopivuus legacy-fallbackilla
  - **Vaikutus pluginiin:** Ei suoraa vaikutusta koska meidän plugin käyttää omaa SQLite-indeksiä eikä QMD:tä, mutta FTS-only-polku voi olla mielenkiintoinen tulevaisuudessa.
- **Plugin SDK: callable facade -refaktorointi** — Memory-core ja muut bundled-plugin-facadet siirretty lazy-loading-malliin (`loadBundledPluginPublicSurfaceModuleSync`). `memory-core-host-engine-embeddings` polku ei muuttunut (edelleen `export * from "../../packages/memory-host-sdk/src/engine-embeddings.js"`), mutta sisäinen latausmekanismi on eri. **Vaikutus:** ei suoraa API-muutosta, mutta runtime-lataus voi käyttäytyä hieman eri tavoin edge caseissa.
- **Memory/search: FTS-only haku ilman embedding-provideria** (#56473) — `memory-core` tukee nyt muistihakua pelkällä FTS5-tekstihaulla kun embedding-provideria ei ole saatavilla. **Mahdollisuus:** meidän pluginissa vastaava fallback voisi parantaa käyttökokemusta tilanteissa joissa embedding-palvelu ei ole käytettävissä.
- **Plugins/hooks: `before_agent_reply`** ei vielä tässä versiossa (tulee 4.2:ssa), mutta hook-rajapinta laajenee yleisesti.
- **Agents/compaction: late compaction-retry double-resolve korjattu** (#57796) — Compaction-sykli on stabiilimpi, mikä hyödyttää meidän context enginen `compact()`-metodia.
- **Plugin SDK: extension test seam -refaktorointi** — Testausinfrastruktuuri muuttunut, ei vaikuta runtime-käyttäytymiseen.

### Toimenpiteet

- [x] **Kriittinen:** `openclaw.plugin.json` `kind` päivitetty `["memory", "context-engine"]`
- [x] Tarkistettu: tuonnit käyttävät `openclaw/plugin-sdk` ja `openclaw/plugin-sdk/memory-core-host-engine-embeddings` — ei deprecoituja polkuja
- [ ] Varmista plugin-asennus toimii uuden security scan -politiikan kanssa
- [ ] Harkitse FTS-fallback-hakua tilanteisiin joissa embedding-provider ei ole saatavilla

---

## v2026.4.1

**Julkaistu:** 2026-04-01
**Vaikutus:** 🟢 Ei vaikutusta — pääasiassa kanavapäivityksiä ja exec-approval-parannuksia

### Pluginiin vaikuttavat muutokset

- **Memory/session indexing: täysi reindeksointi säilyttää session-transkriptit** (#39732) — Korjaa bugin jossa `session-start` tai `watch`-triggeröity reindeksointi ohitti session-transkriptit. **Vaikutus:** positiivinen — `memory-core`:n indeksointi toimii luotettavammin, mikä voi parantaa meidän pluginin embedding-providerien kontekstia.
- **Memory/QMD: `--mask` vs `--glob` -korjaus** (#58736) — QMD-kokoelmien oletuskuviot eivät enää kollidoi uudelleenkäynnistyksessä. Ei suora vaikutus meidän pluginiin.
- **Agents/compaction: `agents.defaults.compaction.model` resolvoidaan johdonmukaisesti** (#56710) — Compaction-malli toimii nyt oikein sekä manuaalisessa `/compact`:ssa että context-engine-compaction-poluissa. **Vaikutus:** meidän `delegateCompactionToRuntime()` hyötyy tästä — konfiguroitu compaction-malli käytetään oikein.
- **Agents/failover: overload retry konfiguroitavissa** — Uusi `auth.cooldowns` -asetusperhe. Ei suora vaikutus pluginiin.
- **Plugins/bundled runtimes: externalized dependency staging korjattu** (#58782) — Korjaa 2026.3.31:n regression jossa bundled pluginien runtime-riippuvuudet eivät latautuneet oikein packed-asennuksissa. **Vaikutus:** varmistaa että meidän plugin ladataan oikein runtime-ympäristössä.

### Breaking changes

- Ei breaking changeja jotka koskevat tätä pluginia.

### Toimenpiteet

- Ei välittömiä toimenpiteitä.

---

## v2026.4.2

**Julkaistu:** 2026-04-02
**Vaikutus:** 🟡 Kohtalainen — uusia hook-rajapintoja, Task Flow plugin API

### Pluginiin vaikuttavat muutokset

- **Plugins/Task Flow: `api.runtime.taskFlow` seam** (#59622) — Uusi plugin-rajapinta jolla pluginit voivat luoda ja ohjata Task Flow:eja host-resolved OpenClaw-kontekstissa. **Mahdollisuus:** tulevaisuudessa meidän plugin voisi käyttää Task Flow:eja pitkäkestoisten memory consolidation -operaatioiden orkestrointiin (esim. `memory sleep` -komento voisi olla background Task Flow).
- **Plugins/hooks: `before_agent_reply`** (#20067) — Uusi hook jolla pluginit voivat short-circuittaa LLM-vastauksen synteettisillä vastauksilla inline-actionien jälkeen. **Mahdollisuus:** meidän plugin voisi käyttää tätä injektoidakseen muisti-kontekstin suoraan ennen vastauksen generointia, ilman erillistä context engine -sykliä.
- **Providers/runtime: provider-owned replay hook -rajapinnat** (#59143) — Uudet transcript policy, replay cleanup ja reasoning-mode dispatch -hookit. Ei suora vaikutus nykyiseen pluginiin, mutta laajentaa provider-integraation mahdollisuuksia.
- **Agents/compaction: `notifyUser` asetettavissa** (#54251) — `🧹 Compacting context...` -ilmoitus on nyt opt-in. Ei suora vaikutus pluginiin, mutta parantaa käyttökokemusta compaction-syklin aikana.
- **Channels/session routing: session-key-rajapinnat siirretty plugin-omisteisiksi** — Session-avainten generointi siirretty plugin-tasolle. Ei suora vaikutus meidän pluginiin, mutta muuttaa sitä miten sessiokonteksti resolvataan runtimessa.

### Breaking changes

- **Plugins/xAI ja Firecrawl config-polkujen siirto** — Koskee vain xAI- ja Firecrawl-plugineja, ei meidän pluginia.

### Toimenpiteet

- [ ] Harkitse Task Flow -integraatiota `memory sleep` -konsolidaatio-operaatioille (ei kiireellinen, mahdollisuus)
- [ ] Tutustu `before_agent_reply` -hookin mahdollisuuksiin muistikontekstin injektointiin

---

## v2026.4.5

**Julkaistu:** 2026-04-05
**Vaikutus:** 🔴 Merkittävä — context-engine-tyyppien exportit korjattu, uusi Bedrock embedding -provider, dreaming-rajapinta, facade-bugfix

### Pluginiin vaikuttavat muutokset

- **Plugin SDK: puuttuvat context-engine-tyypit exportattu** (#61251) — `openclaw/plugin-sdk` exporttaa nyt myös `AssembleResult`, `BootstrapResult`, `CompactResult`, `IngestResult`, `IngestBatchResult`, `SubagentEndReason` ja `SubagentSpawnPreparation`. **Vaikutus:** meidän `context-engine.ts` voi nyt käyttää näitä tyyppejä suoraan SDK:sta sen sijaan että joutuisi inferoimaan ne tai käyttämään `any`-tyyppejä. **Suositus:** päivitä context engine -toteutus käyttämään eksplisiittisiä palautustyyppejä.
- **Memory/search: Amazon Bedrock embeddings** (#61547) — Uusi embedding-provider Titan, Cohere, Nova ja TwelveLabs -malleille, AWS credential chain -autodetektiolla. **Vaikutus:** `listMemoryEmbeddingProviders()` palauttaa nyt enemmän providereja, ja `provider: "auto"` -valinta voi valita Bedrock-providerin jos AWS-tunnukset ovat konfiguroitu. Positiivinen muutos — meidän plugin hyötyy laajemmasta embedding-ekosysteemistä automaattisesti.
- **Memory/dreaming (kokeellinen)** (#60569, #60697) — Täysin uusi memory dreaming -järjestelmä:
  - Kolme vaihetta: light, deep, REM — itsenäiset aikataulut ja recovery
  - Short-term recall -promootio pitkäaikaiseen muistiin
  - `/dreaming`-komento, Dreams UI, `dreams.md`-trail
  - Aging-kontrollit: `recencyHalfLifeDays`, `maxAgeDays`
  - REM preview -työkalut: `openclaw memory rem-harness`, `promote-explain`
  - **Vaikutus:** Tämä on `memory-core`:n oma ominaisuus eikä suoraan vaikuta meidän pluginiin. Kuitenkin dreaming-järjestelmä on konseptuaalisesti hyvin lähellä meidän consolidation/sleep-mekanismia. **Huomio:** mahdollinen päällekkäisyys — onko meidän oma `memory sleep` -konsolidaatio tarpeeton jos `memory-core` tarjoaa dreamingin?
- **Plugin SDK: facade sentinel back-fill** (#61180) — Korjaa bugin jossa facade-exportit olivat tyhjiä circular provider normalization -aikana. **Vaikutus:** parantaa pluginin latausluotettavuutta — estää `is not a function` -virheitä käynnistyksen aikana.
- **Plugin SDK: memory host aliases** — Uusia `memory-host-core`, `memory-host-files`, `memory-host-markdown`, `memory-host-status` alireittejä. **Mahdollisuus:** tarjoaa uusia rajapintoja memory-host-integraatioihin joita meidän plugin voisi hyödyntää.
- **Memory: `memory-core` builtin embedding -rekisteröinnin rekursiokorjaus** (#61402) — Estää `memory-core`:n kaatumisen plugin discovery -rekursiossa. **Vaikutus:** positiivinen — parantaa embedding-rekisterin luotettavuutta runtime-tilanteessa.
- **Refactor: plugin setup ja memory capabilities siirretty rekistereihin** — Laaja sisäinen refaktorointi jossa plugin-setup ja memory-kyvykkyydet siirretty keskitettyihin rekistereihin. Ei suora API-muutos, mutta muuttaa sitä miten pluginien kyvykkyydet resolvataan runtimessa.
- **Config: legacy public config -aliakset poistettu** — Ei koske meidän pluginia suoraan (koskee `talk.voiceId`, `browser.*`, `hooks.internal.*` yms.).

### Toimenpiteet

- [x] **Suositus:** `src/context-engine.ts` päivitetty käyttämään `AssembleResult`, `CompactResult`, `IngestResult` SDK:sta
- [x] **Suositus:** `peerDependencies.openclaw` nostettu `>=2026.4.5`
- [x] Dreaming vs. consolidation -analyysi: `history/analysis-dreaming-vs-consolidation.md`. Ei päällekkäisyyttä, ei toimenpiteitä.
- [x] `kind: ["memory", "context-engine"]` päivitetty `openclaw.plugin.json`:iin
- [ ] Tutustu uusiin memory-host-aliaksiin (`memory-host-core`, `memory-host-files`, `memory-host-markdown`) — voiko niistä olla hyötyä?

# Design-06: Integraatio OpenClaw:iin

> **Tila:** Vedos 3
> **Päivitetty:** 7.3.2026
> **Riippuvuudet:** design-01–05, research-04 (hookit), research-05 (plugin-järjestelmä)
> **Ruokkii:** design-07 (migraatio)

---

## 1. Tarkoitus

Kuvata miten assosiatiivinen muisti -plugin integroituu OpenClaw:iin: mitä integraatiopisteitä OpenClaw tarjoaa, miten niitä käytetään, ja mitä muutoksia OpenClaw:iin tarvitaan erillisenä pull requestina.

---

## 2. OpenClaw:n integraatiopisteet

OpenClaw:n plugin-arkkitehtuuri tarjoaa viisi integraatiomekanismia, joita assosiatiivinen muisti käyttää:

### 2.1 Eksklusiivinen memory-slotti

Plugin ilmoittaa `kind: "memory"`, jolloin se korvaa `memory-core`-pluginin automaattisesti. Vain yksi memory-plugin voi olla aktiivinen kerrallaan. Aktivointi tapahtuu konfiguraatiolla (`plugins.slots.memory = "associative-memory"`) tai CLI:llä.

Kun memory-core poistuu, sen rekisteröimät `memory_search` ja `memory_get` -työkalut katoavat. Pluginin pitää korvata ne omilla työkaluillaan.

### 2.2 Työkalurekisteröinti (`api.registerTool`)

Plugin rekisteröi omat agenttityökalunsa, jotka korvaavat memory-core:n työkalut:

| Työkalu           | Kuvaus                                     |
| ----------------- | ------------------------------------------ |
| `memory_search`   | Semanttinen haku hakuputkella (design-04)  |
| `memory_store`    | Uuden muiston tallentaminen                |
| `memory_feedback` | Relevanssipalaute (1–3 tähteä + kommentti) |
| `memory_get`      | Muiston haku id:llä                        |

Työkalut voidaan rekisteröidä factory-funktiolla, joka saa session-kontekstin (workspaceDir, sessionKey, agentId). Factory kutsutaan jokaisella agenttiajon alussa.

**Huom:** Plugin-työkalut eivät voi ylikirjoittaa core-työkaluja nimellä. Koska memory-core disabloituu slotin kautta, sen työkalut eivät ole olemassa → pluginin samannimiset työkalut rekisteröityvät ongelmitta.

### 2.3 Hook-järjestelmä (`api.on`)

Plugin käyttää tyypitettyä hook-rajapintaa kiinnittyäkseen agentin elinkaareen:

| Hook                  | Käyttötarkoitus                                                                  | Tyyppi          |
| --------------------- | -------------------------------------------------------------------------------- | --------------- |
| `before_prompt_build` | Auto-recall: hae muistoja ja injektoi kontekstiin `prependContext`-palautuksella | muokattava      |
| `after_tool_call`     | retrieval.log-kirjaus (search/store/feedback-tapahtumat)                         | fire-and-forget |
| `agent_end`           | Automaattinen muistojen kaappaus session-transkriptistä                          | fire-and-forget |
| `before_reset`        | Session-muistojen tallennus ennen /new tai /reset                                | fire-and-forget |
| `before_compaction`   | SessionFile-polun tallennus myöhempää käyttöä varten                             | fire-and-forget |

Lisäksi bootstrap-hook (`api.registerHook("agent.bootstrap", ...)`) muokkaa AGENTS.md:n muistiohjeet vastaamaan assosiatiivisen muistin käyttöliittymää.

### 2.4 Palvelurekisteröinti (`api.registerService`)

Konsolidaatio ("uni") toteutetaan taustaprosessina, joka käynnistyy gatewayn mukana. Service saa `stateDir`:n ja `logger`:in, ja se ajaa ajastetun konsolidaation design-05:n mukaisesti.

### 2.5 CLI-rekisteröinti (`api.registerCli`)

Plugin rekisteröi diagnostiikkakomennot:

| Komento               | Kuvaus                                    |
| --------------------- | ----------------------------------------- |
| `memory stats`        | Muistojen ja assosiaatioiden tilastot     |
| `memory consolidate`  | Manuaalinen konsolidaatio                 |
| `memory inspect <id>` | Yksittäisen muiston tiedot + assosiaatiot |

---

## 3. Tarvittavat muutokset OpenClaw:iin (Osa A)

Nämä muutokset tehdään erillisenä pull requestina OpenClaw-repoon. Ne ovat itsenäisiä, taaksepäin yhteensopivia parannuksia plugin-rajapintaan.

### 3.1 Kriittinen: `buildMemorySection()` ehdolliseksi

**Ongelma:** System promptin Memory Recall -osio (`buildMemorySection()` tiedostossa `src/agents/system-prompt.ts`) on hardkoodattu ohjaamaan agenttia käyttämään `memory_search`/`memory_get`-työkaluja. Kun toinen memory-plugin on aktiivinen, nämä ohjeet ovat harhaanjohtavia tai virheellisiä.

**Muutos:** `buildMemorySection()` tarkistaa aktiivisen memory-slotin. Jos slotti ei ole `"memory-core"`, osio jätetään pois ja annetaan pluginin injektoida omat ohjeensa `before_prompt_build` → `prependContext`-hookilla.

**Vaihtoehto:** Alussa voimme kiertää ongelman rekisteröimällä työkalut nimillä `memory_search` ja `memory_get`, jolloin hardkoodatut ohjeet sattuvat toimimaan. Tämä on väliaikainen ratkaisu.

### 3.2 Kriittinen: `sessionFile` lisääminen `after_compaction`-eventtiin

**Ongelma:** Auto-compaction-polku (`handlers.compaction.ts`) ei lähetä `sessionFile`-kenttää `after_compaction`-hookissa, vaikka tyyppi sen sallii. Manuaalinen compaction (`compact.ts`) lähettää sen.

**Muutos:** Lisätään `sessionFile: ctx.params.session.sessionFile` myös `handleAutoCompactionEnd`-funktioon.

**Vaikutus:** Plugin voi analysoida post-compaction-tilan levyltä konsolidaatiota varten.

### 3.3 Suositeltava: Session-memory-hookin ehdollinen ajaminen

**Ongelma:** Bundled-hook `session-memory` tallentaa session-transkriptin `memory/`-hakemistoon `/new`- tai `/reset`-komennon yhteydessä. Tämä toimii memory-core:n rinnalla, mutta assosiatiivisen muistin plugin hoitaa muistojen tallennuksen itse → duplikaatteja.

**Muutos:** `session-memory`-hook tarkistaa aktiivisen memory-slotin. Jos slotti ei ole `"memory-core"`, hook ei aja (tai plugin voi hallita sitä itse).

### 3.4 Pitkän aikavälin: ExtensionFactory-rekisteröinti plugineille

**Ongelma:** Pi-coding-agent-kirjaston Extension API (`context`-event, `session_before_compact`-event) ei ole pluginien saavutettavissa. Plugin ei voi muokata viestejä ennen LLM-kutsua eikä integroitua compaction-summariointiin.

**Muutos:** Lisätään `api.registerExtension(factory)` tai vastaava, joka välittää pluginin rekisteröimän ExtensionFactory:n `buildEmbeddedExtensionFactories()`-funktiolle.

**Vaikutus:** Mahdollistaisi konteksti-ikkunan muokkaamisen (muistojen injektointi viesteihin) ja compaction-integraation. Ei MVP-blokkeraaja – `before_prompt_build` + `prependContext` riittää alkuun.

---

## 4. MVP ilman Osa A -muutoksia

MVP voidaan rakentaa ilman yhtään OpenClaw-muutosta:

| Ominaisuus                                         | Miten toimii                                                                                |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Omat työkalut                                      | `memory_search`/`memory_get`-nimet → hardkoodatut system prompt -ohjeet toimivat sattumalta |
| Uudet työkalut (`memory_store`, `memory_feedback`) | Bootstrap-hook muokkaa AGENTS.md:n ohjeet                                                   |
| Auto-recall                                        | `before_prompt_build` → `prependContext`                                                    |
| retrieval.log-kirjaus                              | `after_tool_call` → fire-and-forget                                                         |
| Konsolidaatio                                      | `registerService()` → ajastettu taustaprosessi                                              |
| Session-muistojen tallennus                        | `before_reset` + `agent_end`                                                                |

**Rajoitukset MVP:ssä:**

- System promptin Memory Recall -osio ei kuvaa pluginin kaikkia työkaluja (vain search/get)
- `session-memory`-hook tuottaa duplikaatteja → käyttäjä voi disabloida sen manuaalisesti
- Compaction-integraatio rajoittuu `before_compaction`-hookiin (ei post-compaction-analyysiä)

---

## 5. Päätökset

| #   | Päätös                                                    | Perustelu                                                         |
| --- | --------------------------------------------------------- | ----------------------------------------------------------------- |
| 1   | retrieval.log-kirjaus `after_tool_call`:sta               | Append-only, ei DB-kirjoituksia normaalikäytössä                  |
| 2   | Temporaalinen tarkistus yhdistetty auto-recalliin         | Yksi hook (`before_prompt_build`), ei erillistä temporal-check:iä |
| 3   | `memory_feedback` lisätty, `memory_forget` poistettu (V1) | Palaute on arvokkaampi kuin eksplisiittinen poisto                |
| 4   | MVP mahdollinen ilman Osa A -muutoksia                    | Pluginin omilla workaroundeilla päästään alkuun                   |
| 5   | Osa A -muutokset tehdään erillisenä PR:nä                 | Taaksepäin yhteensopivat, hyödyttävät kaikkia memory-plugineja    |

---

## 6. Kytkökset muihin design-dokumentteihin

- **design-01 (Tietomalli):** SQLite-skeema, retrieval.log-formaatti
- **design-02 (Assosiaatiot):** retrieval.log-kirjaus, assosiaatioiden hallinta
- **design-03 (Elinkaari):** Strength-malli, temporaaliset siirtymät, pakkoinjektio
- **design-04 (Retrieval):** Hakuputki, muistityökalut
- **design-05 (Konsolidaatio):** Service-toteutus, konsolidaatioprosessi
- **design-07 (Migraatio):** Plugin-asennus ja datan migraatio
- **Research-04 (Hookit):** Hook-rajapinnan yksityiskohdat, pi-agent-analyysi
- **Research-05 (Pluginit):** Plugin-lataus, rekisteröinti, SDK, referenssipluginit

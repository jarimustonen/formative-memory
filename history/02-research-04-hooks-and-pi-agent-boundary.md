# Research 04 – Hook-järjestelmä ja pi-coding-agent-kirjaston rajapinta

> **Tavoite:** Kartoittaa OpenClaw:n hook- ja plugin-järjestelmä sekä analysoida, mitä pi-coding-agent-kirjasto tarjoaa ja piilottaa. Tunnistaa, mihin kohtiin assosiatiivinen muisti -plugin voi kiinnittyä ja mitkä tiedot jäävät saavuttamattomiin.

---

## 1. Yhteenveto

OpenClaw:n plugin-rajapinta on erittäin kattava: 23 nimettyä hookia, työkalu-, komento- ja palvelurekisteröinti sekä eksklusiivinen slot-järjestelmä (`kind: "memory"`). Hook-järjestelmä kattaa koko agentin elinkaaren – viestien vastaanotto, LLM-syötteen rakentaminen, työkalujen suoritus, compaction ja session-hallinta.

Suurin rajoittava tekijä on **pi-coding-agent-kirjaston läpinäkymättömyys**: kirjasto hallitsee agenttista looppia sisäisesti ja tarjoaa ulospäin vain event-pohjaisen subscribe-rajapinnan. OpenClaw:n hook-kerros on rakennettu tämän rajapinnan päälle – se observoi tapahtumia, mutta ei voi injektoida logiikkaa loopin sisälle.

**Päähavainto:** Assosiatiivisen muistin plugin voi toteuttaa suurimman osan toiminnallisuudestaan nykyisellä hook-rajapinnalla. Tick-laskenta, assosiaatioiden päivitys ja konsolidaatio ovat kaikki mahdollisia. Merkittävin puute on, että **compaction-hookit eivät saa kaikkea tarvittavaa dataa** (esim. sessionFile puuttuu after_compaction:sta) ja **loopin sisäistä step-laskentaa** ei voi tehdä tarkasti.

---

## 2. Kaksikerroksinen hook-arkkitehtuuri

OpenClaw:ssa on kaksi erillistä hook-kerrosta:

### 2.1 Sisäiset hookit (Internal Hooks)

**Lähde:** `src/hooks/internal-hooks.ts`

Sisäiset hookit ovat OpenClaw:n oma rekisteri, joka käyttää event key -pohjaista mallia:

```
registerInternalHook("command:new", handler)
triggerInternalHook({ type: "command:new", ... })
```

Tapahtumatyypit:
- `command` – komentotapahtumat (`command:new`, `command:reset`)
- `session` – sessiotapahtumat
- `agent` – agenttitapahtumat (bootstrap)
- `gateway` – gateway-tapahtumat
- `message` – viestitapahtumat

Sisäiset hookit ovat käytössä mm. bundled-hookeissa kuten `session-memory` (joka tallentaa session-kontekstin muistiin `/new` tai `/reset` yhteydessä).

**Konteksti-tyypit:**
- `AgentBootstrapHookContext`: `workspaceDir`, `bootstrapFiles`, `cfg`, `sessionKey`, `sessionId`, `agentId`
- `MessageReceivedHookContext`: `from`, `content`, `timestamp`, `channelId`, `accountId`, `conversationId`, `messageId`, `metadata`

### 2.2 Plugin-hookit (Plugin Hooks)

**Lähde:** `src/plugins/types.ts`

Plugin-hookit ovat plugineille tarkoitettu tyypitetty rajapinta:

```typescript
api.on("llm_input", (event, ctx) => { ... }, { priority: 10 })
```

Plugin-hookit saavat **tyypitetyn tapahtuman ja kontekstin**. Kaikki 23 hookia on dokumentoitu alla (luku 3).

### 2.3 Kerrosten suhde

Plugin käyttää `api.on()`:ia, joka rekisteröi handlerin **plugin hook runner** -järjestelmään. Samaan aikaan plugin voi käyttää myös `api.registerHook()`:ia, joka rekisteröi internal hook -handlerin. Käytännössä:

- **api.on(hookName)** → plugin hook → `HookRunner` ajaa priority-järjestyksessä
- **api.registerHook(eventKey)** → internal hook → `triggerInternalHook` ajaa

Muisti-plugin käyttäisi todennäköisesti molempia: `api.on()` lifecycle-hookeille ja `api.registerHook()` bootstrap-hookeille.

---

## 3. Plugin-hookit: täydellinen luettelo

### 3.1 Agentin elinkaari

| Hook                   | Tyyppi          | Milloin                             | Avaindata                                                                                               |
| ---------------------- | --------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `before_model_resolve` | muokattava      | Ennen mallin valintaa               | `prompt` → voi palauttaa `modelOverride`, `providerOverride`                                            |
| `before_prompt_build`  | muokattava      | Ennen system promptin rakentamista  | `prompt`, `messages[]` → voi palauttaa `systemPrompt`, `prependContext`                                 |
| `before_agent_start`   | muokattava      | Ennen agentin käynnistystä (legacy) | Yhdistelmä edellisistä                                                                                  |
| `llm_input`            | fire-and-forget | Juuri ennen `session.prompt()`      | `runId`, `sessionId`, `provider`, `model`, `systemPrompt`, `prompt`, `historyMessages[]`, `imagesCount` |
| `llm_output`           | fire-and-forget | `session.prompt()` jälkeen          | `runId`, `sessionId`, `provider`, `model`, `assistantTexts[]`, `lastAssistant`, `usage`                 |
| `agent_end`            | fire-and-forget | Agenttiajo päättyy                  | `messages[]`, `success`, `error?`, `durationMs`                                                         |

**Konteksti kaikissa:** `PluginHookAgentContext` = `{ agentId?, sessionKey?, sessionId?, workspaceDir?, messageProvider? }`

### 3.2 Työkalut

| Hook                   | Tyyppi          | Milloin                                  | Avaindata                                                        |
| ---------------------- | --------------- | ---------------------------------------- | ---------------------------------------------------------------- |
| `before_tool_call`     | muokattava      | Ennen työkalukutsua                      | `toolName`, `params` → voi `block`, muuttaa `params`             |
| `after_tool_call`      | fire-and-forget | Työkalukutsun jälkeen                    | `toolName`, `params`, `result?`, `error?`, `durationMs`          |
| `tool_result_persist`  | muokattava      | Ennen tuloksen kirjoitusta transkriptiin | `message` (AgentMessage), `isSynthetic?` → voi muokata `message` |
| `before_message_write` | muokattava      | Ennen viestin kirjoitusta JSONL:ään      | `message`, `sessionKey`, `agentId` → voi `block` tai muokata     |

**Konteksti:** `PluginHookToolContext` = `{ agentId?, sessionKey?, toolName }`

**Fasadit:** Kaikilla työkaluhookeilla on valmiit fasadimetodit `HookRunner`:ssa:
- `runBeforeToolCall(event, ctx)` – sekventiaalinen, voi muokata/estää
- `runAfterToolCall(event, ctx)` – rinnakkainen (fire-and-forget)
- `runToolResultPersist(event, ctx)` – **synkroninen** (hot path)
- `runBeforeMessageWrite(event, ctx)` – synkroninen

### 3.3 Compaction

| Hook                | Tyyppi          | Milloin            | Avaindata                                                                      |
| ------------------- | --------------- | ------------------ | ------------------------------------------------------------------------------ |
| `before_compaction` | fire-and-forget | Compaction alkaa   | `messageCount`, `compactingCount?`, `tokenCount?`, `messages?`, `sessionFile?` |
| `after_compaction`  | fire-and-forget | Compaction päättyy | `messageCount`, `tokenCount?`, `compactedCount`, `sessionFile?`                |

**Fasadit:** Molemmat compaction-hookit on toteutettu fasadeina `HookRunner`:ssa:
- `runBeforeCompaction(event, ctx)` – fire-and-forget (`runVoidHook`)
- `runAfterCompaction(event, ctx)` – fire-and-forget (`runVoidHook`)

**Kutsupaikat:** Compaction-hookeja kutsutaan **kahdesta paikasta**:
1. **Subscribe-handleri** (`pi-embedded-subscribe.handlers.compaction.ts`) – agenttiloopin aikana tapahtuva auto-compaction
2. **Erillinen compact.ts** (`pi-embedded-runner/compact.ts`) – erillinen compaction-ajo (esim. manuaalinen tai schedule-pohjainen)

Molemmat polut käyttävät samoja `runBeforeCompaction`/`runAfterCompaction`-fasadeja.

**Huom:** `before_compaction` saa `messages[]`:n ja `sessionFile`:n, mutta `after_compaction` saa vain laskurit. Plugin voi lukea sessionFilen asynkronisesti ennen compactionia, koska kaikki viestit ovat jo levyllä.

### 3.4 Sessiot

| Hook            | Tyyppi          | Milloin         | Avaindata                                  |
| --------------- | --------------- | --------------- | ------------------------------------------ |
| `session_start` | fire-and-forget | Sessio alkaa    | `sessionId`, `resumedFrom?`                |
| `session_end`   | fire-and-forget | Sessio päättyy  | `sessionId`, `messageCount`, `durationMs?` |
| `before_reset`  | fire-and-forget | /new tai /reset | `sessionFile?`, `messages?`, `reason?`     |

### 3.5 Viestit

| Hook               | Tyyppi          | Milloin           | Avaindata                                                         |
| ------------------ | --------------- | ----------------- | ----------------------------------------------------------------- |
| `message_received` | fire-and-forget | Viesti saapuu     | `from`, `content`, `timestamp?`, `metadata?`                      |
| `message_sending`  | muokattava      | Viesti lähetetään | `to`, `content`, `metadata?` → voi `cancel` tai muuttaa `content` |
| `message_sent`     | fire-and-forget | Viesti lähetetty  | `to`, `content`, `success`, `error?`                              |

### 3.6 Aliagentit

| Hook                       | Tyyppi          | Milloin                     | Avaindata                                                    |
| -------------------------- | --------------- | --------------------------- | ------------------------------------------------------------ |
| `subagent_spawning`        | muokattava      | Aliagentti käynnistyy       | `childSessionKey`, `agentId`, `mode`, `requester?`           |
| `subagent_delivery_target` | muokattava      | Aliagentin vastauksen kohde | `childSessionKey`, `requesterSessionKey`, `requesterOrigin?` |
| `subagent_spawned`         | fire-and-forget | Aliagentti käynnistynyt     | `runId`, `childSessionKey`, `agentId`, `mode`                |
| `subagent_ended`           | fire-and-forget | Aliagentti päättynyt        | `targetSessionKey`, `reason`, `outcome?`, `error?`           |

### 3.7 Gateway

| Hook            | Tyyppi          | Milloin            | Avaindata |
| --------------- | --------------- | ------------------ | --------- |
| `gateway_start` | fire-and-forget | Gateway käynnistyy | `port`    |
| `gateway_stop`  | fire-and-forget | Gateway pysähtyy   | `reason?` |

---

## 4. Pi-coding-agent: mitä kirjasto tarjoaa ulospäin

### 4.1 AgentSession-rajapinta

Pi-coding-agent-kirjasto (`@mariozechner/pi-coding-agent`) tarjoaa OpenClaw:lle `AgentSession`-olion, joka käynnistetään `createAgentSession()`:lla. Koodista nähdään, että OpenClaw käyttää seuraavia ominaisuuksia:

| Ominaisuus                       | Käyttö                                                           |
| -------------------------------- | ---------------------------------------------------------------- |
| `session.prompt(text, options?)` | Käynnistää agenttiloopin – **tämä on musta laatikko**            |
| `session.subscribe(handler)`     | Rekisteröi event-handlerin → palauttaa `unsubscribe`             |
| `session.messages`               | Pääsy nykyiseen viestilistaukseen (AgentMessage[])               |
| `session.sessionId`              | Session-tunniste                                                 |
| `session.isCompacting`           | Boolean: onko compaction käynnissä                               |
| `session.abortCompaction()`      | Keskeytä compaction                                              |
| `session.sessionFile`            | Polku JSONL-transkriptiin (saatavilla compaction-hookissa)       |
| `session.agent`                  | Pääsy agentin sisäiseen tilaan (käytetään tool result guardissa) |

### 4.2 Subscribe-tapahtumat

`session.subscribe()` palauttaa tapahtumia, jotka OpenClaw käsittelee `createEmbeddedPiSessionEventHandler()`:ssa:

| Tapahtuma               | Käsittelijä                 | Kuvaus                                      |
| ----------------------- | --------------------------- | ------------------------------------------- |
| `message_start`         | `handleMessageStart`        | Assistentin viesti alkaa                    |
| `message_update`        | `handleMessageUpdate`       | Streaming-delta (teksti/reasoning)          |
| `message_end`           | `handleMessageEnd`          | Viesti valmis – sisältää lopullisen tekstin |
| `tool_execution_start`  | `handleToolExecutionStart`  | Työkalu alkaa – toolName, args, toolCallId  |
| `tool_execution_update` | `handleToolExecutionUpdate` | Työkalun välitulos                          |
| `tool_execution_end`    | `handleToolExecutionEnd`    | Työkalu valmis – result, isError            |
| `agent_start`           | `handleAgentStart`          | Agenttilooppi alkaa                         |
| `agent_end`             | `handleAgentEnd`            | Agenttilooppi päättyy                       |
| `auto_compaction_start` | `handleAutoCompactionStart` | Compaction alkaa                            |
| `auto_compaction_end`   | `handleAutoCompactionEnd`   | Compaction päättyy (+ willRetry)            |

### 4.3 Extension API (pi-coding-agentin sisäinen laajennusmalli)

Pi-coding-agent tarjoaa myös oman `ExtensionAPI`/`ExtensionFactory`-mallin, joka eroaa OpenClaw:n plugin-hookista. OpenClaw käyttää tätä kahdessa paikassa:

1. **`compaction-safeguard`** – rekisteröi `api.on("session_before_compact", ...)` handlerin, joka hallitsee koko compaction-summarisoinnin
2. **`context-pruning`** – rekisteröi `api.on("context", ...)` handlerin, joka voi muokata messages-listaa ennen LLM-kutsua

Extension API -tapahtumat:
- `"context"` → `ContextEvent` (messages) → voi palauttaa `{ messages: AgentMessage[] }`
- `"session_before_compact"` → compaction-data → voi palauttaa `{ compaction: { summary, ... } }` tai `{ cancel: true }`

**Tärkeä ero:** OpenClaw:n plugin-hookit ovat **wrapper** pi-agent-kirjaston subscribe-tapahtumien ympärillä. Pi-agent-kirjaston omat extensionit (`ExtensionAPI`) toimivat **loopin sisällä** – ne voivat muokata viestejä konteksti-ikkunan tasolla ennen LLM-kutsua.

---

## 5. Datavirta: hookin kutsuajankohdat attempt.ts:ssä

Seuraava kaavio näyttää, missä kohdissa attempt.ts kutsuu hookeja suhteessa pi-agent-kirjastoon:

```
┌─ attempt.ts ─────────────────────────────────────────────────┐
│                                                               │
│  1. buildSystemPromptParams()                                │
│     └─ hookRunner.runBeforePromptBuild()  ← MUOKATTAVA       │
│     └─ hookRunner.runBeforeAgentStart()   ← MUOKATTAVA       │
│                                                               │
│  2. createAgentSession({ tools, customTools, extensions })   │
│     └─ pi-agent luo session-olion                            │
│     └─ tools = OpenClaw:n koodia, kääritty hookeilla         │
│                                                               │
│  3. subscribeEmbeddedPiSession()                             │
│     └─ session.subscribe(eventHandler)                       │
│         ├─ tool_execution_start → typing-indikaattori         │
│         ├─ tool_execution_end   → after_tool_call hookiin     │
│         ├─ auto_compaction_start → before_compaction hookiin  │
│         └─ auto_compaction_end   → after_compaction hookiin   │
│                                                               │
│  4. hookRunner.runLlmInput() ← FIRE-AND-FORGET               │
│                                                               │
│  5. session.prompt(text)                                      │
│     ┌─ pi-agent-kirjaston looppi ───────────────────┐        │
│     │  LLM-kutsu → tool_use päätös                   │        │
│     │    └─ tool.execute() ← OpenClaw:n koodi:       │        │
│     │       ├─ before_tool_call hook (wrapperi)      │        │
│     │       └─ varsinainen työkalu (OpenClaw)        │        │
│     │  tool_result → LLM-kutsu → ... → end_turn     │        │
│     │  (extensionit: context, session_before_compact)│        │
│     └────────────────────────────────────────────────┘        │
│     Pi-agent hallitsee: LLM-kutsujen ajoituksen ja           │
│     looppipäätöksen. OpenClaw hallitsee: työkalujen          │
│     suorituksen (callbackit pi-agentin sisällä).             │
│                                                               │
│  6. hookRunner.runAgentEnd() ← FIRE-AND-FORGET               │
│  7. hookRunner.runLlmOutput() ← FIRE-AND-FORGET              │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

**Kriittinen havainto:** Pi-agent hallitsee **LLM-logiikkaa** (milloin kutsutaan, jatketaanko looppia). Mutta **työkalujen suoritus on OpenClaw:n koodia**: kaikki työkalut on kääritty `wrapToolWithBeforeToolCallHook()`:iin, joka ajaa `before_tool_call` -hookin ennen varsinaista suoritusta. Subscribe-tapahtumat (`tool_execution_end`) laukaisevat `after_tool_call` -hookin. Tämä tarkoittaa, että **jokainen työkalukutsu kulkee kahden hook-pisteen läpi** – tick-laskenta on luotettavaa.

Pi-agent on "musta laatikko" vain LLM-päätösten osalta: OpenClaw ei tiedä, montako LLM-kutsua tapahtuu loopin sisällä tai milloin looppi päättää lopettaa.

---

## 6. Eksklusiivinen slot-järjestelmä

**Lähde:** `src/plugins/slots.ts`

```typescript
type PluginKind = "memory";
const SLOT_BY_KIND = { memory: "memory" };
const DEFAULT_SLOT_BY_KEY = { memory: "memory-core" };
```

Vain yksi `kind: "memory"` -plugin voi olla aktiivinen kerrallaan. Oletuksena aktiivinen on `memory-core`.

`applyExclusiveSlotSelection()` disabloi muut samantyyppiset pluginit. Uusi muistiplugin voi siis korvata memory-core:n:

```typescript
export default {
  id: "associative-memory",
  kind: "memory",
  register: (api) => { ... }
}
```

### 6.1 Nykyinen memory-core-plugin

**Lähde:** `extensions/memory-core/index.ts`

Rekisteröi kaksi työkalua:
- `memory_search` – haku memory-tiedostoista (via `api.runtime.tools.createMemorySearchTool()`)
- `memory_get` – yksittäisen tiedoston luku (via `api.runtime.tools.createMemoryGetTool()`)
- CLI-komento: `api.runtime.tools.registerMemoryCli(program)`

Huomionarvoisesti: memory-core käyttää **api.runtime.tools** -rajapintaa, joka tarjoaa valmiit muistityökalut. Assosiatiivinen muisti -plugin voisi joko:
1. Käyttää samoja runtime-työkaluja pohjana ja laajentaa niitä
2. Tai korvata ne kokonaan omilla työkaluillaan

### 6.2 Session-memory bundled hook

**Lähde:** `src/hooks/bundled/session-memory/handler.ts`

Erillinen bundled-hook (ei plugin), joka:
- Kuuntelee `command:new` ja `command:reset` -tapahtumia
- Lukee JSONL-transkriptin, generoi LLM-slugin
- Tallentaa `memory/YYYY-MM-DD-<slug>.md` -tiedoston

Tämä hook toimii memory-core-pluginin rinnalla. Assosiatiivisen muistin pluginin pitää huomioida tämä hook – mahdollisesti korvata tai disabloida se.

---

## 7. OpenClawPluginApi – rekisteröintikyvykkyydet

**Lähde:** `src/plugins/types.ts`, rivit 245–284

| Metodi                                   | Kuvaus                             |
| ---------------------------------------- | ---------------------------------- |
| `registerTool(tool, opts?)`              | Agenttityökalu (suora tai factory) |
| `registerHook(events, handler, opts?)`   | Internal hook -handleri            |
| `registerHttpHandler(handler)`           | HTTP-pyyntöjen käsittelijä         |
| `registerHttpRoute({ path, handler })`   | Nimetty HTTP-reitti                |
| `registerChannel(registration)`          | Viestikanava                       |
| `registerGatewayMethod(method, handler)` | Gateway RPC -metodi                |
| `registerCli(registrar, opts?)`          | CLI-komento                        |
| `registerService(service)`               | Taustaprosessi (start/stop)        |
| `registerProvider(provider)`             | LLM-provaideri                     |
| `registerCommand(command)`               | Pikakomento (ei LLM:ää)            |
| `on(hookName, handler, { priority? })`   | Plugin hook -handleri              |

Pluginilla on myös pääsy:
- `api.config` – OpenClaw-konfiguraatio
- `api.pluginConfig` – pluginin oma konfiguraatio
- `api.runtime` – `PluginRuntime` (sisältää mm. tools-rajapinnan)
- `api.logger` – lokitus
- `api.resolvePath()` – polkujen resoluutio

---

## 8. Analyysi: assosiatiivisen muistin pluginin mahdollisuudet

### 8.1 Tick-laskenta

**Design-dokin tarve:** Sisäinen aikakäsite, joka kasvaa jokaisella agenttiloopin stepillä.

**Mahdollisuudet nykyisellä rajapinnalla:**

Tick-laskenta on mahdollista observoimalla subscribe-tapahtumia hookien kautta:

| Tapahtuma          | Tick-inkrementti        |
| ------------------ | ----------------------- |
| `llm_input`        | +1 (LLM-kutsu alkaa)    |
| `after_tool_call`  | +1 (työkalu suoritettu) |
| `after_compaction` | +1 (compaction-sykli)   |

**Rajoitus:** `llm_input` kutsutaan vain **kerran per attempt.ts-ajo** (rivi 1150), ei jokaisella agenttiloopin LLM-kutsulla. Pi-agent-kirjaston sisäiset uudelleenkutsut (työkalukutsun jälkeiset LLM-kutsut) eivät laukaise `llm_input`-hookia.

**Parempi lähestymistapa:** Käyttää `after_tool_call` -hookia primary tick-lähteenä. Jokainen työkalukutsu = yksi tick. Tämä on tarkempi kuin LLM-kutsujen laskenta, koska:
- Jokaisella tool_execution_start/end:llä voi inkrementoida laskuria
- after_tool_call saa `toolName` ja `durationMs` – hyödyllistä lisätietoa
- message_start/end -tapahtumat voi observoida `onAgentEvent`-callbackilla

**Suositeltava toteutus:** Plugin ylläpitää session-kohtaista tick-laskuria, jota kasvatetaan `after_tool_call` -hookista. Session-start nollaa laskurin.

### 8.2 Assosiaatioiden seuranta reaaliajassa

**Design-dokin tarve:** Kun muistoja palautetaan yhdessä, niiden välinen assosiaatio kasvaa.

**Mahdollisuudet:**

1. **`after_tool_call` -hook** – seurataan memory_search -kutsuja ja niiden tuloksia:
   ```
   after_tool_call: toolName="memory_search", params={query: "..."}, result={...}
   ```
   Plugin voi analysoida, mitkä muistichunkit palautuivat samassa haussa.

2. **`before_tool_call` -hook** – voi jopa muokata memory_search -kutsun parametreja tai estää sen, jos plugin korvaa muistityökalut.

3. **`tool_result_persist` -hook** – voi muokata tai rikastaa tool_result:ia ennen tallennusta JSONL:ään (esim. lisätä assosiaatiometadataa).

**Rajoitus:** Jos plugin korvaa memory_search -työkalun kokonaan (ei käytä memory-core:n versiota), after_tool_call näkee vain pluginin oman työkalun kutsut. Tämä on OK – plugin tietää omat kutsunsa.

### 8.3 Compaction-integraatio

**Design-dokin tarve:** Ennen compactionia pluginin pitää tallentaa tärkeät assosiaatiot.

**Mahdollisuudet:**

1. **`before_compaction`** saa: `messageCount`, `messages[]`, `sessionFile`
   - Plugin voi lukea kaikki viestit ja analysoida assosiaatiot
   - `sessionFile` mahdollistaa asynkronisen analyysin levyltä

2. **`after_compaction`** saa: `messageCount`, `compactedCount`
   - **Puute:** Ei saa `sessionFile`-polkua eikä post-compaction viestejä
   - Plugin pitää tallentaa `sessionFile` before_compaction:sta ja käyttää sitä jälkikäteen

3. **Pi-agent Extension API** (`session_before_compact`) – saa täydellisen datan:
   - `preparation.messagesToSummarize`, `preparation.turnPrefixMessages`
   - `preparation.fileOps` (luetut/muokatut tiedostot)
   - Voi palauttaa custom-summaryn tai peruuttaa compactionin

**Ongelma:** Plugin-hookit (luku 3) ovat OpenClaw-tason wrappereita. Pi-agent Extension API on kirjaston sisäinen. Plugin ei voi suoraan rekisteröidä ExtensionFactory:a – se vaatii OpenClaw-muutoksen (`buildEmbeddedExtensionFactories()`).

**Suositeltava ratkaisu (Osa A):** Lisätä OpenClaw:iin mekanismi, jolla plugin voi rekisteröidä pi-agent ExtensionFactory:n. Tämä mahdollistaisi:
- Pääsyn `context`-tapahtumaan (viestien muokkaus ennen LLM-kutsua)
- Pääsyn `session_before_compact`-tapahtumaan (compaction-integraatio)

### 8.4 Konsolidaatio ("uni")

**Design-dokin tarve:** Hiljaisen ajan konsolidaatiovaihe.

**Mahdollisuudet:**
- Cron-ajojen kautta (research-01:ssä tunnistettu)
- Plugin rekisteröi `registerService()` – taustaprosessi, joka herää ajastettuna
- Konsolidaatio-service käyttää pluginin omia työkaluja muistin analysointiin

**Rajoitus:** Cron-sessiot eivät saa MEMORY.md:tä (MINIMAL_BOOTSTRAP_ALLOWLIST). Pluginin pitää käyttää omia työkalujaan tai suoraa tiedostopääsyä.

### 8.5 Kontekstin rakentaminen

**Design-dokin tarve:** Muistojen injektointi kontekstiin agentin alkaessa.

**Mahdollisuudet:**

1. **`before_prompt_build`** – voi palauttaa `prependContext` tai kokonaan uuden `systemPrompt`:in
   - Saa `prompt` ja `messages[]` – voi analysoida kontekstin
   - Plugin voi hakea relevantteja muistoja ja lisätä ne system promptiin

2. **`before_agent_start`** – legacy-versio samasta

3. **Bootstrap-hook** (`api.registerHook("agent.bootstrap", ...)`) – voi muokata bootstrap-tiedostoja
   - Saa `AgentBootstrapHookContext`: `workspaceDir`, `bootstrapFiles`, `cfg`, `sessionKey`
   - Voi korvata MEMORY.md:n sisällön, muokata AGENTS.md:n muistiosioita

**Suositeltava strategia:**
- `before_prompt_build` injektoi assosiaatioiden perusteella haetut muistot `prependContext`-kenttään
- Bootstrap-hook muokkaa AGENTS.md:n muistiohjeet vastaamaan assosiatiivista muistia

### 8.6 System promptin Memory Recall -osio

**Ongelma:** `buildMemorySection()` on hardkoodattu `src/agents/system-prompt.ts`:ssä (rivit 37–63). Se kehottaa agenttia käyttämään `memory_search`/`memory_get` -työkaluja.

**Ratkaisuvaihtoehdot (Osa A):**

1. **Ehdollinen buildMemorySection** – jos memory-slot ei ole "memory-core", ohita osio
2. **Plugin-generoitu muistiosio** – `before_prompt_build` palauttaa korvaavan system prompt -osan
3. **Osion poisto/korvaus** – plugin palauttaa `systemPrompt`:in, josta Memory Recall on korvattu

`before_prompt_build` mahdollistaa `systemPrompt`-paluuarvon, joten plugin voi teoriassa korvata koko system promptin. Käytännössä tämä on hauras – parempi ratkaisu on Osa A -muutos, joka tekee Memory Recall -osion ehdolliseksi.

---

## 9. Puuteanalyysi: mitä ei voi tehdä nykyisellä rajapinnalla

### 9.1 Kriittiset puutteet

| #   | Puute                                                       | Vaikutus                                                                                                                    | Osa A -muutos                                                     |
| --- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 1   | **Pi-agent Extension API ei ole pluginien saavutettavissa** | Plugin ei voi muokata viestejä ennen LLM-kutsua (`context`-event) eikä integroitua compactioniin (`session_before_compact`) | Lisää extensionFactory-rekisteröinti plugin API:iin               |
| 2   | **`llm_input` kutsutaan vain kerran per ajo**               | Ei voi laskea agenttiloopin sisäisiä LLM-kierroksia                                                                         | Hyväksyttävä rajoitus – `after_tool_call` riittää tick-laskentaan |
| 3   | **`after_compaction` ei saa sessionFile-polkua**            | Plugin ei voi analysoida post-compaction tilaa levyltä                                                                      | Lisää `sessionFile` after_compaction-eventtiin                    |
| 4   | **`buildMemorySection()` on hardkoodattu**                  | Plugin ei voi ohittaa Memory Recall -osiota ilman koko system promptin korvaamista                                          | Tee osio ehdolliseksi memory-slotin perusteella                   |
| 5   | **AGENTS.md:n muistiohjeet ovat hardkoodatut**              | Konflikti assosiatiivisen muistin ohjeiden kanssa                                                                           | Bootstrap-hook voi ratkaista tämän                                |

### 9.2 Hyväksyttävät rajoitukset

| #   | Rajoitus                                 | Miksi hyväksyttävä                                                |
| --- | ---------------------------------------- | ----------------------------------------------------------------- |
| 1   | Ei pääsyä loopin sisäisiin LLM-kutsuihin | `after_tool_call` antaa riittävän tarkkuuden tick-laskentaan      |
| 2   | Subscribe-tapahtumat ovat asynkronisia   | Plugin voi käsitellä ne fire-and-forget ilman loopin hidastamista |
| 3   | Compaction tuhoaa vanhoja viestejä       | Plugin seuraa assosiaatioita reaaliajassa (before_compaction)     |
| 4   | Cron-sessiot eivät saa MEMORY.md:tä      | Plugin käyttää omia työkalujaan konsolidaatiossa                  |

---

## 10. Suositellut Osa A -muutokset

Tämän tutkimuksen perusteella tunnistetut OpenClaw-muutokset:

### 10.1 Välttämättömät

1. **ExtensionFactory-rekisteröinti plugineille** – `api.registerExtension(factory)` tai vastaava
   - Mahdollistaa `context`-tapahtuman käsittelyn (viestien muokkaus ennen LLM:ää)
   - Mahdollistaa `session_before_compact`-integraation
   - Toteutus: `buildEmbeddedExtensionFactories()` hakee rekisteröidyt extensionit plugin-registrystä

2. **`buildMemorySection()` ehdolliseksi** – ohita tai korvaa osio kun aktiivinen memory-slot ei ole "memory-core"
   - Toteutus: `buildMemorySection(memorySlot: string | undefined)` – palauttaa tyhjän, jos slot ei ole core

3. **`sessionFile` lisääminen `after_compaction` -eventtiin** – plugin voi analysoida post-compaction tilan

### 10.2 Suositeltavat

4. **Plugin-extensioiden pääsy AgentSession:iin** – mahdollistaisi session.messages-tiedon suoran käytön hookien ulkopuolella (esim. konsolidaatiossa)

5. **Session-memory bundled-hookin disablointi memory-slotilla** – jos aktiivinen memory-plugin ei ole core, session-memory-hook ei aja (tai plugin voi korvata sen)

### 10.3 Pitkän aikavälin

6. **Internal tick-laskuri pi-agent-kirjastoon** – kirjasto voisi altistaa `session.tickCount` tai vastaavan, joka kasvaa jokaisella LLM-kutsulla. Tämä tekisi tick-laskennasta tarkkaa.

---

## 11. Yhteenveto: plugin-arkkitehtuurin kypsyys

OpenClaw:n plugin-arkkitehtuuri on yllättävän kypsä muistin korvaamiseen:

**Vahvuudet:**
- 23 hookia kattaa koko elinkaaren
- Eksklusiivinen slot-järjestelmä (`kind: "memory"`) on suunniteltu muistipluginien korvaamiseen
- `before_prompt_build` mahdollistaa kontekstin injektoinnin
- `before_compaction` antaa pääsyn viesteihin ennen tiivistystä
- `registerTool()` mahdollistaa omien muistityökalujen rekisteröinnin
- `registerService()` mahdollistaa taustakonsolidaation

**Heikkoudet:**
- Pi-agent Extension API ei ole pluginien saavutettavissa (suurin puute)
- System promptin muistiosio on hardkoodattu
- `after_compaction` on dataltaan köyhä

**Kokonaisarvio:** ~85% tarvittavasta infrastruktuurista on olemassa. Osa A -muutokset ovat kohtuullisen pieniä ja kohdistettuja.

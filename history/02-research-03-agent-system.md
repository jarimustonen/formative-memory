# Raportti 03: Agenttijärjestelmä

> **Tutkimus tehty:** 25.2.2026
> **Tarkoitus:** Kuvata miten agenttien ajaminen toimii OpenClaw:ssa – agenttiloopin rakenne, kontekstin koostaminen ja vastauksen tuottaminen.

---

## Tiivistelmä

OpenClaw:n agenttiajo on **monivaiheinen prosessi**, joka alkaa viestin saapumisesta ja päättyy vastauksen toimittamiseen käyttäjälle. Ydin on **Pi-agentin embedded runner**, joka avaa session, koostaa kontekstin, kutsuu LLM:ää, suorittaa työkalukutsuja ja kirjoittaa tulokset takaisin transkriptiin. Tämä raportti kuvaa tämän prosessin vaihe vaiheelta.

---

## 1. Agenttiajoon johtava ketju

Raportti 01 kuvasi viisi tapaa käynnistää agenttiajo. Yleisin polku (viestikanavasta):

```
Kanava (Telegram/Discord/...)
  → auto-reply → resolveAgentRoute()
  → agentCommand() (src/commands/agent.ts)
  → runEmbeddedPiAgent() (src/agents/pi-embedded-runner/run.ts)
  → runEmbeddedAttempt() (src/agents/pi-embedded-runner/run/attempt.ts)
  → createAgentSession() + session.prompt()
  → LLM agentic loop
```

Gateway-metodikäsittelijästä (`src/gateway/server-methods/agent.ts`):

```
WebSocket RPC "agent" -pyyntö
  → validoi parametrit (viesti, agentId, sessionKey, ...)
  → ratkaise sessio (loadSessionEntry, resolveGatewaySessionStoreTarget)
  → deduplikaatiotarkistus (idempotencyKey)
  → respond(accepted) – vastaa heti "accepted"
  → agentCommand() – ajetaan asynkronisesti taustalla
  → respond(ok/error) – toinen vastaus kun valmis
```

## 2. agentCommand – orkestrointifunktio

`agentCommand()` (`src/commands/agent.ts`) on keskeisin orkestrointifunktio. Se:

1. **Validoi syötteen** – viesti, agentId, sessioavain
2. **Ratkaisee session** – `resolveSession()` palauttaa sessionId, sessionKey, sessionEntry, isNewSession
3. **Ratkaisee mallin** – provider, model, fallback-mallit
4. **Ratkaisee thinking-tason** – low/medium/high (persist sessiossa)
5. **Rakentaa skills-snapshottiin** – mitä taitoja agentti saa käyttää
6. **Ajaa agentin** – `runEmbeddedPiAgent()` tai `runCliAgent()` (CLI-backendeille)
7. **Käsittelee model fallback** – jos ensisijainen malli epäonnistuu, kokeilee varamallia
8. **Päivittää SessionEntry:n** – tokenit, malli, compaction count, ...
9. **Toimittaa vastauksen** – reitittää vastauksen oikeaan kanavaan

### Model fallback -mekanismi

```typescript
runWithModelFallback({
  primary: { provider: "anthropic", model: "claude-sonnet-4-6" },
  fallbacks: [
    { provider: "openai", model: "gpt-5.2" },
    { provider: "google", model: "gemini-3-pro-preview" }
  ],
  run: (provider, model) => runAgentAttempt({ provider, model, ... })
})
```

Jos ensisijainen malli palauttaa virheen (rate limit, auth, billing), kokeillaan varamalleja järjestyksessä.

### Auth profile rotation

Useita API-avaimia voidaan konfiguroida samalle providerille. Jos yksi avain menee cooldowniin (rate limit), järjestelmä rotoi seuraavaan.

## 3. runEmbeddedAttempt – varsinainen agenttiajo

`runEmbeddedAttempt()` (`src/agents/pi-embedded-runner/run/attempt.ts`) on ~1200-rivinen funktio, joka tekee kaiken raskaan työn. Seuraavassa vaiheet:

### 3.1 Valmistelu

```
1. Ratkaistaan workspace-hakemisto
2. Konfiguroidaan sandbox (jos käytössä)
3. Ladataan skills ja asetetaan ympäristömuuttujat
4. Ladataan bootstrap-tiedostot (AGENTS.md, CLAUDE.md, ...)
5. Luodaan työkalut (createOpenClawCodingTools)
6. Rakennetaan system prompt
```

### 3.2 System promptin rakentaminen

System prompt koostetaan `buildEmbeddedSystemPrompt()`:lla ja se sisältää:

| Osa                     | Sisältö                                                       |
| ----------------------- | ------------------------------------------------------------- |
| **Identiteetti**        | Agentin nimi, rooli, käyttäytymisohjeet                       |
| **Bootstrap-tiedostot** | AGENTS.md, workspace-kohtaiset ohjeet                         |
| **Skills-kehotteet**    | Taitojen kuvaukset                                            |
| **Runtime-info**        | Kone, OS, aika, aikavyöhyke, kanava, kyvykkyydet              |
| **Workspace notes**     | "Muista committaa muutokset" (jos workspace on git-repo)      |
| **Tool hints**          | Kanavaspesifiset vihjeet (Telegram-reaktiot, inline-napit...) |
| **Thinking guidance**   | Miten ajattelutaso vaikuttaa                                  |
| **TTS hint**            | Puhesynteesiohjeet (jos käytössä)                             |
| **Extra system prompt** | Hookien ja pluginien lisäkonteksti                            |

### 3.3 Sessiomanagerin avaaminen

```typescript
sessionManager = guardSessionManager(
  SessionManager.open(params.sessionFile),  // JSONL-tiedosto
  {
    agentId,
    sessionKey,
    inputProvenance,
    allowSyntheticToolResults,
    allowedToolNames,
  }
);
```

`guardSessionManager` on wrapper joka:
- Estää tuntemattomien työkalujen tulosten kirjoittamisen
- Validoi input provenancen
- Seuraa sessiokirjoituksia turvallisuussyistä

### 3.4 Session historian käsittely

Ennen LLM-kutsua historia sanitoidaan:

```
1. sanitizeSessionHistory() – korjaa provider-spesifiset ongelmat
2. validateGeminiTurns() – Gemini-mallin vuorottelusäännöt
3. validateAnthropicTurns() – Anthropic-mallin vuorottelusäännöt
4. limitHistoryTurns() – rajoita historian pituus (DM:ssä tyypillisesti rajoittamaton)
5. sanitizeToolUseResultPairing() – korjaa orpoutuneet tool_result-lohkot
6. replaceMessages() – aseta käsitelty historia agentin kontekstiin
```

### 3.5 Agenttiloopin käynnistys

```typescript
// Tilaa agentin tapahtumat (streaming, tool calls, compaction)
const subscription = subscribeEmbeddedPiSession({
  session: activeSession,
  runId,
  onBlockReply,       // Vastauslohko valmis
  onPartialReply,     // Streaming-tokeni
  onToolResult,       // Työkalun tulos
  onAgentEvent,       // Yleinen tapahtuma
  ...
});

// Käynnistä agentti
await activeSession.prompt(effectivePrompt, { images });
```

`session.prompt()` käynnistää **agenttiloopin** (Pi-agentin sisäinen):

```
┌─────────────────────────────────────────────────┐
│                AGENTIC LOOP                      │
│                                                  │
│  ┌─────────────────────────────────────────┐    │
│  │ 1. Kootaan konteksti:                   │    │
│  │    system prompt + historia + käyttäjä   │    │
│  │    viesti + työkalumäärittelyt           │    │
│  └──────────────────┬──────────────────────┘    │
│                     │                            │
│                     ▼                            │
│  ┌─────────────────────────────────────────┐    │
│  │ 2. LLM API -kutsu (streaming)           │    │
│  │    → streamSimple() / ollama stream     │    │
│  └──────────────────┬──────────────────────┘    │
│                     │                            │
│            ┌────────┴────────┐                   │
│            ▼                 ▼                   │
│     Teksti-vastaus     Tool call(s)              │
│            │                 │                   │
│            │                 ▼                   │
│            │  ┌─────────────────────────────┐   │
│            │  │ 3. Suorita työkalu(t)       │   │
│            │  │    exec (bash), memory,     │   │
│            │  │    sessions_send, ...       │   │
│            │  └────────────┬────────────────┘   │
│            │               │                    │
│            │               ▼                    │
│            │  ┌─────────────────────────────┐   │
│            │  │ 4. Tool result → kontekstiin │  │
│            │  │    → takaisin kohtaan 2.    │   │
│            │  └─────────────────────────────┘   │
│            │                                    │
│            ▼                                    │
│  ┌─────────────────────────────────────────┐   │
│  │ 5. Lopullinen vastaus (stop reason)      │   │
│  │    → tallennetaan JSONL:ään             │   │
│  └─────────────────────────────────────────┘   │
│                                                 │
│  [Compaction tarvittaessa – ks. luku 4]        │
│                                                 │
└─────────────────────────────────────────────────┘
```

**Loopin ominaisuudet:**

- **Streaming**: Tokenit striimataan WebSocket-yhteyden yli asiakkaille reaaliajassa
- **Multi-tool**: LLM voi kutsua useita työkaluja yhdellä vuorolla
- **Iteroiva**: Tool call → tool result → uusi LLM-kutsu → ... kunnes stop
- **Abortable**: AbortController mahdollistaa keskeytyksen (timeout tai manuaalinen)
- **Compaction-aware**: Jos konteksti kasvaa liian suureksi loopin aikana, compaction ajetaan

### 3.6 Subscription – tapahtumien käsittely

`subscribeEmbeddedPiSession()` kuuntelee agenttilooppia ja tuottaa tapahtumia:

| Tapahtuma           | Selitys                                       |
| ------------------- | --------------------------------------------- |
| `onPartialReply`    | Streaming-tokeni (delta) – striimataan UI:lle |
| `onBlockReply`      | Kokonainen vastauslohko valmis                |
| `onToolResult`      | Työkalukutsu valmistui                        |
| `onAgentEvent`      | Yleinen tapahtuma (compaction, virhe, ...)    |
| `onReasoningStream` | Thinking-tokeni (reasoning)                   |
| `assistantTexts`    | Kerätyt vastauslohkot                         |
| `toolMetas`         | Työkalujen metatiedot                         |

Gateway broadcastaa nämä tapahtumat kaikille yhdistetyille WebSocket-asiakkaille (`createAgentEventHandler()`).

## 4. Compaction agenttiajossa

Compaction voi tapahtua **agenttilooppien välissä** tai **loopin aikana**:

### Milloin compaction tapahtuu?

Pi-agentin sisäinen logiikka tarkistaa kontekstin koon jokaisen LLM-kutsun jälkeen. Jos konteksti lähestyy rajaa:

1. **Vanhemmat viestit** erotetaan historiasta
2. **generateSummary()** tiivistää ne yhteenvedoksi
3. Yhteenveto korvataan kontekstiin vanhojen viestien tilalle
4. **CompactionCount** kasvaa SessionEntry:ssä

### Memory flush compactionin yhteydessä

Konfiguroitava soft threshold (`compaction.memoryFlush.softThresholdTokens`) – kun tokeni-raja ylittyy, agentille lähetetään kehote kirjoittaa tärkeät asiat muistiin ennen tiivistystä.

```json
{
  "agents": {
    "defaults": {
      "compaction": {
        "memoryFlush": {
          "enabled": true,
          "softThresholdTokens": 80000,
          "prompt": "Write important context to memory before compaction."
        }
      }
    }
  }
}
```

## 5. Timeout ja keskeytysten käsittely

### Timeout

```typescript
const abortTimer = setTimeout(() => {
  abortRun(true);
}, params.timeoutMs);
```

- Oletustimeout konfiguroidaan `agents.defaults.timeout` (sekunteissa)
- Aliagenteilla (subagent lane) timeout on 0 = ei timeoutia
- Timeouttaessa tarkistetaan, oliko compaction käynnissä → erityiskäsittely

### Abort

Kolme abort-lähdettä:
1. **Timeout** – aikaraja ylittyi
2. **Manuaalinen** – käyttäjä tai gateway peruuttaa
3. **Ulkoinen** – AbortSignal parametrista (esim. kanavapuolen timeout)

## 6. Ajon jälkeen

Kun `session.prompt()` palaa:

1. **Tallennus**: Transkripti on jo päivitetty (SessionManager kirjoittaa lennossa)
2. **Usage**: Tokenikäyttö luetaan ja tallennetaan SessionEntry:yn
3. **Delivery**: `deliverAgentCommandResult()` lähettää vastauksen kanavalle
4. **Session store update**: `updateSessionStoreAfterAgentRun()` persistoi metatiedot
5. **Cleanup**: Lock vapautetaan, abort-timerit poistetaan, cwd palautetaan

### Vastauksen toimitus

```typescript
deliverAgentCommandResult({
  messageChannel: resolvedChannel,  // "telegram" | "discord" | ...
  to: resolvedTo,                   // vastaanottaja-ID
  threadId: resolvedThreadId,       // ketjutunniste
  assistantTexts,                   // agentin vastauslohkot
  toolMetas,                        // työkalujen metatiedot
  bestEffortDeliver,                // älä kaadu jos delivery epäonnistuu
  messagingToolSentTexts,           // jos agentti jo lähetti itse
})
```

## 7. Työkalut (pintapuolisesti)

Agenttiloopin aikana LLM voi kutsua työkaluja. Työkalut luodaan `createOpenClawCodingTools()`:

### Ydintyökalut

| Työkalu                    | Tarkoitus                                                            |
| -------------------------- | -------------------------------------------------------------------- |
| `exec` / `bash`            | Shell-komentojen suorittaminen                                       |
| `read_file`                | Tiedoston lukeminen                                                  |
| `write_file`               | Tiedoston kirjoittaminen                                             |
| `search_files`             | Tiedostohaku                                                         |
| `memory_search`            | Muistihaku (semantic search) – **memory-core-pluginin työkalu**      |
| `memory_get`               | Muistichunkin luku rivinumeroilla – **memory-core-pluginin työkalu** |
| `sessions_send`            | Viesti toiselle agentille / sessioon                                 |
| `message`                  | Viesti käyttäjälle kanavaan                                          |
| `web_search`               | Verkkohaku                                                           |
| `cron_add` / `cron_remove` | Ajastuksen hallinta                                                  |

### Työkalun elinkaari

```
1. LLM päättää kutsua työkalua (tool_use -lohko)
   → { name: "exec", input: { command: "ls -la" } }

2. Pi-agentti suorittaa työkalun
   → tool function saa inputin, palauttaa tuloksen

3. Tulos lisätään kontekstiin (tool_result)
   → { role: "tool", content: "total 42\ndrwxr-xr-x..." }

4. LLM näkee tuloksen seuraavalla vuorolla
   → voi tehdä uusia tool calls tai vastata tekstillä
```

### Sandbox

Agentti voi ajaa sandbox-moodissa, jossa:
- **exec**-työkalu suorittaa komennot Docker-kontissa
- Tiedostojärjestelmä on eristetty
- Verkkoyhteyksiä voidaan rajoittaa

## 8. Hookien ja pluginien rooli agenttiajossa

### Hook-pisteet agenttiajossa

| Hook                  | Milloin                               | Mitä voi tehdä                             |
| --------------------- | ------------------------------------- | ------------------------------------------ |
| `before_agent_start`  | Ennen promptin rakentamista           | Muokata system promptia, lisätä kontekstia |
| `before_prompt_build` | Ennen promptin rakentamista (uudempi) | Sama kuin edellä, tarkempi kontrolli       |
| `llm_input`           | Juuri ennen LLM-kutsua                | Loki/observointi                           |
| `after_agent_end`     | Ajon jälkeen                          | Jälkiprosessointi                          |

### Plugin-integraatio

Pluginit voivat:
- Rekisteröidä lisätyökaluja (tool definitions)
- Lisätä kontekstia system promptiin
- Suorittaa hookeja eri pisteissä
- Tarjota client tools (OpenResponses hosted tools)

## 9. Kokonaiskuva: Viestin elinkaari

```
Bob kirjoittaa "Mikä on huomisen sää?" Telegramissa
│
▼
Telegram Bot API → OpenClaw Telegram-kanavahandler
│
▼
MsgContext luodaan:
  Body: "Mikä on huomisen sää?"
  From: "telegram:123456"
  OriginatingChannel: "telegram"
  OriginatingTo: "123456"
│
▼
resolveAgentRoute() → agentId: "main"
buildAgentPeerSessionKey() → "agent:main:main"
│
▼
agentCommand():
  resolveSession() → sessionId: "abc-123" (tuore sessio)
  resolveConfiguredModelRef() → anthropic/claude-sonnet-4-6
│
▼
runEmbeddedPiAgent() → runEmbeddedAttempt():
│
├─ Valmistelu:
│   SessionManager.open("abc-123.jsonl")
│   buildEmbeddedSystemPrompt()
│   createOpenClawCodingTools()
│   createAgentSession()
│
├─ Historia sanitoidaan ja rajataan
│
├─ session.prompt("Mikä on huomisen sää?"):
│   │
│   ├─ LLM-kutsu #1:
│   │   System: [identity + bootstrap + tools + runtime]
│   │   History: [aiemmat viestit abc-123.jsonl:stä]
│   │   User: "Mikä on huomisen sää?"
│   │   → LLM vastaa: tool_use: web_search("Helsinki sää huomenna")
│   │
│   ├─ Tool exec: web_search → "Huomenna +5°C, pilvistä"
│   │
│   ├─ LLM-kutsu #2:
│   │   ... + tool_result: "Huomenna +5°C, pilvistä"
│   │   → LLM vastaa: "Huomenna on pilvistä ja +5°C."
│   │
│   └─ Loppu (stop_reason: "end_turn")
│
├─ Transkripti päivitetty (JSONL):
│   user: "Mikä on huomisen sää?"
│   assistant: [tool_use: web_search]
│   tool: [tool_result: "Huomenna +5°C..."]
│   assistant: "Huomenna on pilvistä ja +5°C."
│
├─ SessionEntry päivitetty:
│   totalTokens: 47000, model: "claude-sonnet-4-6", lastChannel: "telegram"
│
└─ deliverAgentCommandResult():
    channel: "telegram", to: "123456"
    text: "Huomenna on pilvistä ja +5°C."
    │
    ▼
    Telegram Bot API → Bob näkee vastauksen
```

---

## 10. Yhteenveto

| Vaihe                 | Vastuullinen komponentti            | Tiedosto                                         |
| --------------------- | ----------------------------------- | ------------------------------------------------ |
| Viestin vastaanotto   | Kanavaplugin                        | `src/telegram/`, `src/discord/`, ...             |
| Reititys              | resolveAgentRoute + session key     | `src/routing/`                                   |
| Orkestraatio          | agentCommand                        | `src/commands/agent.ts`                          |
| Session resolution    | resolveSession                      | `src/commands/agent/session.ts`                  |
| Agentti-engine        | runEmbeddedAttempt                  | `src/agents/pi-embedded-runner/run/attempt.ts`   |
| System prompt         | buildEmbeddedSystemPrompt           | `src/agents/pi-embedded-runner/system-prompt.ts` |
| Agentic loop          | createAgentSession + prompt()       | `@mariozechner/pi-coding-agent`                  |
| Compaction            | summarizeChunks                     | `src/agents/compaction.ts`                       |
| Tapahtumien striimaus | subscribeEmbeddedPiSession          | `src/agents/pi-embedded-subscribe.ts`            |
| Vastauksen toimitus   | deliverAgentCommandResult           | `src/commands/agent/delivery.ts`                 |
| Session-tallennus     | SessionManager + updateSessionStore | `src/config/sessions/`                           |

**Mitä tämä tarkoittaa muistijärjestelmälle:**

- **Muistihaun trigger**: Agentti kutsuu `memory_search`-työkalua loopin aikana kun se tarvitsee tietoa
- **Muistiin kirjoitus**: Erillistä `memory_write`-työkalua ei ole – agentti kirjoittaa muistiin yleisillä tiedostotyökaluilla (write, edit). AGENTS.md-template ohjeistaa kirjoittamaan `memory/YYYY-MM-DD.md` (päivittäiset) ja `MEMORY.md` (pitkäkestoinen).
- **Compaction-memory flush**: Kontekstin tiivistysvaiheessa agenttia kehotetaan kirjoittamaan muistiin
- **Kontekstin koko**: Muistipalautusten määrä on rajattu konteksti-ikkunan budjetilla
- **Session-transkripti**: Kaikki muistioperaatiot tallentuvat JSONL-transkriptiin (tool_use + tool_result)
- **Plugin-mahdollisuus**: Assosiatiivinen muistijärjestelmä voisi toimia:
  - Hookina (`before_prompt_build`) joka injektoi relevantteja muistoja kontekstiin
  - Omana työkaluna joka korvaa tai täydentää `memory_search`-työkalua
  - Compaction-vaiheen laajennuksena joka ajaa konsolidaation

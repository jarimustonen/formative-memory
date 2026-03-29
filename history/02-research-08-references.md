# Research-08: Lähdetiedostot koodikannasta

> **Tarkoitus:** Yhteinen viittausdokumentti kaikille research-raporteille. Listaa koodikannasta löydetyt tiedostot, funktiot ja tyypit, joihin raportit viittaavat.
> **Päivitetty:** 28.2.2026

---

## research-01-gateway.md – Gateway-arkkitehtuuri

### Gateway-ydinpalvelin

| Viittaus raportissa          | Tiedosto                     | Funktio / Rivi              | Tila |
| ---------------------------- | ---------------------------- | --------------------------- | ---- |
| Barrel-export (julkinen API) | `src/gateway/server.ts`      | –                           | OK   |
| Varsinainen toteutus         | `src/gateway/server.impl.ts` | `startGatewayServer()` :168 | OK   |

### Channel Manager & käynnistys

| Viittaus raportissa                          | Tiedosto                               | Funktio / Rivi | Tila |
| -------------------------------------------- | -------------------------------------- | -------------- | ---- |
| `createChannelManager()`                     | `src/gateway/server-channels.ts`       | :80            | OK   |
| `startGatewaySidecars()` → `startChannels()` | `src/gateway/server-startup.ts`        | :130           | OK   |
| `ChannelPlugin`-rajapinta                    | `src/channels/plugins/types.plugin.ts` | –              | OK   |

### Ydinkanavat (`src/`)

| Kanava         | Raportin viittaus | Pääsisäänkäyntipiste                              |
| -------------- | ----------------- | ------------------------------------------------- |
| Telegram       | `src/telegram`    | `src/telegram/bot.ts` → `createTelegramBot()`     |
| Discord        | `src/discord`     | `src/discord/client.ts` → `createDiscordClient()` |
| Slack          | `src/slack`       | `src/slack/index.ts`                              |
| Signal         | `src/signal`      | `src/signal/index.ts`                             |
| iMessage       | `src/imessage`    | `src/imessage/client.ts` → `IMessageRpcClient`    |
| WhatsApp (web) | `src/web`         | `src/web/inbound.ts` → `monitorWebInbox()`        |

### Laajennuskanavat (`extensions/`)

| Kanava     | Raportin viittaus       | Pääsisäänkäyntipiste                   |
| ---------- | ----------------------- | -------------------------------------- |
| MS Teams   | `extensions/msteams`    | `extensions/msteams/src/index.ts`      |
| Matrix     | `extensions/matrix`     | `extensions/matrix/src/runtime.ts`     |
| Zalo       | `extensions/zalo`       | `extensions/zalo/src/runtime.ts`       |
| Zalo User  | `extensions/zalouser`   | `extensions/zalouser/src/runtime.ts`   |
| Voice Call | `extensions/voice-call` | `extensions/voice-call/src/runtime.ts` |

### Reititys ja sessiot

| Viittaus raportissa       | Tiedosto                       | Funktio / Rivi                 | Tila |
| ------------------------- | ------------------------------ | ------------------------------ | ---- |
| `resolveAgentRoute()`     | `src/routing/resolve-route.ts` | –                              | OK   |
| `resolveDefaultAgentId()` | `src/agents/agent-scope.ts`    | –                              | OK   |
| Sessioavaimet, `dmScope`  | `src/routing/session-key.ts`   | :123 (tyyppi), :127 (logiikka) | OK   |
| Binding-säännöt           | `src/routing/bindings.ts`      | `listBindings()`               | OK   |

### Paritusmekanismi

| Viittaus raportissa             | Tiedosto                          | Funktio                       | Tila |
| ------------------------------- | --------------------------------- | ----------------------------- | ---- |
| Parituskoodi & hyväksyntä       | `src/pairing/pairing-store.ts`    | `approveChannelPairingCode()` | OK   |
| CLI: `openclaw pairing approve` | `src/cli/pairing-cli.ts`          | `registerPairingCli()`        | OK   |
| Kanavapluginien paritusadapteri | `src/channels/plugins/pairing.ts` | `getPairingAdapter()`         | OK   |
| Sallittulistat (allowFrom)      | `src/channels/allow-from.ts`      | –                             | OK   |

### Viestikonteksti ja vastauksen reititys

| Viittaus raportissa                | Tiedosto                                       | Funktio / Tyyppi | Tila |
| ---------------------------------- | ---------------------------------------------- | ---------------- | ---- |
| `MsgContext`, `OriginatingChannel` | `src/auto-reply/templating.ts`                 | `MsgContext`     | OK   |
| Origin-reititys                    | `src/auto-reply/reply/origin-routing.ts`       | –                | OK   |
| `dispatchReplyFromConfig()`        | `src/auto-reply/reply/dispatch-from-config.ts` | –                | OK   |
| Vastausten reititys kanavalle      | `src/auto-reply/reply/route-reply.ts`          | `routeReply()`   | OK   |
| Inbound context -rakennus          | `src/auto-reply/reply/inbound-context.ts`      | –                | OK   |

### Agenttiajojen käynnistys ja striimaus

| Viittaus raportissa         | Tiedosto                              | Funktio / Rivi                  | Tila |
| --------------------------- | ------------------------------------- | ------------------------------- | ---- |
| `agentCommand()`            | `src/gateway/server-methods/agent.ts` | –                               | OK   |
| `createAgentEventHandler()` | `src/gateway/server-chat.ts`          | :270                            | OK   |
| Cron-ajastus                | `src/gateway/server-cron.ts`          | `buildGatewayCronService()` :72 | OK   |
| Node-rekisteri              | `src/gateway/node-registry.ts`        | –                               | OK   |

### HTTP-palvelin

| Viittaus raportissa              | Tiedosto                            | Funktio / Rivi                 | Tila |
| -------------------------------- | ----------------------------------- | ------------------------------ | ---- |
| `createGatewayHttpServer()`      | `src/gateway/server-http.ts`        | :411                           | OK   |
| `handleSlackHttpRequest`         | `src/slack/http/index.ts`           | (importattu server-http.ts:21) | OK   |
| `handleOpenAiHttpRequest`        | `src/gateway/openai-http.ts`        | (importattu server-http.ts:59) | OK   |
| `handleOpenResponsesHttpRequest` | `src/gateway/openresponses-http.ts` | (importattu server-http.ts:60) | OK   |
| `handleToolsInvokeHttpRequest`   | `src/gateway/tools-invoke-http.ts`  | (importattu server-http.ts:63) | OK   |

### WebSocket ja RPC-protokolla

| Viittaus raportissa | Tiedosto                                | Tila |
| ------------------- | --------------------------------------- | ---- |
| WS-runtime          | `src/gateway/server-ws-runtime.ts`      | OK   |
| `ConnectParams`     | `src/gateway/protocol/index.ts` :75     | OK   |
| `RequestFrame`      | `src/gateway/protocol/index.ts` :166    | OK   |
| `ResponseFrame`     | `src/gateway/protocol/index.ts` :168    | OK   |
| `EventFrame`        | `src/gateway/protocol/index.ts` :122    | OK   |
| `PROTOCOL_VERSION`  | `src/gateway/protocol/index.ts` :159    | OK   |
| Frame-skeemat       | `src/gateway/protocol/schema/frames.ts` | OK   |

### Discovery, Tailscale, konfiguraatio

| Viittaus raportissa               | Tiedosto                                                   | Tila |
| --------------------------------- | ---------------------------------------------------------- | ---- |
| Bonjour/mDNS discovery            | `src/gateway/server-discovery.ts`                          | OK   |
| Discovery runtime                 | `src/gateway/server-discovery-runtime.ts`                  | OK   |
| Tailscale-integraatio             | `src/gateway/server-tailscale.ts`                          | OK   |
| CLI: `openclaw gateway run`       | `src/cli/gateway-cli/run.ts`                               | OK   |
| CLI: gateway-rekisteröinti        | `src/cli/gateway-cli/register.ts`                          | OK   |
| CLI: `openclaw gateway discover`  | `src/cli/gateway-cli/discover.ts`                          | OK   |
| CLI: status/health                | `src/commands/gateway-status.ts`, `src/commands/health.ts` | OK   |
| Hot-reload                        | `src/gateway/config-reload.ts`                             | OK   |
| Daemon (launchd/systemd/schtasks) | `src/cli/daemon-cli/lifecycle.ts`                          | OK   |
| Graceful shutdown                 | `src/gateway/server-close.ts`                              | OK   |

### Implisiittiset viittaukset (ei suoraa polkua raportissa)

| Konsepti                       | Tiedosto                                                   |
| ------------------------------ | ---------------------------------------------------------- |
| Auto-reply dispatch            | `src/auto-reply/dispatch.ts`                               |
| Inbound-deduplication          | `src/auto-reply/reply/inbound-dedupe.ts`                   |
| Sessio-JSONL-hallinta          | `src/auto-reply/reply/session.ts`                          |
| Kanavien conversation labeling | `src/channels/conversation-label.ts`                       |
| Device pairing (Node registry) | `src/infra/device-pairing.ts`, `src/infra/node-pairing.ts` |

---

## research-02-core-concepts.md – Peruskäsitteet

### 1. Sessio

| Viittaus raportissa                            | Tiedosto                            | Funktio / Rivi                                           | Tila |
| ---------------------------------------------- | ----------------------------------- | -------------------------------------------------------- | ---- |
| Sessioavain, `buildAgentPeerSessionKey()`      | `src/routing/session-key.ts`        | :123 (`dmScope`), :127                                   | OK   |
| `isSubagentSessionKey()`, `isCronSessionKey()` | `src/sessions/session-key-utils.ts` | –                                                        | OK   |
| `SessionEntry`-tyyppi                          | `src/config/sessions/types.ts`      | :25                                                      | OK   |
| `mergeSessionEntry()`                          | `src/config/sessions/types.ts`      | :117                                                     | OK   |
| Session store                                  | `src/config/sessions/store.ts`      | –                                                        | OK   |
| Session reset -moodit                          | `src/config/sessions/reset.ts`      | `evaluateSessionFreshness()` :139                        | OK   |
| `resolveSessionResetType()`                    | `src/config/sessions/reset.ts`      | :34                                                      | OK   |
| `resolveSessionResetPolicy()`                  | `src/config/sessions/reset.ts`      | :84                                                      | OK   |
| Sessiotiedostopolut                            | `src/config/sessions/paths.ts`      | –                                                        | OK   |
| Session-transkripti                            | `src/config/sessions/transcript.ts` | –                                                        | OK   |
| Session-kirjoituslukko                         | `src/config/sessions/store.ts`      | (viitattuna myös `src/auto-reply/reply/session.test.ts`) | OK   |
| `SessionManager` (Pi-agent)                    | `@mariozechner/pi-coding-agent`     | (ulkoinen kirjasto)                                      | –    |

### 2. Agenttikonfiguraatio

| Viittaus raportissa | Tiedosto                     | Funktio / Tyyppi | Tila |
| ------------------- | ---------------------------- | ---------------- | ---- |
| `AgentConfig`       | `src/config/types.agents.ts` | –                | OK   |
| `AgentBinding`      | `src/config/types.agents.ts` | :42              | OK   |

### 3. Bootstrap-tiedostot

| Viittaus raportissa                | Tiedosto                                      | Funktio / Rivi | Tila |
| ---------------------------------- | --------------------------------------------- | -------------- | ---- |
| `loadWorkspaceBootstrapFiles()`    | `src/agents/workspace.ts`                     | :441           | OK   |
| `filterBootstrapFilesForSession()` | `src/agents/workspace.ts`                     | :505           | OK   |
| `MINIMAL_BOOTSTRAP_ALLOWLIST`      | `src/agents/workspace.ts`                     | :497           | OK   |
| `ensureAgentWorkspace()`           | `src/agents/workspace.ts`                     | :287           | OK   |
| `resolveMemoryBootstrapEntries()`  | `src/agents/workspace.ts`                     | –              | OK   |
| `applyBootstrapHookOverrides()`    | `src/agents/bootstrap-hooks.ts`               | :7             | OK   |
| `buildBootstrapContextFiles()`     | `src/agents/pi-embedded-helpers/bootstrap.ts` | –              | OK   |
| Oletus AGENTS.md -template         | `docs/reference/templates/AGENTS.md`          | –              | OK   |

### 4. Viestimalli

| Viittaus raportissa                   | Tiedosto                                       | Funktio / Tyyppi | Tila |
| ------------------------------------- | ---------------------------------------------- | ---------------- | ---- |
| `MsgContext`                          | `src/auto-reply/templating.ts`                 | –                | OK   |
| `OriginatingChannel`, `OriginatingTo` | `src/auto-reply/templating.ts`                 | –                | OK   |
| `dispatchReplyFromConfig()`           | `src/auto-reply/reply/dispatch-from-config.ts` | –                | OK   |

### 5. Konteksti-ikkuna

| Viittaus raportissa              | Tiedosto                      | Funktio / Rivi                          | Tila |
| -------------------------------- | ----------------------------- | --------------------------------------- | ---- |
| `resolveContextTokensForModel()` | `src/agents/context.ts`       | :172                                    | OK   |
| Compaction                       | `src/agents/compaction.ts`    | –                                       | OK   |
| `buildMemorySection()`           | `src/agents/system-prompt.ts` | :37                                     | OK   |
| System prompt -rakentaja         | `src/agents/system-prompt.ts` | :393 (`buildMemorySection` kutsupaikka) | OK   |

---

## research-03-agent-system.md – Agenttijärjestelmä

### 1. Agenttiajoon johtava ketju

| Viittaus raportissa    | Tiedosto                                       | Funktio / Rivi | Tila |
| ---------------------- | ---------------------------------------------- | -------------- | ---- |
| `agentCommand()`       | `src/commands/agent.ts`                        | :189           | OK   |
| `runEmbeddedPiAgent()` | `src/agents/pi-embedded-runner/run.ts`         | :192           | OK   |
| `runEmbeddedAttempt()` | `src/agents/pi-embedded-runner/run/attempt.ts` | :306           | OK   |
| WS RPC "agent" -pyyntö | `src/gateway/server-methods/agent.ts`          | –              | OK   |

### 2. agentCommand – orkestraatio

| Viittaus raportissa                 | Tiedosto                              | Funktio / Rivi                      | Tila |
| ----------------------------------- | ------------------------------------- | ----------------------------------- | ---- |
| `resolveSession()`                  | `src/commands/agent/session.ts`       | :42 (`resolveSessionKeyForRequest`) | OK   |
| `resolveConfiguredModelRef()`       | `src/agents/model-selection.ts`       | –                                   | OK   |
| `runWithModelFallback()`            | `src/agents/model-fallback.ts`        | –                                   | OK   |
| `updateSessionStoreAfterAgentRun()` | `src/commands/agent/session-store.ts` | –                                   | OK   |
| `deliverAgentCommandResult()`       | `src/commands/agent/delivery.ts`      | :62                                 | OK   |

### 3. runEmbeddedAttempt – varsinainen agenttiajo

| Viittaus raportissa                         | Tiedosto                                          | Funktio / Rivi      | Tila |
| ------------------------------------------- | ------------------------------------------------- | ------------------- | ---- |
| `createOpenClawCodingTools()`               | `src/agents/pi-tools.ts`                          | –                   | OK   |
| `buildEmbeddedSystemPrompt()`               | `src/agents/pi-embedded-runner/system-prompt.ts`  | :11                 | OK   |
| `guardSessionManager()`                     | `src/agents/session-tool-result-guard-wrapper.ts` | –                   | OK   |
| `sanitizeSessionHistory()`                  | `src/agents/pi-embedded-runner/run/attempt.ts`    | (sisäinen)          | OK   |
| `createAgentSession()` + `session.prompt()` | `@mariozechner/pi-coding-agent`                   | (ulkoinen kirjasto) | –    |

### 4. Subscription – tapahtumien käsittely

| Viittaus raportissa                             | Tiedosto                                       | Funktio / Rivi | Tila |
| ----------------------------------------------- | ---------------------------------------------- | -------------- | ---- |
| `subscribeEmbeddedPiSession()`                  | `src/agents/pi-embedded-subscribe.ts`          | :34            | OK   |
| `createEmbeddedPiSessionEventHandler()`         | `src/agents/pi-embedded-subscribe.handlers.ts` | –              | OK   |
| `createAgentEventHandler()` (gateway broadcast) | `src/gateway/server-chat.ts`                   | :270           | OK   |

### 5. Compaction

| Viittaus raportissa              | Tiedosto                   | Tila |
| -------------------------------- | -------------------------- | ---- |
| `summarizeChunks()` / compaction | `src/agents/compaction.ts` | OK   |

### Yhteenvetotaulukko (osio 10)

| Vaihe                 | Tiedosto raportissa                              | Vahvistettu tiedosto                                         |
| --------------------- | ------------------------------------------------ | ------------------------------------------------------------ |
| Viestin vastaanotto   | `src/telegram/`, `src/discord/`, ...             | (ks. research-01)                                            |
| Reititys              | `src/routing/`                                   | `src/routing/resolve-route.ts`, `src/routing/session-key.ts` |
| Orkestraatio          | `src/commands/agent.ts`                          | OK :189                                                      |
| Session resolution    | `src/commands/agent/session.ts`                  | OK :42                                                       |
| Agentti-engine        | `src/agents/pi-embedded-runner/run/attempt.ts`   | OK :306                                                      |
| System prompt         | `src/agents/pi-embedded-runner/system-prompt.ts` | OK :11                                                       |
| Agentic loop          | `@mariozechner/pi-coding-agent`                  | (ulkoinen kirjasto)                                          |
| Compaction            | `src/agents/compaction.ts`                       | OK                                                           |
| Tapahtumien striimaus | `src/agents/pi-embedded-subscribe.ts`            | OK :34                                                       |
| Vastauksen toimitus   | `src/commands/agent/delivery.ts`                 | OK :62                                                       |
| Session-tallennus     | `src/config/sessions/`                           | OK (ks. research-02)                                         |

---

## research-04-hooks-and-pi-agent-boundary.md – Hook-järjestelmä ja pi-agent-rajapinta

### 2. Kaksikerroksinen hook-arkkitehtuuri

| Viittaus raportissa         | Tiedosto                      | Funktio / Rivi                                              | Tila |
| --------------------------- | ----------------------------- | ----------------------------------------------------------- | ---- |
| Sisäiset hookit             | `src/hooks/internal-hooks.ts` | `registerInternalHook()` :136, `triggerInternalHook()` :192 | OK   |
| Plugin-hookit (tyypitetyt)  | `src/plugins/types.ts`        | `PluginHookHandlerMap` :658                                 | OK   |
| `OpenClawPluginApi` -tyyppi | `src/plugins/types.ts`        | :245–284                                                    | OK   |
| Hook-tyyppien määrittelyt   | `src/plugins/types.ts`        | :347–367                                                    | OK   |

### 3. Plugin-hookit: HookRunner

| Viittaus raportissa          | Tiedosto               | Funktio / Rivi | Tila |
| ---------------------------- | ---------------------- | -------------- | ---- |
| `createHookRunner()`         | `src/plugins/hooks.ts` | :125           | OK   |
| `HookRunner`-tyyppi          | `src/plugins/hooks.ts` | :753           | OK   |
| `runBeforeCompaction()`      | `src/plugins/hooks.ts` | :345           | OK   |
| `runAfterCompaction()`       | `src/plugins/hooks.ts` | :355           | OK   |
| `runBeforeToolCall()`        | `src/plugins/hooks.ts` | :429           | OK   |
| `runAfterToolCall()`         | `src/plugins/hooks.ts` | :449           | OK   |
| `runToolResultPersist()`     | `src/plugins/hooks.ts` | :466           | OK   |
| `runBeforeMessageWrite()`    | `src/plugins/hooks.ts` | :531           | OK   |
| Hook runner -palautusobjekti | `src/plugins/hooks.ts` | :716–750       | OK   |

### 4. Pi-coding-agent: AgentSession-rajapinta

| Viittaus raportissa                        | Tiedosto                                       | Tila                |
| ------------------------------------------ | ---------------------------------------------- | ------------------- |
| `createAgentSession()`, `session.prompt()` | `@mariozechner/pi-coding-agent`                | (ulkoinen kirjasto) |
| `createEmbeddedPiSessionEventHandler()`    | `src/agents/pi-embedded-subscribe.handlers.ts` | OK                  |
| Subscribe-tapahtumat (10 tyyppiä)          | `src/agents/pi-embedded-subscribe.ts`          | OK :34              |

### 5. Datavirta: hookin kutsuajankohdat attempt.ts:ssä

| Viittaus raportissa                 | Tiedosto                                                  | Funktio / Rivi                                   | Tila |
| ----------------------------------- | --------------------------------------------------------- | ------------------------------------------------ | ---- |
| `wrapToolWithBeforeToolCallHook()`  | `src/agents/pi-tools.before-tool-call.ts`                 | :175                                             | OK   |
| Tool definition adapter             | `src/agents/pi-tool-definition-adapter.ts`                | `toToolDefinitions()` :89                        | OK   |
| `handleToolExecutionEnd()`          | `src/agents/pi-embedded-subscribe.handlers.tools.ts`      | :293                                             | OK   |
| `handleAutoCompactionStart()`       | `src/agents/pi-embedded-subscribe.handlers.compaction.ts` | :6                                               | OK   |
| `handleAutoCompactionEnd()`         | `src/agents/pi-embedded-subscribe.handlers.compaction.ts` | :40, hook-kutsu :67–82                           | OK   |
| Erillinen compaction-ajo            | `src/agents/pi-embedded-runner/compact.ts`                | `compactEmbeddedPiSession()` :751, hook :680–699 | OK   |
| `buildEmbeddedExtensionFactories()` | `src/agents/pi-embedded-runner/extensions.ts`             | :64                                              | OK   |

### 6. Pi-agent Extension API (sisäiset extensionit)

| Viittaus raportissa     | Tiedosto                                                                           | Tila |
| ----------------------- | ---------------------------------------------------------------------------------- | ---- |
| `compaction-safeguard`  | `src/agents/pi-extensions/compaction-safeguard.ts`                                 | OK   |
| `context-pruning`       | `src/agents/pi-extensions/context-pruning.ts`                                      | OK   |
| Context-pruning runtime | `src/agents/pi-extensions/context-pruning/extension.ts`, `pruner.ts`, `runtime.ts` | OK   |

### 7. Eksklusiivinen slot-järjestelmä

| Viittaus raportissa             | Tiedosto                                      | Funktio / Rivi        | Tila |
| ------------------------------- | --------------------------------------------- | --------------------- | ---- |
| `PluginKind`, `SLOT_BY_KIND`    | `src/plugins/slots.ts`                        | :12                   | OK   |
| `DEFAULT_SLOT_BY_KEY`           | `src/plugins/slots.ts`                        | :16                   | OK   |
| `applyExclusiveSlotSelection()` | `src/plugins/slots.ts`                        | :37                   | OK   |
| memory-core plugin              | `extensions/memory-core/index.ts`             | :38 (default export)  | OK   |
| session-memory bundled hook     | `src/hooks/bundled/session-memory/handler.ts` | :328 (default export) | OK   |

---

## research-05-plugins.md – Plugin-järjestelmä

### 2. Pluginin anatomia

| Viittaus raportissa         | Tiedosto               | Funktio / Rivi | Tila |
| --------------------------- | ---------------------- | -------------- | ---- |
| `OpenClawPluginDefinition`  | `src/plugins/types.ts` | :230           | OK   |
| `OpenClawPluginApi`         | `src/plugins/types.ts` | :245–284       | OK   |
| `OpenClawPluginToolContext` | `src/plugins/types.ts` | :58            | OK   |

### 3. Löytäminen (Discovery)

| Viittaus raportissa           | Tiedosto                     | Funktio / Rivi                  | Tila |
| ----------------------------- | ---------------------------- | ------------------------------- | ---- |
| `discoverOpenClawPlugins()`   | `src/plugins/discovery.ts`   | :557                            | OK   |
| `PluginCandidate`             | `src/plugins/discovery.ts`   | :16                             | OK   |
| Bundled-hakemiston resoluutio | `src/plugins/bundled-dir.ts` | `resolveBundledPluginsDir()` :5 | OK   |

### 4. Lataus ja rekisteröinti

| Viittaus raportissa                         | Tiedosto                           | Funktio / Rivi | Tila |
| ------------------------------------------- | ---------------------------------- | -------------- | ---- |
| `loadOpenClawPlugins()`                     | `src/plugins/loader.ts`            | :359           | OK   |
| `loadPluginManifestRegistry()`              | `src/plugins/manifest-registry.ts` | :134           | OK   |
| Jiti-lataaja                                | `src/plugins/loader.ts`            | :417–439       | OK   |
| Plugin-rekisteröintilooppi (async-varoitus) | `src/plugins/loader.ts`            | :654–665       | OK   |
| Enable/disable -logiikka                    | `src/plugins/config-state.ts`      | –              | OK   |
| `BUNDLED_ENABLED_BY_DEFAULT`                | `src/plugins/config-state.ts`      | :17            | OK   |

### 5. PluginRegistry

| Viittaus raportissa              | Tiedosto                  | Funktio / Rivi | Tila |
| -------------------------------- | ------------------------- | -------------- | ---- |
| `PluginRegistry`-tyyppi          | `src/plugins/registry.ts` | :124           | OK   |
| `createEmptyPluginRegistry()`    | `src/plugins/registry.ts` | :146           | OK   |
| `createPluginRegistry()`         | `src/plugins/registry.ts` | :164           | OK   |
| Plugin API -luonti (`createApi`) | `src/plugins/registry.ts` | :472           | OK   |

### 7. Työkalujen luonti ja resoluutio

| Viittaus raportissa        | Tiedosto               | Funktio / Rivi | Tila |
| -------------------------- | ---------------------- | -------------- | ---- |
| `resolvePluginTools()`     | `src/plugins/tools.ts` | :45            | OK   |
| `pluginToolMeta` (WeakMap) | `src/plugins/tools.ts` | :16            | OK   |

### 9. Plugin Runtime

| Viittaus raportissa     | Tiedosto                       | Funktio / Rivi | Tila |
| ----------------------- | ------------------------------ | -------------- | ---- |
| `createPluginRuntime()` | `src/plugins/runtime/index.ts` | :239           | OK   |
| `PluginRuntime`-tyyppi  | `src/plugins/runtime/types.ts` | :179           | OK   |

### 10. Plugin SDK

| Viittaus raportissa    | Tiedosto                  | Tila           |
| ---------------------- | ------------------------- | -------------- |
| Plugin SDK re-exportit | `src/plugin-sdk/index.ts` | OK (553 riviä) |

### 11. Palvelut (Services)

| Viittaus raportissa     | Tiedosto                  | Funktio / Rivi | Tila |
| ----------------------- | ------------------------- | -------------- | ---- |
| `startPluginServices()` | `src/plugins/services.ts` | :34            | OK   |

### 12. Asennusjärjestelmä

| Viittaus raportissa          | Tiedosto                 | Funktio / Rivi | Tila |
| ---------------------------- | ------------------------ | -------------- | ---- |
| `installPluginFromNpmSpec()` | `src/plugins/install.ts` | :400           | OK   |
| `installPluginFromArchive()` | `src/plugins/install.ts` | :294           | OK   |
| `installPluginFromDir()`     | `src/plugins/install.ts` | :330           | OK   |
| `installPluginFromFile()`    | `src/plugins/install.ts` | :359           | OK   |
| `installPluginFromPath()`    | `src/plugins/install.ts` | :442           | OK   |

> **Huom.:** Raportissa käytetään lyhyitä nimiä (`installFromNpmSpec` jne.), mutta koodissa funktioiden nimet ovat `installPluginFrom*`-muotoiset.

### 14. Referenssipluginit

| Viittaus raportissa | Tiedosto                             | Tila                           |
| ------------------- | ------------------------------------ | ------------------------------ |
| memory-core         | `extensions/memory-core/index.ts`    | OK (38 riviä, ks. research-04) |
| memory-lancedb      | `extensions/memory-lancedb/index.ts` | OK (670 riviä)                 |

---

## research-06-current-memory.md – Nykyinen muistijärjestelmä

### 3. Tietolähteet

| Viittaus raportissa   | Tiedosto                      | Funktio / Rivi | Tila |
| --------------------- | ----------------------------- | -------------- | ---- |
| `listMemoryFiles()`   | `src/memory/internal.ts`      | :80            | OK   |
| `MemoryChunk`-tyyppi  | `src/memory/internal.ts`      | :16            | OK   |
| `hashText()`          | `src/memory/internal.ts`      | :148           | OK   |
| `buildSessionEntry()` | `src/memory/session-files.ts` | :74            | OK   |

### 4. SQLite-skeema

| Viittaus raportissa         | Tiedosto                      | Funktio / Rivi | Tila |
| --------------------------- | ----------------------------- | -------------- | ---- |
| `ensureMemoryIndexSchema()` | `src/memory/memory-schema.ts` | :3             | OK   |
| `meta`-taulu                | `src/memory/memory-schema.ts` | :10–13         | OK   |
| `files`-taulu               | `src/memory/memory-schema.ts` | :16–22         | OK   |
| `chunks`-taulu              | `src/memory/memory-schema.ts` | :25–36         | OK   |
| `embedding_cache`-taulu     | `src/memory/memory-schema.ts` | :39–48         | OK   |
| `chunks_fts` (FTS5)         | `src/memory/memory-schema.ts` | :59–67         | OK   |

### 5. Chunking-algoritmi

| Viittaus raportissa | Tiedosto                              | Funktio / Rivi         | Tila |
| ------------------- | ------------------------------------- | ---------------------- | ---- |
| `chunkMarkdown()`   | `src/memory/internal.ts`              | :184                   | OK   |
| Chunk ID -laskenta  | `src/memory/manager-embedding-ops.ts` | (käyttää `hashText()`) | OK   |

### 6. Embedding-providerit

| Viittaus raportissa                          | Tiedosto                              | Funktio / Rivi | Tila |
| -------------------------------------------- | ------------------------------------- | -------------- | ---- |
| `createEmbeddingProvider()`                  | `src/memory/embeddings.ts`            | :144           | OK   |
| Batch-prosessointi (`buildEmbeddingBatches`) | `src/memory/manager-embedding-ops.ts` | :49            | OK   |

### 7. Hakuputki

| Viittaus raportissa      | Tiedosto                        | Funktio / Rivi | Tila |
| ------------------------ | ------------------------------- | -------------- | ---- |
| `searchVector()`         | `src/memory/manager-search.ts`  | :20            | OK   |
| `searchKeyword()`        | `src/memory/manager-search.ts`  | :136           | OK   |
| `mergeHybridResults()`   | `src/memory/hybrid.ts`          | :51            | OK   |
| `buildFtsQuery()`        | `src/memory/hybrid.ts`          | :33            | OK   |
| FTS-only query expansion | `src/memory/query-expansion.ts` | –              | OK   |

### 8–9. Temporal decay ja MMR

| Viittaus raportissa                                | Tiedosto                       | Funktio / Rivi | Tila |
| -------------------------------------------------- | ------------------------------ | -------------- | ---- |
| `applyTemporalDecay()`                             | `src/memory/temporal-decay.ts` | :34            | OK   |
| `calculateTemporalDecayMultiplier()`               | `src/memory/temporal-decay.ts` | :24            | OK   |
| `DEFAULT_TEMPORAL_DECAY_CONFIG` (halfLifeDays: 30) | `src/memory/temporal-decay.ts` | :9             | OK   |
| MMR-uudelleenjärjestys                             | `src/memory/mmr.ts`            | –              | OK   |
| `jaccardSimilarity()`                              | `src/memory/mmr.ts`            | :38            | OK   |

### 10. Synkronointimekanismit

| Viittaus raportissa    | Tiedosto                         | Funktio / Rivi                | Tila |
| ---------------------- | -------------------------------- | ----------------------------- | ---- |
| `MemoryManagerSyncOps` | `src/memory/manager-sync-ops.ts` | :88                           | OK   |
| `syncMemoryFiles()`    | `src/memory/manager-sync-ops.ts` | :630                          | OK   |
| `syncSessionFiles()`   | `src/memory/manager-sync-ops.ts` | :711                          | OK   |
| `dirty`-lippu          | `src/memory/manager-sync-ops.ts` | :128                          | OK   |
| chokidar-watcher       | `src/memory/manager-sync-ops.ts` | :383 (init), :392 (dirty set) | OK   |

### 11. Agentin muistityökalut

| Viittaus raportissa        | Tiedosto                          | Funktio / Rivi | Tila |
| -------------------------- | --------------------------------- | -------------- | ---- |
| `createMemorySearchTool()` | `src/agents/tools/memory-tool.ts` | :40            | OK   |
| `createMemoryGetTool()`    | `src/agents/tools/memory-tool.ts` | :101           | OK   |

### 14–15. Backendit ja MemorySearchManager

| Viittaus raportissa             | Tiedosto                              | Funktio / Rivi                      | Tila |
| ------------------------------- | ------------------------------------- | ----------------------------------- | ---- |
| `MemoryIndexManager` (builtin)  | `src/memory/manager.ts`               | :43                                 | OK   |
| `INDEX_CACHE` (singleton)       | `src/memory/manager.ts`               | :41                                 | OK   |
| `MemoryManagerEmbeddingOps`     | `src/memory/manager-embedding-ops.ts` | :43                                 | OK   |
| `indexFile()`                   | `src/memory/manager-embedding-ops.ts` | :693                                | OK   |
| QMD-backend config              | `src/memory/backend-config.ts`        | `resolveMemoryBackendConfig()` :297 | OK   |
| `FallbackMemoryManager`         | `src/memory/search-manager.ts`        | :75                                 | OK   |
| `getMemorySearchManager()`      | `src/memory/search-manager.ts`        | :19                                 | OK   |
| `MemorySearchManager`-rajapinta | `src/memory/types.ts`                 | :61                                 | OK   |
| `MemorySearchResult`-tyyppi     | `src/memory/types.ts`                 | :3                                  | OK   |

> **Huom.:** Raportissa viitataan `src/memory/backend-config.ts`:iin `FallbackMemoryManager`-luokan ja `getMemorySearchManager()`-funktion sijaintina, mutta nämä löytyvät tiedostosta `src/memory/search-manager.ts`.

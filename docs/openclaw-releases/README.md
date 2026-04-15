# OpenClaw Release Impact Tracker

Tämä kansio seuraa OpenClaw-pääohjelman julkaisuja ja arvioi niiden vaikutukset associative-memory -pluginiin.

## Plugin-rajapinnat joita seurataan

| Rajapinta | Tuonti / Lähde | Käyttö |
|---|---|---|
| Plugin SDK core | `openclaw/plugin-sdk` | `OpenClawPluginApi`, `OpenClawConfig`, `AnyAgentTool` |
| Memory Embedding Registry | `openclaw/plugin-sdk/memory-core-host-engine-embeddings` | `getMemoryEmbeddingProvider`, `listMemoryEmbeddingProviders`, `MemoryEmbeddingProvider` |
| Context Engine | `openclaw/plugin-sdk` | `ContextEngine`, `ContextEngineInfo`, `delegateCompactionToRuntime` |
| Plugin Registration | `api.registerTool`, `api.registerMemoryPromptSection`, `api.registerContextEngine`, `api.registerCommand` | Pluginin rekisteröinti käynnistyksessä |

## Versiot

| Versio | Vaikutus | Tiedosto |
|--------|----------|----------|
| v2026.3.24 | 🟡 Kohtalainen | [v2026.3.24.md](v2026.3.24.md) |
| v2026.3.28 | 🔴 Merkittävä | [v2026.3.28.md](v2026.3.28.md) |
| v2026.3.31 | 🔴 Merkittävä | [v2026.3.31.md](v2026.3.31.md) |
| v2026.4.1 | 🟢 Ei vaikutusta | [v2026.4.1.md](v2026.4.1.md) |
| v2026.4.2 | 🟡 Kohtalainen | [v2026.4.2.md](v2026.4.2.md) |
| v2026.4.5 | 🔴 Merkittävä | [v2026.4.5.md](v2026.4.5.md) |
| v2026.4.7 | 🟡 Kohtalainen | [v2026.4.7.md](v2026.4.7.md) |
| v2026.4.8 | 🟢 Ei vaikutusta | [v2026.4.8.md](v2026.4.8.md) |
| v2026.4.9 | 🟢 Ei vaikutusta | [v2026.4.9.md](v2026.4.9.md) |
| v2026.4.10 | 🟡 Kohtalainen | [v2026.4.10.md](v2026.4.10.md) |
| v2026.4.11 | 🟡 Kohtalainen | [v2026.4.11.md](v2026.4.11.md) |
| v2026.4.12 | 🟡 Kohtalainen | [v2026.4.12.md](v2026.4.12.md) |
| v2026.4.14 | 🟡 Kohtalainen | [v2026.4.14.md](v2026.4.14.md) |

## Avoimet toimenpiteet

- [ ] `assemble()` signature päivitys: `availableTools`, `citationsMode` (v2026.4.7)
- [ ] Plugin security scan -asennus testaus (v2026.3.31)
- [ ] FTS-fallback ilman embeddingiä (v2026.3.31)
- [ ] Task Flow -integraatio consolidationille (v2026.4.2)
- [ ] Prompt-cache-telemetria (v2026.4.7)
- [ ] `resolveApiKeyForProvider()` auth-yksinkertaistus (v2026.4.7)
- [ ] Memory-host-aliaksien tutkiminen (v2026.4.5)
- [ ] Memory-wiki rinnakkaiselon seuranta (v2026.4.7)
- [ ] Testaa Active Memory + associative-memory -yhdistelmää (v2026.4.10)
- [ ] Tutki context enginen ja Active Memoryn recall-päällekkäisyys (v2026.4.10)
- [ ] Plugin manifest activation/setup descriptors (v2026.4.11)
- [ ] `openclaw.plugin.json` -manifestin kattavuuden varmistus (v2026.4.12)
- [ ] LM Studio -embedding-providerin testaus (v2026.4.12)
- [ ] Ollama-embedding-adapterin testaus (v2026.4.14)
- [ ] Cron-scheduler-korjausten vaikutus issue #21:n workaroundeihin (v2026.4.14)
- [ ] Session routing -korjauksen vaikutus cron-triggereihin (v2026.4.14)

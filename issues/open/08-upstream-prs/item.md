---
created: 2026-04-09
updated: 2026-04-09
type: chore
reporter: jari
assignee: jari
status: open
priority: normal
---

# 08. Upstream PRs to OpenClaw

_Source: openclaw core_

## Description

Four proposals need to be submitted as PRs to the OpenClaw repository. These remove workarounds in the associative memory plugin and enable proper multi-workspace support.

## Reference

- [proposal-factory-context.md](proposal-factory-context.md)
- [proposal-service-start.md](proposal-service-start.md)
- [proposal-decouple-templates.md](proposal-decouple-templates.md)
- [proposal-sdk-embedding-exports.md](proposal-sdk-embedding-exports.md)

## Tasks

- [ ] **Context engine factory context** — pass `ctx: ContextEngineFactoryContext` (config, agentDir, workspaceDir) to factory functions. Enables multi-workspace support without global state hacks.
- [ ] **Plugin service start for memory plugins** — include memory-kind plugins in `shouldStartServices()`. Enables automatic migration/cleanup at gateway boot.
- [ ] **Decouple memory from workspace templates** — remove hardcoded file-based memory instructions from AGENTS.md/SOUL.md templates. Let active memory plugin provide instructions via `registerMemoryPromptSection()`.
- [ ] **SDK embedding provider exports** — export `createGeminiEmbeddingProvider`, `createOpenAiEmbeddingProvider` from SDK factory functions.

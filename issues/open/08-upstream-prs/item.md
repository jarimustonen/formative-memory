---
created: 2026-04-09
updated: 2026-04-16
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

## Test findings (2026-04-15)

Live-tested factory-context + updated plugin on jari's bot (haapa). Key finding: **SDK factory functions cannot resolve auth independently** — they rely on memory-core's internal auth resolution. When memory-core is disabled, `createOpenAiEmbeddingProvider()` fails even with correct agentDir.

**Resolution:** Plugin will implement standalone embedding client (#29) that reads auth-profiles.json directly. This removes the SDK factory dependency and unblocks factory-context without waiting for upstream. SDK embedding exports PR is demoted from blocker to cleanup.

## Tasks

- [x] **Context engine factory context** — pass `ctx: ContextEngineFactoryContext` (config, agentDir, workspaceDir) to factory functions. Enables multi-workspace support without global state hacks. **Submitted as [openclaw/openclaw#67243](https://github.com/openclaw/openclaw/pull/67243)** — awaiting maintainer review. See `status-factory-context.md`.
- [ ] **Plugin service start for memory plugins** — include memory-kind plugins in `shouldStartServices()`. Enables automatic migration/cleanup at gateway boot.
- [ ] **Decouple memory from workspace templates** — remove hardcoded file-based memory instructions from AGENTS.md/SOUL.md templates. Let active memory plugin provide instructions via `registerMemoryPromptSection()`.
- [ ] **SDK embedding provider exports** — export `createGeminiEmbeddingProvider`, `createOpenAiEmbeddingProvider` from SDK public surface. No longer a blocker (plugin uses standalone client via #29), but still valuable as architectural cleanup for the ecosystem.

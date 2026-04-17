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

Three proposals submitted (or pending) as PRs to the OpenClaw repository. These remove workarounds in the associative memory plugin and enable proper multi-workspace support. Fourth proposal (SDK embedding exports) dropped after standalone embedding client (#29) eliminated the need.

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
- [ ] **Plugin service start for memory plugins** — include memory-kind plugins in `shouldStartServices()`. Enables automatic migration/cleanup at gateway boot. Upstream added slot-aware startup in 2026-04-10/11 commits, which partially addresses this (#30 verified). Remaining gap: workspace-origin plugins still not started. **PR not yet submitted** — waiting to see if upstream narrows the gap further before filing.
- [x] **Decouple memory from workspace templates** — remove hardcoded file-based memory instructions from AGENTS.md/SOUL.md templates. Let active memory plugin provide instructions via `registerMemoryPromptSection()`. **Submitted as [openclaw/openclaw#67554](https://github.com/openclaw/openclaw/pull/67554)** — awaiting maintainer review. See `status-decouple-templates.md`.
- ~~**SDK embedding provider exports**~~ — Dropped. Plugin uses standalone fetch-based clients (#29) that read auth-profiles.json directly. SDK exports would be nice-to-have for the ecosystem but are no longer needed by this plugin.

## Status summary (2026-04-17)

3 PRs awaiting review, 1 dropped:
- **factory-context** (#67243) — awaiting review
- **decouple-templates** (#67554) — awaiting review
- **service-start** — not yet submitted, waiting for upstream gap to stabilize
- **SDK embedding exports** — dropped (standalone client solved the need)

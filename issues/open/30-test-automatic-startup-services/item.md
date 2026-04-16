---
created: 2026-04-16
updated: 2026-04-16
type: task
reporter: jari
assignee: jari
status: open
priority: normal
---

# 30. Test automatic startup services with upstream slot-aware fix

_Source: openclaw upstream 2026-04-10/11_

## Description

OpenClaw commits from 2026-04-10 (`03e19c5436`) and 2026-04-11 (`5e2136c6ae`) added slot-aware startup for memory-kind plugins. Plugins that are explicitly selected as `plugins.slots.memory` now have their `start()` called at gateway boot — the premise of our original proposal ("memory plugin services are never started") is no longer fully accurate.

This potentially unblocks automatic migration and workspace cleanup on first startup without user action (no more `/memory-init` required).

The plugin already has the `registerService` handler in place (`src/index.ts` around line 1057). It captures `stateDir` and `agentDir` from the service context. If upstream now calls this `start()` at boot, the workaround `/memory-init` command becomes obsolete for bundled/global/config-origin installations.

## Scope

Verify that:

1. Upstream `start()` is actually called at boot when formative-memory is the memory slot
2. `agentDir` is available in the service context (currently accessed via `(ctx as Record<string, unknown>).agentDir`)
3. Migration runs automatically on first start
4. Workspace cleanup runs automatically on first start
5. Embedding backfill is triggered if applicable

## Test scenarios

1. **Global install + config slot** — `npm install -g formative-memory` in container, set `plugins.slots.memory: formative-memory` in config, boot gateway, observe logs
2. **Config origin** — plugin configured via `plugins.entries.formative-memory`, verify service start
3. **Workspace origin** — this scenario does NOT yet work (see `proposal-service-start.md` — workspace-disabled-by-default still blocks memory-slot plugins). Blocked by upstream fix A/B.

## Success Criteria

- Service `start()` logs appear in gateway boot output (e.g. `[formative-memory] startup service started`)
- Migration runs automatically (if pending data exists)
- Workspace cleanup runs automatically (if AGENTS.md/SOUL.md contain legacy file-based memory instructions)
- No `/memory-init` manual action required

## Test environment

- jari's bot on haapa (`ghcr.io/openclaw/openclaw:2026.4.12` or later containing the slot-aware startup commits)
- Config: `plugins.slots.memory: formative-memory`, `plugins.entries.memory-core.enabled: false`

## Related

- **#08** Upstream PRs — `proposal-service-start.md` documents the upstream evolution and remaining gap
- **#29** Standalone embedding provider — embedding backfill requires working embeddings, which #29 will fix

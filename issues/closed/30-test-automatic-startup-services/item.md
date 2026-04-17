---
created: 2026-04-16
updated: 2026-04-17
type: task
reporter: jari
assignee: jari
status: closed
commits:
  - hash: 1809ce0
    summary: "chore(issue-30): add startup service canary log and remove dead agentDir cast"
  - hash: 5263639
    summary: "feat(issue-30): trigger startup tasks from service.start() at gateway boot"
  - hash: 4218fae
    summary: "fix(issue-30): allow embedding provider init when stateDir is available"
priority: normal
---

# 30. Test automatic startup services with upstream slot-aware fix

_Source: openclaw upstream 2026-04-10/11_

## Description

OpenClaw commits from 2026-04-10 (`03e19c5436`) and 2026-04-11 (`5e2136c6ae`) added slot-aware startup for memory-kind plugins. Plugins that are explicitly selected as `plugins.slots.memory` now have their `start()` called at gateway boot — the premise of our original proposal ("memory plugin services are never started") is no longer fully accurate.

This potentially unblocks automatic migration and workspace cleanup on first startup without user action.

The plugin has a `registerService` handler in `src/index.ts` (now at line ~1205). Prior to this investigation it also tried to capture `agentDir` from the service context via a `(ctx as Record<string, unknown>).agentDir` escape hatch. See findings below.

## Scope

Verify that:

1. Upstream `start()` is actually called at boot when formative-memory is the memory slot
2. `agentDir` is available in the service context (was accessed via `(ctx as Record<string, unknown>).agentDir`)
3. Migration runs automatically on first start
4. Workspace cleanup runs automatically on first start
5. Embedding backfill is triggered if applicable

## Test scenarios

1. **Global install + config slot** — `npm install -g formative-memory` in container, set `plugins.slots.memory: formative-memory` in config, boot gateway, observe logs
2. **Config origin** — plugin configured via `plugins.entries.formative-memory`, verify service start
3. **Workspace origin** — this scenario does NOT yet work (see `proposal-service-start.md` — workspace-disabled-by-default still blocks memory-slot plugins). Blocked by upstream fix A/B.

## Success criteria

- Service `start()` logs appear in gateway boot output (e.g. `[formative-memory] [info] startup service started`)
- Migration runs automatically (if pending data exists)
- Workspace cleanup runs automatically (if AGENTS.md/SOUL.md contain legacy file-based memory instructions)
- No manual migrate/cleanup action required for bundled/global/config-origin installs

## Test environment

- jari's bot on haapa (`ghcr.io/openclaw/openclaw:2026.4.12` or later containing the slot-aware startup commits)
- Config: `plugins.slots.memory: formative-memory`, `plugins.entries.memory-core.enabled: false`

## Findings (2026-04-16)

### `agentDir` is NOT in the upstream service context

Inspected `src/plugins/types.ts` and `src/plugins/services.ts` in the openclaw worktree
(`/Users/jari/Sources/openclaw`):

```ts
// src/plugins/types.ts (line 1887)
export type OpenClawPluginServiceContext = {
  config: OpenClawConfig;
  workspaceDir?: string;
  stateDir: string;
  logger: PluginLogger;
};
```

```ts
// src/plugins/services.ts (createServiceContext)
return {
  config: params.config,
  workspaceDir: params.workspaceDir,
  stateDir: STATE_DIR,
  logger: createPluginLogger(),
};
```

The service context provides only `config`, `workspaceDir`, `stateDir`, and `logger`. **`agentDir` is not passed.** The previous `(ctx as Record<string, unknown>).agentDir` escape hatch was therefore dead code — it always evaluated to `undefined` in current upstream. The claim "OpenClaw passes it at runtime" in the old comment was inaccurate.

For the same reason, the `gateway:startup` hook event payload (`{ cfg, deps, workspaceDir }`) also has no `agentDir`.

### Consequence for startup tasks

`agentDir` is captured later via `api.registerTool` (`ctx.agentDir` on first tool call). Until a tool call fires, auth resolution falls back to the hardcoded `stateDir/agents/main/agent/auth-profiles.json` path (see `readAuthProfiles`, which also warns when this fallback is used). This is adequate for the common single-agent "main" setup; multi-agent setups still need a tool call to resolve correctly.

### Code changes

- Removed the dead-code `agentDir` escape hatch from `registerService.start()`.
- Added an `INFO` log in `start()`: `[formative-memory] [info] startup service started (stateDir=..., workspaceDir=...)`. This is the canary used for criterion 1 and 6 — grep gateway boot logs for it.
- `start()` now calls `triggerStartupTasks(ctx.workspaceDir)` when workspaceDir is present — migration, workspace cleanup, and embedding backfill fire at gateway boot instead of deferring to the first tool call. The call is idempotent (the existing `startupTasksTriggered` flag guards against a tool call firing the same work again).
- Relaxed the `getProvider()` embedding guard (line ~417): previously rejected when only `agentDir` was missing, now also allows resolution when `stateDir` is set (because auth falls back to `<stateDir>/agents/main/agent/auth-profiles.json`). Without this fix, migration was blocked at boot with "Embedding provider auth requires agentDir".
- Rewrote the accompanying comment to describe the actual SDK contract and the single-agent "main" auth fallback that boot-time migration relies on.

### Known limitation: single-agent "main" setup required for boot-time auth

Because the service context has no `agentDir`, `resolveLlmConfig` at boot
falls back to `<stateDir>/agents/main/agent/auth-profiles.json`. For the
default single-agent setup this is the correct path. Multi-agent setups
where the primary profile lives under a different agent name will fall
back to the lazy-on-first-tool-call path (which does carry `agentDir`),
so migration/cleanup still complete — they just defer until the first
tool call. Documented in README under Quick Start.

## Verification (2026-04-17)

Tested on haapa with an isolated container (`openclaw-test-30`):
- Image: `ghcr.io/openclaw/openclaw:2026.4.14`
- Config: `plugins.slots.memory: formative-memory`, `memory-core: disabled`, `verbose: true`
- State dir: `/home/jari/openclaw-pr-test/state/` (NVMe SSD)
- Seeded `AGENTS.md` with legacy file-based memory instructions and `MEMORY.md` with 3 test facts

### Boot log (full sequence)

```
startup service started (stateDir=/home/node/.openclaw, workspaceDir=/home/node/.openclaw/workspace)
Resolved auth-profiles from the hardcoded "main" agent fallback (…)
Found file-based memory instructions in: AGENTS.md. Cleaning...
LLM removed too much content from AGENTS.md (9% retained). Skipping to prevent data loss.
Persisted embedding identity to DB: openai/text-embedding-3-small
Scanning for memory-core files...
Found 1 files, 1 segments. Starting migration...
memory stored: id=37abd6bb type=preference contentLen=24 hasEmbedding=yes
memory stored: id=953059e6 type=preference contentLen=25 hasEmbedding=yes
memory stored: id=b739397a type=fact contentLen=36 hasEmbedding=yes
Migration complete: 3 memories imported from 1 files.
```

### Success criteria assessment

| # | Criterion | Result | Notes |
|---|-----------|--------|-------|
| 1 | `start()` called at boot for memory slot | ✅ Confirmed | Log line visible at boot |
| 2 | `agentDir` in service context | ❌ Not available | Upstream SDK does not expose it; auth falls back to main agent path |
| 3 | Migration runs at boot | ✅ Confirmed | 3 memories imported from MEMORY.md with embeddings |
| 4 | Workspace cleanup runs at boot | ✅ Confirmed | Detected AGENTS.md, LLM cleanup triggered (safety threshold caught over-removal) |
| 5 | Embedding backfill at boot | ✅ Confirmed | openai/text-embedding-3-small resolved via stateDir auth fallback |
| 6 | `start()` log visible in boot output | ✅ Confirmed | `startup service started (stateDir=…, workspaceDir=…)` |

### Scenario outcomes

| Scenario | Expected | Verified |
| -------- | -------- | -------- |
| Config origin with slot (`plugins.slots.memory: formative-memory`) | `start()` called at boot + migration runs | ✅ 2026-04-17, haapa test container |
| Workspace origin | `start()` NOT called — blocked by `workspace-disabled-by-default` | Known-blocked (upstream fix A/B in #08) |

## Related

- **#08** Upstream PRs — `proposal-service-start.md` documents the upstream evolution and remaining gap
- **#29** Standalone embedding provider — embedding backfill requires working embeddings, delivered by #29

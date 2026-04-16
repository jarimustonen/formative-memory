---
created: 2026-04-16
updated: 2026-04-16
type: status
status: submitted-awaiting-review
---

# Status: Factory Context PR

## PR

- **URL:** https://github.com/openclaw/openclaw/pull/67243
- **Title:** `context-engine: pass runtime context to ContextEngineFactory`
- **Branch (fork):** `jarimustonen/openclaw#fix/context-engine-factory-context`
- **Base:** `openclaw/openclaw#main`

## What shipped

- `ContextEngineFactoryContext` type with `config?`, `agentDir?`, `workspaceDir?`
- `ContextEngineFactory` signature updated to `(ctx: ContextEngineFactoryContext) => ...` (required param, backward compatible via TS function parameter contravariance)
- `ResolveContextEngineOptions` for the `resolveContextEngine()` second parameter
- All three resolution call sites pass normalized runtime paths:
  - `run.ts` — uses already-computed `agentDir` and `resolvedWorkspace`
  - `compact.queued.ts` — uses `agentDir` fallback + `resolveUserPath(workspaceDir)`
  - `subagent-registry.ts` — uses `resolveOpenClawAgentDir()` fallback + `params.workspaceDir`
- Fallback path (`resolveDefaultContextEngine`) also receives the factory context
- Plugin SDK exports: `ContextEngineFactoryContext`, `ContextEngineFactory`
- 3 new unit tests (factory receives ctx, no-arg factories still work, undefined-config path)

## Design decisions

- `sessionKey` **excluded** from factory context — it's session-scoped data, already passed to engine lifecycle methods (`ingest`/`assemble`/`compact`). Reviewers (Gemini + Codex pre-submission) flagged mixing environment-scoped and session-scoped concerns as an architectural mistake.
- `config` **optional** in `ContextEngineFactoryContext` — `resolveContextEngine()` accepts `config?: OpenClawConfig`, so the type must be honest.
- `ctx` **required** on factory signature — TypeScript's function parameter contravariance means existing `() => ContextEngine` factories remain assignable.

## Review feedback addressed (chatgpt-codex-connector bot)

- **Subagent-registry dep types align with canonical signature** (`cfg?` instead of `cfg:`) — commit `27be763`
- **Pass normalized paths to factory in run/compact** — commit `7728db5`
- **Pass agentDir into subagent context-engine resolution** — commit `9ac9918`

## CI status

- All required checks pass (check, check-additional, tsgo, tests, build-smoke, etc.)
- `Parity gate / Run the GPT-5.4 / Opus 4.6 parity gate against the qa-lab mock` is **flaky** on upstream main — recent main-branch runs show both success and failure. Not caused by this PR (pure type/refactor change, no runtime behavior impact).

## Testing

- Live-tested against formative-memory plugin on a fork branch rebased onto `v2026.4.14`
- Worktree view in plugin worked as expected, no regression

## Next actions

- **Waiting for maintainer review**
- No local work required until review feedback arrives
- If maintainer merges: bump formative-memory's `openclaw` dependency pin, drop factory-context workarounds
- If maintainer requests changes: reopen worktree at `/Users/jari/Sources/openclaw__worktrees/fix/context-engine-factory-context` (branch preserved on fork)

## Local state

- Worktree closed after this status write
- Branch preserved on fork: `jarimustonen/openclaw#fix/context-engine-factory-context`
- 12 commits ahead of upstream main

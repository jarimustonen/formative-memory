---
created: 2026-04-16
updated: 2026-04-16
type: status
status: submitted-awaiting-review
---

# Status: SDK Embedding Exports PR

## PR

- **URL:** https://github.com/openclaw/openclaw/pull/67242
- **Title:** `plugin-sdk: add stable embeddings subpath export`
- **Branch (fork):** `jarimustonen/openclaw#fix/sdk-embedding-exports`
- **Base:** `openclaw/openclaw#main`

## What shipped

Three commits:

1. **`plugin-sdk: add stable embeddings subpath export`** (`d459bff`)
   - New `src/plugin-sdk/embeddings.ts` barrel re-exporting `memory-host-sdk/engine-embeddings`
   - `"embeddings"` added to `scripts/lib/plugin-sdk-entrypoints.json`
   - `./plugin-sdk/embeddings` added to `package.json` exports map

2. **`docs: document plugin-sdk/embeddings subpath in SDK reference tables`** (`299d6bd`)
   - Added the new subpath to `docs/plugins/sdk-overview.md` and `docs/plugins/sdk-migration.md`
   - Marked old `memory-core-host-engine-embeddings` path with "prefer `plugin-sdk/embeddings`"

3. **`extensions: migrate memory-core and ollama to plugin-sdk/embeddings`** (`48a99ec`)
   - Migrated 5 import sites in `memory-core` extension
   - Migrated 1 import site in `ollama` extension
   - Dogfoods the new path and conforms to the Extension SDK self-import guardrail (bundled extensions must not self-import via `plugin-sdk/<extension>`)

## Design decisions

- **Subpath name `embeddings`** — generic, memory-core-agnostic. Proposal also considered `embedding-providers` and `vectors`; reviewers would understand `embeddings` instantly.
- **Re-export barrel, not a new source of truth** — the new file just re-exports `../memory-host-sdk/engine-embeddings.js`, identical to what the old internal path exports. API baseline hash is unchanged.
- **Bundled-extension migration included** — originally the proposal said "memory-core stays unchanged". We widened scope to migrate bundled extensions because (a) it dogfoods the new path and proves it works in production, and (b) the Extension SDK self-import guardrail in the repo's root CLAUDE.md forbids memory-core from importing `plugin-sdk/memory-core-*` from its own production files.
- **Old path kept** — backward compatible; third-party plugins can migrate at their own pace.

## Critical motivation (for PR reviewers)

When a third-party plugin occupies `plugins.slots.memory` (like formative-memory), memory-core is disabled. With memory-core disabled, the embedding provider API becomes unreachable through the public SDK — the only path that exposes it today is memory-core-owned. Third-party memory-slot plugins are forced to either reach into non-public paths (fragile) or duplicate the embedding stack (drift-prone). This PR is the foundation that lets plugins stop duplicating.

Note: this PR does NOT yet decouple the factory functions from memory-core's internal auth resolution. That is a separate follow-up (see `item.md` 2026-04-15 findings and issue #29).

## Review feedback addressed

- **Greptile:** docs-alignment — `docs/plugins/sdk-overview.md` and `docs/plugins/sdk-migration.md` did not mention the new subpath. Addressed in commit `299d6bd`.

## CI status

- All required checks pass (check, check-additional, tsgo, tests, build-smoke, plugin-sdk:check-exports, plugin-sdk:api:check)
- **`Install Smoke`** fails during the `2026.4.10 → 2026.4.15-beta.1` upgrade path with `missing bundled runtime sidecar dist/extensions/qa-channel/runtime-api.js`. **Not caused by this PR** — the file builds correctly (`dist/extensions/qa-channel/runtime-api.js` exists locally), and this PR does not touch qa-channel. Upstream PR #67492 ("fix(plugin-sdk): route qa-channel facade through runtime-api seam") is open and targets the same error. A comment on the PR flags this as unrelated.

## Testing (Human Verification)

Live-tested with an isolated local bot on top of `2026.4.14`:

- Built tarball with version `2026.4.14-embeddings-test.1`
- Installed into isolated dir with `OPENCLAW_STATE_DIR`
- Credentials copied from Sylvia (`/srv/storage/openclaw/jari/agents/main/agent/auth-profiles.json`)
- Config: memory-core **enabled**, formative-memory disabled (intentionally — needed memory-core active to exercise the migrated import sites)
- Verified:
  - `openclaw plugins list` — memory-core loaded, 0 errors
  - `openclaw memory status` — vector ready, FTS ready, provider `openai` / `text-embedding-3-small`
  - `openclaw memory index` — factory call succeeded, 1/1 files indexed
  - `openclaw memory search "marine arthropod lifespan" --min-score 0` — returned the expected chunk ("crustaceans with a hard exoskeleton") with score 0.17, confirming real vector similarity (no keyword overlap)

Testing workflow documented at `~/Sources/homebase/infra/openclaw/AGENTS-PR-LIVE-TESTING.md`.

## Next actions

- **Waiting for maintainer review**
- No local work required until review feedback arrives
- If maintainer merges:
  - Consider swapping formative-memory's standalone embedding client for the SDK path (currently plugin has its own client per issue #29 to decouple from memory-core)
  - Only makes sense once factory functions also resolve auth independently — see item.md 2026-04-15 findings
- If maintainer requests changes: reopen worktree at `/Users/jari/Sources/openclaw__worktrees/fix/sdk-embedding-exports` (branch preserved on fork)

## Local state

- Worktree closed after this status write
- Branch preserved on fork: `jarimustonen/openclaw#fix/sdk-embedding-exports`
- 3 commits ahead of upstream main
- Local tarball `openclaw-2026.4.14-embeddings-test.1.tgz` can be regenerated from `pnpm pack` after `pnpm build`; no need to retain

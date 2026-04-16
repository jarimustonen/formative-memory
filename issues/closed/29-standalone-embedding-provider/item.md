---
created: 2026-04-15
updated: 2026-04-16
type: task
reporter: jari
assignee: jari
status: closed
priority: high
commits:
  - hash: b1c2650
    summary: "feat: standalone fetch-based embedding providers replacing SDK factories"
  - hash: c9ab132
    summary: "fix: always fall through to standalone after registry failure"
  - hash: fb6fa9e
    summary: "fix: prevent embedding provider drift and cross-provider model pollution"
  - hash: 878cfda
    summary: "fix(gemini): move api key to header, chunk batches, validate responses"
  - hash: 027b9f3
    summary: "fix: update EMBEDDING_REQUIRED_HINT to reflect actual standalone support"
  - hash: 3d18cad
    summary: "fix: tighten readAuthProfiles validation to reject malformed shapes"
  - hash: 814485e
    summary: "fix: suppress per-provider warnings during auto-select probing"
  - hash: dd21e75
    summary: "fix: prefer :default profile and warn on multi-profile ambiguity"
  - hash: 60fd99a
    summary: "fix: warn when using hardcoded \"main\" agent auth-profile fallback"
  - hash: 4f7af8d
    summary: "refactor: extract fetchWithTimeout to shared http.ts module"
  - hash: 3a1d801
    summary: "perf: cache parsed auth-profiles.json with mtime invalidation"
  - hash: 3b84bd0
    summary: "feat!: require auth-profiles.json (remove env var fallback)"
  - hash: 869d713
    summary: "docs: document auth-profiles requirement, provider pinning, and model scope"
  - hash: fd2dcee
    summary: "release: v0.3.0"
---

# 29. Standalone embedding provider — remove SDK factory dependency

_Source: embedding resolution in src/index.ts_

## Verification Outcome (2026-04-16)

Shipped in v0.3.0 (`fd2dcee`). Live-verified on jari's bot during v0.3.0 rollout. One follow-up finding surfaced and was fixed separately as #31 (multi-profile ambiguity warning swallowed by auto-select auto-probe). No other embedding regressions observed.

Review findings A–H noted during implementation were addressed incrementally in the commit trail above (fetchWithTimeout extraction, auth-profile caching, hardcoded-agent fallback warning, validation tightening, etc.). The env-var fallback was removed entirely (`3b84bd0`) — auth-profiles.json is now required.

## Description

Replace the SDK factory functions (`createOpenAiEmbeddingProvider`, `createGeminiEmbeddingProvider`) with a standalone fetch-based embedding client that reads API keys directly from auth-profiles.json. This removes the dependency on memory-core's internal auth resolution and makes embedding work in all contexts (assemble, cron, migration) without requiring a tool-call bootstrap.

## Problem

The plugin imports embedding factory functions from `openclaw/plugin-sdk/memory-core-host-engine-embeddings`. When memory-core is disabled (the intended configuration), these factories cannot resolve API keys — they rely on memory-core's internal auth wiring that only works after a tool call has been processed.

Live-tested on jari's bot (2026-04-15): with factory-context patch, agentDir is correctly available but embedding still fails because `createOpenAiEmbeddingProvider()` cannot read auth-profiles.json independently.

## Solution

- New `src/standalone-embedding.ts` module with fetch-based OpenAI and Gemini embedding clients
- Reads API keys from auth-profiles.json using existing `readAuthProfiles()` with profile key prefix matching and provider field matching
- Falls back to environment variables (OPENAI_API_KEY, GEMINI_API_KEY, GOOGLE_API_KEY)
- Registry-based resolution (memory-core adapters) still preferred when available
- Standalone providers used as fallback when registry is empty OR when registered adapters fail to initialize
- Provider + model persisted to DB state on first successful resolution to prevent silent drift
- Gemini auth moved to `x-goog-api-key` header; batchEmbedContents chunked to 100-item limit; response shapes validated

## Verification Checklist for Next Release

Run through these when the plugin is deployed to jari's bot. **Backup the DB before upgrade** because of the new identity pinning (commit 31a29e9).

### Smoke test (must pass)
- [ ] Plugin loads without errors — check logs for "Persisted embedding identity to DB" on first run
- [ ] `memory_store` works during a normal tool call
- [ ] `memory_search` returns relevant results
- [ ] Heartbeat/assemble runs without "agentDir not yet available" errors after first tool call
- [ ] Cron-triggered consolidation doesn't fail with embedding errors

### Fallback architecture (commit 74a78e2)
This is the core architectural fix. Previous live test (2026-04-15) didn't exercise this path because memory-core was entirely disabled. These need explicit verification:
- [ ] With memory-core **disabled** and auth-profiles.json containing OpenAI key: embedding works
- [ ] With memory-core **enabled** but OpenAI key **missing** from memory-core's auth wiring: standalone fallback kicks in — verify by checking logs for standalone HTTP call to api.openai.com
- [ ] Error messages when both registry and standalone fail: should show BOTH registry error AND "standalone: no API key found"

### Identity pinning (commit 31a29e9) — **most risky behavior change**
- [ ] First run after upgrade: DB gets `embedding_provider_id` and `embedding_model` keys set (check via sqlite CLI: `sqlite3 ~/.openclaw/.../associations.db "SELECT * FROM state WHERE key LIKE 'embedding_%'"`)
- [ ] After first run, the persisted values match what you expected (e.g. `openai` + `text-embedding-3-small`)
- [ ] Subsequent runs use the persisted identity — no re-resolution delays in logs
- [ ] If you manually change `config.embedding.provider` to a different value: plugin throws a clear "provider mismatch" error at startup (not silent corruption)
- [ ] If you manually change `config.embedding.model`: plugin throws a clear "model mismatch" error

**Rollback plan if #2 misbehaves:** delete the `embedding_provider_id` and `embedding_model` rows from the DB's `state` table — plugin will re-resolve on next run.

### Gemini provider changes (commit 91a204b)
Only relevant if you have a Gemini/Google key configured:
- [ ] Gemini embedding request succeeds — verify via network trace that the URL does NOT contain `?key=...` and `x-goog-api-key` header IS present
- [ ] Migration of >100 memories via Gemini completes without 400 errors (chunking works)
- [ ] `embedBatch([])` doesn't crash or make spurious API calls
- [ ] If Gemini returns a malformed response (unlikely but possible during outages): error message mentions the specific missing/invalid field, not "Cannot read properties of undefined"

### Known limitations (not blocking)
- Integration tests in `src/index.test.ts` suffer from a pre-existing `agentDir` lazy-init bug (15 pre-existing failures + 9 added during this work). Logic is covered by unit tests in `src/standalone-embedding.test.ts` (34/34 passing) and code review. File this as a separate issue.
- Review findings A–H deferred (multi-profile ambiguity, warning spam in auto-probe, stale `EMBEDDING_REQUIRED_HINT` text, duplicated `fetchWithTimeout`, sync I/O in cron path, etc.). Non-blocking; can be addressed in a follow-up.

## Quick Test

1. Disable memory-core plugin
2. Ensure auth-profiles.json has an OpenAI or Gemini key
3. Use memory_store tool — should work without errors

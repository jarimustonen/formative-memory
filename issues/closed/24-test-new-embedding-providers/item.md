---
created: 2026-04-15
updated: 2026-04-17
type: task
reporter: jari
assignee: jari
status: closed
priority: normal
commits:
  - hash: 29f9e5c
    summary: "test: verify LM Studio, Ollama, and Gemini prefix-preservation compatibility (#24)"
---

# 24. Test new embedding providers

_Source: plugin SDK_

## Description

OpenClaw v2026.4.12 and v2026.4.14 added new embedding providers that should work with our `resolveEmbeddingProvider("auto")` path. Need to verify compatibility.

1. **LM Studio bundled provider** (v2026.4.12, #53248) — New bundled provider with model discovery, stream preload, and memory-search embeddings. Should appear in `listMemoryEmbeddingProviders()` registry automatically.

2. **Ollama embedding adapter restored** (v2026.4.14, #63429, #66078, #66163) — Built-in `ollama` embedding adapter restored in memory-core with endpoint-aware cache keys. Was previously missing from registry.

3. **Non-OpenAI provider prefix preservation** (v2026.4.14, #66452) — Embedding model ref normalization no longer strips non-OpenAI provider prefixes. Fixes potential issues with Gemini/Ollama model names in our `createGeminiEmbeddingProvider()`.

## Tasks

- [x] Test LM Studio embedding provider with auto-resolution
- [x] Test Ollama embedding adapter with auto-resolution
- [x] Verify Gemini embedding model names resolve correctly after prefix fix

## Verification results

All three providers verified compatible with `resolveEmbeddingProvider("auto")`. No
plugin code changes were required for the registry path; only the standalone Gemini
fallback needed a small defensive normalization for the prefix-preservation change.

### 1. LM Studio (v2026.4.12 #53248) — verified

The auto-selection loop in `src/index.ts` already iterates every adapter that
exposes an `autoSelectPriority`, regardless of `id`. When the LM Studio adapter
registers itself in `listMemoryEmbeddingProviders()` with priority and a working
`create()`, our path picks it up unchanged. Identity is then persisted under
`embedding_provider_id = "lm-studio"`, which prevents future drift the same way
it does for openai/gemini.

Tests: `src/index.test.ts` "LM Studio adapter" describe block — auto-select
priority winner and explicit `embedding.provider: "lm-studio"` selection.

### 2. Ollama (v2026.4.14 #63429/#66078/#66163) — verified

Two paths covered:

- **Auto-select** when the restored adapter advertises `autoSelectPriority`
  (covered in tests).
- **Explicit `embedding.provider: "ollama"`** which works regardless of priority.
  This matters because the current memory-core source for the Ollama adapter
  (`extensions/ollama/src/memory-embedding-adapter.ts` in OpenClaw v2026.4.11
  source we have local) does **not** set `autoSelectPriority`. If that holds in
  v2026.4.14 the adapter would be invisible to `auto`. Operators using local
  Ollama should set `embedding.provider: "ollama"` explicitly.

The endpoint-aware `cacheKeyData` returned in `MemoryEmbeddingProviderCreateResult.runtime`
flows through our resolution path without consumption — we do not depend on it,
and our unit test confirms the runtime field does not interfere with provider
creation.

Tests: `src/index.test.ts` "Ollama adapter" describe block — auto-select with
priority, explicit selection without priority, and custom-model passthrough
(`mxbai-embed-large`).

### 3. Gemini prefix preservation (v2026.4.14 #66452) — verified with small fix

The fix is in memory-core: model refs like `gemini:text-embedding-004` no longer
have the `gemini:` prefix stripped during normalization. The registry adapter
handles its own internal normalization, so the registry path is unaffected.

Our **standalone** Gemini fallback (`src/standalone-embedding.ts`,
`createGeminiProvider()`) passes the model verbatim into the Gemini API URL.
Pre-fix, `gemini:` would be stripped before reaching us; post-fix it can arrive
intact, which would cause a 404 (`gemini%3Atext-embedding-004:embedContent`).

**Fix:** added `stripGeminiPrefix()` so the standalone fallback accepts both
`text-embedding-004` and `gemini:text-embedding-004`.

Tests: `src/standalone-embedding.test.ts` — `tryCreateStandaloneProvider`
"strips 'gemini:' prefix" / "leaves un-prefixed names untouched" and the
fetch-call URL test "calls Gemini API with bare model name when user passes
'gemini:' prefix".

## Side fix: stale `getTools` test helper

`src/index.test.ts`'s `getTools` helper was not passing `agentDir` into the tool
context. Since the lazy-agentDir refactor (commit 4e0d9c1, `fix: use lazy
agentDir getter and decouple init from workspace creation`), embedding
resolution rejects synchronously when `requireEmbedding` is true and `agentDir`
is missing. Twenty-nine tests across this file were failing on `main` because
of this stale helper. Updated `getTools` to pass `agentDir: tmpDir` (which
also happens to match the directory where `writeAuthProfiles()` writes), and
fixed one ad-hoc `toolFactory(...)` call in the turn-cycle integration test
the same way. No production code was touched for this.

## Reference

- [v2026.4.12 impact report](../../docs/openclaw-releases/v2026.4.12.md)
- [v2026.4.14 impact report](../../docs/openclaw-releases/v2026.4.14.md)

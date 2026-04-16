---
created: 2026-04-15
updated: 2026-04-15
type: improvement
reporter: jari
assignee: jari
status: open
priority: high
---

# 29. Standalone embedding provider — remove SDK factory dependency

_Source: embedding resolution in src/index.ts_

## Description

The plugin's embedding resolution depends on SDK factory functions (`createOpenAiEmbeddingProvider`, `createGeminiEmbeddingProvider`) imported from `openclaw/plugin-sdk/memory-core-host-engine-embeddings`. These functions cannot resolve API keys independently — they rely on memory-core's internal auth resolution which is unavailable when memory-core is disabled.

This is the root cause of embedding failures in all non-tool-call contexts: context engine assemble(), consolidation cron, and migration.

### How it fails

1. `resolveEmbeddingProvider("openai")` is called
2. `getMemoryEmbeddingProvider("openai")` returns null (memory-core disabled, registry empty)
3. Fallback: `tryDirectProviderFactory("openai")` calls `createOpenAiEmbeddingProvider({config, agentDir, model})`
4. SDK factory receives agentDir but **cannot read auth-profiles.json** from it — it uses memory-core's internal auth path
5. No `OPENAI_API_KEY` env var exists (haapa uses auth-profiles.json exclusively)
6. Factory fails → embedding unavailable

### Current behavior

Embedding works only via the **tool-call path**: the first tool call triggers lazy provider resolution at a point where the runtime has already wired up auth. All other paths fail:

- **Context engine assemble()** — first message has no memory recall (silent fail, try/catch)
- **Consolidation cron** — cannot run embedding-dependent operations (duplicate detection, merge storage)
- **Migration** — aborted with "embedding required but unavailable"

### Evidence

Live-tested on jari's bot (haapa, 2026-04-15) with factory-context patch. Error changed from "agentDir not yet available" (fixed by factory-context) to "Embedding provider required but not available" (this issue).

## Proposed fix

Replace SDK factory dependency with a standalone OpenAI/Gemini embedding client that reads API keys directly from auth-profiles.json using the plugin's existing `readAuthProfiles()` and `resolveApiKey()`.

```ts
// Current (SDK factory, broken without memory-core):
const result = await createOpenAiEmbeddingProvider({ config, agentDir, model });

// Proposed (standalone, reads auth-profiles directly):
const profiles = readAuthProfiles(stateDir, agentDir);
const resolved = resolveApiKey(profiles, "openai");
const provider = createStandaloneEmbeddingProvider("openai", resolved.apiKey, model);
```

The standalone provider would:
1. Read API key from auth-profiles.json (agentDir → stateDir fallback, already implemented)
2. Call OpenAI/Gemini embedding API directly via fetch
3. Return a `MemoryEmbeddingProvider`-compatible object (`embedQuery`, `embedBatch`)
4. Fall back to env vars (`OPENAI_API_KEY`, `GEMINI_API_KEY`) if auth-profiles not found

### Scope

- New file: `src/standalone-embedding.ts` — minimal OpenAI/Gemini embedding client
- Modified: `src/index.ts` — replace `tryDirectProviderFactory()` with standalone provider
- Remove imports: `createGeminiEmbeddingProvider`, `createOpenAiEmbeddingProvider` from SDK
- Keep: `listMemoryEmbeddingProviders()`, `getMemoryEmbeddingProvider()` for registry-based resolution when memory-core is active

### Benefits

- Embedding works in all contexts (assemble, cron, migration) without tool-call bootstrap
- No dependency on memory-core being active
- No dependency on SDK factory functions (unblocks issue #08 task 1 — factory-context)
- Auth resolution uses the same path as LLM caller (`readAuthProfiles`)

## Related

- **#08** Upstream PRs — this removes the need for SDK embedding exports (task 4) as a blocker for factory-context (task 1)
- **#24** Test new embedding providers — standalone provider should support OpenAI, Gemini; Ollama and LM Studio remain via registry
- **#21** Cron trigger mismatch — consolidation cron needs working embeddings

## Tasks

- [ ] Implement standalone OpenAI embedding client (fetch-based, auth-profiles)
- [ ] Implement standalone Gemini embedding client
- [ ] Replace `tryDirectProviderFactory()` with standalone providers
- [ ] Test: assemble() on first message without prior tool call
- [ ] Test: consolidation cron embedding operations
- [ ] Test: migration with embedding enrichment

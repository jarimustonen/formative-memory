---
created: 2026-04-04T10:15:00+03:00
source_branch: main
task: Replace hardcoded OpenAI embedder with OpenClaw embedding provider API
---

# Task: Integrate OpenClaw Embedding Provider API

## Objective

Replace the plugin's hardcoded OpenAI `fetch()` calls with OpenClaw's built-in `getMemoryEmbeddingProvider()` API. This eliminates the need for `embedding.apiKey` in the plugin config — API keys are resolved automatically from auth-profiles, `models.providers.*.apiKey`, or environment variables, just like memory-core does.

## Context

The plugin currently has its own `createEmbedder()` function in `src/index.ts` (~lines 31-54) that makes raw `fetch()` calls to `https://api.openai.com/v1/embeddings` with a manually configured API key. This is wrong because:

1. Users must configure an API key specifically for this plugin, even if they already have one configured for OpenClaw
2. Only OpenAI is supported — no Gemini, Voyage, Mistral, local, or Ollama
3. It doesn't use OpenClaw's auth resolution chain (auth-profiles → models.providers → env vars)

OpenClaw provides a provider registry via `openclaw/plugin-sdk/memory-core-host-engine-embeddings`:

```ts
import { getMemoryEmbeddingProvider } from "openclaw/plugin-sdk/memory-core-host-engine-embeddings";

const adapter = getMemoryEmbeddingProvider("openai"); // or "auto", "gemini", etc.
const result = await adapter.create({
  config: openclawConfig,
  agentDir,
  provider: providerId,
  model: "text-embedding-3-small",
});
const provider = result.provider; // { embedQuery(text): Promise<number[]>, embedBatch(texts): Promise<number[][]> }
```

The existing `EmbeddingCircuitBreaker` should wrap the provider's `embedQuery()` method.

## Detailed plan

See `history/plan-embedding-provider-integration.md` for the full analysis. Key points:

- The provider needs `OpenClawConfig` and `agentDir` at creation time — these come from tool/context engine runtime context
- Provider creation is async — may need lazy initialization on first use
- If no provider is available (no API keys configured), degrade to BM25-only (circuit breaker OPEN state)
- The `MemoryEmbeddingProvider` interface gives us `embedQuery(text: string): Promise<number[]>` which matches what we need

## Files to Examine

- `src/index.ts` — `createEmbedder()` function and workspace creation (lines ~31-54, ~100-150)
- `src/config.ts` — config type with `embedding.apiKey`
- `openclaw.plugin.json` — config schema requiring `embedding.apiKey`
- `src/memory-manager.ts` — how the embedder is used (store, search)
- `src/embedding-circuit-breaker.ts` — wraps the embedder
- `history/plan-embedding-provider-integration.md` — detailed plan

For OpenClaw API reference:
- `../openclaw/src/plugins/memory-embedding-providers.ts` — provider registry types
- `../openclaw/src/plugin-sdk/memory-core-host-engine-embeddings.ts` — SDK exports
- `../openclaw/extensions/memory-core/src/memory/provider-adapters.ts` — example adapters
- `../openclaw/docs/reference/memory-config.md` — how users configure embedding providers

## Success Criteria

- `embedding.apiKey` is no longer required in plugin config
- Plugin uses OpenClaw's embedding provider API to get embeddings
- Existing `EmbeddingCircuitBreaker` wraps the provider
- If no embedding provider is available, plugin degrades to BM25-only
- All existing tests pass (may need mock updates)
- Config schema in `openclaw.plugin.json` updated (apiKey removed from required)
- Optional config: `embedding.provider` (default "auto") and `embedding.model` (override)

## Workflow

You implement the task. When complete, the user will review your changes.
The user should commit all changes using `/commit`.
The user should finalize and merge worktree with `/worktree-merge`.

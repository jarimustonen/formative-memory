# Plan: Integrate with OpenClaw Embedding Provider API

## Motivation

The plugin currently makes its own OpenAI API calls with a hardcoded endpoint and requires `embedding.apiKey` in its config. OpenClaw has a built-in embedding provider infrastructure (`MemoryEmbeddingProviderAdapter`) that:

- Resolves API keys from auth-profiles, `models.providers.*.apiKey`, or environment variables automatically
- Supports multiple providers (OpenAI, Gemini, Voyage, Mistral, Ollama, local)
- Auto-selects the best available provider
- Handles batching, retry, and multimodal embeddings

The plugin should use this instead of rolling its own.

## Approach: Direct Provider Access

Use `getMemoryEmbeddingProvider()` from `openclaw/plugin-sdk/memory-core-host-engine-embeddings` to get the configured embedding adapter, then wrap it with our existing `EmbeddingCircuitBreaker`.

## Key Changes

### 1. Remove `createEmbedder()` from `src/index.ts`

Current code (lines ~31–54) makes raw `fetch()` calls to OpenAI. Replace with:

```ts
import { getMemoryEmbeddingProvider } from "openclaw/plugin-sdk/memory-core-host-engine-embeddings";

// At workspace creation time, resolve the provider:
const adapter = getMemoryEmbeddingProvider(providerId); // "openai", "auto", etc.
const result = await adapter.create({
  config: openclawConfig,
  agentDir,
  provider: providerId,
  model: config.embedding?.model,
  remote: config.embedding?.remote,
});
const provider = result.provider; // { embedQuery, embedBatch, model, ... }
```

### 2. Wrap with circuit breaker

```ts
const wrappedEmbed = async (text: string, signal?: AbortSignal) => {
  return circuitBreaker.call(() => provider.embedQuery(text));
};
```

### 3. Update config schema (`openclaw.plugin.json`)

Remove `embedding.apiKey` (required) — no longer needed. Optionally keep:
- `embedding.model` — override default model
- `embedding.provider` — override auto-selection ("openai", "gemini", etc.)

### 4. Update `MemoryManager` embedder type

Currently `Embedder = { embed(text: string, signal?: AbortSignal): Promise<number[]> }`. This stays the same — only the creation changes.

### 5. Handle provider unavailability

If no provider is configured (no API keys anywhere), the plugin should degrade gracefully to BM25-only mode — same as the current circuit breaker OPEN state.

## Context needed at runtime

The provider creation needs `OpenClawConfig` and `agentDir`, which are available:
- In tool handlers via the tool context
- In context engine via runtime context
- These are already threaded through workspace creation

## Dependencies

- `openclaw/plugin-sdk/memory-core-host-engine-embeddings` must be importable at runtime
- memory-core plugin must be loaded (it registers the built-in adapters)
  - OR: our plugin registers its own adapters
  - OR: we use the standalone provider creation path

## Open Questions

- Does our plugin co-exist with memory-core (both loaded)? If so, which one owns the `memory` slot?
- If memory-core is not loaded, are the embedding adapters still available?
- Should we register our own adapters or depend on memory-core's registrations?
- Do we need `agentDir` at workspace creation time? Currently workspaces are keyed by `memoryDir:model:apiKey` — this key would change.

## Files to modify

- `src/index.ts` — remove `createEmbedder()`, update workspace creation
- `openclaw.plugin.json` — remove `embedding.apiKey` from required config
- `src/config.ts` — update config type
- Tests that mock the embedder

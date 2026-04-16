# Proposal: Export embedding provider factories from SDK public surface

## Problem

The embedding provider factory functions (`createGeminiEmbeddingProvider`, `createOpenAiEmbeddingProvider`) and the provider registry (`getMemoryEmbeddingProvider`, `listMemoryEmbeddingProviders`, `MemoryEmbeddingProvider` type) are only available from an internal path:

```ts
import {
  createGeminiEmbeddingProvider,
  createOpenAiEmbeddingProvider,
  getMemoryEmbeddingProvider,
  listMemoryEmbeddingProviders,
  type MemoryEmbeddingProvider,
} from "openclaw/plugin-sdk/memory-core-host-engine-embeddings";
```

This path (`memory-core-host-engine-embeddings`) is an implementation detail of the `memory-core` extension. It is not part of the plugin SDK's public API — there is no `exports` entry for it in the SDK's `package.json`, and the name itself signals that it belongs to memory-core's internals.

### Why this matters

Any plugin that needs embeddings — not just memory plugins — must reach into memory-core's internals. This creates three problems:

1. **Fragile import path.** The path is not a public contract. A refactor of memory-core's internal structure (e.g. renaming `host-engine-embeddings` to `providers`) breaks all consumers silently. There is no semver protection because internal paths are not covered by the SDK's versioning policy.

2. **Implicit dependency on memory-core.** A plugin that imports from `memory-core-host-engine-embeddings` requires memory-core to be installed, even if it only wants the OpenAI or Gemini factory function. If a user disables memory-core (e.g. by switching `plugins.slots.memory` to a custom plugin), the import path may stop resolving.

3. **Missing from SDK documentation.** The plugin SDK docs describe `registerContextEngine`, `registerTool`, `registerMemoryPromptSection`, etc. — but say nothing about how to obtain an embedding provider. Plugin authors have to read memory-core's source to discover these functions exist.

### Concrete case: associative-memory plugin

The `formative-memory` plugin needs embeddings for semantic search over memories. It uses the factory functions in two ways:

1. **Registry-based resolution** — `listMemoryEmbeddingProviders()` and `getMemoryEmbeddingProvider(id)` to enumerate and select from registered adapters (the preferred path when memory-core is active).

2. **Direct factory fallback** — `createOpenAiEmbeddingProvider()` and `createGeminiEmbeddingProvider()` as a fallback when the registry is empty (memory-core disabled). This is the `tryDirectProviderFactory()` function in `src/index.ts`.

Both paths import from the internal module. If memory-core is restructured, both break.

## Proposed change

### Re-export from the plugin SDK's public surface

Add a stable subpath export to the plugin SDK:

```jsonc
// openclaw package.json (exports field)
{
  "./plugin-sdk/embeddings": "./dist/plugin-sdk/embeddings.js"
}
```

The new module re-exports the embedding provider API:

```ts
// src/plugin-sdk/embeddings.ts

// Factory functions for creating embedding providers directly
export { createGeminiEmbeddingProvider } from "../extensions/memory-core/host-engine/embeddings/gemini.js";
export { createOpenAiEmbeddingProvider } from "../extensions/memory-core/host-engine/embeddings/openai.js";

// Provider registry — enumerate and select registered adapters
export { getMemoryEmbeddingProvider, listMemoryEmbeddingProviders } from "../extensions/memory-core/host-engine/embeddings/registry.js";

// Types
export type { MemoryEmbeddingProvider } from "../extensions/memory-core/host-engine/embeddings/types.js";
```

Consumers then import from a stable, documented path:

```ts
import {
  createGeminiEmbeddingProvider,
  createOpenAiEmbeddingProvider,
  getMemoryEmbeddingProvider,
  listMemoryEmbeddingProviders,
  type MemoryEmbeddingProvider,
} from "openclaw/plugin-sdk/embeddings";
```

### Alternative: export from the main plugin-sdk entry

If a separate subpath is not wanted, these could be added to the main `openclaw/plugin-sdk` barrel export. This is simpler but may make the plugin-sdk entry point heavier than desired (embedding providers pull in API client dependencies).

### Naming

The subpath name should avoid referencing `memory-core`. Suggestions:

- `openclaw/plugin-sdk/embeddings` — clear, generic, short (preferred)
- `openclaw/plugin-sdk/embedding-providers` — more explicit
- `openclaw/plugin-sdk/vectors` — too abstract

## What should be exported

| Export | Kind | Purpose |
|--------|------|---------|
| `createGeminiEmbeddingProvider` | Factory function | Create a Gemini embedding provider with config + agentDir |
| `createOpenAiEmbeddingProvider` | Factory function | Create an OpenAI embedding provider with config + agentDir |
| `getMemoryEmbeddingProvider` | Registry lookup | Get a registered adapter by ID |
| `listMemoryEmbeddingProviders` | Registry enumeration | List all registered adapters with priority |
| `MemoryEmbeddingProvider` | Type | The provider interface (`id`, `model`, `embedQuery`, `embedBatch`) |

The factory function signature (based on current usage):

```ts
type EmbeddingFactoryOptions = {
  config: OpenClawConfig;
  agentDir?: string;
  model: string;
};

type EmbeddingFactoryResult = {
  provider: MemoryEmbeddingProvider;
  client?: unknown; // provider-specific client instance
};

declare function createOpenAiEmbeddingProvider(
  opts: EmbeddingFactoryOptions,
): Promise<EmbeddingFactoryResult>;

declare function createGeminiEmbeddingProvider(
  opts: EmbeddingFactoryOptions,
): Promise<EmbeddingFactoryResult>;
```

## Impact

### OpenClaw repository

- `package.json` — Add `"./plugin-sdk/embeddings"` to `exports` map
- `src/plugin-sdk/embeddings.ts` (new) — Re-export barrel file
- `src/plugin-sdk/index.ts` — Optionally re-export for convenience
- Documentation — Add "Embedding Providers" section to plugin SDK docs

### Existing code

- **No breaking changes.** The old internal path continues to work. This PR only adds a new stable path.
- **memory-core stays unchanged.** The factories remain in memory-core — the SDK barrel just re-exports them.

### formative-memory (this plugin)

After the upstream PR lands, the plugin will:

1. Change the import from `openclaw/plugin-sdk/memory-core-host-engine-embeddings` to `openclaw/plugin-sdk/embeddings`
2. No other code changes needed — the API surface is identical, only the import path changes

## Live test results (2026-04-15) — dependency confirmed

Tested factory-context PR (`fix/context-engine-factory-context`) on jari's bot. The context engine factory now receives `agentDir` correctly, but **embedding resolution still fails** because:

1. `listMemoryEmbeddingProviders()` returns empty when memory-core is disabled
2. `createOpenAiEmbeddingProvider()` cannot resolve API keys from auth-profiles independently — it relies on memory-core's internal auth resolution

This confirms that the SDK embedding exports proposal is **not just a cleanup** but a **functional dependency** for the factory-context PR. Without independently-working factory functions, the plugin cannot resolve embeddings when:

- memory-core is disabled (the intended configuration for this plugin)
- The context engine factory runs before memory-core's embedding registry is populated

### What the exported factories must support

The re-exported factory functions must be able to resolve API keys **without** memory-core being active. Specifically:

- Read `auth-profiles.json` from `agentDir` (passed via `opts.agentDir`)
- Fall back to environment variables (`OPENAI_API_KEY`, `GEMINI_API_KEY`)
- Work identically whether memory-core is enabled or disabled

If the current factory functions delegate auth to memory-core internals, the re-export alone is not sufficient — the auth resolution must be decoupled first.

### Revised priority (2026-04-15)

The plugin will implement its own standalone embedding client (#29) that reads API keys directly from auth-profiles.json via the existing `readAuthProfiles()`/`resolveApiKey()` helpers. This removes the SDK factory dependency entirely and unblocks the factory-context PR without waiting for this upstream change.

With #29 in place, this SDK embedding exports PR changes from **blocker** to **cleanup**:

- **Before #29:** This PR is a functional dependency — factory-context cannot land without it
- **After #29:** This PR is an architectural improvement — stabilizes the import path and benefits other plugin authors, but formative-memory no longer needs it to function

The PR is still worth submitting because:

1. Other plugins that need embeddings will hit the same internal-path fragility
2. A public `openclaw/plugin-sdk/embeddings` subpath is cleaner than every plugin rolling its own embedding client
3. If the factory functions are fixed to resolve auth independently, the plugin could drop its standalone client and use the SDK again

### Ordering

This PR no longer blocks the factory-context PR (formative-memory uses standalone embedding via #29). It can land independently at any time.

## Backward compatibility

- The old `memory-core-host-engine-embeddings` path is not removed — existing plugins keep working
- The new path is additive — it re-exports the same symbols from a stable location
- If the `memory-core` internal structure is later refactored, only the re-export barrel needs updating — all consumers of the public path are unaffected

## Files to examine

- OpenClaw `package.json` — `exports` field, current subpath entries
- `src/plugin-sdk/` — Existing SDK entry points and barrel files
- `extensions/memory-core/host-engine/embeddings/` — Source of the factory functions and registry
- `extensions/memory-core/index.ts` — How memory-core currently registers adapters
- Plugin SDK documentation — Where to add the new section

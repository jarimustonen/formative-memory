# Proposal: Pass runtime context to ContextEngineFactory

## Problem

`ContextEngineFactory` is currently defined as:

```ts
// src/context-engine/registry.ts
export type ContextEngineFactory = () => ContextEngine | Promise<ContextEngine>;
```

The factory receives no parameters. This means plugins that register a context engine via `api.registerContextEngine(id, factory)` cannot know the runtime context (config, workspace directory, agent identity) when constructing the engine.

### Why this matters

Plugins that own both tools and a context engine need a shared workspace (database, files, state). Tools receive full context via `OpenClawPluginToolContext` on each invocation:

```ts
api.registerTool((ctx) => {
  // ctx.config, ctx.agentDir, ctx.workspaceDir, ctx.sessionKey available
  return createMyTool(ctx);
});
```

But the context engine factory gets nothing:

```ts
api.registerContextEngine("my-engine", () => {
  // No config, no agentDir, no workspaceDir
  return createMyEngine(/* ??? */);
});
```

This forces plugins to use workarounds:

1. **Capture from first tool call** — Store config/workspaceDir from the first tool invocation, share via closure. The context engine silently uses incorrect defaults until a tool runs.

2. **Global mutable state** (`lastWorkspace`) — Track the most recently used workspace globally. Breaks under concurrent/multi-agent use.

3. **Hardcode fallback paths** (`"."`) — The engine guesses the workspace root. Wrong if the host resolves a different working directory.

All three are fragile and incorrect under multi-agent, multi-workspace, or out-of-order execution.

### Concrete case: associative-memory plugin

The `openclaw-associative-memory` plugin registers both tools and a context engine. Both need access to the same `MemoryManager` (backed by a SQLite database). The manager requires `OpenClawConfig` and `agentDir` to resolve the embedding provider.

Currently the plugin works around this by creating the workspace lazily on first tool call and having the context engine use `getWorkspace(".")` as a fallback. This means:

- If the context engine's `assemble()` runs before any tool call, it creates the workspace at `"."` instead of the actual workspace directory
- The embedding provider is initialized without `agentDir`, which matters for local model discovery and per-agent credentials
- The plugin cannot support multiple workspaces because the engine has no way to know which workspace to use

## Proposed change

### Option A: Pass context to ContextEngineFactory (preferred)

Add a context parameter to the factory:

```ts
export type ContextEngineFactoryContext = {
  config: OpenClawConfig;
  agentDir?: string;
  workspaceDir?: string;
  sessionKey?: string;
};

export type ContextEngineFactory =
  | ((ctx: ContextEngineFactoryContext) => ContextEngine | Promise<ContextEngine>)
  // Backward compatible: no-arg factories still work
  | (() => ContextEngine | Promise<ContextEngine>);
```

The runtime calls the factory with context when available. The resolution site in `resolveContextEngine()` already has access to config and session state.

### Option B: Pass context to engine methods only

Keep the factory parameterless, but add optional `config`/`agentDir`/`workspaceDir` fields to engine method params (e.g. `assemble`, `afterTurn`). This is more invasive since it touches the `ContextEngine` interface.

### Option C: Lifecycle hook after context is known

Add a `bind(ctx)` method to `ContextEngine` that the runtime calls once context is resolved:

```ts
interface ContextEngine {
  bind?(ctx: { config: OpenClawConfig; agentDir?: string; workspaceDir?: string }): void;
  // ... existing methods
}
```

## Impact

- `src/context-engine/registry.ts` — Update `ContextEngineFactory` type
- `src/context-engine/registry.ts` — Update `resolveContextEngine()` to pass context when calling factory
- `src/plugins/types.ts` — Update `registerContextEngine` signature if needed
- `src/plugins/api-builder.ts` — Thread context through to factory call
- Existing plugins with `() => engine` factories continue to work (backward compatible if union type is used)

## Files to examine

- `src/context-engine/registry.ts` — Factory type, `resolveContextEngine()`, `getContextEngineFactory()`
- `src/context-engine/types.ts` — `ContextEngine` interface (for Option B/C)
- `src/context-engine/index.ts` — Engine resolution and lifecycle
- `src/plugins/types.ts` — `OpenClawPluginApi.registerContextEngine`
- `src/plugins/api-builder.ts` — Where `registerContextEngine` is implemented
- `extensions/memory-core/index.ts` — Reference: memory-core avoids this by not registering a context engine

## Current workaround (v0.2.x)

Without this upstream change, the formative-memory plugin uses three workarounds
documented in `src/index.ts` (see the `WORKAROUND` block comment above `createWorkspace`):

1. **Lazy agentDir getter** — `createWorkspace` receives `() => runtimePaths.agentDir`
   instead of a static string. The embedding provider resolves agentDir dynamically
   at each `embed()` call, allowing self-healing when a tool call provides context
   after the workspace was already created by a heartbeat/cron trigger.

2. **Decoupled init** — Startup tasks (migration, workspace cleanup) are tracked with
   a separate `startupTasksTriggered` flag, not tied to workspace creation. This
   prevents them from being permanently skipped when the workspace is first created
   by a non-tool caller (context engine, cron).

3. **Non-permanent provider caching** — When embedding resolution fails because
   agentDir is not yet available, the error is NOT permanently cached. Subsequent
   calls can retry once agentDir becomes available via a tool call or startup service.

### Known limitations of the workaround

- `workspaceDir` is still captured at first access — if the context engine creates
  the workspace from `"."` before a tool call, the memory DB may land in the wrong
  directory. This cannot be fixed without the upstream change.
- The startup service extracts `agentDir` from an undocumented field on the service
  context (`ctx.agentDir`). This is runtime-validated but not type-safe.
- Multi-agent / multi-workspace is not supported — requires the upstream change.

## Live test results (2026-04-15)

Tested on jari's bot (haapa, OpenClaw v2026.4.12 with runtime patches).

### What worked

- Factory receives `ctx.agentDir` and `ctx.workspaceDir` correctly
- Plugin sets `runtimePaths.agentDir` from factory context — the old "agentDir not yet available" error no longer occurs
- Plugin registers successfully, Telegram messages flow, bot responds
- No regressions in basic operation

### What did not work

**Embedding provider resolution fails** even with `agentDir` available. The error changed from:

```
Embedding provider auth requires agentDir which is not yet available.
```

to:

```
Embedding provider required but not available.
Set one of: OPENAI_API_KEY, GEMINI_API_KEY, VOYAGE_API_KEY, or MISTRAL_API_KEY.
```

**Root cause:** When memory-core is disabled (`plugins.entries.memory-core.enabled: false`), `listMemoryEmbeddingProviders()` returns an empty list because memory-core never registers its adapters. The fallback path (`tryDirectProviderFactory`) calls `createOpenAiEmbeddingProvider()` which cannot resolve the API key from auth-profiles — the SDK factory functions rely on memory-core's internal auth resolution that is not available when memory-core is disabled.

Before this change, embedding resolution worked because it was triggered by the first tool call, at which point memory-core's embedding registry was populated by the runtime. With factory-context, the context engine factory runs earlier in the lifecycle — before the embedding registry is populated.

### Dependency: SDK embedding provider exports (#08 task 4)

This confirms that the factory-context PR and the SDK embedding exports PR are **interdependent**. Factory-context alone moves the "when" of provider resolution earlier, but the provider registry is still empty at that point. Either:

1. The embedding registry must be populated before context engine factories run, OR
2. The SDK factory functions must be able to resolve auth independently (the SDK embedding exports proposal)

Both PRs should land together or in sequence (embedding exports first).

## What the plugin will do after both PRs land

Once the factory receives context AND embedding factories work independently:

1. Replace the single-workspace singleton with a `Map<string, ManagedWorkspace>` keyed by resolved memory directory
2. Use `ctx.config` and `ctx.agentDir` from the factory to resolve the correct workspace
3. Remove the `getWorkspace(".")` fallback hack and all three workarounds above
4. Support multiple concurrent workspaces/agents correctly

The relevant code is in `src/index.ts` of the `formative-memory` repository, specifically the `register()` function and `createWorkspace()`.

## Test branch

- formative-memory: `test/context-engine-factory-context` (pushed to origin)
- OpenClaw fork: `fix/context-engine-factory-context` (pushed to jarimustonen/openclaw)

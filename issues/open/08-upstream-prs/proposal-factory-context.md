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

## What the associative-memory plugin will do after this lands

Once the factory receives context, the plugin will:

1. Replace the single-workspace singleton with a `Map<string, ManagedWorkspace>` keyed by resolved memory directory
2. Use `ctx.config` and `ctx.agentDir` from the factory to resolve the correct workspace
3. Remove the `getWorkspace(".")` fallback hack
4. Support multiple concurrent workspaces/agents correctly

The relevant code is in `src/index.ts` of the `openclaw-associative-memory` repository, specifically the `register()` function and `createWorkspace()`.

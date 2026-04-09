# Proposal: Run plugin service start() for memory-kind plugins at gateway boot

## Problem

`registerService()` is available to all plugins, but `startPluginServices()` only runs services registered by **startup sidecar** plugins. A plugin is classified as a startup sidecar when:

```ts
function isGatewayStartupSidecar(plugin) {
  return plugin.channels.length === 0 && !hasRuntimeContractSurface(plugin);
}
```

Memory plugins have `hasRuntimeContractSurface() === true` (because `hasKind(plugin.kind, "memory")` is true), so their services are **never started**.

### Why this matters

Memory plugins need to run one-time setup at boot:

1. **Migration** — importing data from the old memory-core file-based system into the new associative memory database. This should happen once, transparently, without user action.
2. **Workspace cleanup** — removing file-based memory instructions from AGENTS.md/SOUL.md that conflict with the new memory system.
3. **Embedding backfill** — generating embeddings for memories that were stored without them (circuit breaker was open at store time).

These tasks are session-independent and should complete before the first user interaction. Without service start, the plugin has no lifecycle hook that runs at boot.

### Current workaround

The plugin exposes a `/memory-init` command that users must run manually. This is error-prone and breaks the "zero user action" migration principle.

## Proposed fix

Include memory-kind plugins in `resolveGatewayStartupPluginIds()`:

```ts
function isGatewayStartupSidecar(plugin) {
  return plugin.channels.length === 0 && !hasRuntimeContractSurface(plugin);
}

// Add: memory plugins should also have their services started
function shouldStartServices(plugin) {
  return isGatewayStartupSidecar(plugin) || hasKind(plugin.kind, "memory");
}
```

Alternatively, decouple "has runtime contract surface" from "should start services". A plugin can have both runtime tools (loaded per-session) and boot-time services (started once at gateway init).

## Impact

- No behavioral change for existing plugins — only memory-kind plugins gain service start
- Memory plugins already handle missing service start gracefully (30s timeout fallback)
- Service start is already wrapped in try/catch in `startPluginServices()`

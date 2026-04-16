# Proposal: Run plugin service start() for memory-kind plugins at gateway boot

## Status (2026-04-16)

**Original analysis was based on pre-2026-04-11 upstream code.** Since then upstream has
evolved significantly. Updated analysis below.

## Upstream landscape

### 2026-04-10: Dreaming startup reconciliation (`03e19c5436`, Mariano)
Added special-case handling so dreaming plugins boot their services even when they are not
the active memory slot.

### 2026-04-11: Slot-aware memory startup (`5e2136c6ae`, EronFan)
Memory-kind plugins that are explicitly selected as the memory slot
(`plugins.slots.memory: <id>`) are now included in `resolveGatewayStartupPluginIds()`.
Their `start()` is called at boot.

This means the original proposal's premise — "memory plugin services are never started" — is
**no longer fully accurate**. Services DO start when the plugin is the explicit slot.

### 2026-04-15: Default-slot fix (our PR, branch `fix/memory-plugin-service-start`)
`resolveExplicitMemorySlotStartupPluginId` read the raw config and returned `undefined` when
the user hadn't set a slot explicitly, missing the normalized default (`memory-core`). Fixed by
reading the normalized config so the default slot resolves correctly. This only affects
`memory-core`, not formative-memory.

## Remaining problems

### Problem 1: Workspace-origin memory-slot plugins are disabled even when selected

In `src/plugins/config-state.ts` around line 296-309:

```ts
if (
  params.origin === "workspace" &&
  !explicitlyAllowed &&
  entry?.enabled !== true &&
  explicitSelection.cause !== "selected-context-engine-slot"  // ← only context-engine bypass
) {
  return toPluginActivationState({
    enabled: false,
    source: "disabled",
    cause: "workspace-disabled-by-default",
  });
}
```

The workspace-disabled-by-default check bypasses for `selected-context-engine-slot` but
**not** for `selected-memory-slot`. A workspace-origin memory plugin selected as the memory
slot is still classified as disabled, so its services never start.

`resolveExplicitPluginSelection` returns causes in this order:
```ts
if (params.config.slots.memory === params.id) {
  return { explicitlyEnabled: true, cause: "selected-memory-slot" };
}
if (params.config.slots.contextEngine === params.id) {
  return { explicitlyEnabled: true, cause: "selected-context-engine-slot" };
}
```

Memory slot is checked first, so even if formative-memory (`kind: ["memory", "context-engine"]`)
is set as both memory and context-engine slot, the cause is `selected-memory-slot` and the
workspace check still blocks it.

### Problem 2: Non-workspace memory-slot plugins should already work
For formative-memory installed via `npm install -g` (origin: `global`) or configured via
`plugins.entries` (origin: `config`), slot-based activation should already work upstream after
the 2026-04-11 fix.

This needs verification with an actual end-to-end test:
1. Install formative-memory globally
2. Set `plugins.slots.memory: formative-memory` in config
3. Boot gateway
4. Verify `start()` is called

If this scenario also fails, there's a deeper bug we haven't identified.

## Proposed fix

### Fix A: Memory-slot bypass for workspace-disabled-by-default

Update the workspace check in `resolvePluginActivationState` to also bypass for
`selected-memory-slot`:

```ts
if (
  params.origin === "workspace" &&
  !explicitlyAllowed &&
  entry?.enabled !== true &&
  explicitSelection.cause !== "selected-context-engine-slot" &&
  explicitSelection.cause !== "selected-memory-slot"   // ← new
) {
  return ...disabled-by-default...
}
```

Rationale: a plugin explicitly selected as a slot is by definition intentional. Workspace
origin is about "disabled-by-default unless user opts in"; selecting the plugin as a slot IS
opting in.

### Fix B: Generalize slot-selection bypass

The cleaner version: bypass workspace-disabled-by-default for ANY slot selection, not
case-by-case:

```ts
const isSelectedSlot =
  explicitSelection.cause === "selected-memory-slot" ||
  explicitSelection.cause === "selected-context-engine-slot";

if (
  params.origin === "workspace" &&
  !explicitlyAllowed &&
  entry?.enabled !== true &&
  !isSelectedSlot
) {
  return ...disabled-by-default...
}
```

This is forward-compatible for future slot kinds.

## Out of scope

The original proposal's idea of starting services for ALL memory-kind plugins (regardless
of slot) was considered and rejected during PR review because:

- Memory plugins frequently allocate heavy resources (DB pools, file locks, vector indexing)
- Users may enable multiple memory backends for secondary features (CLI backends, providers)
  — not all of them should boot services simultaneously
- The slot mechanism already models "which implementation is primary for a capability"; that's
  the right abstraction for which plugin boots

See review history in `history/review-memory-plugin-service-start.md` (openclaw worktree)
for the full reasoning.

## Impact of fixes A/B

- No behavioral change for bundled or non-workspace plugins
- Workspace memory plugins set as the memory slot will correctly start their services
- No new eager-start surface — activation is gated by explicit slot selection
- Service start is already wrapped in try/catch in `startPluginServices()`

## Testing

1. Install formative-memory to a workspace (`pnpm install formative-memory` in workspace root)
2. Configure `plugins.slots.memory: formative-memory`
3. Boot gateway
4. Assert `start()` is called and migrations/cleanup/backfill run

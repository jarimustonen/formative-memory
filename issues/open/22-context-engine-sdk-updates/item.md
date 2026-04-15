---
created: 2026-04-15
updated: 2026-04-15
type: improvement
reporter: jari
assignee: jari
status: open
priority: normal
---

# 22. Context engine SDK updates

_Source: plugin SDK_

## Description

OpenClaw v2026.4.7 introduced new context engine capabilities that our plugin should adopt:

1. **`assemble()` signature update** — New parameters `availableTools` and `citationsMode` added to the context engine `assemble()` method. Our implementation should accept and utilize these.

2. **Prompt-cache telemetry** — `ContextEngineRuntimeContext` now includes a `promptCache` field with retention policy, usage (input/output/cacheRead/cacheWrite tokens), observation data, and expiry. New types: `ContextEnginePromptCacheInfo`, `ContextEnginePromptCacheRetention`, `ContextEnginePromptCacheUsage`. Our `afterTurn()` and `compact()` methods receive this data — we could use it for cache-aware memory prioritization (e.g. prioritize memories when cache evicts).

## Tasks

- [ ] Update `assemble()` to accept `availableTools` and `citationsMode` parameters
- [ ] Evaluate prompt-cache telemetry for memory prioritization in `afterTurn()`/`compact()`

## Reference

- [v2026.4.7 impact report](../../docs/openclaw-releases/v2026.4.7.md)

---
created: 2026-04-15
updated: 2026-04-17
type: improvement
reporter: jari
assignee: jari
status: closed
priority: normal
commits: []
---

# 22. Context engine SDK updates

_Source: plugin SDK_

## Description

OpenClaw v2026.4.7 introduced new context engine capabilities that our plugin should adopt:

1. **`assemble()` signature update** — New parameters `availableTools` and `citationsMode` added to the context engine `assemble()` method. Our implementation should accept and utilize these.

2. **Prompt-cache telemetry** — `ContextEngineRuntimeContext` now includes a `promptCache` field with retention policy, usage (input/output/cacheRead/cacheWrite tokens), observation data, and expiry. New types: `ContextEnginePromptCacheInfo`, `ContextEnginePromptCacheRetention`, `ContextEnginePromptCacheUsage`. Our `afterTurn()` and `compact()` methods receive this data — we could use it for cache-aware memory prioritization (e.g. prioritize memories when cache evicts).

## Tasks

- [x] Update `assemble()` to accept `availableTools` and `citationsMode` parameters
- [x] Evaluate prompt-cache telemetry for memory prioritization in `afterTurn()`/`compact()`

## Prompt-cache evaluation

**Finding:** The `runtimeContext.promptCache` data is available in `afterTurn()` and `compact()` via the SDK interface. The data includes:
- `retention` — cache retention policy (`none`, `short`, `long`, `in_memory`, `24h`)
- `lastCallUsage` — token usage breakdown (`input`, `output`, `cacheRead`, `cacheWrite`, `total`)
- `observation` — cache observation data
- `lastCacheTouchAt` / `expiresAt` — timing info

**Decision: defer cache-aware prioritization.** Reasons:
1. **No actionable signal yet.** Our `assemble()` injects memories into `systemPromptAddition`, which sits in the system prompt — the most cache-friendly position. We already minimize changes between calls via the assemble cache (fingerprint + budget + ledger version). Moving memories around to optimize cache hits would likely _hurt_ cache performance by changing the system prompt more often.
2. **Observation data is opaque.** The `observation` field's structure isn't documented in the SDK types — it's `Record<string, unknown>`. Until we see real production telemetry, we can't build reliable heuristics.
3. **Minimal benefit vs. complexity.** The main cache-aware optimization would be: "if cache is warm, don't change the memory block." But our assemble cache already achieves this — same transcript + same ledger state = cached result = identical system prompt.

**What we did instead:** Added debug logging in `afterTurn()` that reports prompt-cache telemetry when present (retention, cacheRead/cacheWrite, expiresAt). This gives observability to evaluate whether cache-aware prioritization becomes worthwhile once we see real usage patterns.

## Changes

- Updated `assemble()` debug logging to structured format with `availableTools` count and `citationsMode` value
- Added prompt-cache telemetry observability logging in `afterTurn()`
- Fixed 5 pre-existing test failures (logger mocks missing `isDebugEnabled`)
- Added 2 new tests for `availableTools`/`citationsMode` param acceptance

## Reference

- [v2026.4.7 impact report](../../docs/openclaw-releases/v2026.4.7.md)

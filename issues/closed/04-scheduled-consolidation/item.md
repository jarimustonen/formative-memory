---
created: 2026-04-09
updated: 2026-04-10
type: feature
reporter: jari
assignee: jari
status: closed
priority: normal
---

# 04. Scheduled / automated consolidation

_Source: associative memory plugin_

## Description

Replace manual `/memory sleep` with automatic daily consolidation. Adds catch-up decay for missed cycles and separates temporal transitions into a faster schedule.

## Reference

- [plan.md](plan.md) — full plan

## Scope

- `applyCatchUpDecay()` with MAX_CATCHUP_CYCLES=30, using pow() for efficiency
- Update `runConsolidation()` to compute catch-up cycles from `last_consolidation_at`
- Cron: full consolidation at 03:00 daily
- Cron: temporal transitions at 15:00 daily (03:00 covered by full consolidation)
- Keep manual `/memory sleep` command
- Decay math tests (verify pow correctness)
- Per-memory age-aware catch-up (new memories not punished for old sleep debt)
- NaN guard for invalid `last_consolidation_at`
- Sleep debt warning in assemble() output (48h threshold, pre-existing)

## Implementation

- Cron registration via `registerHook("gateway:startup")` + cron service (same pattern as memory-core dreaming)
- Cron trigger handling via `api.on("before_agent_reply")` with `{ handled: true }` to skip LLM
- `applyCatchUpDecay(db, lastConsolidationMs, nowMs)` — per-memory cycles based on `max(lastConsolidation, mem.created_at)`

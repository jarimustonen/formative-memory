---
created: 2026-04-09
updated: 2026-04-09
type: feature
reporter: jari
assignee: jari
status: open
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
- Cron: temporal transitions at 03:00 and 15:00
- Keep manual `/memory sleep` command
- Decay math tests (verify pow correctness)
- Idempotence tests for temporal transitions

---
created: 2026-04-13
updated: 2026-04-13
type: bug
reporter: jari
assignee: jari
status: closed
priority: normal
---

# 12. Fix s.promoted reference in consolidation summary

## Description

`ConsolidationSummary` type in `src/consolidation.ts:38-47` has no `promoted` field, but `src/index.ts` lines 700 and 942 reference `s.promoted`. This produces `undefined` in the consolidation report string.

## Quick Test

Search for `s.promoted` in `src/index.ts` — the field does not exist on the type.

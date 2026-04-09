---
created: 2026-04-09
updated: 2026-04-09
type: feature
reporter: jari
assignee: jari
status: open
priority: high
---

# 03. Broad recall — memory_browse tool

_Source: associative memory plugin_

## Description

Current `assemble()` fails on meta-questions like "Kerro mitä muistat minusta?" because it searches for specific content. A `memory_browse` tool provides a broad overview of memory contents, called by the LLM when needed.

## Reference

- [plan.md](plan.md) — full plan

## Scope

- `MemoryDatabase.getTopByStrength(limit)` — new DB method
- `MemoryManager.broadRecall(limit)` — scoring: 0.8×strength + 0.2×recency, greedy type-capped selection, near-duplicate suppression
- `memory_browse` tool registration in index.ts with limit parameter
- System prompt update with memory_browse guidance
- Comprehensive tests

## Notes

- Optional Phase 5 enhancement: LLM-based relevance filtering.

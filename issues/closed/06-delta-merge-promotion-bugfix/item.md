---
created: 2026-04-09
updated: 2026-04-11
type: improvement
reporter: jari
assignee: jari
status: closed
closing_note: "Delta-merge O(S×T) optimization and promotion bugfix implemented and merged to main."
priority: normal
commits:
  - hash: b2571d3
    summary: "fix: remove blanket promotion, add delta-merge with filtered candidates"
  - hash: b8a0f9d
    summary: "fix: split merge threshold for jaccard-only vs combined scoring"
  - hash: c900350
    summary: "fix: address review findings — bounded queries, targeted embeddings, race fix"
  - hash: e1bb77b
    summary: "fix: pre-existing bugs — schema version test, co-retrieval N+1"
  - hash: af495e1
    summary: "fix: remove stale memory-manager tests for deleted markdown files"
---

# 06. Delta-merge optimization + promotion bugfix

_Source: associative memory plugin, consolidation_

## Description

Two independent improvements to the consolidation merge phase:

1. **Delta-merge**: Replace O(N²) merge candidate comparison with O(S×T) filtered search using strength and recency thresholds.
2. **Promotion bugfix**: Remove incorrect `promoteWorkingToConsolidated()` that marks all memories as consolidated after first merge. Working memories should stay working; consolidated = only merge results.

## Reference

- [plan.md](plan.md) — full plan

## Scope

### Delta-merge
- `findMergeCandidatesDelta()` with filtered source/target sets
- Source set: strength ≥ 0.5 OR recent creation OR recent exposure/retrieval
- Target set: strength ≥ 0.3 OR recent creation OR recent exposure/retrieval
- Type constraint: source.type === target.type
- `MemoryDatabase.getMergeCandidateMemories(minStrength, lastConsolidationAt)`

### Promotion bugfix
- Remove `promoteWorkingToConsolidated()` call
- Bug causes incorrect decay rates after first consolidation

## Notes

- Depends on #02 (consolidation implementation) for integration.

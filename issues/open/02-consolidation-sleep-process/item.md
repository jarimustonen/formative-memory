---
created: 2026-04-09
updated: 2026-04-09
type: epic
owner: jari
status: in-progress
priority: high
---

# E02. Consolidation / sleep process (Phase 4)

## Goal

Implement the 10-phase consolidation process that strengthens, decays, associates, merges, and prunes memories — the biological "sleep" that turns raw memory stores into a coherent long-term memory.

## Reference

- [design-consolidation.md](design-consolidation.md) — consolidation design
- [analysis-dreaming-vs-consolidation.md](analysis-dreaming-vs-consolidation.md) — relationship to OpenClaw dreaming
- See also: #04 (scheduled consolidation), #06 (delta-merge + promotion bugfix)

## Phases

### Phase 4.1: Foundation
- [x] Implement `state.last_consolidation_at` persistence
- [ ] Catch-up decay for missed cycles (pow() for efficiency, MAX_CATCHUP_CYCLES=30)
- [ ] Sleep debt warning in assemble() (>72h since last consolidation)

### Phase 4.2: Core cycle
- [x] Reinforcement (retrieval-based strength boost)
- [x] Normal single-cycle decay
- [x] Co-retrieval associations
- [x] Transitive associations

### Phase 4.3: Temporal & pruning
- [x] Temporal state transitions
- [x] Pruning (dead memories below threshold)

### Phase 4.4: Merge
- [ ] Delta-merge candidate search (O(S×T) filtered, not O(N²)) — see #06
- [x] LLM-based merge execution
- [x] Association inheritance for merged memories
- [x] Alias table updates

### Phase 4.5: Finalization
- [x] Provenance GC
- [x] Write consolidated memories
- ~~Regenerate working.md and consolidated.md~~ — REMOVED, no markdown file generation

## Issues

_Child issues will be linked here as Phase 4 is broken down._

## Notes

- Working memories stay working — do NOT promote all to consolidated (promotion bugfix from #06).
- Consolidated = only merge results.
- Can coexist with OpenClaw's file-based dreaming — no overlap.

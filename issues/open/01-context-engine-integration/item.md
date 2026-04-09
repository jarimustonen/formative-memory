---
created: 2026-04-09
updated: 2026-04-09
type: epic
owner: jari
status: in-progress
priority: high
---

# E01. Context engine integration (Phase 3)

## Goal

Claim the `contextEngine` slot in OpenClaw by implementing the full context engine API — assemble, compact, afterTurn — replacing the current `before_prompt_build` hook with a proper lifecycle-aware integration.

## Reference

- [plan.md](plan.md) — architecture plan
- [review-phase3.md](review-phase3.md) — LLM review
- [review-todo-v2.md](review-todo-v2.md) — TODO review with 8 consensus fixes
- [analysis-api-audit.md](analysis-api-audit.md) — API audit

## Phases

### Phase 3.0: API contract audit
- [ ] Inspect `registerContextEngine()` API in openclaw
- [ ] Document lifecycle methods, TypeScript signatures
- [ ] Verify `session_id`, `turn_id`, `message_id` sources
- [ ] Document `dispose()` semantics and what survives it

### Phase 3.1: Skeleton registration
- [ ] Register context engine via `api.registerContextEngine()` with `ownsCompaction: false`
- [ ] Implement `dispose()` with lazy DB handle reopening
- [ ] Keep `before_prompt_build` hook active (remove only in 3.9)

### Phase 3.2: assemble() implementation
- [ ] Transcript fingerprinting (N=3, configurable)
- [ ] Turn memory ledger (dedup within session)
- [ ] Token budget strategy (High/Medium/Low/None)
- [ ] Untrusted-data framing for injected content

### Phase 3.3: Assemble cache
- [ ] Cache key: transcriptFingerprint + messageCount + budgetClass + retrievalMode + ledgerVersion
- [ ] Tests for same-transcript-different-state scenarios

### Phase 3.4: Circuit breaker
- [ ] Embedding failure detection → BM25-only fallback
- [ ] In-memory state, resets on process restart

### Phase 3.5: compact() delegation
- [ ] Implement `compact()` with `delegateCompactionToRuntime()` delegation

### Phase 3.6: Provenance tables (before afterTurn)
- [ ] Exposure + attribution tables
- [ ] Alias table for merge tracking

### Phase 3.7: afterTurn()
- [ ] Deterministic logging
- [ ] Provenance writes (exposure, attribution)

### Phase 3.8: Markdown regeneration
- [ ] Regenerate working.md and consolidated.md from SQLite after mutations

### Phase 3.9: Hook removal
- [ ] Remove `before_prompt_build` hook (only after assemble() verified)
- [ ] Parity test: old hook vs new assemble() output

## Notes

- V1 principle: Minimize hot-path writes. Append-only sidecar writes (retrieval.log, provenance) allowed. Canonical memory mutations only during consolidation.
- `dispose()` must not close DB handles that will be needed again — use lazy reopening.

---
created: 2026-04-09
updated: 2026-04-09
closing_note: All phases complete. Phase 3.8 (markdown regeneration) removed — no markdown file generation.
type: epic
owner: jari
status: closed
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
- [x] Inspect `registerContextEngine()` API in openclaw
- [x] Document lifecycle methods, TypeScript signatures
- [x] Verify `session_id`, `turn_id`, `message_id` sources
- [x] Document `dispose()` semantics and what survives it

### Phase 3.1: Skeleton registration
- [x] Register context engine via `api.registerContextEngine()` with `ownsCompaction: false`
- [x] Implement `dispose()` with lazy DB handle reopening

### Phase 3.2: assemble() implementation
- [x] Transcript fingerprinting (N=3, configurable)
- [x] Turn memory ledger (dedup within session)
- [x] Token budget strategy (High/Medium/Low/None)
- [x] Untrusted-data framing for injected content

### Phase 3.3: Assemble cache
- [x] Cache key: transcriptFingerprint + messageCount + budgetClass + retrievalMode + ledgerVersion
- [x] Tests for same-transcript-different-state scenarios

### Phase 3.4: Circuit breaker
- [x] Embedding failure detection → BM25-only fallback
- [x] In-memory state, resets on process restart

### Phase 3.5: compact() delegation
- [x] Implement `compact()` with `delegateCompactionToRuntime()` delegation

### Phase 3.6: Provenance tables (before afterTurn)
- [x] Exposure + attribution tables
- [x] Alias table for merge tracking

### Phase 3.7: afterTurn()
- [x] Deterministic logging
- [x] Provenance writes (exposure, attribution)

### Phase 3.8: ~~Markdown regeneration~~ — REMOVED
- _No markdown file generation. SQLite is the sole data store; use CLI/tools to inspect._

### Phase 3.9: Hook removal
- [x] Remove `before_prompt_build` hook (only after assemble() verified)

## Notes

- V1 principle: Minimize hot-path writes. Append-only sidecar writes (retrieval.log, provenance) allowed. Canonical memory mutations only during consolidation.
- `dispose()` must not close DB handles that will be needed again — use lazy reopening.

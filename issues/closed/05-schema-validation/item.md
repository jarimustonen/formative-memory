---
created: 2026-04-09
updated: 2026-04-09
type: improvement
reporter: jari
assignee: jari
status: closed
priority: normal
---

# 05. Schema validation — enum guards and numeric integrity

_Source: associative memory plugin_

## Description

Add runtime validation for enum fields (temporal_state, source, evidence, mode, retrieval_mode) and numeric values (strength, embeddings, timestamps) to catch invalid data before it enters the database.

## Reference

- [analysis.md](analysis.md) — research
- [analysis-impact.md](analysis-impact.md) — impact analysis
- [review.md](review.md) — LLM review
- [review-impl.md](review-impl.md) — implementation review

## Scope

### Phase 0 (required first): Error handling strategy
- Strict mode (admin/tooling): throw on invalid values
- Tolerant mode (user-facing): skip + log

### Phase 1 (high): Enum validation
- `temporal_state`, `source`, `evidence`, `mode`, `retrieval_mode`
- Use `makeEnumGuard<const T>` factory pattern
- Assertion functions in `types.ts`

### Phase 2 (medium): Numeric/timestamp validation
- `updateStrength()`: check `Number.isFinite()`
- `setEmbedding()`: validate array length and finite values
- ISO-8601 UTC format validation for timestamps

### Phase 3 (deferred): SQLite CHECK constraints
- Defer until enum values stabilize

## Notes

- Do NOT add schema libraries (no Zod/Valibot) — use assertion functions.
- `evidence` field in `message_memory_attribution` is critical (40 lines of CASE logic).
- Note: some runtime validation was already added in commit `76d4938`.

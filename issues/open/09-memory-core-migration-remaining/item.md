---
created: 2026-04-09
updated: 2026-04-09
type: task
reporter: jari
assignee: jari
status: done
priority: normal
---

# 09. Memory-core migration — remaining work

_Source: associative memory plugin_

## Description

Phase 6 (memory-core import) is mostly complete. Preprocessing (6.1) and migration service (6.2) are done and tested. Remaining items are deferred features and upstream dependencies.

## Reference

- [plan.md](plan.md) — full plan
- [todo.md](todo.md) — detailed TODO with status
- [review-preprocess.md](review-preprocess.md) — preprocessing review
- [review-wiring.md](review-wiring.md) — index.ts wiring review
- [review-cleanup.md](review-cleanup.md) — workspace cleanup review

## Completed

- `src/import-preprocess.ts` — markdown scanning & segmentation (50 tests)
- `src/migration-service.ts` — orchestration with LLM enrichment (17 tests)
- `src/llm-caller.ts` — direct LLM caller with auth-profile support
- index.ts wiring, startup gate, workspace cleanup

## Remaining

- [ ] Session transcript import (deferred, not V1)
- [ ] Provenance tracking and reconciliation (deferred)
- [ ] Ghost deletion / tombstoning (deferred)

## Notes

- Upstream PRs (#08) needed for workspace template changes and SDK exports.
- Migration is automatic on first plugin start; idempotent via db-state flag.

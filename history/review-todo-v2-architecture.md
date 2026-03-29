# Review: TODO.md vs Context Engine Architecture v2

**Reviewed:** `TODO.md` (implementation plan) against `history/plan-context-engine-architecture-v2.md`
**Reviewers:** Gemini (gemini-3.1-pro-preview), Codex (GPT-5.4)
**Rounds:** 2
**Date:** 2026-03-29

---

## Critical Issues (Consensus)

Issues both reviewers agree on, ordered by severity.

### 1. No API contract audit before implementation

- **What:** Phase 3 starts with "Rekisteröi context engine" but the actual `registerContextEngine()` API shape, method signatures, param types, and lifecycle semantics are unknown. `turn_id` and `session_id` sources — required as primary keys in provenance tables — are listed as "open questions" instead of blocking prerequisites.
- **Where:** TODO.md "Avoimet kysymykset" items 1–3; Phase 3.1
- **Why it matters:** Without verified API contracts, all of Phase 3 is built on assumptions. Provenance tables can't be populated without stable IDs. Implementation may discover the API doesn't match the plan.
- **Suggested fix:** Add a **Phase 3.0** before everything else:
  - Inspect `registerContextEngine()` API in `../openclaw/`
  - Document required/optional lifecycle methods and exact TypeScript signatures
  - Verify return shape for `assemble()`, token budget semantics, `delegateCompactionToRuntime()` usage
  - Determine source of `session_id`, `turn_id`, `message_id`
  - Verify `dispose()` call frequency and instance lifetime
  - Decide fallback generation strategy for missing runtime IDs

### 2. Assemble cache key is incomplete — will return stale injections

- **What:** Phase 3.3 uses transcript fingerprint as the sole cache determinant. But `assemble()` output also depends on token budget class, circuit breaker state, and ledger dedup state. Same transcript with different budget or breaker state → wrong cached output.
- **Where:** TODO.md 3.3; Architecture §7, §10
- **Why it matters:** Stale cache = oversized injection when budget is low, or hybrid results returned during BM25-only fallback. Concrete bug.
- **Suggested fix:** Define cache key explicitly:
  ```
  transcriptFingerprint + messageCount + budgetClass + retrievalMode + ledgerVersion
  ```
  Add tests for same-transcript-different-state scenarios.

### 3. "Zero DB writes" principle contradicts Phase 3 provenance writes

- **What:** TODO states "Nolla DB-kirjoitusta normaalikäytössä paitsi uuden muiston luonti. Kaikki tilamuutokset konsolidaatiossa." But Phase 3 adds synchronous writes every turn: provenance exposure, attribution, retrieval log updates in `afterTurn()`.
- **Where:** TODO.md line 11; TODO.md 3.6/3.7; Architecture §8, §12
- **Why it matters:** The stated principle biases implementation decisions in the wrong direction. Someone following TODO may resist necessary writes or try to defer them incorrectly.
- **Suggested fix:** Rewrite the V1 principle:
  > **V1-periaate:** Minimize hot-path writes. Append-only sidecar writes (retrieval.log, provenance) are allowed in normal operation. Canonical memory mutations (strength, associations, pruning, merges, temporal transitions) occur only during consolidation.

### 4. Hook removal in 3.1 creates immediate regression

- **What:** Phase 3.1 says "Poista `before_prompt_build` hook" and Phase 3.9 says "Poista vanha `before_prompt_build` hook kokonaan". Removing in 3.1 before `assemble()` injection exists (3.2) eliminates all auto-recall during development of Phases 3.2–3.8.
- **Where:** TODO.md 3.1 and 3.9
- **Why it matters:** Concrete behavior regression. No memory injection between 3.1 and 3.2 completion.
- **Suggested fix:** Remove hook removal from 3.1. Keep it only in 3.9 after `assemble()` injection is verified as feature-complete via parity test.

### 5. Provenance schema ordered after code that writes to it

- **What:** Phase 3.6 (`afterTurn()`) is before 3.7 (provenance tables), but `afterTurn()` must write exposure/attribution rows.
- **Where:** TODO.md 3.6 vs 3.7; Architecture §8, §12
- **Why it matters:** Either 3.6 is incomplete and untestable, or it gets implemented twice.
- **Suggested fix:** Move provenance schema creation (3.7) before `afterTurn()` implementation (3.6).

### 6. `dispose()` lifecycle may conflict with in-memory state

- **What:** Architecture §15 says `dispose()` is called per-run/compact in a finally block, not just on process exit. TODO 3.1 says "close SQLite connections, clear pending state." If dispose closes connections after compact, the next agent turn crashes. If it clears pending state, circuit breaker (§6: "in-memory, resets to CLOSED on process restart") and fingerprint cache are incorrectly reset.
- **Where:** TODO.md 3.1; Architecture §6, §15
- **Why it matters:** Fatal database errors or breaker state loss.
- **Suggested fix:** Define explicitly what survives `dispose()`: DB handles (reopen lazily), circuit breaker state (survives if plugin instance survives), fingerprint cache (reset per session, not per dispose). Add as a design task in 3.1.

### 7. Missing markdown regeneration after Phase 4 consolidation

- **What:** Architecture §11 says working.md and consolidated.md are derived views from SQLite. Phase 4 heavily mutates the database (merge, weaken, prune, move). No task to regenerate markdown files afterward.
- **Where:** TODO.md Phase 4; Architecture §11
- **Why it matters:** Human-readable views become stale and misleading. These are the only observability interface until the viewer is built.
- **Suggested fix:** Add explicit Phase 4 task: regenerate working.md and consolidated.md from SQLite after consolidation completes.

### 8. Missing persisted last-consolidation timestamp for sleep debt

- **What:** Phase 4 includes sleep debt warning (>72h since last consolidation), but neither the TODO nor architecture specifies where the timestamp is stored. Needed in the `state` table.
- **Where:** TODO.md Phase 4; Architecture §14
- **Suggested fix:** Add `state.last_consolidation_at` to Phase 4 schema tasks. Stub the sleep debt check in Phase 3 `assemble()`.

---

## Resolution

All 8 consensus issues were applied to TODO.md. See commit `4d4acc4`.

Disputed issues and their resolutions are documented in `/tmp/review-disputes-todo-v2.md`.

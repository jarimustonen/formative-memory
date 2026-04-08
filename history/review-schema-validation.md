# Review: analysis-schema-validation.md

**Reviewed:** `history/analysis-schema-validation.md` — runtime schema validation strategy for SQLite-backed associative memory plugin
**Reviewers:** Gemini (gemini-3.1-pro-preview), Codex (gpt-5.4)
**Rounds:** 2

---

## Critical Issues (Consensus)

Issues both reviewers agree on, ordered by severity:

### 1. No coherent integrity strategy for existing databases

- **What:** The analysis proposes CHECK constraints for new installs only (via `CREATE TABLE IF NOT EXISTS`), leaving existing databases unprotected. Adding throwing assertions in `rowToMemory()` will crash features for upgraded users with any invalid data.
- **Where:** `src/db.ts` (schema SQL, `SCHEMA_VERSION`, `migrate()`), `src/memory-manager.ts:rowToMemory()`
- **Why it matters:** Creates split-brain behavior — same code version behaves differently based on install age. Existing installs (most likely to contain migrated/imported data) get no protection. Upgraded users with one invalid row lose access to consolidation, search, and assemble.
- **Suggested fix:** Must include one of: (a) table rebuild migration for existing DBs, (b) startup integrity scan with repair/quarantine, or (c) strict vs tolerant DB access APIs that skip invalid rows with logging in user-facing paths.

### 2. Validation scope too narrow — ignores semantically critical provenance fields

- **What:** The analysis focuses on `temporal_state` and `source` (4+4 enum values) but ignores `message_memory_attribution.evidence`, `turn_memory_exposure.mode`, and `retrieval_mode`. These are at least as risky.
- **Where:** `src/db.ts:mergeAttributionRow()` — hardcoded `LIKE 'agent_feedback_%'` prefix matching determines attribution precedence logic
- **Why it matters:** Invalid `evidence` values silently change business logic in the 40-line SQL CASE statement. This is more dangerous than wrong `source` because it affects attribution merge/promotion semantics, not just display.
- **Suggested fix:** Include all enum-like string fields in scope. `evidence` should be the highest-priority field.

### 3. No failure-mode design for read-time validation

- **What:** "Throw on invalid enum" is proposed without defining what happens to the exception. No skip, quarantine, logging, or degradation strategy.
- **Where:** All consumers of `rowToMemory()`: `search()`, `getAllMemories()`, `getTransitionMemories()`, `assemble()`, `memory-sleep` command
- **Why it matters:** An uncaught assertion in `getAllMemories()` bricks consolidation. In `search()`, one bad row fails the entire query. The analysis proposes adding danger without a safety net.
- **Suggested fix:** Define explicit failure policy — both reviewers converged on: fail-fast in admin/tooling paths, skip+log in user-facing retrieval paths. Codex proposed structured parse results (`ParseResult<T>`).

### 4. Timestamp/numeric integrity not addressed despite core logic depending on it

- **What:** The analysis ignores timestamp format validation and numeric bounds, despite the codebase's explicit ISO-8601 contract and dependence on lexicographic SQL ordering.
- **Where:** `src/db.ts` (docblock contract), `src/memory-manager.ts:getTransitionMemories()` (`new Date()` on potentially invalid anchors), `updateStrength()` (accepts NaN/Infinity), `cosineSimilarity()` (garbage inputs from corrupt embeddings)
- **Why it matters:** Malformed timestamps make `getUpcomingMemories()` return wrong results. NaN strength poisons `scored.sort()` with unstable ordering. Invalid floats in embeddings make cosine similarity meaningless.
- **Suggested fix:** Validate canonical UTC ISO-8601 format on write (not just `Date.parse()`). Add `Number.isFinite()` guards on strength writes.

### 5. Write-side validation missing on import/raw paths

- **What:** `insertExposureRaw()`, `insertAttributionRaw()`, and LLM enrichment output write unvalidated strings into critical fields.
- **Where:** `src/db.ts:insertExposureRaw()`, `src/db.ts:insertAttributionRaw()`, `src/index.ts` migration paths
- **Why it matters:** These are the actual trust boundary — external data enters the system here. The analysis identifies import paths as risky but provides no concrete recommendations.
- **Suggested fix:** Runtime validation before insert on all `*Raw` and migration paths.

---

## Disputed Issues

Issues where reviewers disagree — both positions presented:

### 1. Where should validation live? (`db.ts` vs `MemoryManager`)

- **Codex's position:** Validation belongs in `db.ts` at the persistence boundary. `MemoryDatabase` should return typed domain objects or structured parse results. Current architecture leaks raw row types upward, forcing each caller to reinterpret data independently.
- **Gemini's position:** `MemoryDatabase` is infrastructure — it should return exactly what's on disk. The domain layer (`MemoryManager.rowToMemory()`) decides how to handle corruption. Validating in `db.ts` creates the same throw-or-drop dilemma.
- **Moderator's take:** Codex has the stronger argument. The current split (DB returns raw strings, Manager casts them) is the root cause of the problem. However, Gemini is right that `db.ts` needs a proper result model (not just throw/drop) to make this work. The structured `ParseResult<T>` approach or strict/tolerant API variants would resolve both concerns.

### 2. Should CHECK constraints be used at all?

- **Gemini's position:** Reject CHECK constraints entirely for evolving enums. SQLite makes them very expensive to modify (full table rebuild). Enforce constraints purely in TypeScript.
- **Codex's position:** CHECK constraints are still valuable as a write-time safety net. The issue is incomplete implementation, not the concept. Don't reject them — do them properly with migration support.
- **Moderator's take:** Both have valid points. For this project's current state (rapid iteration, small user base, no proper migration framework), Gemini's position is more pragmatic. CHECKs can be added later when the enum set stabilizes.

### 3. How should invalid data be handled on read? (Throw vs coerce vs skip)

- **Gemini's initial position:** Silent coercion/fallback (e.g., default to `"none"`). Later retracted and agreed with Codex that this is "data corruption by normalization."
- **Codex's position:** Never silently coerce. Skip+log in user-facing paths, fail-fast in admin paths. Use structured parse results.
- **Moderator's take:** Codex is right. Silent coercion is the worst option — it destroys evidence and can propagate via read-modify-write patterns like `replaceMemoryId()`. The skip+log approach is operationally safe.

### 4. Should TypeBox be expanded for transcript parsing?

- **Gemini's position:** Yes, replace manual parsers in `parseFeedbackCalls`, `config.ts`, and `extractLastUserMessage` with compiled TypeBox validators.
- **Codex's position:** TypeBox could help with shape checks but doesn't replace traversal/business logic. It's a maintainability improvement, not a top-tier integrity issue.
- **Moderator's take:** Codex is right on prioritization — this is real but secondary. The `any` casts in `extractLastUserMessage()` should be fixed regardless, but that's a code quality issue, not the critical integrity gap.

---

## Minor Findings

- `feedbackEvidenceForRating()` returns plain `string` instead of a narrow union type — easy fix that strengthens downstream guarantees
- `insertExposure()` accepts `mode: string` instead of a typed union — same pattern
- `config.ts` hand-rolled parser works but is inconsistent with TypeBox usage elsewhere — low priority
- `type` field on memories is free-form and user/LLM-supplied with no length/character validation
- `resolveAlias()` silently stops on cycles/max depth — data integrity concern beyond enum validation
- Embedding BLOBs assume perfect Float32 alignment with no corruption checks

---

## What's Solid

Both reviewers agree on:

- **Rejecting Zod/Valibot** as a second schema library is correct
- **Performance analysis** is accurate — validation overhead is negligible on all paths
- **Identifying I/O boundaries** as the right place for strict validation
- **The analysis format** — structured, covers the right questions, provides concrete code examples

---

## Unresolved Questions

1. **Migration framework:** Should the project invest in a proper table-rebuild migration mechanism now, or defer until enum set stabilizes?
2. **Strict vs tolerant API design:** How far should the DB layer go in separating admin/tooling (fail-fast) from user-facing (skip+log) access patterns?
3. **Source of truth for enum values:** Should TS const tuples drive SQL CHECK strings, or should they be maintained independently? How to prevent drift?
4. **Scope of "schema validation":** The analysis scoped to enum fields; the actual integrity surface includes timestamps, numerics, embeddings, and alias chains. How much should be addressed in one pass?

---

## Moderator's Assessment

**Which reviewer made stronger arguments?** Codex (gpt-5.4) made the stronger case overall — more systematic, better scoped, and more consistent across rounds. Key wins: identifying `evidence` as the most dangerous field, pushing for structured parse results over coercion, and correctly noting that TypeScript types don't validate runtime data. Gemini made excellent individual catches (timestamp fragility, read-modify-write destruction loop) but proposed a flawed solution (silent coercion) and had to retract it.

**Issues neither reviewer caught:**
- The `confidence` field already has a CHECK constraint (`CHECK (confidence >= -1.0 AND confidence <= 1.0)`) — the analysis and both reviews missed that the project already uses CHECK constraints selectively. This weakens Gemini's "reject all CHECKs" argument.
- Neither reviewer considered that `tsdown` bundling means TypeBox's bundle size impact is already paid — tree-shaking makes the "verbosity" concern purely about developer ergonomics, not runtime cost.

**Single most important thing to address:**
The analysis needs a **failure-mode design** before any validation code is written. Adding assertions without defining catch/skip/quarantine behavior is worse than the current state — it turns latent data issues into production failures. Design the error handling first, then decide which fields to validate and where.

# Review: Schema Validation Implementation

**Reviewed:** Runtime schema validation changes (11 files, +168/-39 lines)
**Reviewers:** Gemini (gemini-3.1-pro-preview), Codex (gpt-5.4)
**Rounds:** 1 (strong consensus, no second round needed)

---

## Critical Issues (Consensus)

### 1. Row types conflate raw DB data with validated domain types

- **What:** `ExposureRow` and `AttributionRow` now declare `mode: ExposureMode`, `evidence: AttributionEvidence` etc, but DB reads (`getExposures()`, `getAllAttributions()`) still use `as ExposureRow[]` casts without runtime validation.
- **Where:** `src/db.ts` lines ~112–146 (type definitions) + all getter methods
- **Why it matters:** TypeScript now falsely believes DB-read values are valid unions. Future code will assume impossible states are impossible when they are not. This is a type-model bug that masks real integrity issues.
- **Suggested fix:** Either (a) split `ExposureDbRow` (raw) from `ExposureRow` (validated), or (b) add `rowToExposure()`/`rowToAttribution()` validators analogous to `rowToMemory()` on all read paths.

### 2. Main write paths remain unvalidated

- **What:** `insertMemory()`, `insertExposure()`, `upsertAttribution()` accept garbage timestamps, NaN scores, unbounded numerics. Only `*Raw()` import methods got validation.
- **Where:** `src/db.ts` — `insertMemory()`, `insertExposure()`, `upsertAttribution()`, `upsertAssociation()`, `insertAlias()`
- **Why it matters:** Defeats the stated goal of "DB-layer runtime validation." New bad data can be created by normal code paths. Write-side validation is the cheapest and most effective place to enforce invariants.
- **Suggested fix:** Add validation to all public write methods. At minimum: `created_at`/`temporal_anchor` format, `strength`/`weight`/`confidence`/`score` bounds, enum guards defensively.

### 3. `rowToMemory()` throw-on-read risks bricking features

- **What:** A single corrupt row with invalid `temporal_state` or `source` crashes `getTransitionMemories()`, `getAllMemories()`, `search()`, and `memory-sleep`.
- **Where:** `src/memory-manager.ts:rowToMemory()`
- **Why it matters:** No remediation tooling exists yet. Shipped before `memory-integrity` CLI. Turns latent data issues into user-visible failures.
- **Suggested fix:** Both reviewers agree: do not silently coerce to defaults (hides corruption). Instead: return `Memory | null`, skip+log invalid rows in bulk paths, reserve hard throw for admin/integrity checks.

### 4. Timestamp validation is syntactic only

- **What:** `assertIsoUtcTimestamp()` regex accepts `2024-13-45T25:99:99Z`. No calendar validation.
- **Where:** `src/types.ts` lines ~80–87
- **Why it matters:** Invalid-but-regex-matching timestamps enter DB via import paths, break lexicographic ordering that SQL queries depend on.
- **Suggested fix:** Add `Date.parse()` check after regex. Optionally canonicalize and compare.

### 5. Float64→Float32 overflow in `setEmbedding()`

- **What:** `Number.isFinite()` checks JS doubles, but `new Float32Array(embedding)` can overflow finite doubles (e.g. `1e100`) to `Infinity`.
- **Where:** `src/db.ts:setEmbedding()`
- **Why it matters:** Persisted BLOB contains non-finite values despite the guard.
- **Suggested fix:** Validate after Float32 conversion, or bound inputs to float32 range.

---

## Disputed Issues

### 1. How should `rowToMemory()` handle invalid data?

- **Gemini:** Fallback to safe defaults with logging (e.g. `"none"` for temporal_state).
- **Codex:** Never silently coerce — return `null` and let callers filter. Silent coercion hides corruption and can poison downstream behavior.
- **Moderator's take:** Codex is right. Coercion is silent data corruption. `null` return + caller filtering is the correct approach for bulk paths.

### 2. Should DB CHECK constraints be added?

- **Gemini:** No — SQLite table rebuild is too expensive for a lightweight plugin.
- **Codex:** Yes — schema constraints matter more than TS unions for the source of truth.
- **Moderator's take:** Gemini is right for now. Runtime TS validation on all write paths gives equivalent protection without migration complexity. CHECKs can be added later.

---

## Minor Findings

- `console.warn` in `resolveAlias()` bypasses project logger abstractions — should use injected logger or return structured info
- `extractLastUserMessage()` replacement is clunky — cast repeated 3x. Use scoped `const b = block as Record<string, unknown>` or dedicated `isTextBlock()` type guard
- `safeTemporalState()` should log when coercion happens (LLM output quality visibility)
- `parseEnrichmentResponse()` still uses `any` — missed in this pass
- `getExposureRetrievalMode()` still returns `string | null` — inconsistent with new typing
- `updateStrength()` allows negative/absurd values — should validate range, not just finite
- `insertExposureRaw()` doesn't validate `message_index`, `score`; `insertAttributionRaw()` doesn't validate `reinforcement_applied`
- `assertIsoUtcTimestamp()` docstring says "canonical" but accepts multiple fractional-second precisions
- `getAllEmbeddings()` silently drops corrupt rows without logging — loses observability

---

## What's Solid

- `makeEnumGuard()` factory + const tuple pattern is well-designed and DRY
- `Number.isFinite()` on `updateStrength()` and embedding validation close real NaN-poisoning bugs
- BLOB `byteLength % 4` check prevents Float32Array crashes
- `getTransitionMemories()` NaN guard prevents silent row loss
- `cosineSimilarity()` non-finite output check is correct
- `feedbackEvidenceForRating()` narrow return type is a clean improvement
- `safeTemporalState()` is a reasonable LLM fallback pattern (needs logging)

---

## Moderator's Assessment

**Both reviewers converged strongly** on the same top 3 issues. The implementation is a good first pass but has three structural gaps that should be addressed before merging:

1. **Row type conflation** — the most architecturally damaging. Fix by keeping `MemoryRow`/`ExposureRow`/`AttributionRow` as raw DB types (string fields) and adding validated domain types or conversion functions.

2. **Asymmetric validation** — validates import paths but not main write paths. The fix is straightforward: add guards to `insertMemory()`, `insertExposure()`, `upsertAttribution()`.

3. **Throw-on-read without remediation** — `rowToMemory()` should return `Memory | null` with logging, not throw. Callers filter nulls.

**Quick wins to address before merge:**
- Fix `assertIsoUtcTimestamp()` to include `Date.parse()` check
- Fix `setEmbedding()` to validate after Float32 conversion
- Change `rowToMemory()` to return `null` on invalid rows + log warning
- Change `console.warn` in `resolveAlias()` to not use direct console
- Revert `ExposureRow`/`AttributionRow` types back to `string` fields (keep `MemoryRow` as-is since it has `rowToMemory()` validation)
- Add `isTextBlock()` helper for `extractLastUserMessage()`

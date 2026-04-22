# Review: FTS Fallback Design Document

**Reviewed:** `history/plan-fts-fallback.md` — design for embedding-free BM25/FTS operation
**Reviewers:** Gemini (gemini-3.1-pro-preview), Codex (gpt-5.4)
**Rounds:** 2
**Review type:** Functional review — sufficiency of proposed changes, creative new ideas

---

## Critical Issues (Consensus)

Both reviewers agree these are real problems, ordered by severity.

### 1. The plan gets FTS5 query semantics wrong — implicit AND, not OR

- **What:** The design document claims `escapeFtsQuery()` produces OR semantics. In reality, FTS5 treats space-separated quoted terms as **implicit AND**. A query `"release" "deadline" "tomorrow"` requires ALL three terms to appear.
- **Where:** `src/memory-manager.ts:405-412` (`escapeFtsQuery`), design doc section 1c
- **Why it matters:** This means BM25-only mode has far worse recall than the plan assumes. Multi-term queries silently require all terms, missing any memory that only partially matches. The plan's discussion of "weak matches polluting results" is backwards — the actual failure mode is **overly strict matching**.
- **Fix:** Replace `escapeFtsQuery()` with a multi-pass waterfall: (1) exact phrase, (2) AND all terms, (3) OR all terms. Fill up to limit at each stage. Both reviewers independently proposed this approach.

### 2. Min-max BM25 normalization is mathematically broken

- **What:** Current normalization maps BM25 ranks to 0-1 range using batch min/max. This means: (a) a single result always gets score 1.0 regardless of relevance, (b) among excellent matches the worst gets score 0.0, (c) the proposed minimum relevance threshold (0.15) filters relative to the batch, not absolute relevance.
- **Where:** `src/memory-manager.ts:162-169`, design doc section 1b
- **Why it matters:** Makes thresholding impossible and distorts cross-query score comparisons. Any scoring improvement built on this foundation is unreliable.
- **Fix:** Replace with absolute score transformation. Gemini proposes `rank / (rank - 1)`, Codex proposes `(-rank) / (1 + (-rank))`. Both map negative FTS5 ranks to stable [0, 1) range without batch dependence.

### 3. Full-corpus scans on every search (O(N) performance)

- **What:** `getStrengthMap()` loads ALL memory IDs + strengths into a JS Map on every search. The plan proposes adding `getCreatedAtMap()` which doubles this cost.
- **Where:** `src/db.ts:533-542` (`getStrengthMap`), `src/memory-manager.ts:175`
- **Why it matters:** Scales linearly with corpus size. At 100K memories, this creates massive GC pressure on every query. The FTS query itself returns ~20 candidates — loading 100K rows to score 20 is absurd.
- **Fix:** Push strength (and recency data) into the FTS SQL query via JOIN:
  ```sql
  SELECT f.id, bm25(memory_fts, 0.0, 1.0, 0.5) as rank, m.strength, m.created_at
  FROM memory_fts f JOIN memories m ON f.id = m.id
  WHERE memory_fts MATCH ? ORDER BY rank LIMIT ?
  ```

### 4. FTS schema needs structural fixes, not just scoring tweaks

- **What:** The plan says "no schema migration needed" but both reviewers agree structural fixes are essential: (a) `id` column should be `UNINDEXED` — currently tokenizing SHA-256 hashes wastes I/O, (b) Porter stemming should be evaluated — "shipping" doesn't match "shipped" without it, (c) prefix indexes would improve partial-term matching.
- **Where:** `src/db.ts:57-61`
- **Why it matters:** The design optimizes scoring (post-retrieval) while ignoring retrieval surface (what can match at all). Stemming alone would yield more improvement than all proposed scoring tweaks combined.
- **Caveat:** Porter stemming is English-centric. If the plugin stores non-English memories, this needs careful consideration.

### 5. N+1 query bug in search result hydration

- **What:** After scoring, `search()` calls `this.getMemory(id)` in a loop for each result. Each call is a separate SQLite query.
- **Where:** `src/memory-manager.ts:200-206`
- **Why it matters:** Minor at current limits (5 results) but is an unnecessary anti-pattern. Should be a bulk fetch.

---

## Disputed Issues

### A. Association boosting: defer or not?

- **Gemini's position:** Deferral was correct. Mixing graph traversal into a broken BM25 baseline is "a recipe for debugging nightmares." Fix the foundation first.
- **Codex's position:** In BM25-only mode, associations are one of the only semantic-ish signals available. Deferring them leaves a high-value relevance source unused. However, agrees on *sequencing* — fix lexical retrieval first, then add association boosting.
- **Moderator's take:** Both are right. Defer as a sequencing decision, not a design rejection. The plan should explicitly mark association boosting as the next phase after lexical retrieval is fixed, not as indefinitely deferred future work.

### B. Write-time document expansion (Doc2Query, LLM synonyms)

- **Gemini's initial position:** Use LLM at store() time to generate "what queries would find this memory?" and index expansions in FTS.
- **Codex's rebuttal:** If the user disabled embeddings because they have no API key or want offline operation, they can't call an LLM either. Architectural contradiction.
- **Gemini's concession:** Agreed in round 2 that this was wrong. BM25 fallback must remain strictly lexical and self-contained.
- **Moderator's take:** Codex wins this one cleanly. However, a **rule-based** synonym dictionary (not LLM-based) is a lighter-weight version of this idea that doesn't have the API dependency problem. Neither reviewer explored this middle ground deeply.

### C. Staged retrieval pipeline architecture

- **Codex's position:** Refactor `search()` into: query analysis -> candidate generation (multiple channels) -> feature extraction -> rerank. Current monolithic design can't support planned enhancements.
- **Gemini's position:** "Architecture astronautics" for a local SQLite plugin. Keep it simple.
- **Codex's final position:** Rejected the blanket dismissal. A phrase -> AND -> OR waterfall IS a simple staged pipeline. No classifier needed, but the code structure should support multiple retrieval passes.
- **Moderator's take:** Codex is right that the current monolithic `search()` will become unmaintainable as features are added. But Gemini is right that a formal Candidate/Feature/Reranker abstraction is premature. The pragmatic middle: implement multi-pass retrieval as clean helper functions within the current structure, refactor to a formal pipeline only if/when a 4th retrieval channel is needed.

### D. Jaccard trigram sensitivity in merge candidates

- **Codex's initial position:** Gemini's criticism was "speculative" — assumed character trigrams, which share many substrings even with reordering.
- **Gemini's rebuttal:** Actually read `merge-candidates.ts:208-223` — `textFeatures()` uses **word trigrams**, not character trigrams. "The quick brown fox" and "The brown quick fox" share zero word trigrams. The criticism is valid.
- **Codex's final position:** Did not revisit after seeing the code.
- **Moderator's take:** Gemini is correct. Word trigrams are order-sensitive. This matters less for this design (merge candidate detection, not search), but is a real quality issue for BM25-only consolidation. Consider adding character n-grams alongside word trigrams in `textFeatures()`.

### E. Recency boost scope (BM25-only vs always)

- **Plan's position:** Apply recency boost only in BM25-only mode.
- **Codex's position:** Mode-conditional recency creates behavioral discontinuity — same query gives different rankings when embedder toggles. Better: always include freshness, mode-dependent weight.
- **Gemini's position:** Didn't directly address.
- **Moderator's take:** Codex makes a good point about behavioral consistency. However, in hybrid mode embeddings already capture contextual relevance that correlates with recency. Adding explicit recency there risks over-penalizing old but semantically relevant memories. Compromise: apply recency in both modes but with much lower weight in hybrid (e.g., 0.02 vs 0.10).

---

## Creative Ideas Worth Pursuing

From both reviewers, ideas that are feasible and high-value:

1. **Multi-pass lexical retrieval** (both reviewers) — phrase -> AND -> OR waterfall. Highest-value idea, no schema changes needed.

2. **Rule-based synonym/alias dictionary** (moderator synthesis) — a curated dictionary for common synonyms relevant to memory use (deadline/due date/ship date, preference/likes/prefers, postgres/postgresql). Cheap, local, no API needed. Neither reviewer fully developed this but both circled around it.

3. **Type-conditional freshness** (Codex) — events need strong temporal relevance, preferences need weak freshness. Already have the type field and temporal anchor machinery.

4. **Transcript-aware query expansion** (Codex) — current assemble() uses only last user message as query. Extracting salient terms from recent turns would improve recall significantly in BM25-only mode. Low cost, no external dependencies.

5. **Query term coverage penalty** (Gemini) — when using OR queries, penalize results that match few query terms. Simple, effective, requires multi-pass first.

6. **Pseudo-relevance feedback from provenance** (Gemini initial, Codex rejected as premature) — deferred, but worth revisiting once lexical retrieval is correct. The exposure/attribution tables are a unique asset.

---

## Minor Findings

- `searchFts()` should use explicit `bm25()` call instead of relying on FTS5 hidden `rank` column (Codex). Gemini disagrees — `rank` is documented FTS5 behavior. Both agree switching to `bm25(memory_fts, 0.0, 1.0, 0.5)` is needed anyway for column weights.
- The plan's evaluation approach (`memory bench` with overlap metrics) is too weak (Codex). Needs labeled query suites covering exact match, paraphrase, typo, temporal, names, short queries.
- Candidate pool `limit * 4` is probably too small in BM25-only mode (Codex). Consider adaptive sizing.
- `jaccardFromSets()` returns 1.0 for two empty feature sets — makes empty memories "perfect duplicates" (Codex). Edge case but real bug.
- `findMergeCandidatesDelta()` doesn't validate `maxPairs` — negative values trigger JS slice weirdness (Codex).

---

## What's Solid

Both reviewers agree:
- Identifying `id` column as noisy in FTS scoring is correct
- The plan's honest assessment of BM25 limitations (paraphrase, synonyms) is appreciated
- Not replacing the hybrid architecture in this iteration is the right call
- The existing circuit breaker + fallback mechanism is well-designed
- The plan correctly avoids adding new config surface for this iteration

---

## Unresolved Questions

1. **Stemming vs multilingual support:** Porter stemming dramatically improves English lexical matching but may harm non-English memories. What languages does this plugin need to support?
2. **Schema migration appetite:** Several high-value fixes require FTS table rebuild (`UNINDEXED`, stemming, prefix indexes). Is a migration acceptable for this feature?
3. **Embedding search O(N):** Both reviewers noted `getAllEmbeddings()` does a full table scan in hybrid mode. The plan doesn't address this but it's the same class of problem as `getStrengthMap()`. Should this be fixed simultaneously?
4. **Character vs word trigrams in merge detection:** Should `textFeatures()` use character n-grams for better reordering tolerance, or is word-level sufficient for merge use cases?

---

## Moderator's Assessment

**Which reviewer made stronger arguments?** Codex was stronger overall. The functional analysis was more thorough — identifying the recall vs. ranking distinction, the pipeline architecture concerns, and the type-conditional freshness idea. However, Gemini caught the most important single bug (AND vs OR semantics) and was more pragmatic about keeping the solution scope manageable.

**Issues NEITHER reviewer caught:**
- The `broadRecall()` method (`memory-manager.ts:264-324`) is entirely query-independent — it ranks by strength + recency. In BM25-only mode with weak query-based recall, `broadRecall` becomes relatively more important as a fallback. The design doesn't consider how FTS improvements interact with the broad recall path.
- The `escapeFtsQuery` quoting may interact badly with FTS5's tokenizer — if the tokenizer strips punctuation but the query wraps punctuated terms in quotes, there could be mismatches beyond what either reviewer described.

**Single most important thing to address:** Fix the FTS query semantics (AND -> multi-pass OR). Everything else in the design is secondary because the current search literally cannot find memories that don't contain every query term. The proposed scoring improvements are optimizing a fundamentally broken retrieval step.

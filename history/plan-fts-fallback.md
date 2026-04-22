# Design: FTS Fallback for Embedding-Free Operation

> **Revision 2** — Updated after LLM review (Gemini + Codex, 2 rounds).
> See `history/review-fts-fallback.md` for the full review report.

## Problem Statement

The plugin currently supports a `requireEmbedding: false` config that allows startup without an embedding provider, and the circuit breaker already falls back to BM25-only when embeddings become temporarily unavailable. However, the BM25-only search quality is significantly worse than hybrid search because the FTS pipeline was designed as the *weaker half* of a hybrid system, not as a standalone retrieval engine.

This design enables better operation in pure BM25/FTS mode for users who:
- Have no API keys for embedding providers (e.g. only an Anthropic key)
- Need graceful degradation when the embedding circuit breaker is open

**Important caveat:** BM25-only mode is inherently a compromise. It cannot match embedding-based semantic search for paraphrase, synonym, or conceptual queries. Users should be strongly encouraged to configure an embedding provider (OpenAI or Google) for the best experience.

## Current Search Architecture

### Hybrid search pipeline (`memory-manager.ts:132-218`)

```
Query → [Embedding search] + [BM25 search] → Normalize → Combine → × strength → Top-K
```

1. **Embedding search**: Query is embedded, cosine similarity computed against all stored embeddings via full table scan (`getAllEmbeddings()`). Scores are raw cosine values (0-1 range for normalized vectors).

2. **BM25 search** (`db.ts:552-555`): FTS5 `MATCH` query with min-max normalized ranks. SQLite FTS5's default `bm25()` ranking function is used with no column weights. Query terms are individually quoted to prevent FTS5 syntax errors.

3. **Score combination**: `ALPHA * embeddingScore + (1-ALPHA) * bm25Score` where ALPHA=0.6 when embeddings available, 0 when not. Final score is multiplied by memory strength via full table scan (`getStrengthMap()`).

### What happens today when embeddings are unavailable

When the circuit breaker opens or embedding calls fail:

1. `search()` catches `EmbeddingCircuitOpenError`/`EmbeddingTimeoutError` and sets `queryEmbedding = null`
2. ALPHA drops to 0, so the hybrid score becomes pure BM25
3. The context engine adds a notice: "Memory recall is operating in keyword-only mode"
4. The assemble cache key includes `bm25Only` flag so cache invalidates on mode change

### Critical bugs in the current BM25-only path

1. **Implicit AND, not OR**: `escapeFtsQuery()` joins quoted terms with spaces. FTS5 treats this as **implicit AND** — ALL terms must appear. A query for `"release" "deadline" "tomorrow"` returns nothing if any memory lacks one of those words. This is the opposite of what the system needs for recall.

2. **Min-max normalization is broken**: Scores are normalized relative to the batch. A single result always gets 1.0. Among excellent matches, the worst gets 0.0. This makes absolute thresholds impossible and distorts cross-query comparisons.

3. **O(N) full-corpus scans**: `getStrengthMap()` loads ALL memory IDs + strengths into a JS Map on every search. `getAllEmbeddings()` does the same for embedding vectors. At scale this is catastrophic.

4. **FTS schema wastes resources**: The `id` column (SHA-256 hash) is tokenized and indexed by FTS5, adding noise and wasting I/O.

5. **No recency signal**: BM25 ranks purely on term frequency.

6. **No field weighting**: Content, type, and id all weighted equally.

### Consolidation in BM25-only mode

Consolidation already works without embeddings:

- **Merge candidate detection** (`merge-candidates.ts`): Falls back to Jaccard-only with a higher threshold (0.6 vs 0.5 combined). This is functional but less precise.
- **Store** (`memory-manager.ts:77-88`): Stores memories without embeddings when embedding fails — FTS index is always populated.
- **Decay/reinforcement**: Fully independent of embeddings. Works identically.

## Proposed Changes

### 1. Fix FTS query semantics — multi-pass waterfall with OR

**Problem:** `escapeFtsQuery()` produces implicit AND queries, destroying recall for multi-term queries.

**Fix:** Replace with a multi-pass waterfall:

1. **Pass 1: Exact phrase** — `"release deadline"` (quoted as single phrase)
2. **Pass 2: AND** — `"release" AND "deadline"` (all terms required)
3. **Pass 3: OR** — `"release" OR "deadline"` (any term matches)

Fill results up to limit at each pass, deduplicating across passes.

Additional improvements in the rewrite:
- **Strip punctuation** before building queries to avoid tokenizer mismatches
- **Query term coverage ranking** — in OR pass, rank higher results that match more query terms: `score *= Math.pow(coverageRatio, 2)`
- **Larger candidate pool** — use `limit * 8` in BM25-only mode (vs current `limit * 4`)

**Risk:** Low. Multi-pass is standard search engineering, cheap in SQLite, no schema changes.

### 2. Replace min-max normalization with absolute score transformation

**Problem:** Min-max normalization is batch-relative and mathematically broken for thresholding.

**Fix:** Use an absolute monotonic transformation:

```typescript
// FTS5 ranks are negative; more negative = better match
const score = (-rank) / (1 + (-rank));
```

This maps `(-∞, 0]` to `[0, 1)` without batch dependence. Enables stable absolute thresholds.

**Risk:** Low. Changes score distribution but not relative ordering within a single query.

### 3. Consolidate search pipeline — SQL JOIN instead of O(N) scans

**Problem:** `getStrengthMap()` loads entire database on every search. Plan originally proposed adding `getCreatedAtMap()` which would double the problem.

**Fix:** Combine FTS search with memory data in a single SQL JOIN:

```sql
SELECT f.id, bm25(memory_fts, 0.0, 1.0, 0.5) as rank,
       m.strength, m.created_at, m.content, m.type,
       m.temporal_state, m.temporal_anchor, m.source, m.consolidated
FROM memory_fts f
JOIN memories m ON f.id = m.id
WHERE memory_fts MATCH ?
ORDER BY rank LIMIT ?
```

This eliminates:
- `getStrengthMap()` full table scan
- Separate `getCreatedAtMap()` (never needs to exist)
- N+1 `getMemory(id)` calls for result hydration

All ranking inputs (rank, strength, created_at) and result data come from one query.

**Risk:** Low. Standard SQL optimization.

### 4. FTS schema migration

**Changes:**

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
  id UNINDEXED,
  content,
  type,
  tokenize='unicode61 remove_diacritics 2',
  prefix='2,3,4'
);
```

- `id UNINDEXED` — stop tokenizing SHA-256 hashes
- `remove_diacritics 2` — language-independent improvement for accented characters
- `prefix='2,3,4'` — enable prefix queries for partial-term matching

**Not included:** Porter stemming. It is English-only and would break non-English content (e.g. Finnish). Language-specific stemming may be reconsidered in the future via application-level stemmers if demand warrants it.

**Migration:** Drop and recreate FTS virtual table, reindex all memories. No data loss — `memories` table is canonical.

**Risk:** Low. One-time rebuild during schema version bump.

### 5. Recency boost (BM25-only mode)

**Implementation:** Apply a gentle exponential decay factor during scoring:

```typescript
const ageDays = (Date.now() - new Date(created_at).getTime()) / (1000 * 60 * 60 * 24);
const recencyBoost = Math.exp(-ageDays / 180); // Half-life ~125 days
```

- `created_at` comes from the JOIN (change 3), no extra query
- Applied in BM25-only mode only
- Uniform across all memory types (type field is free-form, we cannot make assumptions)
- Strength already captures "actively used" signal via consolidation reinforcement

**Risk:** Low. Gentle half-life. Old but high-strength memories still rank well.

### 6. Column weight tuning

Part of the JOIN query (change 3):

```sql
bm25(memory_fts, 0.0, 1.0, 0.5) as rank
```

- `id=0.0` (UNINDEXED makes this redundant but explicit for clarity)
- `content=1.0` (primary search field)
- `type=0.5` (secondary boost when type matches)

### 7. Documentation and warnings

- **README:** Strong recommendation to configure OpenAI and/or Google API keys for embedding support. Explain that BM25-only is a fallback, not a recommended operating mode.
- **Startup warning:** Emit a `warn`-level log message when no embedding provider is available, recommending configuration of an embedding provider.
- **Known limitations:** Document that BM25-only mode cannot handle paraphrases, synonyms, or typos. These are fundamental limitations of lexical search.

## Deferred Work

### Association-based search boosting (separate branch)

Memories linked to recently-retrieved memories could receive a ranking boost. The exposure table and association data already exist. This is the highest-value semantic-ish improvement for BM25-only mode.

**Implementation points (leave TODO comments in code):**
- In `search()` scoring loop: boost candidates that have associations with recently-exposed memories
- Requires loading association edges for top-K seeds
- Interaction with strength multiplier and recency boost needs careful design

### Provenance-based ranking signals (consider carefully)

The system could boost memories that were previously useful (high attribution confidence) for lexically similar queries. However, this carries **significant self-reinforcement risk**: popular memories become permanently over-retrievable, wrong past retrievals poison future results. Leave a comment in code noting this possibility and the risk.

### Strength scoring change (separate issue)

Current multiplicative strength scoring (`hybridScore * strength`) can zero out relevant but weakened memories. A logarithmic approach (`score + w * log1p(c * strength)`) would be gentler. This affects both hybrid and BM25-only modes and should be evaluated separately.

### Word trigram sensitivity in merge candidates (separate issue)

`textFeatures()` in `merge-candidates.ts` uses word trigrams which are order-sensitive. "The deadline is April 15" and "April 15 is the deadline" share zero word trigrams. This affects merge candidate detection in both embedded and BM25-only modes.

### Comprehensive test suite (separate issue)

Beyond integration tests in this branch, a comprehensive evaluation suite covering the full memory plugin (retrieval quality, consolidation correctness, temporal behavior) should be built. This could serve go-to-market quality assurance for researcher-facing use cases.

## Implementation Plan

Each change is a separate commit.

### Commit 1: FTS schema migration
- Add schema version bump and migration logic
- Rebuild FTS table with `UNINDEXED`, `remove_diacritics 2`, `prefix='2,3,4'`
- Update tests

### Commit 2: Search pipeline consolidation (SQL JOIN)
- Replace `searchFts()` with joined query returning rank + memory data
- Remove `getStrengthMap()` usage from search path
- Eliminate N+1 `getMemory()` calls in result hydration
- Update tests

### Commit 3: BM25 score normalization fix
- Replace min-max normalization with absolute transformation
- Update tests

### Commit 4: Multi-pass FTS query builder
- Replace `escapeFtsQuery()` with multi-pass waterfall (phrase → AND → OR)
- Add punctuation stripping
- Add query term coverage ranking
- Use `limit * 8` candidate pool in BM25-only mode
- Update tests

### Commit 5: Recency boost
- Apply recency factor in BM25-only scoring
- Add tests with time-sensitive fixtures

### Commit 6: Documentation and warnings
- Update README with embedding provider recommendation
- Add warn-level startup message when embeddings unavailable
- Document BM25-only limitations

### Commit 7: Integration tests
- FTS-only search end-to-end tests
- Verify multi-pass waterfall behavior
- Verify recency boost behavior
- Verify schema migration path

## Risks and Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| Multi-pass waterfall returns too many weak OR matches | Medium | Query term coverage ranking penalizes low-overlap results |
| Recency boost over-penalizes old important memories | Low | Gentle half-life (180 days), strength compensates for active use |
| FTS schema migration breaks existing databases | Low | Standard version-gated migration, FTS is rebuilt not altered |
| Users expect embedding-quality search from BM25-only | High | Strong documentation, startup warning, "keyword-only mode" notice |
| No typo tolerance in BM25-only mode | Medium | Documented limitation. Prefix indexes help partially. `node:sqlite` does not support spellfix1 or custom extensions |
| Absolute score transformation changes ranking behavior | Low | Relative ordering preserved within queries; only cross-query comparisons change |

## Known Limitations (to document)

BM25-only mode cannot:
- Match paraphrases ("shipping date" → "release deadline")
- Handle typos ("shiping" → "shipping")
- Understand synonyms ("postgres" → "postgresql")
- Split compound identifiers ("camelCase" → "camel" + "case")

These are fundamental limitations of lexical search without embeddings. Users who need these capabilities should configure an embedding provider.

# Implementation Review v2: LLM Fact Extraction

**Reviewed:** autoCapture LLM extraction — commit 57a3afe
**Reviewers:** Gemini (gemini-3.1-pro-preview), Codex (gpt-5.4)
**Rounds:** 2
**Date:** 2026-04-14

## Critical Issues (Consensus)

### 1. Auto-capture is non-idempotent — duplicates on retries

- **What:** Provenance uses deterministic `turnId` with upsert semantics, but auto-capture has no turn-level dedup. If `afterTurn()` is retried (regenerate, network retry), the LLM extracts again with slightly different wording, bypassing content-hash dedup.
- **Where:** `context-engine.ts` afterTurn() auto-capture block
- **Why it matters:** Permanent duplicate memories in the database. Different from the pre-existing `store()` TOCTOU — this is a design gap.
- **Suggested fix:** Persist a `autocapture:{turnId}` state flag before extraction. Skip if already set.

### 2. Fire-and-forget is lifecycle-unsafe

- **What:** `void extractAndStoreMemories(...)` launches a detached promise. If the runtime shuts down, disposes the workspace, or closes the DB before extraction completes, the background task may write to a closed DB or silently fail.
- **Where:** `context-engine.ts` afterTurn(), and `dispose()` does not track outstanding tasks
- **Why it matters:** In ephemeral runtimes, tests, or fast session turnover, extraction may never complete or may crash.
- **Additional concern:** No concurrency control — bursty sessions can stampede the LLM provider with unbounded parallel requests.
- **Suggested fix:** Track outstanding extraction promises. Drain on `dispose()`. Or use a sequential queue per engine instance.
- **Nuance:** Codex emphasizes concurrency control; Gemini emphasizes lifecycle safety. Both are valid aspects of the same root issue.

### 3. `parseExtractionResponse()` is brittle

- **What:** (a) Fence-stripping regex `^```...` only works if fences are at the absolute start. LLM output like `"Here are facts:\n```json\n[...]```"` won't strip correctly. (b) `indexOf("[")` / `lastIndexOf("]")` can match brackets in prose/examples before the actual JSON array.
- **Where:** `context-engine.ts` `parseExtractionResponse()`
- **Why it matters:** Silently drops all extracted facts for a turn, or parses garbage.
- **Suggested fix:** Use regex `match(/```(?:json)?\s*([\s\S]*?)\s*```/i)` to extract fenced content first; fall back to bracket-balanced array detection.

### 4. `getLlmConfig` does synchronous file I/O every turn

- **What:** `resolveLlmConfig()` calls `readFileSync` on `auth-profiles.json`. Invoked via `getLlmConfig()` on every `afterTurn()` call.
- **Where:** `index.ts` `getLlmConfig` closure, `resolveLlmConfig()` in index.ts
- **Why it matters:** Blocks the Node.js event loop on the hot path for every single turn.
- **Suggested fix:** Cache the resolved config at first access.

## Disputed Issues

### Trivial-turn filter: `&&` vs `||`

- **Gemini:** Using `&&` means "hi" + long assistant reply bypasses filter, triggering an LLM extraction call for nothing. Should use `||`.
- **Codex:** Agrees `&&` is too weak for this purpose. But notes even `||` is imperfect — short but important user facts ("I'm vegan") would also be filtered.
- **Moderator:** Gemini is right that `&&` is incorrect for the stated intent. `||` is better as a cost-saving gate (avoid wasteful LLM calls), even if it's not a perfect quality signal. The LLM itself is the real quality filter.

### `extractRoleText` and non-text content shapes

- **Codex:** Warns that only string and text-block arrays are handled. Other content shapes silently return null, which could disable auto-capture for some runtimes.
- **Gemini:** Pushes back — skipping images and tool_use blocks is correct behavior. We only want natural language text for extraction.
- **Moderator:** Gemini is right for the current use case. The risk is real but low-probability. If a runtime represents all assistant text in an unknown format, this would need updating, but it's not a bug today.

### `store()` error handling strictness

- **Codex:** store() rethrows non-breaker/timeout embedding errors. Auto-capture facts could still be stored with BM25-only if the embedding provider has auth issues.
- **Gemini:** Pushing back — throwing on hard config errors is appropriate. Silently storing un-embedded rows on genuine misconfiguration is wrong.
- **Moderator:** Gemini's argument is stronger. Hard errors should surface. The auto-capture try/catch in `extractAndStoreMemories` already handles this gracefully by logging and continuing.

## Minor Findings

- **`truncate()` bug when `maxLen < 3`:** `slice(0, negative)` returns characters from end instead of empty string. Fix: `Math.max(0, maxLen - 3)`. Low severity — `maxLen` is always ~2000 in practice.
- **Duplicate facts within same LLM response:** LLM may return same fact with different type. No normalization/dedup before storing. Should deduplicate by normalized content before calling `store()`.
- **`store()` TOCTOU race:** Pre-existing issue, but auto-capture increases concurrent write frequency. Two concurrent stores with same content can both pass the duplicate check. Would benefit from `INSERT OR IGNORE` at DB layer.
- **Missing tests:** Retry/idempotency, concurrent capture, duplicate facts in LLM response, malformed LLM output with multiple bracketed arrays.

## What's Solid

- **Provenance/auto-capture decoupling:** afterTurn() correctly separates the two concerns. Auto-capture works without getDb/ledger.
- **`extractRoleText` aggregation:** Forward-iterating accumulator correctly collects all messages per role.
- **`truncatePair` dynamic budget:** Short side lends budget to long side. Clean implementation.
- **Error isolation in `extractAndStoreMemories`:** Per-fact try/catch prevents one failed store from blocking others. Outer try/catch catches LLM failures.
- **`parseExtractionResponse` validation:** Type allowlist with fallback, content trimming, empty-content rejection. Robust against most malformed items within a valid JSON array.

## Moderator's Assessment

Strong convergence on top issues. Both reviewers independently found the parsing brittleness and filesystem I/O problems. Codex contributed the idempotency and concurrency concerns; Gemini contributed the lifecycle safety angle.

**Neither reviewer caught:** The `extractAndStoreMemories` function captures `manager` by value at call time. If the workspace is recreated between fire-and-forget dispatch and completion, the stored reference could point to a stale manager. This is related to the lifecycle issue but more specific.

**Single most important fix:** Add idempotency keyed by deterministic turn ID. This prevents the most likely data corruption scenario (retry-induced duplicates) with minimal code change.

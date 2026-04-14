# Implementation Review: autoCapture

**Reviewed:** autoCapture feature — commit 6427327
**Reviewers:** Gemini (gemini-3.1-pro-preview), Codex (gpt-5.4)
**Rounds:** 1 (strong convergence, round 2 unnecessary)
**Date:** 2026-04-14

## Critical Issues (Consensus)

Both reviewers agree on the same top 3 bugs, in the same priority order.

### 1. Auto-capture is accidentally disabled when provenance deps are missing

- **What:** The early return `if (!options.getDb || !options.ledger) return;` in `afterTurn()` exits before the auto-capture block runs. Auto-capture only needs `getManager()` and `autoCapture`, not `getDb` or `ledger`.
- **Where:** `src/context-engine.ts`, `afterTurn()` method
- **Why it matters:** Feature silently does nothing in any configuration that omits provenance tracking. All tests pass because they all provide both deps — the test suite has a blind spot.
- **Fix:** Decouple provenance and auto-capture into independent blocks:
  ```ts
  async afterTurn(params) {
    // 1. Provenance (requires getDb + ledger)
    if (options.getDb && options.ledger) {
      // ... provenance try/catch ...
    }

    // 2. Auto-capture (independent — requires only getManager + autoCapture)
    if (options.autoCapture) {
      // ... capture try/catch ...
    }
  }
  ```
- **Missing tests:** auto-capture with `autoCapture: true` but no `ledger`; auto-capture with no `getDb`.

### 2. `extractRoleText()` captures only the last message per role — loses earlier turn content

- **What:** `extractRoleText()` iterates backward and returns on the first match. In multi-message turns, earlier user messages (the original question, context) are dropped.
- **Where:** `src/context-engine.ts`, `extractRoleText()`
- **Why it matters:** If user sends "Here is my code" then "Find the bug", only "Find the bug" is captured. The stored memory is misleading or context-free.
- **Fix:** Aggregate all messages for the role within the turn (forward iteration):
  ```ts
  function extractRoleText(messages: unknown[], role: string): string | null {
    const parts: string[] = [];
    for (const msg of messages) {
      // ... extract text, push to parts ...
    }
    return parts.length > 0 ? parts.join("\n\n") : null;
  }
  ```
- **Missing tests:** multiple user messages in one turn; interleaved user/assistant messages; assistant tool-planning followed by final answer.

### 3. TOCTOU race in `MemoryManager.store()` across async embedding + insert

- **What:** `store()` checks `db.getMemory(id)`, then `await embedder.embed()`, then opens a transaction to insert. Two concurrent calls with same content can both pass the check, both generate embeddings, and the second insert hits a UNIQUE constraint failure.
- **Where:** `src/memory-manager.ts`, `store()` method
- **Why it matters:** Auto-capture increases write frequency on every turn, making this race more likely. A crash in `store()` would propagate as an unhandled error (though auto-capture's try/catch would contain it).
- **Fix:** Re-check existence inside the synchronous DB transaction:
  ```ts
  this.db.transaction(() => {
    if (this.db.getMemory(id)) return;  // TOCTOU guard
    this.db.insertMemory({ ... });
    // ...
  });
  ```
- **Note:** This is a pre-existing bug exacerbated by auto-capture, not introduced by this commit.

## Disputed Issues

### Assistant tool-planning text captured instead of final answer

- **Codex's position:** Last assistant message might be "Calling memory_search..." rather than the actual response. Risk of storing tool preambles.
- **Gemini's position:** If the turn ends on a tool execution, capturing the reasoning is better than returning null. Furthermore, fixing issue #2 (aggregating all messages) resolves this — both planning and answer would be included.
- **Moderator's take:** Gemini is right that aggregation mostly resolves this. Remaining edge case is turns that genuinely end mid-tool-use, which are uncommon. Not a separate critical issue.

### `satisfies MemorySource` usage

- **Codex:** Correct but unnecessary, slightly misleading. Just use the bare string literal.
- **Gemini:** Disagrees — `satisfies` is a TypeScript best practice that catches typos at compile time without widening.
- **Moderator's take:** Gemini is right. `satisfies` provides compile-time safety with zero runtime cost. Keep it.

### Content-hash dedup as idempotency mechanism

- **Codex:** Auto-capture is not idempotent by turnId like provenance. Content-hash dedup is "accidental and incomplete."
- **Gemini:** Pushes back — content-hash IS functionally idempotent for same-content retries. Only vulnerable to the TOCTOU race, not logical duplication.
- **Moderator's take:** Gemini is right for the retry case. Content-hash dedup is sufficient for the intended use case (same turn retried = same content = same hash). Cross-session conflation of identical content is actually desirable behavior (dedup).

## Minor Findings

- **Trivial-turn filter doesn't trim whitespace:** `"   ok   "` (8 chars with spaces) evaluates differently than intended. Fix: use `.trim().length`.
- **Static 50/50 truncation budget:** Wastes budget when one side is short. Should dynamically allocate — let the longer side borrow unused chars from the shorter side.
- **Loose boolean config parsing:** `cfg.autoCapture !== false` treats string `"false"`, `0`, `null` as `true`. Should use `typeof cfg.autoCapture === "boolean" ? cfg.autoCapture : true`. Pre-existing pattern but riskier now that default is `true`.
- **No integration test for default flip wiring:** Config default changed but no test verifies it flows through `index.ts` → engine creation.
- **No test for non-text multimodal content:** Assistant array with only image/tool blocks should return null gracefully (code handles it but no test covers it).

## What's Solid

- **Error isolation:** Auto-capture's try/catch ensures failures don't block the turn lifecycle or provenance writes.
- **`satisfies MemorySource` type safety:** Catches source string typos at compile time.
- **Test structure:** New tests follow existing patterns well (temp DB, cleanup, mock manager).
- **Minimal surface area:** Changes are contained to the right files with no unnecessary refactoring.

## Moderator's Assessment

Both reviewers converged on the same top 3 with remarkable agreement. The most damaging finding is **#1 (provenance guard blocks auto-capture)** — the feature literally doesn't work in partial configurations, and the test suite has a blind spot that hides it.

**Issue #2 (last-message-only capture)** is a design flaw that both reviewers caught independently and proposed nearly identical fixes for. It's straightforward to fix.

**Issue #3 (TOCTOU race)** is pre-existing but worth fixing now since auto-capture increases write frequency.

**Neither reviewer caught:** The `hook_capture` → `auto_capture` rename could theoretically break existing databases with `hook_capture` source values, though this is practically a non-issue since the value was never used in code.

**Single most important fix:** Decouple the provenance early-return from auto-capture in `afterTurn()`. Without this, the feature is dead code in many valid configurations.

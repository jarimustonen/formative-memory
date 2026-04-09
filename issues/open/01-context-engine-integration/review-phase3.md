# Review: Phase 3.1–3.2 Context Engine Implementation

**Reviewed:** `src/context-engine.ts`, `src/context-engine.test.ts`, `src/index.ts`, `src/index.test.ts`
**Reviewers:** Gemini, Codex (GPT-5.4)
**Rounds:** 2

---

## Critical Issues (Consensus)

Issues both reviewers agree on, ordered by severity:

### 1. Context engine uses wrong workspace — hardcoded `"."`

- **What:** Context engine factory passes `getManager(config, ".")` while tool registration uses `ctx.workspaceDir ?? ctx.agentDir ?? "."`. The engine and tools may read/write different SQLite databases.
- **Where:** `src/index.ts:242` — `getManager: () => getManager(config, ".")`
- **Why it matters:** Total functional failure in workspace-aware setups. Recalled memories may not match stored memories.
- **Fix:** Context engine factory signature is parameterless (`ContextEngineFactory = () => ContextEngine`). The workspace must come from another source — either the config's absolute `dbPath` (which is usually `~/.openclaw/memory/associative`, making this a non-issue for absolute paths) or a shared resolver.
- **Moderator note:** Since the default dbPath is `~/.openclaw/memory/associative` (absolute/tilde), `resolveMemoryDir()` ignores the workspaceDir for absolute paths. The `"."` only matters for relative dbPath configs. Still, it should be consistent with the tool path.

### 2. Unescaped memory content in systemPromptAddition — prompt injection risk

- **What:** `formatRecalledMemories()` interpolates `r.memory.content` directly into pseudo-XML blocks. Content containing `</recalled_memories>`, quotes, or control text can break the framing.
- **Where:** `src/context-engine.ts:73-76` — raw string interpolation
- **Why it matters:** Stored memory content is user-influenced. A malicious or accidental `</recalled_memories>` breaks the untrusted data boundary.
- **Fix options:**
  - Escape XML-special chars (`<`, `>`, `"`) in content before interpolation
  - OR use JSON-encoded block (both reviewers converged on this as more robust)
  - Also sanitize `r.memory.type` if it's free-form

### 3. `extractLastUserMessage()` ignores array/structured content

- **What:** Only handles `typeof msg.content === "string"`. Multimodal messages with `content: [{type: "text", text: "..."}]` are missed, causing recall to silently degrade.
- **Where:** `src/context-engine.ts:164-171`
- **Why it matters:** Modern chat APIs frequently use array content. No recall means degraded memory functionality.
- **Fix:** Extract text from content arrays:
  ```typescript
  if (Array.isArray(msg.content)) {
    return msg.content.filter(b => b.type === "text").map(b => b.text).join("\n");
  }
  ```

### 4. Silent error swallowing in assemble() — no observability

- **What:** `catch {}` block returns gracefully but logs nothing.
- **Where:** `src/context-engine.ts:126-129`
- **Why it matters:** DB corruption, expired API keys, SQLite BUSY — all fail identically to "no memories found". Impossible to diagnose.
- **Fix:** Add logger to engine options, log at warn level before returning.

### 5. Query priority is backwards — `params.prompt` before user message

- **What:** `params.prompt ?? extractLastUserMessage(...)` prioritizes prompt over user message. `params.prompt` may be a static system instruction, not the user's query.
- **Where:** `src/context-engine.ts:116`
- **Why it matters:** Systematically poor recall quality if prompt is static/generic.
- **Fix:** `extractLastUserMessage(params.messages) ?? params.prompt`

---

## Disputed Issues

### 1. Duplicate injection (before_prompt_build + assemble())

- **Gemini's position:** This is a documented transitional state (TODO Phase 3.8). Not an accidental bug.
- **Codex's position:** Even if documented, it's still harmful: duplicate recall, prompt bloat, token waste. Should be gated.
- **Moderator's take:** Both are right. TODO explicitly says "before_prompt_build hook säilyy kunnes assemble() injektointi on valmis (3.2)". Now that 3.2 IS complete, the hook should be disabled. It was intentional to keep during 3.1, but 3.2 changes the situation. However, TODO also says "Poista vanha hook vasta pariteettitestin jälkeen" (3.8). Safest approach: gate it behind a flag now, remove after parity test.

### 2. classifyBudget(undefined) => "high"

- **Gemini's position:** Correct — undefined means no limit, "high" is logical.
- **Codex initial position:** Should be "medium" for safety.
- **Codex round 2:** Conceded. "high" is defensible.
- **Moderator's take:** Gemini is right. Undefined tokenBudget means no constraint imposed.

### 3. estimatedTokens: 0

- **Gemini's position:** TODO explicitly requires it ("kuten legacy engine"). Not a bug.
- **Codex's position:** Intentional but architecturally problematic.
- **Moderator's take:** This is correct for Phase 3.2 per spec. It's tech debt to address later when the runtime starts using it.

### 4. 400 tokens/msg heuristic severity

- **Gemini:** "Catastrophic" — large messages cause budget misclassification.
- **Codex:** "Overstated" — it's a coarse classifier, crude but not catastrophic.
- **Gemini round 2:** Insisted it can cause `context_length_exceeded` errors.
- **Moderator's take:** The heuristic IS bad for extreme cases (pasted logs, code). A char-count-based estimate is strictly better and trivial to implement. Should fix, but it's medium priority — the downstream effect is misclassification of 4 budget tiers, not a hard crash (the runtime manages actual token limits).

### 5. XML vs JSON for recalled memories

- **Gemini:** Pseudo-XML is industry standard for Claude. Structure is fine, escaping is the problem.
- **Codex:** Agrees XML is fine, but content must be escaped/encoded.
- **Moderator's take:** Consensus — keep XML structure, fix escaping. JSON encoding of content within the block is one valid approach.

---

## Minor Findings

- **`bm25Only` is static boolean, should be `() => boolean` getter** for Phase 3.5 circuit breaker compatibility (Gemini). Valid future concern; not blocking for 3.2.
- **`memory_feedback` rating accepts unbounded values** — Type.Number() without min/max (Codex). Real bug, easy fix.
- **`memory_get` prefix ambiguity** — no collision detection for 8-char prefixes (Codex). Low probability but should return error on ambiguity.
- **Naive string truncation** can break Markdown formatting (Gemini). Minor — cosmetic within untrusted data block.
- **Global `managers` map never evicts/closes** — potential DB handle leak (both). Valid for long-running processes.
- **`before_prompt_build` hook error boundary** — `getManager()` outside try block (Codex). Real bug in legacy path.
- **`createEmbedder()` has no timeout** on fetch (Codex). Valid but separate from context engine.

---

## What's Solid

- Context engine factory pattern and ContextEngine interface compliance
- Separation of `classifyBudget` and `formatRecalledMemories` as testable pure functions
- Untrusted data framing concept (just needs proper escaping)
- Error resilience approach (graceful degradation on recall failure)
- Test coverage breadth (27 tests) for the core logic
- Clean phase-by-phase architecture following the documented plan

---

## Unresolved Questions

1. **Does `registerContextEngine` factory receive context?** The TypeScript type is `() => ContextEngine` (parameterless). If so, workspace resolution must come from config or manager resolver, not from factory params. Needs verification.
2. **Should before_prompt_build be disabled now or after parity test?** The TODO says wait for 3.8, but 3.2 is now complete. Pragmatic decision needed.
3. **Is `params.prompt` a system prompt or user query?** The OpenClaw API audit says it's "The incoming user prompt for this turn (useful for retrieval-oriented engines)". If it IS the user's turn prompt, then the current priority order may be correct after all. Needs runtime testing.

---

## Moderator's Assessment

**Strongest reviewer:** Codex had more systematic coverage and caught the workspace bug first. Gemini had better instinct on API semantics (budget undefined = "high", XML format, transitional state).

**Issues neither caught:**
- The `params.prompt` question depends on what OpenClaw actually passes. The API audit doc says it's "the incoming user prompt for this turn" — which means the current `params.prompt ?? lastUserMessage` priority might actually be correct. This needs runtime verification.

**Single most important thing to address:**
Content escaping in `formatRecalledMemories()`. The workspace issue may be a non-issue for default absolute paths, and the double injection is transitional. But prompt injection via stored memories is a real security concern that affects every user.

**Recommended fix order:**
1. Escape content in formatRecalledMemories (security)
2. Handle array content in extractLastUserMessage (compatibility)
3. Add logging to assemble() catch block (observability)
4. Verify workspace resolution for non-absolute dbPath configs
5. Improve budget heuristic (char-count over message-count)

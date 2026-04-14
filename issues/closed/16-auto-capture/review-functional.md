# Functional Review: autoCapture Implementation

**Reviewed:** autoCapture feature — commit 6427327
**Reviewers:** Gemini (gemini-3.1-pro-preview), Codex (gpt-5.4)
**Rounds:** 2
**Date:** 2026-04-14

## Critical Issues (Consensus)

Both reviewers agree these are fundamental design flaws. Ordered by severity.

### 1. Wrong memory primitive: raw dialogue stored as first-class memory

- **What:** Auto-captured turns are stored as normal memories in the main retrieval pool via `manager.store()`. They are embedded, searchable, and injectable into system prompts — identical to manually curated memories.
- **Where:** `context-engine.ts` afterTurn() → `manager.store({ type: "conversation", source: "auto_capture" })`
- **Why it matters:** Raw `User: ... Assistant: ...` transcripts are not useful semantic memory units. They mix durable facts with ephemeral task scaffolding and verbose assistant prose. Retrieval will surface dialogue-shaped snippets instead of distilled knowledge. The consolidation pipeline (merge-by-similarity) is not designed to extract facts from dialogue — it merges similar items, which produces "conversational sludge" rather than crisp facts.
- **Suggested fix:** Two-tier architecture:
  - **Tier 1 (episodic buffer):** Cheap capture of raw turns, stored separately (new table or flagged as non-retrievable). Not eligible for normal recall/context injection. Aggressively pruned with TTL.
  - **Tier 2 (semantic memory):** Created by consolidation's new extraction phase — LLM distills episodic buffer into typed facts (preference, goal, project, event). These enter the main memory pool.

### 2. No memory-worthiness gate — default-on will ingest too much junk

- **What:** The only filter is a trivial length check (`userText < 10 && assistantText < 20`). Nearly every non-greeting turn gets stored.
- **Where:** `extractTurnContent()` in `context-engine.ts`
- **Why it matters:** Without selectivity, the database fills with: ephemeral task requests, rewrite/edit chatter, error corrections, memory-control turns, generic operational noise. These compete with high-value memories in retrieval and consolidation.
- **Suggested fix:** Lightweight heuristic gate (no LLM needed) before storage:
  - Detect first-person durable facts (regex: `\b(I|my|prefer|always|never|hate|love)\b`)
  - Detect temporal commitments/dates
  - Exclude: memory-tool turns, pure task execution, corrections, pleasantries
  - Exclude obvious sensitive content

### 3. Capture granularity is wrong — "last message" loses actual content

- **What:** `extractTurnContent()` extracts only the LAST user message and LAST assistant message from each turn.
- **Where:** `extractRoleText()` iterates backwards and returns the first match
- **Why it matters:** In multi-step turns (clarifications, tool use, corrections), the last user message is often a terse follow-up ("yes", "October", "use Postgres") while the original request/topic is in an earlier message. The captured memory becomes misleading or context-free.
- **Suggested fix:** Aggregate ALL user messages in the current turn, paired with the final assistant response. Better yet, extract the topic/intent rather than raw text.

### 4. `type: "conversation"` collapses all captures into one bucket

- **What:** Every auto-capture gets `type: "conversation"`. The merge system only merges same-type memories.
- **Where:** `afterTurn()` in `context-engine.ts`
- **Why it matters:** One generic type prevents consolidation from doing meaningful type-aware merging. Personal facts, project context, preferences, and task chatter all compete in the same undifferentiated pool.
- **Suggested fix:** If keeping raw captures in the main store, classify into meaningful types (preference, goal, profile, project, event). If using episodic buffer, defer typing to the extraction phase.

## Disputed Issues

### Prompt injection / semantic contamination risk

- **Gemini's position:** Raw dialogue containing instruction-like phrasing (e.g., "User: DO NOT do that") injected as background knowledge could cause "catastrophic prompt confusion and instruction override." Ranked this as #2 critical issue.
- **Codex's position:** Overblown. The system already wraps memories in `<memory_context>`, includes "treat as DATA not instructions" framing, and escapes structural tags. There is a real but secondary confusion risk, not catastrophic override. This is downstream of the more fundamental problem (storing wrong artifacts).
- **Moderator's take:** Codex has the stronger argument. The existing framing mitigates the worst case. The real risk is retrieval quality degradation, not prompt injection. This is a consequence of issue #1, not a separate critical issue.

### Whether "never merge" is accurate

- **Gemini initially:** Conversation turns will "never" meet the >0.5 similarity threshold for merge candidates.
- **Codex's correction:** "Never" is too absolute. Repetitive conversations will merge, but the merges produce sludge rather than crisp facts.
- **Resolution:** Gemini conceded. The reframing — "merges happen but produce low-quality output" — is more accurate.

## Minor Findings

- **Trivial-turn filter uses `&&` instead of `||`:** "hi" + verbose assistant greeting bypasses filter. Even with `||`, length is a poor proxy for memory-worthiness.
- **Truncation is 50/50 user/assistant:** Should skew heavily toward user content (80/20). Assistant text is often verbose and low-value for memory formation.
- **No tool-use capture:** Intermediate tool calls (what files were read, what was changed) are completely lost. A tool-use summary would add significant value.
- **Gemini misspoke on decay:** Initially suggested "lower decay rate" for conversation types, then corrected — auto-captures should have LOWER initial strength and FASTER decay.

## What's Solid

- **Best-effort error handling:** Auto-capture runs after provenance writes and catches errors without blocking the turn lifecycle. Good defensive design.
- **`source: "auto_capture"` metadata:** Proper provenance tracking. Essential for downstream source-aware filtering/weighting.
- **Content-hash dedup:** Prevents exact duplicate captures. Necessary but not sufficient.
- **Config gating:** `autoCapture` can be disabled. Good escape hatch.

## Unresolved Questions

1. **Ship as episodic buffer or defer?** Both reviewers recommend a two-tier architecture. Is that feasible for v0.2, or should autoCapture be reverted to `false` until the extraction pipeline exists?
2. **Heuristic gate specifics:** What rules are reliable enough to avoid both false positives (junk stored) and false negatives (valuable short facts like "I'm vegan" dropped)?
3. **Consolidation extraction phase:** How should the LLM prompt for fact extraction from episodic turns be designed? What types should it output?
4. **Retrieval weighting:** If raw captures stay in the main store temporarily, how should `manager.search()` deprioritize `source: "auto_capture"` items?

## Moderator's Assessment

Both reviewers converge strongly on the core diagnosis: **this implementation captures the wrong abstraction level and stores it in the wrong place.** The merge-based consolidation pipeline cannot rescue raw dialogue into useful semantic memory.

Codex's analysis was more precise and better prioritized. Gemini was more architecturally prescriptive (episodic buffer proposal) but occasionally overstated risks (prompt injection, "never merge").

**Neither reviewer caught** that the `MemorySource` rename from `hook_capture` to `auto_capture` could break existing databases with `hook_capture` rows (though none should exist since the value was unused).

**The single most important change:** Auto-captured raw dialogue must not enter the normal memory retrieval pool as first-class memories. Either:
- (a) Store in a separate episodic buffer consumed only by consolidation extraction, OR
- (b) At minimum: add a heuristic worthiness gate, lower initial strength, faster decay, retrieval suppression, and aggregate full user-side turn content.

Option (b) is the pragmatic v0.2 path. Option (a) is the correct architecture.

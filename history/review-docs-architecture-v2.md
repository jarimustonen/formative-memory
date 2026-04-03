# Review: Architecture and Conceptual Documentation (v2)

**Reviewed:** `docs/architecture.md`, `docs/how-memory-works.md`
**Reviewers:** Gemini (gemini-3.1-pro-preview), Codex (gpt-5.4)
**Rounds:** 2

## Critical Issues (Consensus)

Issues both reviewers agree on, ordered by severity:

### 1. Future behavior documented as current reality

- **What:** Both documents present consolidation mechanics (reinforcement, decay, association updates, temporal transitions, pruning, merging) as operational behavior. A single bullet in "Current limitations" admits phases 4.0–4.5 are not implemented. This contaminates downstream claims: "important memories naturally surface", "stale ones fade", time-aware transitions.
- **Where:** Both docs, especially consolidation sections and `how-memory-works.md` opening paragraph
- **Why it matters:** Readers form a false mental model of what the system currently does. The conceptual doc reads like marketing for features that don't exist.
- **Suggested fix:** Split every section into **Implemented now** vs **Planned design**. Rewrite the conceptual doc's opening to describe current V1 behavior accurately, with future behavior explicitly labeled as design intent.

### 2. Undocumented global/ambient state creates correctness risk

- **What:** "Most recently accessed workspace" is ambient mutable global state. The deduplication ledger is "owned by the caller" but the contract is undefined. CLI write warnings are too weak.
- **Where:** `architecture.md` — "Workspace isolation", "Deduplication ledger", "CLI diagnostic tool"
- **Why it matters:** Race conditions in concurrent environments, cross-session contamination, state divergence between runtime caches and external DB mutations.
- **Suggested fix:** Document the strict single-active-workspace assumption, ledger lifecycle/keying, and strengthen CLI write warnings to "Do not run while runtime is active."

### 3. Content-addressed identity (`SHA-256(content)`) is a documented architectural trap

- **What:** Presented as clean deduplication ("same content = same identity, preventing duplicates") but it collapses metadata distinctions (same text as "hypothesis" vs "fact" → PK collision), complicates updates/corrections, and constrains memory evolution.
- **Where:** Both docs — identity definition
- **Why it matters:** Users will hit this constraint in normal workflows. The docs present it as a benefit without documenting the trade-off.
- **Suggested fix:** Document the constraint explicitly: content-addressed identity prevents exact-text duplicates but also means metadata-only changes require content modification. State which fields are mutable vs immutable.

### 4. Security language overclaims

- **What:** "Prevents prompt injection attacks" — framing data as data mitigates but does not prevent. Model compliance is probabilistic.
- **Where:** `how-memory-works.md` "Automatic recall", "Core principles"
- **Why it matters:** False security assurance in an open-source project.
- **Suggested fix:** Change to "reduces prompt-injection risk."

## Disputed Issues

### 5. Whether "does not modify existing memories during normal operation" is misleading

- **Gemini's position:** The statement is technically correct — provenance writes and log appends don't mutate `memories` table rows.
- **Codex's position:** In a conceptual doc, "does not modify existing memories" is broader than intended. The system clearly mutates persisted state (exposure, attribution, feedback, logs) during normal operation. The statement misleads.
- **Moderator's take:** Codex has the stronger argument for a conceptual doc. The fix is simple: narrow the claim to "does not update memory strength, associations, temporal state, or consolidation status during normal operation."

### 6. Whether synchronous blocking consolidation is a severe anti-pattern

- **Gemini's position:** In a single-threaded Node.js environment, synchronous blocking freezes the entire OpenClaw process for all agents and incoming requests. Fatal architectural flaw.
- **Codex's position:** `/memory sleep` is an explicit rare admin action. Synchronous blocking is acceptable for that. The bigger concern is future LLM-based merging making it much worse.
- **Moderator's take:** Both have valid points. For V1 with simple operations, it's acceptable. The docs should note the constraint and its implications for future phases.

### 7. Whether hardcoded 60/40 search weights are a docs problem

- **Gemini's position:** Hardcoding weights prevents user tuning for different domains. Bad practice.
- **Codex's position:** Documenting fixed constants is fine. The real issue is missing normalization details and score calibration.
- **Moderator's take:** Codex is right that this is not primarily a docs problem. The docs should document normalization behavior, not make weights configurable.

### 8. Whether hybrid search normalization is top-3 critical

- **Gemini's position:** BM25 scores are unbounded, cosine is bounded [-1,1]. Direct weighted combination is "mathematically nonsensical." Top 3 issue.
- **Codex's position:** Important but not top-3. A poor ranking still yields some results. State boundaries and identity constraints are more fundamental.
- **Moderator's take:** Codex is right on priority. The normalization gap should be documented but is not as damaging as the aspirational-vs-reality or state-boundary problems. (Note: the code likely does normalize — the docs just don't say so.)

## Minor Findings

- `~` in JSON config example is unsafe unless plugin explicitly expands it — document or use absolute path
- Temporal transitions can lag indefinitely if `/memory sleep` is not run — document the consequence
- Consolidation/feedback race: if sleep runs between memory use and feedback, implicit attribution gets reinforced permanently before override arrives — document or design around
- "Probabilistic OR" used without definition in consolidation section
- Circuit breaker section has decorative precision (jitter percentages) but omits operational semantics (probe mechanics, what counts as failure)
- No schema migration/versioning story documented
- No memory content size constraints documented
- No explanation of which memory fields are mutable vs immutable
- No guidance on what makes a good memory to store, or what to expect before first consolidation
- Missing: what the recalled memory injection actually looks like in the prompt (XML shape)
- Attribution confidence constants may be too brittle for architecture docs — consider moving to reference section
- `compact()` delegation to runtime is unexplained platform jargon

## What's Solid

- **Structure and style:** Frontmatter, Mermaid diagrams, cross-links, examples, and layered organization now match OpenClaw conventions well
- **Exposure/attribution distinction:** Both reviewers called this the strongest conceptual contribution
- **Turn lifecycle sequence diagram:** Clear and immediately communicable
- **Separation of concerns:** Conceptual doc vs architecture doc is the right split
- **CLI examples:** Practical and useful
- **Limitations section:** Exists and is honest (though needs to be more prominent)

## Unresolved Questions

- Should the conceptual doc describe the *target* memory model (with caveats) or only *current* behavior?
- How much consolidation detail belongs in docs when it's mostly unimplemented?
- Should temporal state be updated outside consolidation (real-time) to avoid stale state?
- Is `lastAccessedWorkspace` safe given OpenClaw's actual concurrency model, or does it need redesign?

## Moderator's Assessment

**Strongest reviewer:** Codex made more precise, better-prioritized arguments throughout. Gemini found important issues (workspace race condition, score normalization, AbortSignal concern) but tended to overstate severity and was less disciplined about distinguishing documentation problems from design problems.

**Issues neither reviewer caught:**
- The docs don't explain what happens when a user first enables the plugin — the "day one" experience with no memories and no consolidation history
- No mention of disk space growth or operational monitoring

**Single most important thing to address:** The aspirational-vs-reality split. Both docs describe a sophisticated memory system where most of the sophistication doesn't exist yet. This must be fixed before publishing. Everything else is secondary.

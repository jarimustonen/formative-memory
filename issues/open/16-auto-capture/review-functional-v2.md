# Functional Review v2: LLM Fact Extraction

**Reviewed:** autoCapture LLM extraction — commit 57a3afe
**Reviewers:** Gemini (gemini-3.1-pro-preview), Codex (gpt-5.4)
**Rounds:** 2
**Date:** 2026-04-14

## Critical Issues (Consensus)

### 1. Weak admission policy — system will store too much low-value project/task residue

- **What:** The extraction prompt allows "project context" broadly. Small models (Haiku, GPT-4o-mini) are biased toward action/compliance and will invent "durable" facts from routine coding turns. They struggle to return empty arrays.
- **Why it matters:** In a 50-turn debugging session, expect 20-40 micro-memories. Most are ephemeral task state ("User is rewriting the auth module") not long-term knowledge.
- **Suggested fix:** Stricter prompt policy: "Prefer under-extraction to over-extraction. Only extract facts explicitly stated or clearly confirmed by the user. Do not extract current task requests as memory. If uncertain whether something is durable, omit it."
- **Both agree:** This is the single most impactful functional change.

### 2. No handling of corrections and contradictions

- **What:** Auto-capture appends new facts without checking existing memory. Corrections ("Actually I moved to Munich, not Berlin") create a new memory while the old contradictory one persists.
- **Why it matters:** The context engine injects both into the system prompt until consolidation runs (every 48h). Agent operates with contradictory state for days.
- **Suggested fix:** Either (a) pass currently recalled memories to the extraction prompt and allow `supersedes_id` output, or (b) run a fast post-extraction dedup/conflict check against recent memories.

### 3. Insufficient context — current-turn-only loses reference resolution

- **What:** `extractTurnContent` only sees `messages.slice(prePromptMessageCount)`. When user says "Let's migrate it to Postgres", the LLM can't resolve what "it" refers to.
- **Why it matters:** Extracted facts are decontextualized and sometimes useless when recalled later.
- **Suggested fix:** Pass a sliding window (last 3-5 turns) but instruct the LLM to only extract facts from the LATEST turn, using prior turns only for context.
- **Nuance:** Codex rates this #3 (below admission policy), Gemini rates it higher. Both agree it's important.

### 4. Type taxonomy is insufficient

- **What:** `fact` is a garbage drawer absorbing profiles, constraints, habits, health info, location, background. Missing `constraint` type for "must use Node 18", "no Docker", "SQLite only". Missing `profile/background` for "senior backend engineer", "new to Rust".
- **Why it matters:** Type is used for merge candidate selection. One huge `fact` bucket degrades consolidation quality.
- **Suggested fix:** Add at minimum `constraint` and `profile`. Define `project` narrowly (durable project identity, not current implementation details).

## Disputed Issues

### Per-turn vs batched execution

- **Gemini:** Running every turn is a "fundamental design error." Recommends batching every 5-10 turns or session end, or heuristic trigger gating.
- **Codex:** Per-turn is not inherently wrong IF the extractor is conservative. Per-turn has benefits: turn is still fresh, corrections easiest to detect in the moment, session-end batching loses granularity. The real problem is permissive admission, not timing.
- **Moderator:** Codex makes the stronger argument. Per-turn with strict admission > batched with loose admission. But a cheap heuristic pre-gate (regex for "I prefer", "remember", "always", "moving to") could reduce unnecessary LLM calls.

### Chain-of-thought reasoning in extraction output

- **Gemini:** Force LLM to output `longevity_reasoning` and `durable_score` (1-10) before each fact. Drop anything below threshold. This structurally constrains over-extraction.
- **Codex:** Skeptical. Small models fabricate rationales. Rationale fields increase cost/latency without guaranteeing better filtering. Prefers structured evidence markers (`explicitly_stated_by_user: true/false`, `durable_beyond_current_task: true/false`) or a separate accept/reject filter.
- **Moderator:** Both have merit. CoT can help but is not reliable with tiny models. Structured boolean markers are cheaper and more actionable. A second-pass filter is the most robust option.

### User-approved vs user-stated facts

- **Gemini:** Must capture "agreed-upon state," not just user utterances. If assistant proposes Zustand and user says "Great, do that," the fact "Project uses Zustand" was assistant-stated but user-approved.
- **Codex:** Dangerous to include assistant-induced framing — the LLM may crystallize assistant suggestions as user preferences without clear confirmation.
- **Moderator:** Gemini is right in principle, but the prompt must explicitly distinguish "user confirmed" from "assistant suggested without confirmation." Prompt should say: "Only extract assistant-introduced information if the user explicitly confirmed it."

## Minor Findings

- **Volume concern in coding sessions:** Both agree most coding turns have little durable memory value, but the extractor will often emit something anyway. Need either strict admission or a cheap pre-gate.
- **Consolidation merge limitations:** Jaccard-based merge can't handle semantic oppositions ("likes Python for scripts" vs "dislikes Python for enterprise"). Not a merge-rate problem but a truth-maintenance problem.
- **Generic project boilerplate:** Facts like "User is working on a software project" or "User is coding in TypeScript" are almost worthless but will be extracted frequently.
- **Negative preferences underserved:** Models extract positive statements better than aversions like "I hate verbose docs" or "Don't suggest React."

## What's Solid

- **LLM extraction is the right architecture** — both reviewers agree this is a massive improvement over raw dialogue storage.
- **Typed facts with proper source metadata** — enables downstream filtering, weighting, and type-aware consolidation.
- **Fire-and-forget design** — non-blocking is correct; the turn content is already in context.
- **JSON schema output** — structured output enables validation and filtering.

## Moderator's Assessment

Both reviewers converge on the core diagnosis: **the extraction policy is too permissive for small models, and the system lacks contradiction handling and sufficient context.** These are the three changes that would most improve memory quality.

Codex's analysis was more nuanced on admission policy and per-turn vs batching. Gemini was more architecturally prescriptive (CoT, sliding window) but occasionally overstated certainty.

**Single most important fix:** Tighten the extraction prompt to strongly prefer under-extraction, require user-grounded evidence, and explicitly exclude current-task restatements. This single change would reduce noise more than any structural change.

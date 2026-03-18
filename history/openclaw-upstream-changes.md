# OpenClaw Upstream Changes for the Associative Memory Plugin

> This document describes changes needed in OpenClaw core to enable or improve the associative memory plugin. Each change is an independent, backwards-compatible PR.
>
> **Context:** We are building an OpenClaw plugin that replaces `memory-core` with an associative memory system. The plugin uses the exclusive memory slot (`kind: "memory"`).
>
> **Memory slot mechanism:** The plugin declares `kind: "memory"` and is activated via `plugins.slots.memory = "plugin-id"`. Slots are managed in `src/plugins/loader.ts` (~line 455–701). When a slot is claimed, memory-core is automatically disabled.

---

## Current Status (2026-03-18)

**The plugin is functional without any upstream PRs.** The `before_prompt_build` hook with `prependContext` provides a viable workaround for injecting memory instructions and auto-recalled memories into the agent context. The four memory tools (`memory_store`, `memory_search`, `memory_get`, `memory_feedback`) are registered via the standard `registerTool` API.

**What the upstream PRs would improve:**
- **A1** (#40126): Cleaner system prompt integration (dedicated section instead of prepended context)
- **A3** (#40781): Session transcript capture after compaction (enables automatic memory extraction from conversations)

**Workaround details:** Instead of using `registerMemoryPromptSection()` (A1) for the system prompt, we use the existing `before_prompt_build` hook to return `{ prependContext: ... }` with memory usage instructions and auto-recalled memories. This works today without any upstream changes. The tradeoff is less precise placement in the system prompt, but functionally equivalent.

---

## Priority 1: Desirable Improvements

### A1. Pluggable `buildMemorySection()`

> **PR:** openclaw/openclaw#40126 — `feat(memory): pluggable system prompt section for memory plugins`

**File:** `src/agents/system-prompt.ts` – `buildMemorySection()` line 37, called at line 401.

**Problem:** The system prompt's "Memory Recall" section is hardcoded to instruct the agent to use `memory_search`/`memory_get` in a specific way. When a different memory plugin is active, these instructions are misleading.

**Implemented solution:** New plugin API method `registerMemoryPromptSection(builder)` that lets the active memory plugin register its own system prompt section. `buildMemorySection()` delegates to the registered callback. Scoped to `kind: "memory"` plugins. When no builder is registered, the section is omitted.

**CI status:** `check` (type-check) failing — needs rebase onto latest main.

**Workaround:** `before_prompt_build` + `prependContext` (already implemented in the plugin).

### A3. `sessionFile` in `after_compaction` hook

> **PR:** openclaw/openclaw#40781 — being actively worked on by @jalehman (maintainer)

**File:** `src/agents/pi-embedded-subscribe.handlers.compaction.ts`, `runAfterCompaction` call at line 73.

**Problem:** Auto-compaction doesn't send the `sessionFile` field in the `after_compaction` hook, even though it's available in context and the type allows it. Manual compaction sends it.

**Change:**
```diff
hookRunnerEnd.runAfterCompaction(
  {
    messageCount: ctx.params.session.messages?.length ?? 0,
    compactedCount: ctx.getCompactionCount(),
+   sessionFile: ctx.params.session.sessionFile,
  },
- {},
+ { sessionKey: ctx.params.sessionKey },
)
```

**CI status:** @jalehman rebased and pushed 2026-03-13. Multiple CI failures after rebase — likely being addressed by the maintainer.

---

## Priority 2: Bug Fix (Independent)

### A5. Unicode support for MMR and FTS tokenizers

> **PR:** openclaw/openclaw#38945 — `fix(memory): Unicode support for MMR and FTS tokenizers`

**File:** `src/memory/mmr.ts`, line 33

**Problem:** Tokenizer uses `/[a-z0-9_]+/g` which drops all non-ASCII characters. Non-English words fail to tokenize. The same codebase's `buildFtsQuery` (`src/memory/hybrid.ts`) already uses Unicode-aware `/[\p{L}\p{N}_]+/gu`.

**Implemented fix:** Both tokenizers updated to `/[\p{L}\p{M}\p{N}_]+/gu` + `.normalize("NFC")`. 30 tests covering Finnish, French, Chinese, Japanese, Korean, Russian, Arabic, Hebrew, Thai, Hindi, and NFC normalization.

**CI status:** `check` (type-check) failing — needs rebase.

---

## Priority 3: Architectural Changes

### A4. Conditional session-memory hook — Paused

**File:** `src/hooks/bundled/session-memory/handler.ts`

**Problem:** The bundled `session-memory` hook writes session transcripts to `memory/YYYY-MM-DD-<slug>.md`. This is independent of the memory plugin, causing duplicates when another memory plugin is active.

**Status:** Not an MVP blocker. The markdown files are harmless when another memory plugin is active — nobody queries them since memory-core's tools are disabled. Requires design discussion. Parked.

### A6. Embedding provider access for plugins

**Problem:** Plugin needs access to embedding infrastructure for its own memory objects. Current API hides the infrastructure.

**Status:** Not an MVP blocker. V1 uses its own OpenAI embedding calls via `fetch()` directly. A6 would allow sharing the host's embedding provider/cache, which is a V2 optimization.

### A7. Memory layout manifest

**Problem:** Nothing indicates which memory model a workspace uses. If the agent opens a workspace with associative memory data, memory-core would blindly try to index it.

**Status:** Not critical. The exclusive memory slot mechanism means memory-core is disabled when the associative memory plugin is active. `.layout.json` is useful for diagnostics but not required.

---

## Priority 4: Long-term

### A2. ExtensionFactory registration for plugins

**Problem:** The pi-coding-agent Extension API (`context` event, `session_before_compact` event) is not accessible to plugins.

**Status:** Not needed for V1. The `before_prompt_build` + `prependContext` workaround is sufficient. The new Context Engine abstraction (`src/context-engine/`) may make A2 unnecessary — if a plugin could register as both a memory slot and a context engine slot, A2's goals would be covered. This is a V2 decision.

---

## PR Status (2026-03-18)

| PR | Subject | Change | State | CI | Notes |
|---|---|---|---|---|---|
| #40781 | sessionFile after_compaction | A3 | Open | `check` + tests failing | Maintainer (@jalehman) actively working on it |
| #40126 | Pluggable memory prompt | A1 | Open | `check` failing | Needs rebase; **workaround in place** |
| #38945 | Unicode MMR/FTS tokenizer | A5 | Open | `check` failing | Needs rebase |
| #38724 | Docs: AGENTS.md reference | — | Open | `secrets` failing | Trivial, awaiting review |

**Key observations:**
- None of the PRs are blockers for testing the plugin — workarounds are in place
- `check` (type-check) fails on #40781, #40126, #38945 — upstream has evolved since these were submitted
- No human approvals on any PR yet
- @jalehman is actively working on #40781, which is the most valuable PR (enables session capture in Phase 3)

## Recommended PR Order

1. **A3** (#40781) — maintainer is driving this; wait for their next push
2. **A5** (#38945) — independent bug fix, rebase when convenient
3. **A1** (#40126) — nice-to-have, workaround already works
4. **A4, A6, A7** — deferred, not needed for V1
5. **A2** — long-term, may be superseded by Context Engine

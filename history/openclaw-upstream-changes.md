# OpenClaw Upstream Changes for the Associative Memory Plugin

> Last updated: 2026-03-27
> Architecture: Context engine + memory slot (see `plan-context-engine-architecture-v2.md`)

---

## Merged (included in v2026.3.24)

### A1. Pluggable `buildMemorySection()` — PR #40126

`registerMemoryPromptSection(builder)` lets our plugin provide custom system prompt instructions. **In use** — our plugin registers a builder that describes the four memory tools.

### A5. Unicode MMR/FTS tokenizer — PR #38945

Upstream's memory-core tokenizers now use Unicode-aware regex. This fix benefits users of memory-core; our plugin uses its own retrieval pipeline so the impact is indirect.

---

## No Longer Needed

### A3. `sessionFile` in `after_compaction` — PR #40781 (open, but no longer a dependency)

Originally needed for session capture via the `after_compaction` hook. With the context engine architecture, `afterTurn()` and `compact()` provide the same capability natively. PR #40781 is still being worked on by @jalehman but is no longer on our critical path.

### A2. ExtensionFactory registration for plugins

Superseded entirely by the context engine slot. `assemble()`, `afterTurn()`, `maintain()`, and `compact()` cover all use cases that A2 would have addressed.

### A7. Memory layout manifest

Implemented locally in the plugin (`.layout.json` + SQLite state table). No upstream change needed.

---

## Still Relevant (Low Priority)

### A4. Conditional session-memory hook — Paused

**Problem:** The bundled `session-memory` hook writes session transcripts to `memory/YYYY-MM-DD-<slug>.md` even when our plugin is active. These files are harmless (nobody queries them since memory-core's tools are disabled) but wasteful.

**Status:** Not a blocker. Parked.

### A6. Embedding provider access for plugins

**Problem:** Our plugin calls the OpenAI embedding API directly via `fetch()`. If OpenClaw exposed its embedding infrastructure to plugins, we could share provider config, caching, and rate-limiting.

**Status:** Nice-to-have optimization. V1 works without it. The circuit breaker in our plugin handles provider failures independently.

---

## PR Status

| PR     | Subject                           | State      | Relevance to us                                 |
| ------ | --------------------------------- | ---------- | ----------------------------------------------- |
| #40126 | Pluggable memory prompt (A1)      | **Merged** | In use                                          |
| #38945 | Unicode tokenizer (A5)            | **Merged** | Indirect benefit                                |
| #40781 | sessionFile after_compaction (A3) | Open       | No longer needed — context engine replaces this |
| #38724 | Docs: AGENTS.md reference         | Open       | Trivial, no impact                              |

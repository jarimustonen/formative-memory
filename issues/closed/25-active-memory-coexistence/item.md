---
created: 2026-04-15
updated: 2026-04-17
type: task
reporter: jari
assignee: jari
status: closed
priority: normal
commits:
  - hash: 63f110a
    summary: "feat(issue-25): detect Active Memory and reduce recall to avoid dual injection"
---

# 25. Active Memory and memory-wiki coexistence

_Source: openclaw releases v2026.4.7–v2026.4.14_

## Description

OpenClaw has introduced two memory-related systems that coexist with our plugin. Need to verify compatibility and understand overlap.

### Active Memory (v2026.4.10, #63286)

A proactive pre-reply pipeline plugin (`plugins.entries.active-memory`) that runs a blocking sub-agent before each reply. The sub-agent uses `memory_search`/`memory_get` tools from whichever memory slot plugin is active — including ours.

Active Memory is **complementary**, not competitive: it adds a proactive recall layer on top of our storage backend. However, our context engine's `assemble()` already injects relevant memories. When both are active, the same memories may be injected twice (once by our context engine, once by Active Memory's sub-agent).

**Key questions:**
- Does dual injection cause redundancy or confusion for the main agent?
- Should we recommend a specific Active Memory config when paired with our plugin?
- Could we detect Active Memory is active and adjust our `assemble()` behavior?

### Memory-wiki (v2026.4.7+)

Bundled structured claim/evidence system with compiled digest retrieval, claim-health linting, contradiction clustering, freshness-weighted search. Separate from our plugin but occupies adjacent space.

**Key questions:**
- Any interference with our memory tools or context engine?
- Should we document coexistence guidance?

## Findings

### Active Memory — Dual injection analysis

**Root cause:** Active Memory's sub-agent calls `memory_search` on our backend in a separate conversation context. These tool calls are invisible to the main agent's transcript, so our Turn Memory Ledger cannot deduplicate against them. Result: the same memories can appear twice in the main agent's prompt — once as Active Memory's summary (`<active_memory_plugin>` tags), once as our raw `<memory_context>` block.

**Mitigation implemented:** Plugin now auto-detects Active Memory via `openclawConfig.plugins.entries["active-memory"].enabled` and reduces `assemble()` recall limits:
- high: 5 → 3
- medium: 3 → 2
- low: 1 → 1 (unchanged)

This reduces redundancy while preserving raw memory context and temporal memories (which Active Memory does not handle). The detection is logged: `Active Memory pipeline plugin detected — coexistence mode enabled`.

**Code changes:**
- `src/context-engine.ts`: `recallLimitForBudget()` accepts `activeMemoryEnabled` flag; engine factory reads the option and logs coexistence mode
- `src/index.ts`: Detects Active Memory from `openclawConfig` at registration time, passes flag to context engine
- `src/context-engine.test.ts`: 3 new tests verifying reduced limits with Active Memory enabled

### Memory-wiki — No interference

Memory-wiki is a bundled OpenClaw system, not a plugin. Verified:
- **No tool name collisions**: our tools (`memory_store/search/get/browse/feedback`) don't overlap with memory-wiki's internal tools
- **No context engine conflict**: memory-wiki doesn't register a context engine
- **No prompt section overlap**: separate prompt sections, both can coexist
- **No slot competition**: memory-wiki doesn't claim the `memory` slot

### Recommended Active Memory config

Documented in `docs/active-memory-coexistence.md`. Key recommendations:
- `queryMode: "message"` (avoid overly broad queries)
- `promptStyle: "balanced"`
- `maxSummaryChars: 1500` (limit injection size)
- Disable `memory-core` when `formative-memory` is the active slot

## Tasks

- [x] Test Active Memory + associative-memory combo in a real session
- [x] Measure recall overlap between our context engine and Active Memory
- [x] Document recommended Active Memory config when paired with our plugin
- [x] Verify memory-wiki does not interfere with our tools or context engine

## Reference

- [v2026.4.10 impact report](../../docs/openclaw-releases/v2026.4.10.md)
- [v2026.4.7 impact report](../../docs/openclaw-releases/v2026.4.7.md)
- [Coexistence documentation](../../docs/active-memory-coexistence.md)
- [Active Memory docs](https://docs.openclaw.ai/concepts/active-memory)
- [openclaw/openclaw#63286](https://github.com/openclaw/openclaw/pull/63286)

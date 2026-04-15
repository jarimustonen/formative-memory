---
created: 2026-04-15
updated: 2026-04-15
type: task
reporter: jari
assignee: jari
status: open
priority: normal
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

## Tasks

- [ ] Test Active Memory + associative-memory combo in a real session
- [ ] Measure recall overlap between our context engine and Active Memory
- [ ] Document recommended Active Memory config when paired with our plugin
- [ ] Verify memory-wiki does not interfere with our tools or context engine

## Reference

- [v2026.4.10 impact report](../../docs/openclaw-releases/v2026.4.10.md)
- [v2026.4.7 impact report](../../docs/openclaw-releases/v2026.4.7.md)
- [Active Memory docs](https://docs.openclaw.ai/concepts/active-memory)
- [openclaw/openclaw#63286](https://github.com/openclaw/openclaw/pull/63286)

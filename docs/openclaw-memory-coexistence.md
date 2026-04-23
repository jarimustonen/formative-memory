---
title: Formative Memory & OpenClaw Memory Systems
summary: How Formative Memory compares to and coexists with OpenClaw's built-in memory features (memory-core, Active Memory, Memory-wiki).
read_when:
  - You are deciding whether to use Formative Memory alongside OpenClaw built-in memory features
  - You need to configure coexistence with Active Memory or Memory-wiki
  - You are debugging dual injection or memory overlap issues
  - You want to understand which OpenClaw SDK features are used vs ignored
---

# Formative Memory & OpenClaw Memory Systems

This document covers how Formative Memory relates to OpenClaw's built-in memory features: how it compares to memory-core, how it coexists with Active Memory and Memory-wiki, and which SDK features it adopts or ignores.

## Comparison with memory-core

Both solve the same core problem — giving AI agents persistent memory across sessions — but with different approaches.

| | OpenClaw memory-core | Formative Memory |
|---|---|---|
| **Storage** | MEMORY.md + daily diary files + SQLite index | Content-addressed objects (SHA-256) in SQLite |
| **Retrieval** | Hybrid search (embedding + BM25), temporal decay | Hybrid search (embedding + BM25), strength-weighted |
| **Prioritization** | Recency-based (temporal decay, 30-day half-life) | Use-based reinforcement (retrieval strengthens memories) |
| **Duplicate handling** | MMR re-ranking at retrieval time | Prevented at write time (content-addressing) + merged during consolidation |
| **Contradiction resolution** | Not handled — both versions coexist | LLM-assisted merging during consolidation |
| **Associations** | None — memories are independent | Weighted bidirectional links via co-retrieval tracking |
| **Maintenance** | Manual curation or truncation at ~20KB | Automatic consolidation (decay, prune, merge) |
| **Scalability** | Quality can degrade as volume grows | Self-maintaining — consolidation keeps signal-to-noise ratio stable |
| **Context budget** | Soft cap with truncation | Token-budget-aware recall with strength-based selection |

### Retrieval ranking

Both systems use hybrid search combining semantic similarity and keyword matching. The key difference is in ranking:

- **memory-core**: `score = relevance × temporal_decay(age)`
- **Formative Memory**: `score = relevance × strength`, where strength increases with use and decreases without it

This means memory-core favors recent memories, while Formative Memory favors *used* memories — a memory from three months ago that gets retrieved regularly will rank higher than a memory from yesterday that was never accessed again.

### Memory lifecycle

In memory-core, memories are static once written. They fade from relevance through temporal decay but don't change or consolidate.

In Formative Memory, memories have a lifecycle:
1. **Created** as working memory (faster decay)
2. **Strengthened** through retrieval and positive feedback
3. **Associated** with co-retrieved memories
4. **Consolidated** — similar memories merged into coherent summaries
5. **Pruned** when strength falls below threshold

### When to use which

**memory-core** works well when:
- Memory volume stays small (under a few hundred entries)
- You prefer direct file editing and full manual control
- Simplicity and transparency are the priority

**Formative Memory** is designed for cases where:
- Memory accumulates over weeks/months of active use
- You want the system to maintain itself without manual curation
- Connections between memories matter (e.g., related decisions, linked preferences)
- Important patterns should surface regardless of when they were stored

## Coexistence with Active Memory

Active Memory (`plugins.entries.active-memory`) is an OpenClaw built-in proactive pre-reply pipeline plugin that runs its own sub-agent before each main response. The sub-agent uses `memory_search` and `memory_get` tools from whichever memory slot plugin is active — including ours.

### Data flow

1. Active Memory's sub-agent calls our `memory_search` → receives memories
2. Sub-agent summarizes results → injects via `<active_memory_plugin>` tags into the main prompt
3. Our `assemble()` runs separately → recalls memories via `manager.recall()` → injects via `systemPromptAddition`
4. The main agent sees **both** injections

### Dual injection problem

Without mitigation, the same memory can appear twice:
- Once in Active Memory's summary (short, paraphrased)
- Once in our `<memory_context>` block (full content)

The Turn Memory Ledger cannot deduplicate because Active Memory's sub-agent tool calls are invisible to the main agent's transcript.

### Automatic mitigation

The plugin detects Active Memory automatically via `openclawConfig.plugins.entries["active-memory"].enabled` and reduces `assemble()` recall limits:

| Budget level | Normal limit | Active Memory limit |
|--------------|-------------|---------------------|
| high         | 8           | 5                   |
| medium       | 5           | 3                   |
| low          | 2           | 1                   |

This reduces redundancy while preserving raw memory context, especially temporal memories that Active Memory does not handle.

### Recommended configuration

We recommend disabling Active Memory when using this plugin (see README). If you choose to keep it enabled:

```json
{
  "plugins": {
    "entries": {
      "active-memory": {
        "enabled": true,
        "config": {
          "queryMode": "message",
          "promptStyle": "balanced",
          "maxSummaryChars": 1500
        }
      },
      "formative-memory": {
        "enabled": true
      },
      "memory-core": {
        "enabled": false
      }
    },
    "slots": {
      "memory": "formative-memory"
    }
  }
}
```

**Notes:**
- `queryMode: "message"` is recommended — `"full"` can produce overly broad queries
- `promptStyle: "balanced"` works well alongside this plugin
- `maxSummaryChars: 1500` limits the size of Active Memory's injections
- `memory-core` must be disabled when `formative-memory` is the active slot

### Debugging

Use `/verbose on` and `/trace on` to see both injections:
- Active Memory injections appear inside `<active_memory_plugin>` tags
- Our injections appear inside `<memory_context>` tags
- Log line: `assemble: recalled=N temporal=N budget=X activeMemory=true cache=miss`

## Coexistence with Memory-wiki

Memory-wiki is an OpenClaw built-in system (claim/evidence, digest retrieval, contradiction clustering). It **does not compete** with this plugin:

| | Formative Memory | Memory-wiki |
|---|---|---|
| Type | Plugin (memory slot) | Bundled (built-in) |
| Tools | `memory_store/search/get/browse/feedback` | Own internal tools |
| Context engine | `associative-memory` | Does not register a context engine |
| Storage | SQLite, embeddings, associations | Own files, compiled digests |

**No interference:** No tool name collisions, no context engine conflicts, no prompt section overlap. Both can be active simultaneously.

Memory-wiki can be left at its default settings. It complements this plugin by providing structured information (claims, evidence) while this plugin handles episodic and associative memory.

## OpenClaw SDK features

OpenClaw's plugin SDK includes interfaces designed around its own file-based memory system. Some are irrelevant to Formative Memory.

### Ignored features

**citationsMode** — `assemble()` receives `citationsMode?: "auto" | "on" | "off"`. Memory-core uses this to control `Source: <path#line>` citations. Ignored because our memories are objects, not files — there are no file paths to cite.

**promptCache telemetry** — `afterTurn()` and `compact()` receive `runtimeContext.promptCache` data. Observed for debug logging but not acted upon. Our assemble cache already produces a stable `systemPromptAddition` for the same transcript, which is the best way to preserve API cache hits.

**Compaction provider registry** — `registerCompactionProvider()` allows custom compaction logic. We delegate compaction to the runtime, so this does not apply.

### Adopted features

**availableTools** — `assemble()` receives `availableTools?: Set<string>`. Used by `registerMemoryPromptSection` to tailor system prompt guidance based on which memory tools are available to the agent.

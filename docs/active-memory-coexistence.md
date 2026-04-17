# Active Memory & Memory-wiki — Coexistence

## Active Memory (OpenClaw built-in)

### How it works together

Active Memory (`plugins.entries.active-memory`) is an OpenClaw built-in proactive pre-reply pipeline plugin that runs its own sub-agent before each main response. The sub-agent uses `memory_search` and `memory_get` tools from whichever memory slot plugin is active — including ours.

**Data flow:**
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
| high         | 5           | 3                   |
| medium       | 3           | 2                   |
| low          | 1           | 1                   |

This reduces redundancy while preserving raw memory context, especially temporal memories that Active Memory does not handle.

### Recommended configuration

We recommend disabling Active Memory when using this plugin (see README). If you choose to keep it enabled, use this configuration:

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

## Memory-wiki (bundled)

### Coexistence

Memory-wiki is an OpenClaw built-in system (claim/evidence, digest retrieval, contradiction clustering). It **does not compete** with this plugin:

| | Formative Memory | Memory-wiki |
|---|---|---|
| Type | Plugin (memory slot) | Bundled (built-in) |
| Tools | `memory_store/search/get/browse/feedback` | Own internal tools |
| Context engine | `associative-memory` | Does not register a context engine |
| Storage | SQLite, embeddings, associations | Own files, compiled digests |

**No interference:** No tool name collisions, no context engine conflicts, no prompt section overlap. Both can be active simultaneously.

### Recommendation

Memory-wiki can be left at its default settings. It complements this plugin by providing structured information (claims, evidence) while this plugin handles episodic and associative memory.

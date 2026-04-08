# Formative Memory

**Long-term memory for OpenClaw that strengthens with use, fades with neglect, and consolidates during explicit sleep cycles.**

Formative Memory replaces flat-file memory with content-addressed memory objects stored in SQLite, retrieved through hybrid semantic + keyword search, and linked through weighted associations. It gives your AI coding agent a memory system that evolves over time instead of accumulating stale notes forever.

> **Package name:** `openclaw-associative-memory` · **Requires:** OpenClaw ≥ 2026.4.5

---

## Why not flat memory?

|                 | Flat-file memory        | Formative Memory                                      |
|-----------------|-------------------------|-------------------------------------------------------|
| **Structure**   | Append-only text file   | Content-addressed memory objects with associations    |
| **Relevance**   | Everything is equal     | Strength-weighted: used memories surface, unused decay |
| **Duplicates**  | Accumulate forever      | Prevented at creation, merged during consolidation    |
| **Stale info**  | Stays forever           | Updated or pruned during sleep cycles                 |
| **Connections** | None                    | Weighted bidirectional associations                   |
| **Maintenance** | Manual pruning          | Automatic via consolidation                           |

## Quick start

### 1. Install the plugin

```bash
# In your OpenClaw extensions directory
npm install openclaw-associative-memory
```

### 2. Register the extension

Add to your OpenClaw configuration (`openclaw.json`):

```json
{
  "extensions": ["openclaw-associative-memory"]
}
```

### 3. Start using it

The plugin works automatically once installed:

- **Auto-recall** surfaces relevant memories before every agent response
- **Agent tools** let the agent store, search, and rate memories explicitly
- **`/memory-sleep`** runs consolidation when you're ready

No additional configuration needed — sensible defaults are built in.

### Optional configuration

```json
{
  "extensions": ["openclaw-associative-memory"],
  "memory-associative": {
    "autoRecall": true,
    "autoCapture": true,
    "embedding": {
      "provider": "auto"
    }
  }
}
```

The `embedding.provider` defaults to `"auto"`, which selects the best available provider from your configured API keys.

## How it works

> **Mental model:** Formative Memory stores facts as durable memory objects. Retrieval is hybrid search weighted by strength. Usage is logged during chat. Consolidation later reinforces useful memories, decays neglected ones, updates associations, and prunes or merges as needed.

### During normal chat

The plugin records but does not mutate memory state:

- **Store** new memories via agent tool calls
- **Recall** relevant memories automatically (token-budget-aware) or via `memory_search`
- **Rate** memories via `memory_feedback` (1–5 usefulness score)
- **Log** which memories were shown and how they influenced responses

### During consolidation (`/memory-sleep`)

All memory maintenance happens in a single explicit batch pass:

| Step | What happens |
|------|-------------|
| **Reinforce** | Memories that influenced responses gain strength |
| **Decay** | All strengths decrease; working memory decays faster than consolidated |
| **Associate** | Co-retrieved memories form or strengthen weighted links |
| **Temporal shift** | Future memories become present or past based on anchor dates |
| **Prune** | Very weak memories and associations are deleted |
| **Merge** | Similar memories are identified and combined (LLM-assisted) |
| **Promote** | Surviving working memories become consolidated (strength resets to 1.0) |
| **Cleanup** | Old exposure records are garbage collected |

This separation is deliberate: live chat stays fast and predictable; maintenance is inspectable and explicit.

## Key features

**Automatic recall** — Before every response, the context engine searches for relevant memories and injects them into the agent's context. The number of recalled memories adapts to the remaining token budget: more when space is plentiful, fewer when the context is tight.

**Hybrid search** — Combines embedding similarity (semantic) and BM25 full-text search (keyword), weighted by memory strength. Falls back to keyword-only if the embedding provider is unavailable.

**Content-addressed identity** — Each memory's ID is derived from its content (SHA-256). Same content always produces the same identity, preventing exact duplicates at creation time.

**Weighted associations** — Memories that appear together in the same conversation turn form bidirectional links. These associations are currently used during consolidation (for merge candidate identification), not for retrieval ranking.

**Temporal awareness** — Memories can carry a time anchor and track whether they refer to the future, present, or past. Temporal transitions happen during consolidation.

**Provenance tracking** — The system records which memories were shown to the model (exposure) and how they influenced responses (attribution). Attribution history survives memory deletion and merging.

## Architecture

```
OpenClaw Runtime
    │
    ├── Context Engine (auto-recall)
    │       └── MemoryManager.recall() → hybrid search → ranked results
    │
    ├── Memory Tools (agent-initiated)
    │       ├── memory_store    — save a new memory
    │       ├── memory_search   — find by keyword or meaning
    │       ├── memory_get      — retrieve by ID
    │       └── memory_feedback — rate usefulness (1–5)
    │
    └── /memory-sleep (user-initiated consolidation)
            └── 8-step batch process
```

**Storage:** SQLite with FTS5 (full-text search) and sqlite-vec (vector similarity). Single file, no external services required.

**Embedding:** Supports OpenAI, Gemini, and local providers. Auto-detection from configured API keys. Degrades gracefully to keyword-only search.

**Consolidation LLM:** Uses Anthropic (Claude Haiku) or OpenAI (GPT-4o-mini) for memory merging. Requires an API key in `auth-profiles.json`.

## Trust model

Automatically recalled memories are framed as reference data, not instructions. This reduces prompt injection risk from stored memory content, but memory remains untrusted input — the framing is probabilistic, not a hard security boundary.

Do not store secrets (API keys, passwords) in memories. They will be surfaced to the model during recall.

## Current limitations

- **Blocking consolidation** — `/memory-sleep` is synchronous. Run it between sessions, not during active work.
- **Associations don't drive retrieval** — Association weights are recorded and used during consolidation (merge identification), but do not currently affect search ranking.
- **Embedding dependency** — Semantic search requires an external embedding provider. Keyword-only fallback works but reduces recall quality.
- **Parameter tuning** — Decay rates, pruning thresholds, and search weights are subject to ongoing tuning.

## CLI tool

A standalone diagnostic CLI operates directly on the SQLite database (no OpenClaw runtime needed):

```bash
memory stats <memory-dir>       # Overview of memory database
memory list <memory-dir>        # List memories (filterable)
memory inspect <memory-dir> <id> # Detailed view of a single memory
memory search <memory-dir> <q>  # Search memories by content
memory export <memory-dir>      # Export database to JSON
```

## Docs

- [How Associative Memory Works](docs/how-memory-works.md) — conceptual guide
- [Architecture](docs/architecture.md) — storage, retrieval, provenance, consolidation details
- [Glossary](docs/glossary.md) — terminology reference

## Biological inspiration

The memory model draws from neuroscience, but with explicit, inspectable mechanics:

| Biological concept | Implementation |
|--------------------|---------------|
| Strengthening through recall | Attribution-driven reinforcement during consolidation |
| Forgetting through neglect | Exponential strength decay and threshold pruning |
| Association formation | Co-retrieval logging and weighted bidirectional links |
| Sleep consolidation | Explicit synchronous maintenance pipeline |
| Working → long-term memory | Promotion with strength reset after surviving consolidation |
| Temporal memory | Anchor-based future/present/past state transitions |

These are engineering decisions inspired by biology, not a simulation of it.

## Roadmap

- [x] OpenClaw plugin with full memory lifecycle
- [ ] Association-boosted retrieval (use graph structure during search)
- [ ] Async / non-blocking consolidation
- [ ] Adapters for other AI coding agents (Roo, Aider, OpenCode)
- [ ] Visual memory graph explorer
- [ ] Generic memory SDK for any AI agent

## Contributing

Contributions welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup.

Areas where help is especially useful:
- Consolidation algorithm tuning and evaluation
- Embedding model benchmarks
- Adapters for other AI coding agents

## License

MIT

# Formative Memory

**Memory that forgets, so it remembers better what matters. It forms with you and your needs.**

Formative Memory is an open source memory plugin for [OpenClaw](https://openclaw.ai). Memories form associations, strengthen through use, decay without reinforcement, and consolidate during sleep.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)
![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A522.12-green)
![OpenClaw](https://img.shields.io/badge/OpenClaw-%E2%89%A52026.4.5-purple)

---

## Why

Traditional memory systems treat all information equally and rely on recency to decide what's relevant. Over time, noise accumulates: duplicates pile up, outdated facts coexist with corrections, and important patterns get buried under recent but trivial details. The more you use memory, the harder it becomes to find what matters. You end up teaching the same lessons over and over.

Formative Memory inverts this. Memories that prove useful get stronger. Unused ones fade. Related memories form connections. The system maintains itself through automatic consolidation — no manual curation needed.

## Quick Start

```bash
npm install formative-memory
```

Add to your OpenClaw configuration:

```json
{
  "extensions": ["formative-memory"]
}
```

That's it. The plugin works automatically:

- **Auto-recall** surfaces relevant memories before every response
- **Agent tools** let the agent store, search, and rate memories
- **Consolidation** runs automatically to maintain memory quality

No configuration needed — sensible defaults are built in.

## How It Works

### Store

When your agent learns something, it creates a content-addressed memory object. Same content always produces the same ID — no duplicates by design.

```
Agent: "I'll remember that."
→ memory_store(content: "Project uses Tailwind, not styled-components", type: "preference")
→ id: a3f2c9e1, strength: 1.0, type: preference
```

### Associate

Memories don't exist in isolation. When two memories are retrieved together, they form a weighted bidirectional link. The more often they co-occur, the stronger the connection.

```
"Tailwind preference" ←0.7→ "Tailwind v4 migration"
"Tailwind preference" ←0.4→ "tailwind.config.ts in project root"
"Tailwind v4 migration" ←0.3→ "CSS specificity bug"
```

### Recall

Retrieval combines semantic similarity and keyword matching, weighted by memory strength. Important memories surface first. Every retrieval makes the memory stronger. Every miss lets it fade.

```
Agent thinking: "What CSS framework do we use?"
→ memory_search(query: "CSS framework")
→ 1. "Project uses Tailwind exclusively" (strength: 0.92, score: 0.87)
  2. "Migrated to Tailwind v4 last week"   (strength: 0.71, score: 0.64)
  3. "tailwind.config.ts in project root"   (strength: 0.68, score: 0.51)
```

### Consolidate

A background consolidation process maintains the memory system automatically:

| Step | What happens |
|------|-------------|
| **Reinforce** | Memories that influenced responses gain strength |
| **Decay** | All strengths decrease — working memory fades faster than consolidated |
| **Associate** | Co-retrieved memories form or strengthen links; transitive paths are discovered |
| **Temporal shift** | Future memories transition to present or past based on anchor dates |
| **Prune** | Very weak memories and associations are deleted |
| **Merge** | Similar memories are combined via LLM into coherent summaries |
| **Cleanup** | Old provenance records are garbage collected |

Live chat stays fast and predictable. All mutation happens during consolidation.

## Memory Tools

The plugin registers five tools the agent can use during conversation:

| Tool | What it does |
|------|-------------|
| `memory_store` | Store a new memory with type and optional temporal anchor |
| `memory_search` | Search by meaning and keywords, ranked by relevance × strength |
| `memory_get` | Retrieve a specific memory by ID |
| `memory_feedback` | Rate a memory's usefulness — feeds into reinforcement |
| `memory_browse` | Browse all memories sorted by importance |

Memory types: `fact`, `preference`, `decision`, `plan`, `observation`.

## Configuration

All settings are optional:

```json
{
  "memory-associative": {
    "autoRecall": true,
    "autoCapture": false,
    "embedding": {
      "provider": "auto",
      "model": null
    },
    "dbPath": "~/.openclaw/memory/associative"
  }
}
```

| Key | Default | Description |
|-----|---------|-------------|
| `autoRecall` | `true` | Inject relevant memories into context before every response |
| `autoCapture` | `false` | Automatically capture conversations for consolidation |
| `embedding.provider` | `"auto"` | Embedding provider: `auto`, `openai`, `gemini`, `voyage`, `mistral`, `ollama` |
| `embedding.model` | — | Override the provider's default embedding model |
| `dbPath` | `~/.openclaw/memory/associative` | SQLite database location |

The `"auto"` provider selects the best available embedding provider from your configured API keys. If no provider is available, the plugin degrades gracefully to keyword-only search.

## Architecture

```
OpenClaw Runtime
    │
    ├── Context Engine ─── assemble() → auto-recall into context
    │   (budget-aware)     afterTurn() → log exposures + attributions
    │
    ├── Memory Tools ───── memory_store    — create memory
    │   (agent-initiated)  memory_search   — hybrid search
    │                      memory_get      — lookup by ID
    │                      memory_feedback — rate usefulness
    │                      memory_browse   — browse by importance
    │
    └── Consolidation ──── reinforce → decay → associate → transition
        (automatic)        → prune → merge (LLM) → cleanup
```

**Storage:** SQLite with FTS5 for full-text search. Single file, no external services.

**Embedding:** Auto-detected from configured API keys. Supports OpenAI, Gemini, Voyage, Mistral, Ollama. Circuit breaker with graceful fallback to keyword-only search.

**Consolidation LLM:** Uses Anthropic (Claude) or OpenAI for memory merging. Runs only during consolidation, not during normal chat.

## Trust & Security

Automatically recalled memories are framed as reference data, not instructions. This reduces prompt injection risk from stored memory content, but memory remains untrusted input — the framing is probabilistic, not a hard security boundary.

Do not store secrets (API keys, passwords) in memories. They will be surfaced to the model during recall.

## CLI

A standalone diagnostic CLI operates directly on the SQLite database — no OpenClaw runtime needed:

```bash
memory stats <memory-dir>         # Database overview
memory list <memory-dir>          # List memories (filterable)
memory inspect <memory-dir> <id>  # Detailed view of a single memory
memory search <memory-dir> <q>    # Search by content
memory export <memory-dir>        # Export to JSON
memory history <memory-dir>       # Retrieval history
memory graph <memory-dir>         # Association graph
```

## Roadmap

- [ ] Association-boosted retrieval (graph structure influences search ranking)
- [ ] Memory-type-specific search strategies
- [ ] Visual memory graph explorer
- [ ] Cross-project memory sharing

## Documentation

- [How Associative Memory Works](docs/how-memory-works.md) — conceptual guide
- [Architecture](docs/architecture.md) — storage, retrieval, provenance, consolidation
- [Comparison with OpenClaw built-in memory](docs/comparison-openclaw-memory.md) — technical comparison
- [Glossary](docs/glossary.md) — terminology

## Development

```bash
pnpm install          # Install dependencies
pnpm build            # Build (tsdown)
pnpm test             # Run tests (vitest)
pnpm lint             # Lint (oxlint)
pnpm check            # Full check (format + typecheck + lint)
```

Requires Node.js >= 22.12.0, pnpm 10.x.

## Contributing

Contributions welcome. Areas where help is especially useful:

- Consolidation algorithm tuning and evaluation
- Embedding model benchmarks
- Documentation and examples

## License

[MIT](LICENSE)

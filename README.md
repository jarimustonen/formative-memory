# Formative Memory

**Your AI agent forgets everything. What if it didn't?**

Formative Memory is an open source plugin that gives [OpenClaw](https://openclaw.ai) agents biologically-inspired memory — memories that form associations, strengthen through use, decay without reinforcement, and consolidate during sleep.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)
![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A522.12-green)
![OpenClaw](https://img.shields.io/badge/OpenClaw-%E2%89%A52026.4.5-purple)

---

## The Problem

Every AI coding session starts from scratch. Your agent doesn't remember that you prefer Tailwind over styled-components, that the auth module was refactored last week, or that CI breaks on Node 18.

Flat-file memory is a band-aid: an append-only text file with no structure, no prioritization, no forgetting. Everything is equally important. Nothing is connected. Stale information lives forever. You end up teaching the same lessons over and over.

|                 | Flat-file memory        | Formative Memory                                      |
|-----------------|-------------------------|-------------------------------------------------------|
| **Structure**   | Append-only text file   | Content-addressed memory objects with associations    |
| **Relevance**   | Everything is equal     | Strength-weighted: used memories surface, unused decay |
| **Duplicates**  | Accumulate forever      | Prevented at creation, merged during consolidation    |
| **Stale info**  | Stays forever           | Updated or pruned during sleep cycles                 |
| **Connections** | None                    | Weighted bidirectional associations                   |
| **Maintenance** | Manual pruning          | Automatic via consolidation                           |

## Quick Start

### 1. Install

```bash
npm install openclaw-associative-memory
```

### 2. Register

Add to your OpenClaw configuration:

```json
{
  "extensions": ["openclaw-associative-memory"]
}
```

### 3. Use

That's it. The plugin works automatically:

- **Auto-recall** surfaces relevant memories before every response
- **Agent tools** let the agent store, search, and rate memories
- **`/memory-sleep`** runs consolidation when you're ready

No configuration needed — sensible defaults are built in.

## How It Works

### Store

When your agent learns something, it creates a content-addressed memory object (SHA-256). Typed, timestamped, with stable identity. Same content always produces the same ID — no duplicates.

```
Agent: "I'll remember that."
→ memory_store(content: "Project uses Tailwind, not styled-components", type: "preference")
→ id: a3f2c9e1, strength: 1.0, type: preference
```

### Associate

Memories don't exist in isolation. When two memories appear in the same conversation turn, they form a weighted bidirectional link. The more often they're retrieved together, the stronger the connection — Hebbian learning for AI agents.

```
"Tailwind preference" ←0.7→ "Tailwind v4 migration"
"Tailwind preference" ←0.4→ "tailwind.config.ts in project root"
"Tailwind v4 migration" ←0.3→ "CSS specificity bug"
```

### Consolidate

A background "sleep" process maintains the memory system. Run it explicitly with `/memory-sleep`:

| Step | What happens |
|------|-------------|
| **Reinforce** | Memories that influenced responses gain strength |
| **Decay** | All strengths decrease — working memory fades faster (half-life: 7 cycles) than consolidated (30 cycles) |
| **Associate** | Co-retrieved memories form or strengthen weighted links; transitive paths are discovered |
| **Temporal shift** | Future memories transition to present or past based on anchor dates |
| **Prune** | Very weak memories (strength < 0.05) and associations are deleted |
| **Merge** | Similar memories are identified and combined via LLM into coherent summaries |
| **Cleanup** | Old provenance records are garbage collected |

This separation is deliberate: live chat stays fast and predictable. All mutation happens during inspectable, explicit sleep cycles.

### Recall

Retrieval is hybrid: embedding similarity (semantic) + BM25 full-text search (keyword), weighted by memory strength. Important memories surface first.

```
Agent thinking: "What CSS framework do we use?"
→ memory_search(query: "CSS framework")
→ 1. "Project uses Tailwind exclusively" (strength: 0.92, score: 0.87)
  2. "Migrated to Tailwind v4 last week"   (strength: 0.71, score: 0.64)
  3. "tailwind.config.ts in project root"   (strength: 0.68, score: 0.51)
```

Every retrieval makes the memory stronger. Every miss lets it fade.

## Memory Tools

The plugin registers five tools the agent can use during conversation:

| Tool | What it does |
|------|-------------|
| `memory_store` | Store a new memory with type (`fact`, `preference`, `decision`, `plan`, `observation`) and optional temporal anchor |
| `memory_search` | Search by meaning and keywords, ranked by relevance × strength |
| `memory_get` | Retrieve a specific memory by ID (full SHA-256 or 8-char prefix) |
| `memory_feedback` | Rate a memory's usefulness (1–5) — feeds into consolidation reinforcement |
| `memory_browse` | Browse all memories sorted by importance, with type diversity |

And one user-facing command:

| Command | What it does |
|---------|-------------|
| `/memory-sleep` | Run the full consolidation pipeline |

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
    └── /memory-sleep ──── reinforce → decay → associate → transition
        (user-initiated)   → prune → merge (LLM) → cleanup
```

**Storage:** SQLite with FTS5 for full-text search. Single file, no external services.

**Embedding:** Auto-detected from configured API keys. Supports OpenAI, Gemini, Voyage, Mistral, Ollama. Circuit breaker with 3-second timeout and graceful fallback to BM25-only.

**Consolidation LLM:** Uses Anthropic (Claude) or OpenAI for memory merging. Runs only during `/memory-sleep`, not during normal chat.

## Trust Model

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

## The Biological Metaphor

The memory model draws from neuroscience — but with explicit, inspectable mechanics:

| Human memory | Formative Memory |
|-------------|-----------------|
| Strengthening through recall | Attribution-driven reinforcement during consolidation |
| Forgetting through neglect | Exponential decay (0.906/cycle working, 0.977/cycle consolidated) |
| Association formation | Co-retrieval tracking + weighted bidirectional links |
| Sleep consolidation | Explicit `/memory-sleep` batch pipeline |
| Working → long-term memory | Working → consolidated via merging (strength resets to 1.0) |
| Temporal memory | Anchor-based future/present/past state transitions |
| Pruning | Hard deletion below strength threshold (< 0.05) |

These are engineering decisions inspired by biology, not a simulation of it.

## Limitations

- **Blocking consolidation** — `/memory-sleep` is synchronous. Run it between sessions.
- **Associations don't drive retrieval yet** — Weights are used during merge identification, but don't yet affect search ranking.
- **Embedding dependency** — Semantic search requires an external provider. Keyword-only fallback works but with reduced recall quality.
- **Single workspace** — One database per workspace. Cross-project sharing is on the roadmap.

## Roadmap

### Now: OpenClaw Plugin

- [x] Content-addressed memory storage (SHA-256)
- [x] Weighted bidirectional associations (co-retrieval + transitive)
- [x] 7-step consolidation pipeline with LLM-assisted merging
- [x] Hybrid search: embedding + BM25, strength-weighted
- [x] Retrieval-based reinforcement (Hebbian learning)
- [x] Temporal awareness (future/present/past transitions)
- [x] Token-budget-aware auto-recall
- [x] Provenance tracking (exposure, attribution, retrieval log)
- [x] CLI diagnostic tools
- [x] 700+ test cases

### Next: Deeper Integration

- [ ] Association-boosted retrieval (graph structure during search)
- [ ] Async / non-blocking consolidation
- [ ] Memory-type-specific search strategies

### Future: Multi-Agent

- [ ] Adapters for Roo, Aider, OpenCode, Cline
- [ ] Agent-agnostic core library
- [ ] Visual memory graph explorer
- [ ] Cross-project memory sharing
- [ ] Generic memory SDK for any AI agent

## Documentation

- [How Associative Memory Works](docs/how-memory-works.md) — conceptual guide
- [Architecture](docs/architecture.md) — storage, retrieval, provenance, consolidation
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
- Adapters for other AI coding agents
- Documentation and examples

## License

[MIT](LICENSE)

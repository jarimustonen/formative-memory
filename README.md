# Formative Memory

**Memory that actively forms around what matters.**

Formative Memory is an [OpenClaw](https://openclaw.ai) plugin that gives your agent a self-optimizing memory. It strengthens relevant context through use, weakens unused details, and automatically builds associations between related concepts. In each session, it helps by injecting relevant memories into context before every response. It also evaluates memory quality — each retrieval affects the strength of the memory, so useful ones rise and unused ones fade. Every night, your agent sleeps: a consolidation process prunes and combines memories to keep the quality of recalled context high.

Over time, this combination process builds beyond raw facts into interpretations, nuanced awareness, and deeper understanding.

[![npm version](https://img.shields.io/npm/v/formative-memory)](https://www.npmjs.com/package/formative-memory)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)
![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A522.12-green)

---

## How It Works

### Recall

Before every response, the plugin searches for memories relevant to
the current conversation using hybrid search (embedding similarity +
BM25 full-text), ranked by memory strength. Matching memories are
injected into the agent's context automatically. Each retrieval
strengthens the memories that were surfaced.

```
User: "Do you remember that restaurant? The one by the beach
       last summer. I'm trying to book for our anniversary."

Injected memories:
  [a3f2|fact|strength=0.82]  "Dinner at Maininki, Hanko, July 2024"
  [b7d1|event|2026-07-04]    "Wedding anniversary — 12 years"
  [c9f3|preference|str=0.74] "Sanna loves peonies"
  [d2e6|fact|2026-07-02]     "Sanna: private doctor's appointment"

Agent: "Of course! It was Maininki, in Hanko. Shall I book a table?
        Your 12th anniversary is coming up on July 4th."
```

The agent sees recalled memories as context, not instructions — this
reduces prompt injection risk from stored content.

### Capture

Memories are collected in two ways. The agent can store a memory
explicitly with `memory_store`, and auto-capture extracts durable
facts from conversations automatically after each turn.

```
After the turn above, auto-capture extracts:
→ store("Booking anniversary dinner at Maininki", type: event,
        temporal_anchor: 2026-07-04, temporal_state: future)

A later turn — user asks for Sanna's favorite foods:
Agent explicitly stores:
→ memory_store("Sanna's favorites: salmon soup (her mother's recipe,
   no cream), pistachio ice cream, meat pies from Market Hall
   on Saturdays", type: preference)
→ id: e8b2a1f4, strength: 1.0
```

Each memory is content-addressed (SHA-256) — same content always
produces the same ID, so duplicates are prevented by design.

### Consolidate

Every night, the agent sleeps. A consolidation process runs through
the accumulated memories:

| Step | What happens |
|------|-------------|
| **Reinforce** | Memories that influenced responses gain strength |
| **Decay** | All strengths decrease — recent memories fade faster than established ones |
| **Associate** | Memories retrieved together form links; connections grow stronger with co-occurrence |
| **Temporal shift** | Future memories transition to present or past based on anchor dates |
| **Prune** | Weak memories and associations are removed |
| **Merge** | Similar memories are combined into coherent summaries |

```
Before consolidation:
  [a3f2|strength=0.82] "Dinner at Maininki, Hanko, July 2024"
  [f1c4|strength=0.65] "Maininki — beachfront restaurant, good wine list"
  [a9b3|strength=0.41] "Tried booking Maininki in June, fully booked"

After consolidation:
  [g7e2|strength=1.00] "Maininki, Hanko: beachfront restaurant with good
   wine list. Visited July 2024. Book early — fills up in summer."

  Associations formed:
    "Maininki" ←0.7→ "Wedding anniversary"
    "Maininki" ←0.4→ "Sanna loves peonies"
```

All mutation happens during consolidation — live chat stays fast and
predictable. Over time, simple facts combine into richer structures:
merged summaries, connected associations, and deeper understanding.

## Quick Start

Install the plugin:

```bash
npm install formative-memory
```

Add to your OpenClaw configuration:

```json
{
  "extensions": ["formative-memory"]
}
```

Verify the plugin is loaded:

```bash
openclaw /memory stats
```

That's it. The plugin works automatically:

- **Auto-capture** records conversations for consolidation (enabled by default)
- **Auto-recall** surfaces relevant memories before every response
- **Consolidation** runs automatically to maintain memory quality

No configuration needed — sensible defaults are built in.

## Memory Tools

The plugin registers five tools the agent can use during conversation:

| Tool | What it does |
|------|-------------|
| `memory_store` | Store a new memory with type and optional temporal anchor |
| `memory_search` | Search by meaning and keywords, ranked by relevance x strength |
| `memory_get` | Retrieve a specific memory by ID |
| `memory_feedback` | Rate a memory's usefulness (1-5) — feeds into reinforcement |
| `memory_browse` | Browse all memories sorted by importance, with type diversity |

Memory types: `fact`, `preference`, `decision`, `plan`, `observation`.

## Configuration

All settings are optional — defaults are designed to work out of the box:

```json
{
  "formative-memory": {
    "autoRecall": true,
    "autoCapture": true,
    "requireEmbedding": true,
    "embedding": {
      "provider": "auto",
      "model": null
    },
    "dbPath": "~/.openclaw/memory/associative",
    "verbose": false,
    "logQueries": false
  }
}
```

| Key | Default | Description |
|-----|---------|-------------|
| `autoRecall` | `true` | Inject relevant memories into context before every response |
| `autoCapture` | `true` | Automatically capture conversations for consolidation |
| `requireEmbedding` | `true` | Require a working embedding provider. Set `false` to allow BM25-only fallback |
| `embedding.provider` | `"auto"` | Embedding provider: `auto`, `openai`, `gemini`, `voyage`, `mistral`, `ollama`, `local` |
| `embedding.model` | — | Override the provider's default embedding model |
| `dbPath` | `~/.openclaw/memory/associative` | SQLite database location |
| `verbose` | `false` | Enable debug logging (also via `FORMATIVE_MEMORY_DEBUG=1`) |
| `logQueries` | `false` | Include raw query text in debug logs (disabled by default for privacy) |

The `"auto"` provider selects the best available embedding provider from
your configured API keys. When `requireEmbedding` is `true` (the
default), the plugin will not start without a working embedding provider.
Set it to `false` to allow graceful degradation to keyword-only search.

## Architecture

```
OpenClaw Runtime
    |
    |-- Context Engine --- assemble() -> auto-recall into context
    |   (budget-aware)     afterTurn() -> log exposures + attributions
    |
    |-- Memory Tools ----- memory_store    - create memory
    |   (agent-initiated)  memory_search   - hybrid search
    |                      memory_get      - lookup by ID
    |                      memory_feedback - rate usefulness
    |                      memory_browse   - browse by importance
    |
    +-- Consolidation ---- reinforce -> decay -> associate -> transition
        (automatic)        -> prune -> merge (LLM) -> cleanup
```

**Storage:** SQLite with FTS5 for full-text search. Single file, no
external services.

**Embedding:** Auto-detected from configured API keys. Supports OpenAI,
Gemini, Voyage, Mistral, Ollama. Circuit breaker with graceful fallback
to keyword-only search when `requireEmbedding` is `false`.

**Consolidation LLM:** Uses Anthropic (Claude) or OpenAI for memory
merging. Runs only during consolidation, not during normal chat.

## How Memory Evolves

Memories aren't static records — they change over time:

| What happens | How |
|-------------|-----|
| New memories start in working memory | High initial strength, fast decay |
| Useful memories get consolidated | Moved to long-term storage, strength resets to 1.0 |
| Retrieval makes memories stronger | Every search hit reinforces the result |
| Unused memories fade | Working: 7-cycle half-life. Consolidated: 30-cycle |
| Similar memories merge | LLM combines duplicates into coherent summaries |
| Outdated memories update | Newer information colors older memories |
| Weak memories disappear | Strength below 0.05 = pruned |

## Trust & Security

Automatically recalled memories are framed as reference data, not
instructions. This reduces prompt injection risk from stored memory
content, but memory remains untrusted input — the framing is
probabilistic, not a hard security boundary.

Do not store secrets (API keys, passwords) in memories. They will be
surfaced to the model during recall.

## CLI

A standalone diagnostic CLI operates directly on the SQLite database —
no OpenClaw runtime needed:

```bash
memory stats <memory-dir>         # Database overview
memory list <memory-dir>          # List memories (filterable)
memory inspect <memory-dir> <id>  # Detailed view of a single memory
memory search <memory-dir> <q>    # Search by content
memory export <memory-dir>        # Export to JSON
memory history <memory-dir>       # Retrieval history
memory graph <memory-dir>         # Association graph
```

## Logging

Centralized logging with configurable verbosity. By default only
significant events are logged (info level).

Enable debug logging:

```json
{ "verbose": true }
```

Or via environment variable:

```bash
FORMATIVE_MEMORY_DEBUG=1
```

| Level | What |
|-------|------|
| **info** | Memory stored, memories injected into context, circuit breaker state changes |
| **debug** | Search results, embedding fallback reasons, cache hit/miss, consolidation timing |
| **warn** | Circuit breaker opening (degraded to keyword-only), recall failures |

All log lines are prefixed with `[formative-memory] [level]` for easy
filtering. Query text is never included in logs by default — set
`logQueries: true` to opt in.

## Roadmap

- [x] **Phase 1: OpenClaw plugin** — content-addressed memories,
  associations, consolidation, hybrid search, auto-capture, auto-recall,
  temporal awareness, CLI tools
- [ ] **Phase 2: Multi-agent support** — adapter architecture for Roo,
  Aider, OpenCode, Cline; agent-agnostic core library
- [ ] **Phase 3: Universal memory layer** — generic memory SDK,
  cross-project associations, memory visualization, team sharing

### Near-term

- [ ] Association-boosted retrieval (graph structure influences ranking)
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
- Adapters for other AI coding agents
- Documentation and examples

## License

[MIT](LICENSE)

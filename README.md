# Formative Memory

**Memory plugin for [OpenClaw](https://openclaw.ai) agents.**

Formative Memory is an OpenClaw plugin that gives your agent long-term memory modeled after how biological memory works. Before every response, it recalls relevant memories into context. After every response, it evaluates which memories actually contributed — strengthening useful ones and letting unused ones fade. Every night, the agent sleeps: a consolidation process decays, prunes, merges, and connects memories to keep recalled context high-quality.

Over time, raw facts combine into richer structures: merged summaries, connected associations, and deeper understanding.

[![npm version](https://img.shields.io/npm/v/formative-memory)](https://www.npmjs.com/package/formative-memory)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)
![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A522.12-green)

---

## How It Works

### Recall

Before every response, the plugin searches for memories relevant to
the current conversation using hybrid search (embedding similarity +
BM25 full-text), ranked by memory strength. Strongly-associated
neighbors of the top results are also pulled in through single-hop
association expansion, so related memories surface even when they
don't directly match the query. Matching memories are injected into
the agent's context automatically. Each retrieval strengthens the
memories that were surfaced.

```
User: "Do you remember that restaurant? The one by the beach
       last summer. I'm trying to book for our anniversary."

Injected memories:
  [a3f2|fact|strength=0.82]  "Dinner at Maininki, Hanko, April 2026"
  [b7d1|event|2026-07-04]    "Wedding anniversary — 12 years"
  [c9f3|preference|str=0.74] "Sanna loves peonies"
  [d2e6|fact|2026-07-02]     "Sanna: private doctor's appointment"

Agent: "Of course! It was Maininki, in Hanko. Shall I book a table?
        Your 12th anniversary is coming up on July 4th."
```

The agent sees recalled memories as context, not instructions — this
reduces prompt injection risk from stored content.

### Evaluate

After each response, the plugin tracks which memories were surfaced
and whether they actually influenced the reply. This happens at two
levels:

- **Automatic attribution** — the plugin logs which memories were
  injected and which the model referenced, building a retrieval
  history without any agent effort
- **Explicit feedback** — the agent can call `memory_feedback` to
  rate a memory's usefulness (1–5), signaling quality directly

Both signals feed into consolidation: frequently used, highly rated
memories are reinforced, while memories that are surfaced but never
referenced gradually lose strength. This creates a feedback loop where
the memory system learns what is actually useful, not just what matches
a query.

```
After the agent's response about Maininki:

Automatic attribution (logged by the plugin):
  ✓ [a3f2] "Dinner at Maininki, Hanko"     — referenced in reply
  ✓ [b7d1] "Wedding anniversary — 12 years" — referenced in reply
  · [c9f3] "Sanna loves peonies"            — injected, not used
  · [d2e6] "Sanna: doctor's appointment"    — injected, not used

  → a3f2 and b7d1 are reinforced at next consolidation
  → c9f3 and d2e6 were surfaced but ignored — no reinforcement

Explicit feedback (agent calls memory_feedback):
  → memory_feedback(memory_id: "a3f2", rating: 5)
  → "Directly answered the user's question"
```

### Capture

Memories are collected in two ways. The agent can store a memory
explicitly with `memory_store`, and auto-capture extracts durable
facts from conversations automatically after each turn. Extraction
uses chain-of-thought reasoning — the LLM evaluates each candidate
fact for durability beyond the current task, discarding ephemeral
details like "currently looking for a birthday gift".

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
  [a3f2|strength=0.82] "Dinner at Maininki, Hanko, April 2026"
  [f1c4|strength=0.65] "Maininki — beachfront restaurant, good wine list"
  [a9b3|strength=0.41] "Tried booking Maininki in June, fully booked"

After consolidation:
  [g7e2|strength=1.00] "Maininki, Hanko: beachfront restaurant with good
   wine list. Visited April 2026. Book early — fills up in summer."

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
openclaw plugins install formative-memory
```

This installs from npm, enables the plugin, and assigns it the memory
slot automatically. Restart the gateway to load the plugin.

That's it. The plugin works out of the box:

- **Auto-capture** records conversations for consolidation
- **Auto-recall** surfaces relevant memories before every response
- **Consolidation** runs automatically to maintain memory quality
- **Startup tasks** (migrating existing memory files, scrubbing legacy
  memory instructions from `AGENTS.md`, backfilling embeddings)
  run automatically at gateway boot

No configuration needed — sensible defaults are built in.

> **Security: plugin allowlist.** OpenClaw logs a warning if
> `plugins.allow` is empty — non-bundled plugins auto-load without
> validation. To silence it and restrict loading to trusted plugins,
> add an explicit allowlist in `openclaw.json`:
>
> ```json
> {
>   "plugins": {
>     "allow": ["formative-memory"]
>   }
> }
> ```

> **Multi-agent setups:** API key resolution is delegated to the
> OpenClaw SDK's `resolveApiKeyForProvider`, which handles auth
> profiles, multi-agent resolution, and credential precedence
> internally. The plugin resolves keys lazily — if the runtime
> context (`agentDir`) is not yet available at boot (e.g. during
> heartbeat), resolution defers until the first tool call or service
> start provides it.

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

All settings are optional — defaults are designed to work out of the box.
Configuration goes in `openclaw.json` under the plugin entry:

```json
{
  "plugins": {
    "entries": {
      "formative-memory": {
        "enabled": true,
        "config": {
          "autoRecall": true,
          "autoCapture": true,
          "requireEmbedding": true,
          "embedding": {
            "provider": "auto"
          },
          "consolidation": {
            "notification": "errors",
            "errorNotification": true
          },
          "temporal": {
            "notification": "errors",
            "errorNotification": true
          }
        }
      }
    }
  }
}
```

| Key | Default | Description |
|-----|---------|-------------|
| `autoRecall` | `true` | Inject relevant memories into context before every response |
| `autoCapture` | `true` | Automatically capture conversations for consolidation |
| `requireEmbedding` | `true` | Require a working embedding provider. Set `false` to allow BM25-only fallback |
| `embedding.provider` | `"auto"` | Embedding provider: `auto`, `openai`, `gemini`. Additional providers (`voyage`, `mistral`, `ollama`, `local`) are also accepted when memory-core embedding adapters are installed as a fallback registry |
| `embedding.model` | — | Override the provider's default embedding model. Only takes effect with an explicit `embedding.provider` — ignored in `"auto"` mode to avoid passing a provider-specific model name to the wrong provider |
| `dbPath` | `~/.openclaw/memory/associative` | SQLite database location |
| `verbose` | `false` | Enable debug logging |
| `consolidation.notification` | `"errors"` | Notification after nightly consolidation: `"off"` (silent), `"errors"` (errors only), `"summary"` (LLM-generated), or `"detailed"` (raw technical report) |
| `consolidation.errorNotification` | `true` | Whether to notify on consolidation errors. Set `false` to suppress error messages even when notification level would show them |
| `temporal.notification` | `"errors"` | Notification after temporal transitions (15:00 daily): `"off"`, `"errors"`, `"summary"`, or `"detailed"` |
| `temporal.errorNotification` | `true` | Whether to notify on temporal transition errors. Same behavior as `consolidation.errorNotification` |
| `logQueries` | `false` | Include raw query text in debug logs (disabled by default for privacy) |

The `"auto"` provider selects the best available embedding provider from
your configured API keys. When `requireEmbedding` is `true` (the
default), the plugin will not start without a working embedding provider.
Set it to `false` to allow graceful degradation to keyword-only search.

> **We strongly recommend configuring an OpenAI or Google API key for
> embeddings.** Without embeddings, memory search operates in keyword-only
> (BM25) mode which cannot match paraphrases, synonyms, or typos. For
> example, searching for "shipping date" will not find a memory about
> "release deadline". Embeddings dramatically improve recall quality.

### Salience Profile

A default `salience.md` is created automatically in the memory
directory (default: `~/.openclaw/memory/associative/salience.md`) if
one does not already exist. This file guides both auto-capture
extraction and the agent's `memory_store` decisions — edit it to
match your priorities.

Write it in natural language — describe what kinds of information
matter to you. For example:

```markdown
Pay attention to:
- Family members and relationships
- Health details I share
- Travel plans and locations
- Professional milestones and career goals

Less important:
- What I'm currently shopping for or browsing
- Passing mentions of things I'm not committed to
```

The profile is capped at 4000 characters and treated as preference
guidance only — it cannot override the plugin's extraction rules or
output format.

### API Keys

API key resolution is delegated to the OpenClaw SDK's
`resolveApiKeyForProvider`, which handles auth profiles, env vars,
OAuth, and multi-agent resolution internally. Configure a profile
under the standard OpenClaw setup:

```json
{
  "version": 1,
  "profiles": {
    "openai:default": { "type": "api_key", "key": "sk-..." },
    "google:default": { "type": "api_key", "key": "AIza..." }
  }
}
```

The `openai:default` and `google:default` profile names are picked up
automatically. If you have multiple profiles for the same provider
(e.g. `openai:work` and `openai:personal`), the plugin warns and picks
the first one — add a `:default` profile to select explicitly.

### Provider pinning

The plugin pins the selected provider and model to the database on
first successful resolution. On subsequent runs, the same provider and
model are used regardless of `embedding.provider` in config — this
prevents silent drift that would corrupt the vector store when a
different provider (producing different-dimension vectors) takes over.

If you intentionally want to switch providers or models for an
existing database, you must re-embed all memories via migration.
Attempting to change the configured provider mid-life produces a
clear error at startup rather than silent corruption.

## Disabling Overlapping Memory Features

OpenClaw ships with built-in memory features that overlap with this
plugin. We recommend disabling them to avoid redundant injection and
conflicting memory writes:

```json
{
  "plugins": {
    "entries": {
      "active-memory": { "enabled": false },
      "memory-core": { "enabled": false }
    }
  },
  "hooks": {
    "session-memory": { "enabled": false }
  }
}
```

| Feature | Why disable |
|---------|-------------|
| **Active Memory** | OpenClaw's built-in proactive recall. Runs a sub-agent that queries our `memory_search` before each reply, then injects a summary alongside our own context injection — same memories appear twice. The plugin auto-detects Active Memory and reduces recall limits (8→5, 5→3, 2→1) as mitigation |
| **memory-core** | The built-in file-based memory plugin. Only one memory slot can be active; this plugin replaces it |
| **session-memory** | An internal hook that writes `memory/YYYY-MM-DD.md` files on `/new` and `/reset`. These files are not used by this plugin and create unnecessary disk writes |

If Active Memory is left enabled, the plugin logs a warning at startup
and automatically reduces its own recall limits to minimize redundancy.
Disabling is the cleaner approach.

## Architecture

```
OpenClaw Runtime
    |
    |-- Context Engine --- assemble() -> association-augmented recall
    |   (budget-aware)     afterTurn() -> provenance + auto-capture
    |                      cancelExtractions() -> abort in-flight tasks
    |                      dispose() -> await tasks, reset caches
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

**Embedding:** Standalone fetch-based clients for OpenAI and Gemini
read keys from `auth-profiles.json`. Additional providers (Voyage,
Mistral, Ollama, local) resolve through memory-core's embedding
adapter registry when installed. Circuit breaker with graceful fallback
to keyword-only search when `requireEmbedding` is `false`.

**Consolidation LLM:** Uses Anthropic (Claude) or OpenAI for memory
merging. Runs only during consolidation, not during normal chat.

## Trust & Security

Automatically recalled memories are framed as reference data, not
instructions. This reduces prompt injection risk from stored memory
content, but memory remains untrusted input — the framing is
probabilistic, not a hard security boundary.

Do not store secrets (API keys, passwords) in memories. They will be
surfaced to the model during recall.

## Privacy

This plugin sends conversation text to the LLM and embedding providers
you configure in OpenClaw. Be aware of what leaves your machine:

- **Auto-capture (`autoCapture`, default `true`)** — at the end of each
  agent turn, recent user/assistant text is sent to the configured LLM
  provider for memory extraction.
- **Embeddings** — every stored memory is sent to your configured
  embedding provider (OpenAI / Google / etc.) to produce vectors. New
  recall queries are also embedded.
- **Consolidation (nightly "sleep")** — candidate memory pairs are sent
  to the configured LLM provider to be merged or rephrased.
- **Query logging (`logQueries`, default `false`)** — when enabled,
  raw query text appears in OpenClaw logs.

What stays local: the SQLite database (at `dbPath`, default
`~/.openclaw/memory/associative`), all memory content at rest, and BM25
search indices.

To minimize external exposure:

- Set `autoCapture: false` to require explicit `memory_store` calls.
- Set `requireEmbedding: false` to fall back to BM25-only search and
  avoid sending text to an embedding provider altogether.
- Choose a provider whose data-retention policy you trust, or run a
  local OpenAI-compatible endpoint.
- Keep `logQueries: false` (the default) if logs may be shared.

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

| Level | What |
|-------|------|
| **info** | Memory stored, memories injected into context, circuit breaker state changes |
| **debug** | Search results, embedding fallback reasons, cache hit/miss, consolidation timing |
| **warn** | Circuit breaker opening (degraded to keyword-only), recall failures |

All log lines are prefixed with `[formative-memory] [level]` for easy
filtering. Query text is never included in logs by default — set
`logQueries: true` to opt in.

## Documentation

- [How Formative Memory Works](docs/how-memory-works.md) — conceptual guide
- [Architecture](docs/architecture.md) — storage, retrieval, provenance, consolidation
- [OpenClaw Memory Systems](docs/openclaw-memory-coexistence.md) — comparison and coexistence with built-in memory
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

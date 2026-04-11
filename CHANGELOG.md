# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] — 2026-04-11

Initial release. Feature-complete alpha with full memory lifecycle.

### Added

- **Memory storage** — Content-addressed memory objects (SHA-256) with types (`fact`, `preference`, `decision`, `plan`, `observation`, `narrative`) and temporal awareness (`future`, `present`, `past`)
- **Hybrid search** — Embedding similarity (60%) + BM25 full-text search (40%), weighted by memory strength
- **Weighted associations** — Bidirectional links formed from co-retrieval tracking, with transitive path discovery
- **Consolidation pipeline** — 7-step "sleep" process: reinforcement, decay, association update, temporal transitions, pruning, LLM-assisted merging, provenance GC
- **Context engine** — Token-budget-aware auto-recall via `assemble()`, provenance logging via `afterTurn()`
- **Memory tools** — `memory_store`, `memory_search`, `memory_get`, `memory_feedback`, `memory_browse`
- **`/memory-sleep` command** — Manual consolidation trigger
- **Embedding circuit breaker** — 3-second timeout, 2-failure threshold, jitter cooldown, graceful BM25-only fallback
- **Embedding providers** — Auto-detection from configured API keys (OpenAI, Gemini, Voyage, Mistral, Ollama), direct SDK fallback
- **Memory-core migration** — Automatic import from `memory.md`, `MEMORY.md`, and daily memory files on first tool call
- **Workspace cleanup** — Removes file-based memory instructions from `AGENTS.md`, `SOUL.md` after migration
- **CLI diagnostic tools** — `memory stats`, `list`, `inspect`, `search`, `export`, `history`, `graph`, `import`
- **Provenance tracking** — Exposure records, attribution with confidence scores, retrieval log; attribution survives deletion and merging
- **Runtime schema validation** — Enum guards and numeric integrity checks on database reads
- **Delta-merge optimization** — O(S×T) filtered candidate search instead of O(N²)
- **Catch-up decay** — `pow()`-based multi-cycle decay for missed consolidation runs (cap: 30 cycles)
- **Scheduled consolidation** — Daily full consolidation + 12-hour temporal transition cron
- **Sleep debt warning** — Warning injected in assemble output if >48h since last consolidation
- **Trust model** — Recalled memories framed as reference data, not instructions

### Technical Details

- **Storage**: SQLite with FTS5 full-text search, schema version 4
- **Decay rates**: Working 0.906/cycle (half-life ~7), consolidated 0.977/cycle (half-life ~30)
- **Pruning threshold**: Strength < 0.05 for memories, weight < 0.01 for associations
- **Reinforcement**: η=0.7 learning rate, confidence × mode_weight (1.0 hybrid, 0.5 BM25-only)
- **Requires**: Node.js >= 22.12.0, OpenClaw >= 2026.4.5

[0.1.0]: https://github.com/jmustonen/openclaw-associative-memory/releases/tag/v0.1.0

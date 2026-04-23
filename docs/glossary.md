---
title: Glossary
summary: Plain-language definitions of technical terms used throughout the plugin's documentation and source code.
read_when:
  - You encounter an unfamiliar term in the docs or codebase
  - You want a quick reference for the vocabulary used in this project
  - You are new to the plugin and want to build a shared language
---

# Glossary

This document defines the technical terms that appear throughout Formative Memory's documentation, planning documents, and source code. Each entry explains what the term means in general, then how it applies to this project specifically.

## Association

A weighted, bidirectional link between two memories. Associations form when memories appear together in the same conversation turn (co-retrieval) and strengthen with repeated co-occurrence. They weaken through decay if unused. Associations participate in recall through [association-augmented search](#association-augmented-recall): strongly-linked neighbors of search results are expanded into the candidate pool via single-hop traversal. They are also used during consolidation to identify merge candidates and model the knowledge graph.

## Association-augmented recall

The recall strategy that expands direct search results through association links. After hybrid search produces initial results, the top-scoring memories (seeds) have their strongly-associated neighbors pulled into the candidate pool. All candidates — direct hits and association-expanded — compete in a single pool ranked by score. This allows memories that don't directly match a query to surface when they are strongly linked to relevant results. See [Architecture — Association-augmented recall](./architecture.md#association-augmented-recall).

## Auto-capture

The automatic extraction of durable facts from conversation turns. After each turn, the plugin sends the conversation exchange to an LLM which identifies facts worth remembering long-term. The extraction uses [chain-of-thought reasoning](#chain-of-thought-extraction) to filter out ephemeral details. Auto-capture runs asynchronously and does not block the agent's response.

## Batch

A small group of items processed together. During memory import, the agent receives segments in batches of 3–5 at a time rather than all at once. This keeps the conversation context window manageable and lets the agent focus on a few segments before moving to the next group.

## BM25

A probabilistic information retrieval scoring function used for keyword-based full-text search. In this project, BM25 scoring is provided by SQLite's FTS5 extension. BM25 is one half of the hybrid search pipeline (the other being embedding-based semantic search). When embeddings are unavailable, the system falls back to BM25-only mode. BM25 scores are normalized using an absolute transformation (`score / (1 + score)`) that maps raw FTS5 ranks to a stable [0, 1) range independent of other results in the batch.

## Chain-of-thought extraction

The reasoning process used during [auto-capture](#auto-capture). For each candidate fact, the extraction LLM produces a brief reasoning about whether the fact is durable beyond the current task. Facts explicitly marked as not durable (e.g. "currently looking for a birthday gift") are filtered out before storage. This reduces noise from transient operational context.

## Chunking

Splitting a large text into smaller pieces for indexing. Memory-core uses mechanical chunking: it divides files into fixed-size pieces (400 tokens with 80-token overlap) regardless of content structure. Formative Memory uses semantic units instead — each memory is a coherent, self-contained piece of information whose size depends on the content, not a fixed token budget.

## Consolidation

A batch maintenance process analogous to biological sleep. Normal operation only creates memories and records observations. All strength updates, association changes, pruning, merging, and temporal transitions happen during consolidation, triggered with `/memory sleep`. See [How Memory Works](./how-memory-works.md) for the full consolidation pipeline.

## Content hash (content-addressable identity)

The memory's identity is derived from its content using a SHA-256 hash function. The same text always produces the same identity, which prevents exact duplicates automatically. This also means that changing a memory's content — even a small edit — produces a new identity. Two memories with identical text but different metadata (type, temporal state) are still considered the same memory.

## Decay

The gradual weakening of memory strength over time. Every consolidation cycle reduces all memory strengths by a fixed factor. Recent (working) memories decay faster than established (consolidated) ones. Association weights also decay. Decay models natural forgetting: information that is not reinforced through use eventually fades below the pruning threshold and is deleted. Active use counteracts decay through reinforcement.

## Embedding

A numerical representation of text as a list of numbers (a vector). Texts with similar meaning produce vectors that are close together in mathematical space, which allows the system to find memories by meaning rather than exact word matching. The plugin uses an external embedding service (e.g. OpenAI) to generate these vectors. If the service is unavailable, the system falls back to keyword-only search.

## Enrichment

The process of adding metadata to raw text segments during import. When migrating from memory-core, the agent analyzes each segment and infers its type (fact, decision, preference, etc.), temporal state, and temporal anchor. This transforms flat markdown content into structured memory units.

## Idempotent / idempotency

An operation is idempotent if running it multiple times produces the same result as running it once. The memory import is idempotent because each memory's identity is its content hash: importing the same content again produces the same identity, and the system skips it. This makes accidental re-runs safe.

## Provenance

The origin and history of a piece of information. In general usage (borrowed from the art world), provenance means the documented chain of ownership of a painting or artifact. In this project, provenance has two meanings:

1. **Retrieval provenance** — tracking which memories were shown to the agent (exposure) and which memories influenced responses (attribution). This is implemented and runs during normal operation.

2. **Import provenance** — tracking where an imported memory came from (which file, which section, when it was imported). This is not implemented in the current version but may be added later to support re-import and reconciliation workflows.

## Pruning

Deleting memories or associations that have weakened below a threshold. Pruning happens during consolidation and removes information that has not been reinforced through use. This is the final stage of decay — a memory weakens gradually across multiple consolidation cycles before being pruned.

## Recency boost

A gentle exponential decay factor applied to search scores in BM25-only mode. Recent memories rank higher when lexical relevance is equal. The half-life is approximately 125 days. This boost does not apply in hybrid mode where embeddings already capture contextual relevance.

## Reconciliation

Comparing two data sources and deciding what to do with differences. In the context of memory import, reconciliation would mean comparing the current state of memory-core files against previously imported memories and handling changes: updating modified content, removing deleted content, adding new content. The current version does not implement reconciliation — re-import simply skips existing content and adds new content alongside old versions.

## Segment / segmentation

A segment is a meaningful section of a markdown file, typically delimited by headings. Segmentation is the process of splitting a file into these sections. During import, memory-core files are segmented at heading boundaries (H1/H2/H3) so that each segment can be independently analyzed and stored as one or more memories.

## Salience profile

A user-authored file (`salience.md`) placed in the memory directory that customizes what the plugin pays attention to during memory extraction and storage. The profile is injected into both the auto-capture extraction prompt and the agent's system prompt for `memory_store`. It is treated as preference guidance and cannot override the plugin's extraction rules. Content is capped at 4000 characters with BOM stripping and mtime-based caching.

## Strength

A number between 0 and 1 representing how "alive" a memory is. New memories start at 1.0. Strength decreases through decay and increases through reinforcement (when the memory influences a response). Memories below the pruning threshold are deleted during consolidation. Strength also affects search ranking: stronger memories appear higher in results.

## Temporal state

A memory's relationship to time. Four states:

- **none** — timeless. A fact like "the project uses SQLite" has no time dependency.
- **future** — not yet happened. "Demo scheduled for Friday" is future until Friday.
- **present** — happening now. The demo memory transitions to present on Friday.
- **past** — already happened. After Friday, the demo memory becomes past.

Transitions happen during consolidation based on the memory's temporal anchor (a specific date). Memories without a temporal anchor stay in whatever state they were created with.

## Tombstone / tombstoning

Marking a record as inactive instead of deleting it. Rather than removing a memory from the database (which would break any associations pointing to it), tombstoning would set its strength to zero and exclude it from search results while preserving the data. The current version does not use tombstoning — pruning performs hard deletion.

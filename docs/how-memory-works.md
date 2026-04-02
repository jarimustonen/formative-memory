# How the Memory System Works

> This document describes the memory system's operating principles as implemented.
> It is implementation-independent — it focuses on *what* the system does, not *how* it is coded.

## Biological Inspiration

Human memory is not a database you query for records. It is a dynamic network where memories strengthen through use, weaken through neglect, connect to each other through shared experience, and consolidate during sleep. This system mimics these mechanisms.

## Anatomy of a Memory

Each memory is a self-contained unit with:

- **Content** — free-form text (a fact, a decision, an observation, anything)
- **Identity** — derived from the content (same content = same identity)
- **Strength** — a value between 0 and 1 representing how "alive" the memory is. New memories are born at strength 1.0
- **Type** — a free-form classification (e.g. "fact", "decision", "observation")
- **Temporal state** — the memory's relationship to time:
  - *future*: not yet relevant (e.g. an upcoming deadline)
  - *present*: relevant now
  - *past*: no longer relevant
  - *none*: timeless
- **Source** — how the memory was created (agent tool, consolidation, import)

## Two Channels of Remembering

The system surfaces memories to the agent through two channels:

### 1. Automatic recall

Before every response, the system examines the recent conversation and automatically recalls relevant memories. The agent does not request this — it happens in the background. The number of recalled memories depends on the remaining context budget:

| Situation | Memories |
|-----------|----------|
| Plenty of space | 5 |
| Moderate | 3 |
| Little | 1 (short hint) |
| No space | 0 |

### 2. Agent-initiated

The agent can actively:
- **Store** a new memory
- **Search** memories by keyword or semantic similarity
- **Get** a specific memory by its identifier
- **Give feedback** on a memory's usefulness (scale 1–5)

If the agent has already seen a memory through a tool call, automatic injection skips it. This prevents the same information from appearing twice.

## How Search Works

Search combines two methods:

1. **Semantic search** — measures meaning similarity using vector embeddings (60% weight)
2. **Keyword search** — traditional text matching with the BM25 algorithm (40% weight)

The combined score is multiplied by the memory's strength. Strong memories rank higher, weak ones sink lower.

If semantic search is unavailable, the system falls back to keyword-only search and informs the agent.

## Associations: Links Between Memories

Memories can be linked to each other. Links are bidirectional and weighted (0–1):

- **Co-retrieval:** If two memories are retrieved in the same conversation turn, a link is created or strengthened between them
- **Transitive links:** If A is linked to B and B to C, an indirect link may form between A and C (one hop maximum)
- **Decay:** Unused links weaken over time

Associations do not influence search in V1 — they are structural data used by consolidation.

## Provenance: Traceability

The system tracks memory usage at two levels:

### Exposure: what was offered

Every memory shown to the model is recorded — where it came from (automatic injection, search, get, store), with what score, and in which retrieval mode.

### Attribution: what influenced the response

Memories receive a confidence score based on how they ended up in the response:

| Method | Confidence |
|--------|------------|
| Automatic injection | Low (0.15) |
| Search result | Moderate (0.3) |
| Explicit get | High (0.6) |
| Positive feedback (4–5) | Very high (0.95) |
| Negative feedback (1–2) | Negative (−0.5) |

Attribution is durable — it survives even if the memory is deleted. Explicit feedback always overrides implicit attribution, enabling both promotion (positive feedback boosts) and demotion (negative feedback reduces).

### Cross-turn feedback

Feedback may arrive in a later turn than the original memory use. The system links late feedback to the correct earlier attribution.

## Consolidation: Processing During Sleep

The memory system does not modify memories during normal operation (except for creating new ones). All maintenance happens during consolidation — analogous to biological sleep.

Consolidation is triggered explicitly (`/memory sleep`). It is a synchronous, blocking process.

### What happens during consolidation

```
1. Reinforcement
   Memories that influenced responses (attributions) receive a
   strength boost. Higher confidence → larger boost.

2. Decay
   All memory strengths decrease slightly.
   Recent (working) memories decay faster than
   established (consolidated) ones.
   Association weights also decay.

3. Association updates
   Co-retrieval pairs get a new or strengthened link.
   Transitive links are computed (1 hop).

4. Temporal transitions
   Future memories become present when their anchor date
   has passed. Present memories become past 24 hours
   after their anchor.

5. Pruning
   Very weak memories (strength ≤ 0.05) are deleted.
   Very weak links (weight < 0.01) are deleted.

6. Merging
   Similar memories are identified and merged.
   Merging can produce three outcomes:
   - Absorption: one memory subsumes the other
   - Reuse: content matches an already existing memory
   - New memory: merging produces new content

7. Promotion
   Remaining working memories become consolidated.

8. Provenance cleanup
   Exposure records older than 30 days are deleted.
   Attribution history is preserved permanently.
```

### Memory lifecycle

```
              store
                │
                ▼
            ┌───────-──┐
            │ Working  │ ◄── new memory (strength 1.0)
            │          │
            └────┬─────┘
                 │  consolidation
                 │  (decay, reinforce, merge, prune)
                 ▼
            ┌───────────────┐
            │ Consolidated  │ ◄── established memory
            │               │
            └───────┬───────┘
                    │
          ┌─────────┼──────────┐
          ▼         ▼          ▼
      reinforced  weakened   merged
      (use)       (decay)    (merge)
          │         │          │
          ▼         ▼          ▼
       survives   pruned     new
                             memory
```

## Temporality

Memories can have a time anchor:

- **"Deadline on Friday"** is created in state *future* with an anchor on Friday's date
- When Friday arrives, the memory automatically transitions to *present*
- 24 hours after Friday, the memory transitions to *past*

Temporal transitions happen during consolidation. Timeless memories (state *none*) have no anchor.

## Core Principles

1. **Content is identity.** Same content = same memory. Duplicates are prevented at creation time.

2. **Mutations only during consolidation.** During normal operation, only new memories and append-only log entries are written. All strength updates, associations, pruning, and merging happen during "sleep."

3. **Graceful degradation.** If semantic search is unavailable, the system continues with keyword search only.

4. **Memory content is untrusted data.** Automatically injected memories are framed as data, not instructions. This prevents prompt injection attacks through memory content.

5. **Provenance is durable.** Attribution history survives memory deletion. This enables retrospective analysis of which memories influenced which responses.

6. **Gradual forgetting.** Memories do not disappear suddenly — they weaken across consolidation cycles until they fall below the pruning threshold. Active use reinforces memories and prevents forgetting.

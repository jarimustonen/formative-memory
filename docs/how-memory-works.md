---
title: How Formative Memory Works
summary: Conceptual guide to how the plugin stores, recalls, reinforces, and forgets memories — the mental model you need before using or extending it.
read_when:
  - You want to understand the plugin's behavior before enabling it
  - You need the mental model for memory recall and consolidation
  - You are deciding whether the memory model fits your workflow
---

# How Formative Memory Works

Formative Memory gives an OpenClaw agent persistent, long-term memory that behaves more like human recall than a database lookup. Memories strengthen when used, weaken when neglected, form connections through shared context, and consolidate during periodic "sleep" cycles. The result is a memory system where important, frequently-used knowledge naturally surfaces while stale information gradually fades away.

## What this analogy does and does not mean

The biological metaphor is useful but has limits. Key differences from human memory:

- **Recall is ranked retrieval**, not spreading activation. The system searches by meaning and keywords, not by walking association graphs.
- **Associations are recorded but do not drive retrieval** in the current version. They are structural data used during consolidation.
- **Strengthening is not immediate.** A memory gains strength only during the next consolidation cycle, based on how it was used.
- **"Sleep" is not autonomous.** Consolidation runs when explicitly triggered, not on a timer.

## A typical interaction

To make the system concrete, here is what happens during a normal conversation:

1. A user asks the agent about an upcoming release deadline.
2. Before the agent responds, the system automatically recalls a relevant memory: *"Alpha release deadline is April 15."*
3. The agent sees this memory in its context and uses it in the response.
4. Later in the conversation, the agent explicitly searches for related memories and finds deployment procedures.
5. The agent gives positive feedback on the deadline memory, marking it as useful.
6. During the next consolidation cycle, the deadline memory is reinforced (it influenced a response), the deployment memory decays slightly (it was not used), and the two memories form an association because they appeared together.

## What a memory looks like

Each memory is a self-contained unit:

- **Content** — free-form text: a fact, a decision, an observation, anything worth remembering
- **Identity** — derived from the content itself (SHA-256 hash). Same content always produces the same identity, preventing exact duplicates. This also means that two memories with identical text but different metadata (e.g. different type or temporal state) are considered the same memory — to store a revised version, the content itself must change
- **Strength** — a value between 0 and 1 representing how "alive" the memory is. New memories start at 1.0
- **Type** — a free-form label (e.g. `fact`, `decision`, `preference`)
- **Temporal state** — the memory's relationship to time: *future*, *present*, *past*, or *none* (timeless)

## Two channels of recall

The system surfaces memories through two complementary channels:

### Automatic recall

Before every response, the system examines the recent conversation and automatically recalls relevant memories. The agent does not request this — it happens transparently. The number of recalled memories adapts to the remaining context budget: more when space is plentiful, fewer when the context is tight, none when there is almost no space left.

Automatically recalled memories are explicitly framed as data, not instructions. This reduces prompt injection risk through memory content, though it does not eliminate it entirely — model compliance with framing is probabilistic.

### Agent-initiated tools

The agent can also work with memories directly:

| Tool | Purpose |
|------|---------|
| `memory_store` | Save a new memory |
| `memory_search` | Find memories by keyword or meaning |
| `memory_get` | Retrieve a specific memory by ID |
| `memory_feedback` | Rate a memory's usefulness (1–5) |

If the agent has already seen a memory through a tool call, automatic recall skips it. This prevents the same information from appearing twice.

## How search works

When the system looks for relevant memories, it combines two methods:

- **Semantic search** finds memories with similar meaning, even if the words differ. *"shipping date"* can match a memory about *"release deadline."*
- **Keyword search** finds memories containing matching terms. This catches exact references that semantic search might miss.

The combined relevance score is weighted by the memory's strength. Strong memories rank higher; weak ones sink. If semantic search is unavailable, the system falls back to keyword-only search and informs the agent.

## Associations: links between memories

Memories form weighted, bidirectional links:

- **Co-retrieval** — when two memories appear in the same conversation turn, a link forms or strengthens between them
- **Transitive links** — if A is linked to B and B to C, an indirect link may form between A and C
- **Decay** — unused links weaken over time

In the current version, associations do not affect search results. They are structural data that consolidation uses to identify related memories for merging and to model the knowledge graph.

## Provenance: tracing memory influence

The system tracks how memories are used:

**Exposure** records which memories were shown to the model in each turn — whether through automatic recall, search results, or explicit retrieval.

**Attribution** records how memories influenced responses. Each attribution carries a confidence score: low for automatically recalled memories, moderate for search results, high for explicitly retrieved ones, and very high (or negative) for memories that received explicit agent feedback. Attribution is durable — it survives even if the memory itself is later deleted or merged.

Feedback can arrive in a later turn than the original memory use. The system links late feedback to the correct earlier attribution.

## Time-aware memories

Memories can carry a time anchor:

- A memory like *"demo scheduled for Friday"* is created with temporal state **future** and an anchor on Friday's date
- When Friday arrives, the memory transitions to **present**
- After Friday passes, the memory transitions to **past**

Temporal transitions happen during consolidation, not in real time. This means a memory's temporal state can lag behind the actual date until the next `/memory sleep` is run. Timeless memories (state **none**) have no anchor and do not transition.

## Consolidation: maintenance during sleep

Normal operation does not update memory strength, associations, temporal state, or consolidation status. It does write provenance records (exposure and attribution) and append to the retrieval log, but these are observational side effects — they do not change the memories themselves. All memory maintenance happens during **consolidation** — a batch process analogous to biological sleep, triggered explicitly with `/memory sleep`.

```mermaid
flowchart TD
    R[Reinforcement] --> D[Decay]
    D --> A[Association updates]
    A --> T[Temporal transitions]
    T --> P[Pruning]
    P --> M[Merging]
    M --> PR[Promotion]
    PR --> GC[Provenance cleanup]
```

What each step does:

1. **Reinforcement** — memories that influenced responses receive a strength boost proportional to their attribution confidence
2. **Decay** — all memory strengths decrease. Recent memories decay faster than established ones. Association weights also decay
3. **Association updates** — co-retrieval pairs get linked; transitive links are computed
4. **Temporal transitions** — future memories become present or past based on their anchor dates
5. **Pruning** — very weak memories and associations are deleted
6. **Merging** — similar memories are identified and combined. One may absorb the other, or a new merged memory is created. Old identities are preserved as aliases for traceability
7. **Promotion** — surviving recent memories become established
8. **Provenance cleanup** — old exposure records are deleted; attribution history is preserved permanently

### The memory lifecycle

```mermaid
flowchart TD
    S[Store] --> W[Working memory]
    W -->|consolidation| C[Consolidated memory]
    C -->|used| C
    C -->|unused| D[Decay]
    D -->|below threshold| PR[Pruned]
    C -->|similar to another| M[Merged]
    M --> N[New memory]
```

A new memory starts as **working** — recent and fast-decaying. After surviving a consolidation cycle, it is **promoted** to **consolidated** — established and slow-decaying. Active use reinforces it; neglect lets it fade. If it weakens below the pruning threshold, it is deleted. If it is similar enough to another memory, they may be merged into a new, combined memory.

## Core principles

1. **Content is identity.** Same content produces the same memory. Exact-text duplicates are prevented at creation time. This is content-addressed deduplication, not semantic deduplication — two memories with different wording but the same meaning are distinct.

2. **Mutations only during consolidation.** Normal operation creates new memories and appends observational records (provenance, retrieval log). All strength updates, associations, pruning, and merging happen during sleep.

3. **Gradual forgetting.** Memories do not disappear suddenly — they weaken across consolidation cycles until they fall below the pruning threshold. Active use reinforces and prevents forgetting.

4. **Provenance is durable.** Attribution history survives memory deletion and merging, enabling retrospective analysis of which memories influenced which responses.

5. **Untrusted data.** Memory content is always framed as data, never as instructions, to reduce prompt injection risk.

## Current limitations

- Associations do not influence search — they are recorded for consolidation use only
- Consolidation is synchronous and blocking
- Recall uses only the recent transcript as query context
- Numeric parameters (decay rates, pruning thresholds, search weights) are subject to tuning
- Semantic search depends on an external embedding service; degradation to keyword-only search is automatic but reduces recall quality

See [Architecture](./architecture.md) for implementation details, storage model, and configuration reference.

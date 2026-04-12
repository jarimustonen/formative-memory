# Formative Memory vs OpenClaw Built-in Memory

A technical comparison of the two memory systems. Both solve the same core problem — giving AI agents persistent memory across sessions — but with different approaches and trade-offs.

## Overview

OpenClaw's built-in memory uses a file-based approach: `MEMORY.md` for long-term facts, daily diary files for running context, and a SQLite index for hybrid search. It's simple, transparent, and works well for small-to-medium memory volumes.

Formative Memory takes a different approach: content-addressed memory objects with use-based reinforcement, associative links, and automatic consolidation. It's designed for memory systems that grow over time without degrading.

## Comparison

| | OpenClaw built-in | Formative Memory |
|---|---|---|
| **Storage** | MEMORY.md + daily diary files + SQLite index | Content-addressed objects (SHA-256) in SQLite |
| **Retrieval** | Hybrid search (embedding + BM25), temporal decay | Hybrid search (embedding + BM25), strength-weighted |
| **Prioritization** | Recency-based (temporal decay, 30-day half-life) | Use-based reinforcement (retrieval strengthens memories) |
| **Duplicate handling** | MMR re-ranking at retrieval time | Prevented at write time (content-addressing) + merged during consolidation |
| **Contradiction resolution** | Not handled — both versions coexist | LLM-assisted merging during consolidation |
| **Associations** | None — memories are independent | Weighted bidirectional links via co-retrieval tracking |
| **Maintenance** | Manual curation or truncation at ~20KB | Automatic 7-step consolidation (decay, prune, merge) |
| **Scalability** | Quality can degrade as volume grows | Self-maintaining — consolidation keeps signal-to-noise ratio stable |
| **Context budget** | Soft cap with truncation | Token-budget-aware recall with strength-based selection |

## When to use which

**OpenClaw built-in memory** works well when:
- Memory volume stays small (under a few hundred entries)
- You prefer direct file editing and full manual control
- Simplicity and transparency are the priority

**Formative Memory** is designed for cases where:
- Memory accumulates over weeks/months of active use
- You want the system to maintain itself without manual curation
- Connections between memories matter (e.g., related decisions, linked preferences)
- Important patterns should surface regardless of when they were stored

## Technical details

### Retrieval ranking

Both systems use hybrid search combining semantic similarity and keyword matching. The key difference is in ranking:

- **OpenClaw**: `score = relevance × temporal_decay(age)`
- **Formative Memory**: `score = relevance × strength`, where strength increases with use and decreases without it

This means OpenClaw favors recent memories, while Formative Memory favors *used* memories — a memory from three months ago that gets retrieved regularly will rank higher than a memory from yesterday that was never accessed again.

### Memory lifecycle

In OpenClaw, memories are static once written. They fade from relevance through temporal decay but don't change or consolidate.

In Formative Memory, memories have a lifecycle:
1. **Created** as working memory (faster decay)
2. **Strengthened** through retrieval and positive feedback
3. **Associated** with co-retrieved memories
4. **Consolidated** — similar memories merged into coherent summaries
5. **Pruned** when strength falls below threshold

### Consolidation

OpenClaw has no built-in consolidation. Memory maintenance is manual (editing MEMORY.md) or via truncation.

Formative Memory runs a consolidation pipeline automatically:
- Reinforce memories that influenced responses
- Decay all strengths (working memory faster than consolidated)
- Form/strengthen associations between co-retrieved memories
- Transition temporal states (future → present → past)
- Prune very weak memories
- Merge similar memories via LLM
- Garbage collect old provenance records

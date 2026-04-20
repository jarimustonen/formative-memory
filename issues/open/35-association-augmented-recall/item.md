---
created: 2026-04-20
updated: 2026-04-20
type: feature
reporter: jari
assignee: ""
status: open
priority: medium
---

# 35. Association-augmented recall

## Description

Currently, the recall phase uses only embedding similarity + BM25 keyword search to find relevant memories. Associations between memories are built and maintained during consolidation but are never used during the recall phase.

The association graph should actively participate in retrieval: when a memory scores high in search, its strongly-associated memories should also be considered as candidates. This would make the association graph a functional part of recall rather than purely observational metadata.

## Scope

- When recall finds top-scoring memories, follow their association links to pull in related memories
- Apply a threshold on association weight to avoid pulling in weakly-linked noise
- Respect the existing recall budget (don't exceed injection limits)
- Consider ranking: associated memories could receive a blended score (association weight x source memory score)

## Key files

- `src/context-engine.ts` — `assemble()` / recall logic
- `src/memory-manager.ts` — `search()` / `recall()` implementation
- `src/db.ts` — `getAssociations()` storage layer

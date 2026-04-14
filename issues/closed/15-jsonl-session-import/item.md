---
created: 2026-04-14
updated: 2026-04-14
type: feature
reporter: jari
assignee: jari
status: closed
priority: normal
commits:
  - hash: 4bdc8f2
    summary: "feat: import JSONL session histories during migration"
  - hash: 0827f36
    summary: "test: add comprehensive JSONL session import coverage"
  - hash: ed63d0b
    summary: "feat: route JSONL session import through LLM fact extraction"
  - hash: 28c4307
    summary: "fix: address review findings for JSONL session import"
---

# 15. Import JSONL session histories during migration

_Epic: **#17** v0.2_

## Description

The migration pipeline currently only imports markdown memory files (`MEMORY.md`, `memory/*.md`). OpenClaw also stores session-level conversation histories as `.jsonl` files. These contain valuable context that should be imported as memories during the initial migration.

## Scope

- Discover `.jsonl` session history files in the agent's sessions directory
- Parse the JSONL format (one JSON object per line, each representing a conversation turn)
- Group turns into exchanges (user message + assistant reply) as natural semantic units
- Extract durable facts via LLM using the same extraction pipeline as autoCapture
- Store extracted facts as memories with `source: "import"` and age-based decay
- Respect the existing migration guard (`requireEmbedding`)

## Resolved Questions

- **Location:** `<agentDir>/sessions/*.jsonl` — resolved from OpenClaw agent directory
- **Filtering:** Import all canonical sessions (exclude `.reset.*`, `.deleted.*`, `.bak.*` archive variants to avoid duplicates). Age-based decay handles relevance.
- **Long sessions:** Exchange-based segmentation — each user+assistant pair is one extraction unit. No character-count chunking.
- **Without LLM:** Session import is skipped entirely (no raw dialogue fallback).

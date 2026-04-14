---
created: 2026-04-14
updated: 2026-04-14
type: feature
reporter: jari
assignee: jari
status: in-progress
priority: normal
---

# 15. Import JSONL session histories during migration

_Epic: **#17** v0.2_

## Description

The migration pipeline currently only imports markdown memory files (`MEMORY.md`, `memory/*.md`). OpenClaw also stores session-level conversation histories as `.jsonl` files. These contain valuable context that should be imported as memories during the initial migration.

## Scope

- Discover `.jsonl` session history files in the workspace directory
- Parse the JSONL format (one JSON object per line, each representing a conversation turn)
- Extract meaningful content from sessions and segment into memory-sized chunks
- Enrich segments with LLM (type classification, temporal state) like the existing markdown pipeline
- Store as memories with appropriate source metadata
- Respect the existing migration guard (`requireEmbedding`)

## Open Questions

- Exact location and format of JSONL files on the server needs to be confirmed
- Filtering strategy: import all sessions or only recent ones?
- How to handle very long sessions — summarize or segment?

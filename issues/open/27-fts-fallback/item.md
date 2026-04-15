---
created: 2026-04-15
updated: 2026-04-15
type: feature
reporter: jari
assignee: jari
status: open
priority: normal
---

# 27. FTS fallback for embedding-free operation

_Source: openclaw v2026.3.31_

## Description

Allow the plugin to operate in a pure BM25/FTS mode without any embedding provider. Currently `requireEmbedding: false` in config disables the embedding requirement, but the search quality degrades significantly.

This would enable:
- Users without API keys for embedding providers to still use the plugin
- Faster operation for simple use cases where semantic search isn't critical
- Graceful degradation when the embedding circuit breaker is open

## Tasks

- [ ] Evaluate current BM25-only search quality
- [ ] Improve FTS ranking (term weighting, recency boost, association strength)
- [ ] Document FTS-only mode as a supported configuration
- [ ] Consider hybrid mode: FTS primary with optional embedding re-ranking

## Reference

- [v2026.3.31 impact report](../../docs/openclaw-releases/v2026.3.31.md)

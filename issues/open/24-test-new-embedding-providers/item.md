---
created: 2026-04-15
updated: 2026-04-15
type: task
reporter: jari
assignee: jari
status: open
priority: normal
---

# 24. Test new embedding providers

_Source: plugin SDK_

## Description

OpenClaw v2026.4.12 and v2026.4.14 added new embedding providers that should work with our `resolveEmbeddingProvider("auto")` path. Need to verify compatibility.

1. **LM Studio bundled provider** (v2026.4.12, #53248) — New bundled provider with model discovery, stream preload, and memory-search embeddings. Should appear in `listMemoryEmbeddingProviders()` registry automatically.

2. **Ollama embedding adapter restored** (v2026.4.14, #63429, #66078, #66163) — Built-in `ollama` embedding adapter restored in memory-core with endpoint-aware cache keys. Was previously missing from registry.

3. **Non-OpenAI provider prefix preservation** (v2026.4.14, #66452) — Embedding model ref normalization no longer strips non-OpenAI provider prefixes. Fixes potential issues with Gemini/Ollama model names in our `createGeminiEmbeddingProvider()`.

## Tasks

- [ ] Test LM Studio embedding provider with auto-resolution
- [ ] Test Ollama embedding adapter with auto-resolution
- [ ] Verify Gemini embedding model names resolve correctly after prefix fix

## Reference

- [v2026.4.12 impact report](../../docs/openclaw-releases/v2026.4.12.md)
- [v2026.4.14 impact report](../../docs/openclaw-releases/v2026.4.14.md)

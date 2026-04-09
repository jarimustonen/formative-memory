---
created: 2026-04-09
updated: 2026-04-09
type: task
reporter: jari
assignee: jari
status: open
priority: normal
---

# 07. Embedding provider integration — use OpenClaw SDK

_Source: associative memory plugin_

## Description

Replace custom OpenAI API calls (`createEmbedder()`) with OpenClaw's built-in `MemoryEmbeddingProviderAdapter` via `getMemoryEmbeddingProvider()`. This auto-resolves API keys from auth-profiles and supports multiple providers (OpenAI, Gemini, Voyage, Ollama, local).

## Reference

- [plan.md](plan.md) — full plan

## Scope

- Remove `createEmbedder()` from `src/index.ts`
- Use `getMemoryEmbeddingProvider()` at workspace creation time
- Wrap provider with existing circuit breaker
- Update config schema (remove required `embedding.apiKey`)
- Handle provider unavailability (degrade to BM25-only)
- Test embedding provider resolution and fallback

## Open Questions

- Will memory-core plugin be loaded alongside? Provider availability at runtime?

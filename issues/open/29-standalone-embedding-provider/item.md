---
created: 2026-04-15
updated: 2026-04-15
type: task
reporter: jari
assignee: jari
status: in-progress
priority: high
commits: []
---

# 29. Standalone embedding provider — remove SDK factory dependency

_Source: embedding resolution in src/index.ts_

## Description

Replace the SDK factory functions (`createOpenAiEmbeddingProvider`, `createGeminiEmbeddingProvider`) with a standalone fetch-based embedding client that reads API keys directly from auth-profiles.json. This removes the dependency on memory-core's internal auth resolution and makes embedding work in all contexts (assemble, cron, migration) without requiring a tool-call bootstrap.

## Problem

The plugin imports embedding factory functions from `openclaw/plugin-sdk/memory-core-host-engine-embeddings`. When memory-core is disabled (the intended configuration), these factories cannot resolve API keys — they rely on memory-core's internal auth wiring that only works after a tool call has been processed.

Live-tested on jari's bot (2026-04-15): with factory-context patch, agentDir is correctly available but embedding still fails because `createOpenAiEmbeddingProvider()` cannot read auth-profiles.json independently.

## Solution

- New `src/standalone-embedding.ts` module with fetch-based OpenAI and Gemini embedding clients
- Reads API keys from auth-profiles.json using existing `readAuthProfiles()` with profile key prefix matching and provider field matching
- Falls back to environment variables (OPENAI_API_KEY, GEMINI_API_KEY, GOOGLE_API_KEY)
- Registry-based resolution (memory-core adapters) still preferred when available
- Standalone providers used as fallback when registry is empty

## Quick Test

1. Disable memory-core plugin
2. Ensure auth-profiles.json has an OpenAI or Gemini key
3. Use memory_store tool — should work without errors

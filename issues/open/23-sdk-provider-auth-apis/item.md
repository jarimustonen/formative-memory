---
created: 2026-04-15
updated: 2026-04-15
type: improvement
reporter: jari
assignee: jari
status: open
priority: normal
---

# 23. Adopt new SDK provider auth APIs

_Source: plugin SDK_

## Description

Recent OpenClaw releases exposed new provider auth APIs that could simplify our embedding provider resolution:

1. **`resolveApiKeyForProvider()`** (v2026.4.7) — New SDK export for resolving API keys per provider. Could replace our manual auth resolution in `llm-caller.ts` and embedding provider setup.

2. **`getRuntimeAuthForModel()`** (v2026.4.7) — Runtime auth resolution for specific models. Useful for embedding model auth.

3. **Memory-host aliases** (v2026.4.5) — Provider alias mechanism that may simplify how we reference embedding providers. Needs investigation to determine if it's applicable.

## Tasks

- [ ] Evaluate `resolveApiKeyForProvider()` for simplifying auth in `llm-caller.ts`
- [ ] Evaluate `getRuntimeAuthForModel()` for embedding provider auth
- [ ] Investigate memory-host alias mechanism and applicability

## Reference

- [v2026.4.7 impact report](../../docs/openclaw-releases/v2026.4.7.md)
- [v2026.4.5 impact report](../../docs/openclaw-releases/v2026.4.5.md)

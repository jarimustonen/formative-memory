---
created: 2026-04-14
updated: 2026-04-14
type: improvement
reporter: jari
assignee: jari
status: open
priority: normal
---

# 19. Chain-of-thought reasoning for fact extraction

_Epic: **#17** v0.2_

## Description

The autoCapture extraction prompt (#16) asks the LLM to directly output facts as a JSON array. Adding a chain-of-thought (CoT) reasoning step before each fact could improve extraction quality by forcing the model to explicitly reason about durability before committing to an extraction.

## Idea

Instead of:
```json
[{"type": "preference", "content": "User prefers TypeScript"}]
```

Require:
```json
[{
  "reasoning": "User explicitly stated a language preference that will affect future suggestions",
  "durable_beyond_current_task": true,
  "type": "preference",
  "content": "User prefers TypeScript for backend work"
}]
```

Facts with `durable_beyond_current_task: false` could be automatically filtered.

## Trade-offs

**Pros:**
- Forces the model to reason about longevity before outputting
- Provides auditable rationale for why a fact was extracted
- Structured markers (`durable_beyond_current_task`) are more actionable than free-form reasoning
- Could reduce false positives (ephemeral task details extracted as durable facts)

**Cons:**
- Increases token cost per extraction (~2x output tokens)
- Small models may fabricate rationales (rationalization after the fact)
- Adds parsing complexity
- May not be necessary with larger models (Opus/Sonnet) that already have good judgment

## Status

Deferred — evaluate after observing extraction quality with the base implementation. If over-extraction is a problem in practice, this is a natural next step.

## Notes

Emerged from LLM review of autoCapture implementation. Alternative: use structured boolean markers instead of free-form reasoning to avoid fabrication risk.

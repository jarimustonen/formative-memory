---
created: 2026-04-14
updated: 2026-04-14
type: feature
reporter: jari
assignee: jari
status: closed
priority: normal
---

# 16. Implement autoCapture and enable by default

_Epic: **#17** v0.2_

## Description

The `autoCapture` config option exists in the schema but is not implemented. When enabled, the plugin should automatically capture conversation sessions as memories for later consolidation — without requiring the user to explicitly store memories.

This is critical for the soft launch: users shouldn't need to manually invoke memory storage for the system to learn from their interactions.

## Scope

- Implement automatic capture of conversation content after each turn/session
- Determine what to capture: full turns, summaries, or key exchanges
- Store captured content as raw memories with `source: "auto-capture"`
- Let consolidation handle deduplication, merging, and pruning
- Change default from `false` to `true` once implemented
- Respect existing turn processing in `after-turn.ts` and `context-engine.ts`

## Notes

- The config key and plugin.json schema already exist — just need the implementation
- Should integrate with the existing `processAfterTurn()` lifecycle

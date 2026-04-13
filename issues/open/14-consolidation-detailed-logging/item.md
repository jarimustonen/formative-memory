---
created: 2026-04-13
updated: 2026-04-13
type: feature
reporter: jari
assignee: jari
status: open
priority: normal
---

# 14. Add detailed consolidation logging

_Depends on: **#13** logger infrastructure_

## Description

The consolidation pipeline currently returns only aggregate counts (reinforced: N, pruned: N, etc.). For the soft launch we need to see exactly what happened during each consolidation cycle — which memories were pruned and why, which were merged together, what associations formed.

## Scope

- Each consolidation step logs its actions at info/debug level:
  - **Reinforce**: which memories gained strength, by how much
  - **Decay**: summary of strength changes (debug: per-memory details)
  - **Associate**: new or strengthened associations
  - **Prune**: which memories/associations were deleted, their content and final strength
  - **Merge**: which memories were merged into what, before/after content
  - **Temporal shift**: which memories transitioned state
- Output should be readable in terminal (not just JSON)
- Use logger from #13 so verbosity is controllable

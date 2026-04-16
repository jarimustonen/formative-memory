---
created: 2026-04-13
updated: 2026-04-16
type: feature
reporter: jari
assignee: jari
status: done
priority: normal
commits:
  - hash: e974afc
    summary: "feat: add detailed logging to consolidation pipeline"
  - hash: d5a718b
    summary: "fix: address review findings for consolidation logging"
  - hash: f7bccbe
    summary: "refactor: polish consolidation logging from review round 2"
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

## Resolution

See [analysis.md](./analysis.md) for the per-step coverage table.

The bulk landed in `e974afc` / `d5a718b` / `f7bccbe`. The final
gap-closing pass restored info-level visibility for prune, temporal
shift, and merge-before content (which review round 2 had demoted to
debug) using the capped per-item pattern from `d5a718b`, and added the
notable/all split for reinforce that the scope called for. Cap
(`PER_ITEM_INFO_CAP = 20`) prevents log storms while keeping every step
audible at default verbosity.

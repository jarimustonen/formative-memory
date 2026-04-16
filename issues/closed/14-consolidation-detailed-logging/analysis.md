# Consolidation logging audit

Snapshot of what each consolidation step logs after the gap-closing pass.
Levels marked `info` are visible by default; `debug` requires `verbose: true`
in plugin config.

## Per-step coverage

| Step                  | Per-item                                                          | Aggregate                                  |
| --------------------- | ----------------------------------------------------------------- | ------------------------------------------ |
| Catch-up decay        | debug `"{content}" old → new (N cycles, working/consolidated)`    | info `N memories adjusted`                 |
| Reinforce             | **info** for notable (Δ ≥ 0.3), debug for all; capped at 20 info | info `N strengthened from M attributions` + overflow summary |
| Decay (memories)      | debug `"{content}" old → new (×factor)`                           | info `N memories decayed`                  |
| Decay (associations)  | debug `associations ×factor`                                      | (rolled into above)                        |
| Co-retrieval          | debug `id1↔id2 (+w)`                                              | info `N updated from M turn groups`        |
| Transitive            | debug `id1↔id2 via id3 weight=w`                                  | info `N created/updated`                   |
| Prune                 | **info** `removing "{content}" (strength, type)`; capped at 20    | info `N memories, M associations removed` + overflow summary |
| Merge (combining)     | **info** `combining A=id "{content}" + B=id "{content}"`          | —                                          |
| Merge (outcome)       | info `outcome (a + b) → "{merged content}" (newId)`               | info `N merges completed`                  |
| Merge (cleanup)       | debug `weakened originals: ...` / `deleted intermediates: ...`    | —                                          |
| Temporal shift        | **info** `"{content}" oldState → newState`; capped at 20          | info `N memories transitioned` + overflow summary |
| Provenance GC         | debug `N exposure rows older than D days removed`                 | —                                          |

## Overall envelope

- `consolidation: starting` (info, on entry)
- `consolidation: done in {ms}ms — reinforced=… decayed=… pruned=…+… merged=… transitioned=…` (info, on exit)
- `consolidation: starting trigger=command|cron` (debug, before invoking)
- `merge: N sources, M targets` (debug, pre-candidate scan)
- `merge: K candidate pairs found` (info, when K > 0)

## Verbosity & sanitization

- All output goes through `Logger` from #13. `verbose: true` in plugin
  config flips minimum level from `info` to `debug`.
- `preview()` (in `logger.ts`) sanitizes content for log output: collapses
  whitespace and control chars, truncates with `…`. Default 60 chars,
  longer for prune (80) and merge (80–100).
- Hot-loop debug formatting is guarded by `isDebugEnabled()` to avoid
  eager string concatenation when debug is off.

## Cap behaviour

Per-item info-level lines for prune, temporal, and reinforce-notable are
capped at `PER_ITEM_INFO_CAP` (20) per consolidation step. Items beyond
the cap drop to debug; an overflow summary is always emitted at info so
operators see the suppressed count.

This pattern came out of review round 1 (`d5a718b`): batched cycles can
produce hundreds of pruned items, and we want operator-readable info logs
without log-storm volume in the rare large-batch case.

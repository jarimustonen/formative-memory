---
created: 2026-04-13
updated: 2026-04-13
type: feature
reporter: jari
assignee: jari
status: closed
priority: normal
commits:
  - hash: 1f8d3cf
    summary: "feat: add centralized logger with configurable verbosity"
  - hash: 3f49200
    summary: "fix: align logger with PluginLogger type, harden serialization"
  - hash: aa91549
    summary: "feat: instrument logging across store, search, assemble, and circuit breaker"
  - hash: c6edca2
    summary: "docs: add logging configuration and verbosity guide to README"
  - hash: 5f3cd0c
    summary: "fix: address review findings in logging instrumentation"
---

# 13. Add logger infrastructure with configurable verbosity

## Description

Currently there is no centralized logging with adjustable verbosity. Logging is ad-hoc: `console.warn()` in memory-manager, a simple logger interface in migration-service, and no debug/verbose mode.

For the soft launch we need to see what each bot is doing during normal operation, consolidation, and import — without requiring code changes.

## Scope

- Centralized logger with levels (debug, info, warn, error)
- Configurable via `verbose: true` in plugin config or environment variable (e.g. `FORMATIVE_MEMORY_DEBUG=1`)
- Replace existing ad-hoc console.warn/console.log calls with the logger
- Normal operation: log what auto-recall injects, what gets stored
- Import: already uses a logger interface — wire it to the new system

## Notes

Review found that `autoRecall` config option is parsed and documented but does not gate context engine recall behavior. This is a separate bug outside the scope of this issue — should be tracked independently.

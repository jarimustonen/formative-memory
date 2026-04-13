---
created: 2026-04-13
updated: 2026-04-13
type: feature
reporter: jari
assignee: jari
status: done
priority: normal
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

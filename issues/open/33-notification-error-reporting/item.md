---
created: 2026-04-19
updated: 2026-04-19
type: improvement
reporter: jari
assignee: jari
status: open
priority: normal
---

# 33. Surface consolidation errors through notification system

_Source: consolidation notification path in src/index.ts_

## Description

When consolidation fails (e.g. embedding timeout, DB lock, LLM error), the error is logged but the user receives no notification — the bot stays silent. Users should be informed when something went wrong with their memory maintenance, even if notifications are set to `off`.

Current notification levels (`off` / `summary` / `detailed`) control the *success* message. Errors are a separate concern: users need to know their memory system had a problem regardless of their notification preference.

## Proposed behavior

| Notification level | On success | On error |
|--------------------|-----------|----------|
| `off` | Silent | **Notify with short error message** |
| `summary` | LLM-voiced summary | Notify with short error message |
| `detailed` | Full technical report | Full error details |

Only `off` + explicit opt-out (e.g. a future `consolidation.errorNotification: false`) should suppress error messages. The default should be: errors are always surfaced.

## Scope

- [ ] Add error notification path in the consolidation cron handler
- [ ] Error message should be concise and non-technical for `off`/`summary` (e.g. "Memory maintenance encountered an issue — I'll retry next cycle")
- [ ] `detailed` mode shows full error info
- [ ] Do not change the existing success notification behavior
- [ ] Tests for error notification routing

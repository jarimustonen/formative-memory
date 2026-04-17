---
created: 2026-04-17
updated: 2026-04-17
type: improvement
reporter: jari
assignee: jari
status: open
priority: normal
---

# 32. User-friendly consolidation notifications

_Source: cron consolidation → user notification path_

## Description

After consolidation runs (nightly cron or manual `/memory sleep`), the bot sends a detailed technical summary to the user: memory counts, strength changes, prune/merge details. This is invaluable for debugging but is spam for a regular end user who just wants their bot to work.

Two problems:
1. **Too much detail by default** — end users don't care about reinforcement counts or decay summaries.
2. **Wrong voice** — the message is a raw system report, not in the bot's persona or the user's language. A Finnish-speaking user gets English technical jargon.

## Design

### Notification levels

A new config option `consolidation.notification` with three levels:

| Level | Behavior | Audience |
|-------|----------|----------|
| `off` | No notification after consolidation | Users who don't want to know |
| `summary` | Short, persona-voiced summary via LLM | **Default for end users** |
| `detailed` | Current technical report (unchanged) | Developers, debugging |

Default: `summary` (or `off` — to be decided during implementation).

### LLM summary layer

When `notification: "summary"`, the raw consolidation report is passed through an LLM call that:

1. **Condenses** the report to 1–3 sentences of what actually matters (e.g. "I reorganized my memories — merged a few duplicates and let some old details fade").
2. **Matches the bot's persona** — uses the bot's system prompt / personality to voice the message naturally.
3. **Uses the conversation language** — if the user speaks Finnish, the summary comes in Finnish. Language detection can be based on recent conversation history or a config hint.

The LLM call should be lightweight (small prompt, short output). The raw report can be included in a debug log regardless of notification level.

### Graceful degradation

If the LLM call fails (rate limit, timeout), fall back to either `off` (silent) or a short hardcoded message ("Memory maintenance complete"). Never block consolidation on notification delivery.

## Scope

- [ ] Add `consolidation.notification` config option (`off` | `summary` | `detailed`)
- [ ] Implement LLM summary generation with persona/language awareness
- [ ] Preserve current detailed report as `detailed` mode (no regression)
- [ ] Fallback when LLM call fails
- [ ] Tests for notification routing (level → behavior)

## Out of scope

- Changing the consolidation pipeline itself
- Notification via external channels (Slack, email) — only in-chat

---
created: 2026-04-19
updated: 2026-04-19
type: bug
reporter: jari
assignee: jari
status: open
priority: normal
---

# 34. Notification language does not respect user's language setting

_Source: consolidation notification LLM summary path_

## Description

When `consolidation.notification` is set to `summary`, the LLM generates a persona-voiced message. However, the language of this message does not consistently match the user's language — e.g. a Finnish-speaking user may receive the notification in English.

Need to investigate what context the notification LLM call has access to and how language should be determined.

## Investigation needed

1. **What data is available at notification time?** — The consolidation runs in a cron/heartbeat context, not in a normal conversation turn. What does the LLM prompt include?
   - System prompt / bot persona — does it specify language?
   - Recent conversation history — is it available in cron context?
   - User profile or locale setting — does OpenClaw expose this?

2. **How does the current implementation determine language?** — Check the prompt in `src/consolidation-notification.ts` — what language hints (if any) are passed to the LLM.

3. **What are the options?**
   - Explicit `language` config option in plugin config (e.g. `consolidation.language: "fi"`)
   - Infer from bot's system prompt / SOUL.md (many bots have language instructions there)
   - Infer from recent conversation history (if accessible in cron context)
   - Store detected language in DB state after each conversation turn

## Scope

- [ ] Audit `src/consolidation-notification.ts` — what context is passed to the LLM
- [ ] Determine which language signals are available at cron-time
- [ ] Implement language-aware notification (preferred approach TBD after investigation)
- [ ] Test with Finnish-speaking user config

## Reproduction

1. Configure a bot with Finnish-language persona
2. Set `consolidation.notification: "summary"`
3. Run `/memory sleep`
4. Observe: notification may come in English instead of Finnish

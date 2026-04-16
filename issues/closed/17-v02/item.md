---
created: 2026-04-14
updated: 2026-04-16
type: epic
owner: jari
status: closed
priority: normal
---

# E17. Version 0.2

## Goal

Second release focusing on richer data ingestion and automatic memory capture — making the plugin useful out of the box without requiring manual memory storage.

## Issues

- **#15** Import JSONL session histories during migration (closed)
- **#16** Implement autoCapture and enable by default (closed)

## Outcome

Both child issues shipped. The v0.2.0 release (commit `a7cc019`) delivered the JSONL session import and LLM-based autoCapture. Subsequent work (#21 cron hardening, #29 standalone embeddings) folded into v0.3.0, so there was no dedicated v0.2.x patch line.

## Deferred to later milestones

- **#18** Salience profile — personalization of autoCapture, scheduled for a later release.
- **#19** Extraction CoT — deliberately deferred until extraction-quality data justifies it.

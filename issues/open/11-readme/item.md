---
created: 2026-04-11
updated: 2026-04-11
type: task
reporter: jari
assignee: jari
status: open
priority: high
---

# 11. Write public-facing README.md

_Epic: **#10** Go-to-market_

## Description

Write a compelling, public-facing README.md that presents the plugin to developers for the first time. This is the "front door" of the project and must work both as a quick-start guide and as a pitch for why this exists.

## Reference

- [E10 plan-gtm.md](../10-go-to-market/plan-gtm.md) §3 — README draft structure
- Research: Mem0, Graphiti, Cognee READMEs as benchmarks

## Research Findings

Analysis of successful AI memory/agent project READMEs (Mem0 26k stars, Graphiti 3.2k, Cognee 2.5k) reveals a consistent pattern:

1. **Hero + badges** (npm, license, CI, TypeScript — max 4)
2. **One-liner value prop** — verb-forward, outcome-oriented, under 20 words
3. **The Problem** — 2-3 sentences, relatable pain
4. **How It Works** — 3-5 bullets or the Store/Associate/Consolidate/Recall narrative
5. **Quickstart** — install command + minimal working example (under 15 lines)
6. **Configuration** — options table, sensible defaults emphasized
7. **Architecture** — ASCII diagram or brief explanation for technical credibility
8. **The Biological Metaphor** — human memory vs Formative Memory comparison table
9. **Roadmap** — phased (OpenClaw plugin -> multi-agent -> universal memory layer)
10. **Contributing + License**

Key insight: every successful README shows a runnable code snippet within the first screenful. Mem0 does it in 6 lines, Cognee in 5.

## Scope

- [ ] Hero section: project name, tagline, badges (npm, license, CI, TS)
- [ ] Value proposition: one-sentence "what and why"
- [ ] The Problem: why flat-file memory fails (2-3 sentences)
- [ ] How It Works: Store / Associate / Consolidate / Recall (4 sections, concise)
- [ ] Quick Start: install command + verify step
- [ ] Configuration: options table with defaults
- [ ] Architecture: ASCII diagram showing plugin <-> SQLite <-> consolidation flow
- [ ] Biological metaphor: comparison table (human memory vs Formative Memory)
- [ ] Roadmap: Phase 1 (OpenClaw) -> Phase 2 (multi-agent) -> Phase 3 (universal)
- [ ] Contributing section (brief, link to future CONTRIBUTING.md)
- [ ] License (MIT)
- [ ] Links: website, docs, Discord, issues

## Guidelines

- **Tone**: Direct and technical. Developer audience — show architecture, show the algorithm, explain _why_ this is different. The biological metaphor is the hook, the engineering is the substance.
- **Length**: Aim for ~300-400 lines. Long enough to be comprehensive, short enough to read in 5 minutes.
- **Code examples**: Must be real and runnable, not pseudocode.
- **Brand**: Package is "formative-memory", public brand is "Formative Memory".
- **No marketing-speak**: Honest about scope ("OpenClaw plugin today, broader vision for tomorrow").

## Notes

- The GTM plan §3 has a draft README structure — use as starting point but verify against actual codebase state.
- Installation and configuration must reflect the real plugin, not aspirational features.
- Roadmap items must be honest about current status.

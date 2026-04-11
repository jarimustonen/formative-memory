---
created: 2026-04-09
updated: 2026-04-09
type: epic
owner: jari
status: open
priority: normal
---

# E10. Go-to-market

## Goal

Prepare the plugin for public release under the "Formative Memory" brand at formativememory.ai. Covers website, content, community launch, and repo cleanup.

## Reference

- [plan-gtm.md](plan-gtm.md) — GTM strategy
- [plan-website.md](plan-website.md) — website plan
- [plan-repo-cleanup.md](plan-repo-cleanup.md) — repo cleanup checklist
- [review-gtm.md](review-gtm.md) — review

## Issues

- **#11** Write public-facing README.md (open)

## Phases

### Phase 1: Repo cleanup
- [ ] Add LICENSE (MIT)
- [ ] Write CONTRIBUTING.md
- [ ] Create .github/ issue/PR templates
- [ ] Secrets audit (gitleaks/trufflehog on git history)
- [ ] Update .gitignore (*.db, *.db-wal, *.db-shm, *.log)
- [ ] Update package.json metadata (keywords, homepage, repository, license)
- [ ] Tag v0.1.0 release

### Phase 2: Website
- [ ] Set up Astro + Tailwind project
- [ ] Deploy "coming soon" page at formativememory.ai
- [ ] Build full landing page (hero, problem, animation, features, quick start, roadmap)
- [ ] Scroll-driven animation (4 frames: Store, Associate, Consolidate, Recall)
- [ ] Mobile testing, accessibility

### Phase 3: Content & launch
- [ ] Blog post 1: The problem with flat-file memory
- [ ] Blog post 2: Neuroscience inspiration
- [ ] Blog post 3: Technical deep-dive
- [ ] Demo video (2-3 min)
- [ ] Show HN post
- [ ] Reddit multi-subreddit campaign
- [ ] X account + launch thread
- [ ] OpenClaw community coordination

## Notes

- Domain: formativememory.ai
- Package name stays "openclaw-associative-memory", brand is "Formative Memory"
- Website: Astro + Tailwind, static, CSS scroll-driven animation

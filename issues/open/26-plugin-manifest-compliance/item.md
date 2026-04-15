---
created: 2026-04-15
updated: 2026-04-15
type: chore
reporter: jari
assignee: jari
status: open
priority: normal
---

# 26. Plugin manifest and security compliance

_Source: openclaw releases v2026.3.31–v2026.4.12_

## Description

Several OpenClaw releases tightened plugin loading and security requirements. Need to verify our plugin meets all new requirements.

1. **Plugin loading narrowed to manifest declarations** (v2026.4.12, #65120+) — CLI, provider, and channel activation now restricted to manifest-declared needs. Centralized manifest-owner policy. Our `openclaw.plugin.json` must explicitly declare all capabilities.

2. **Plugin manifest activation/setup descriptors** (v2026.4.11, #64780) — Plugins can now declare activation and setup descriptions in their manifest. Opportunity to improve our install experience.

3. **Plugin install dependency scanning** (v2026.4.10) — Dependency scanning during plugin installation. Our plugin is clean, but should verify the scan passes without issues.

4. **Plugin security scan** (v2026.3.31) — Security scanning infrastructure. Should test that our plugin passes.

## Tasks

- [ ] Audit `openclaw.plugin.json` manifest for completeness under stricter activation policy
- [ ] Add activation/setup descriptors to manifest
- [ ] Run plugin security scan and verify clean pass
- [ ] Test plugin install dependency scanning

## Reference

- [v2026.4.12 impact report](../../docs/openclaw-releases/v2026.4.12.md)
- [v2026.4.11 impact report](../../docs/openclaw-releases/v2026.4.11.md)
- [v2026.3.31 impact report](../../docs/openclaw-releases/v2026.3.31.md)

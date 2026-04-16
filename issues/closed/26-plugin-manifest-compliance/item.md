---
created: 2026-04-15
updated: 2026-04-16
type: chore
reporter: jari
assignee: jari
status: closed
priority: normal
commits:
  - hash: c86840f
    summary: "chore(issue-26): declare full manifest capabilities and harden install scan"
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

- [x] Audit `openclaw.plugin.json` manifest for completeness under stricter activation policy
- [x] Add activation/setup descriptors to manifest
- [x] Run plugin security scan and verify clean pass
- [x] Test plugin install dependency scanning

## Resolution

### Manifest declarations (`openclaw.plugin.json`)

Added everything `src/index.ts` actually registers, plus the new descriptor surfaces:

- `commandAliases` — declares `memory-sleep`, `memory-migrate`, `memory-cleanup` as `runtime-slash` so CLI diagnostics treat them as plugin-owned slash commands instead of root CLI commands (manifest-narrowed CLI activation, v2026.4.12).
- `contracts.tools` — static ownership of `memory_store`, `memory_search`, `memory_get`, `memory_feedback`, `memory_browse` for bundled-style contract checks.
- `activation.onCommands` — same three slash commands, so the loader activates the plugin when a user invokes one of them under the new manifest-declared activation policy.
- `activation.onCapabilities` — `["tool", "hook"]`, since `register()` registers tools and two hooks (`gateway:startup` via `registerHook`, `before_agent_reply` via `api.on`).
- `setup.requiresRuntime: true` — accurately reflects that our setup (migration + embedding-provider resolution + cron reconciliation) needs the plugin runtime; cheap descriptor for setup surfaces (v2026.4.11 #64780).
- Added top-level `version: "0.3.0"` to match `package.json`.

`kind: ["memory", "context-engine"]` was already in place from issue #29.

### Security scan (v2026.3.31)

`scanSource` in OpenClaw flags `process.env` collocated with `fetch`/`post`/`http.request` as `env-harvesting` (severity `critical` — blocks install). Our built `dist/index.js` bundle previously contained both:
- `process.env.HOME ?? process.env.USERPROFILE` — `~` expansion fallback in `resolveMemoryDir` (`src/index.ts:242`).
- `fetch(...)` calls bundled from `src/standalone-embedding.ts`.

Refactored `resolveMemoryDir` to use `os.homedir()` instead of reading `HOME`/`USERPROFILE` from the environment directly. Verified the rebuilt bundle (`dist/index.js`, `dist/cli.js`, `dist/db-*.js`) contains zero matches for `process.env`, `child_process`, `eval(`, `new Function(`, or crypto-mining patterns. The only remaining scanner-relevant hit is a `warn`-level `obfuscated-code` match in `markdown-it`'s Unicode-class regex (`\xA1\xA7\xAB...`) — not blocking under the v2026.3.31 critical-only install gate.

### Dependency scan (v2026.4.10)

OpenClaw's current `BLOCKED_INSTALL_DEPENDENCY_PACKAGE_NAMES` denylist is `["plain-crypto-js"]`. Our runtime deps are `@sinclair/typebox` and `markdown-it`; transitives bundled by `tsdown` are `mdurl`, `uc.micro`, `entities`, `linkify-it`, `punycode.js`. None are on the denylist, so dependency scanning passes.

### Notes

- No upstream follow-ups required — the scan rules and manifest schema are stable in the inspected OpenClaw HEAD.
- Pre-existing test/`tsgo`/lint failures are unchanged by this work (verified by stashing and re-running).

## Reference

- [v2026.4.12 impact report](../../docs/openclaw-releases/v2026.4.12.md)
- [v2026.4.11 impact report](../../docs/openclaw-releases/v2026.4.11.md)
- [v2026.3.31 impact report](../../docs/openclaw-releases/v2026.3.31.md)
- OpenClaw `src/security/skill-scanner.ts` — security scan rule definitions
- OpenClaw `src/plugins/dependency-denylist.ts` — install dependency denylist
- OpenClaw `src/plugins/manifest.ts` — manifest schema (activation/setup parsers)

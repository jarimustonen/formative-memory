---
created: 2026-04-16
updated: 2026-04-16
type: status
status: submitted-awaiting-review
---

# Status: Decouple Templates PR

## PR

- **URL:** https://github.com/openclaw/openclaw/pull/67554
- **Title:** `refactor(memory-core): decouple file-based memory instructions from workspace templates`
- **Branch (fork):** `jarimustonen/openclaw#fix/decouple-memory-templates`
- **Base:** `openclaw/openclaw#main`
- **Base tag at submit time:** `v2026.4.14`

## What shipped

- **Templates thinned:**
  - `docs/reference/templates/AGENTS.md` — removed Memory section (two-tier file architecture, MEMORY.md rules, "Write It Down"), removed Memory Maintenance heartbeat section, removed memory-file references from Session Startup bullets
  - `docs/reference/templates/AGENTS.dev.md` — removed Daily Memory section, updated backup tip to drop memory wording
  - `docs/reference/templates/SOUL.md` — Continuity section rewritten to reference memory plugin + workspace files (not "these files _are_ your memory")
  - `docs/reference/templates/BOOTSTRAP.md` — updated first-run memory reference to be plugin-aware
- **memory-core plugin takes ownership:**
  - `extensions/memory-core/src/prompt-section.ts` — `buildPromptSection()` now emits the full file-based memory instructions (Memory Persistence, MEMORY.md rules, Write It Down, Memory Maintenance) so default users see identical behavior
- **New platform-level Red Lines rule in AGENTS.md:**
  - `Don't expose personal memory content in shared/group contexts.` — previously inside the Memory section, now promoted to Red Lines so it applies regardless of the active memory plugin
- **"Learn a lesson" guidance** kept in AGENTS.md (workspace-level concern, not memory-backend specific)

## Design decisions (after LLM review)

Ran `$llm-review` with Gemini + Codex. Top reviewer concerns considered and resolved:

1. **Early-return regression:** `buildPromptSection` returns `[]` when memory tools are absent. Decision: **intentional, not a regression**. If the memory plugin is not loaded, its instructions should not be emitted. Duh. Pre-existing early-return, not introduced by this PR.
2. **Privacy rule delegated to swappable plugin:** Decision: **move the rule to AGENTS.md Red Lines**. It's a platform-level safety rule, not memory-backend specific. Now applies regardless of which memory plugin is active.
3. **"Use workspace files as fallback" without specifying files:** Decision: **remove the fallback claim entirely** from templates. If no memory plugin is active, there are no memory instructions. Cleanly matches the "plugin owns memory" story.

Other reviewer concerns (heartbeat coupling in storage plugin, markdown-in-TS maintainability, API context too weak, missing tests, migration docs) intentionally deferred as out of scope.

## PR template choices

- **Title prefix:** `refactor` (not `fix`) — accurate since no existing behavior is broken; this enables custom memory plugins to own their instructions.
- **Related issues:** None (no upstream issue yet).
- **Regression test:** No new test — change is string relocation, not logic. Live-verified with a real agent call.

## Testing

- Followed `infra/openclaw/AGENTS-PR-LIVE-TESTING.md`.
- Built versioned tarball (`2026.4.14-decouple-memory-templates-test.1`) on top of `v2026.4.14`.
- Installed into isolated test bot with `memory-core` enabled.
- Verified:
  - `openclaw plugins list` → `@openclaw/memory-core` loaded
  - Agent correctly describes file-based memory conventions (MEMORY.md, `memory/YYYY-MM-DD.md`, main-session-only rule, "write it down", heartbeat maintenance)
  - Agent lists Red Lines verbatim with new privacy rule as line 2

Not verified:

- Custom memory plugin behavior (formative-memory) on top of the new templates. Expected to work since custom plugins already register their own `promptBuilder`.
- Upgrade-in-place of an existing workspace (templates only affect `ensureAgentWorkspace` for fresh workspaces).

## Impact on formative-memory

- **After PR lands:** new installations no longer need the LLM cleanup step in `runMigration()` Phase 6.2. Templates already ship without conflicting memory instructions.
- **Existing workspaces:** still need the plugin's migration service — existing AGENTS.md files are not modified by upgrade. Keep migration code for backward compat.
- **Documented in PR Compatibility section:** custom memory plugin users with existing workspaces should manually remove the obsolete Memory section from their AGENTS.md.

## Next actions

- **Waiting for maintainer review**
- No local work required until review feedback arrives
- If maintainer merges: update `proposal-decouple-templates.md` to mark as shipped, and the plugin's migration service can be simplified for post-PR installs
- If maintainer requests changes: reopen worktree at `/Users/jari/Sources/openclaw__worktrees/fix/decouple-memory-templates` (branch preserved on fork)

## Local state

- Worktree: `/Users/jari/Sources/openclaw__worktrees/fix/decouple-memory-templates`
- Branch preserved on fork: `jarimustonen/openclaw#fix/decouple-memory-templates`
- 2 commits ahead of `v2026.4.14`:
  - `b52728441c` — decouple file-based memory instructions from workspace templates
  - `f3c0360b29` — address review feedback: privacy rule, fallback, lesson-learning
- Test bot at `~/openclaw-pr-test` still installed (can be cleaned up with `rm -rf ~/openclaw-pr-test`)

# Repo Cleanup Plan for Public Release

> **Date:** 2026-04-08
> **Status:** Plan

---

## 1. Naming

### Current state
- Package: `openclaw-associative-memory`
- Plugin ID: `memory-associative`
- Plugin display name: "Memory (Associative)"
- GTM branding: "Formative Memory"

### Decision needed
The GTM plan uses "Formative Memory" as the project brand. The package and plugin IDs use "associative memory." Three names is confusing.

**Options:**
1. **Rename package to `formative-memory`** — clean branding, but breaking change
2. **Keep package name, use "Formative Memory" as project brand** — add a note in README
3. **Drop "Formative Memory", use "OpenClaw Associative Memory" everywhere** — simpler, less memorable

**Recommendation:** Option 2 for now. Brand as "Formative Memory" in README/website, note the package name. Rename package later if the brand sticks.

---

## 2. Files to Add

### LICENSE
- **License:** MIT (already stated in GTM plan and README draft)
- **Action:** Create `LICENSE` file with MIT text, copyright holder name, year 2026

### CONTRIBUTING.md
- Basic contribution guide: how to build, test, submit PRs
- Code style: oxlint + oxfmt (already configured)
- Areas where help is welcome

### .github/
- Issue templates (bug report, feature request)
- PR template
- Consider: GitHub Actions for CI (build + test on PR)

---

## 3. Files to Review/Clean

### history/ directory (39 files)

The `history/` directory contains AI-generated planning, research, design, and review documents. These are valuable for project context but some may be noise for public consumption.

**Keep (valuable design context):**
- `01-idea-associative-memory-plugin.md` — origin story
- `03-design-*` series — architecture design docs (7 files)
- `design-associative-memory.md` — core design
- `plan-gtm-formativememory.md` — GTM strategy
- `plan-website.md` — this document
- `plan-repo-cleanup.md` — this document

**Consider moving to a separate branch or archive:**
- `02-research-*` series (8 files) — OpenClaw internals research, useful during development but not for public audience
- `review-*` series (8 files) — code review notes, ephemeral
- `proposal-*` series (3 files) — upstream proposals, context-specific
- `todo-memory-core-migration.md` — internal migration tracking
- `openclaw-upstream-changes.md` — upstream tracking

**Recommendation:** Keep all in `history/` but add a `history/README.md` explaining the directory structure. Public design docs build credibility. The research and review files show thorough process. No harm in keeping them.

### deploy.sh
Contains deployment details for a specific server ("haapa"). Includes:
- SSH remote name
- Container name
- Directory paths on the server

**Risk:** Not a security risk (no credentials), but reveals internal infrastructure.
**Action:** Either remove or add to `.gitignore`. If keeping, add a note that it's an example/personal deployment script.

### sylvia-memory/
Listed in root `ls` but appears to not exist (possibly gitignored or deleted). Verify and clean up if needed.

### index.ts (root)
There's an `index.ts` at the repo root AND in `src/`. Check if the root one is needed or stale.

### docs/ directory
Contains good public-facing documentation:
- `architecture.md`
- `glossary.md`
- `how-memory-works.md`
- `openclaw-release-impact.md`
- `AGENTS.md`

**Action:** `openclaw-release-impact.md` is internal tracking — consider moving to `history/`.

---

## 4. Sensitive Data Audit

### API keys / credentials
- No hardcoded API keys found in source code
- `llm-caller.ts` references `apiKey` parameter but reads from `auth-profiles.json` at runtime
- `.gitignore` includes `.env` — good
- `.gitignore` includes `.claude/settings.local.json` — good

### Personal data
- `deploy.sh` references server name "haapa" and paths — low risk
- No email addresses, usernames, or personal identifiers in source

### Secrets in git history
- **Action:** Before making repo public, run `git log --all --diff-filter=A -- '*.env' '*.key' '*.pem' '*secret*' '*credential*'` to verify no secrets were ever committed
- Consider using `trufflehog` or `gitleaks` for a thorough scan

---

## 5. .gitignore Review

Current `.gitignore`:
```
node_modules
**/node_modules/
dist
.env
coverage
.tsbuildinfo
.pnpm-store
.DS_Store
**/.DS_Store
pnpm-lock.yaml
bun.lock
bun.lockb
.worktrees/
.claude/settings.local.json
```

**Missing entries to add:**
- `*.db` — SQLite database files (in case someone runs locally)
- `*.db-wal` / `*.db-shm` — SQLite WAL files
- `.claude/` — entire Claude local config directory (currently only settings.local.json)
- `*.log` — log files

**Note:** `pnpm-lock.yaml` is gitignored. For a published package, lock files are typically excluded (correct for libraries). Verify this is intentional.

---

## 6. Git History

### Current state
The repo has a normal development history. No obviously problematic commits visible.

### Options
1. **Keep full history** — shows the development process, more transparent
2. **Squash to clean history** — cleaner but loses context
3. **Selective rebase** — clean up only problematic commits

**Recommendation:** Keep full history. The development process is part of the project's story, and `history/` docs reference specific development phases. Squashing would disconnect the narrative.

**Exception:** If the secrets audit (§4) finds any committed credentials, those commits must be rewritten with `git filter-repo`.

---

## 7. Package.json Cleanup

Review before publish:
- [ ] `name`: decide if renaming to `formative-memory`
- [ ] `description`: update to match README tagline
- [ ] `repository`: add GitHub repo URL
- [ ] `homepage`: add `https://formativememory.ai`
- [ ] `bugs`: add GitHub issues URL
- [ ] `author`: add author info
- [ ] `keywords`: add discoverable keywords (`ai-memory`, `ai-agents`, `openclaw`, `associative-memory`, `llm-tools`)
- [ ] `license`: add `"MIT"`
- [ ] `files`: specify which files to include in npm package (avoid publishing `history/`, `docs/`, tests)

---

## 8. TODO.md

Currently contains detailed internal development tracking. For public release:

**Options:**
1. Move to `history/todo-development.md` and create a clean public TODO/roadmap
2. Keep as-is (it shows development transparency)
3. Replace with GitHub Issues/Projects for public tracking

**Recommendation:** Move current TODO.md to history, replace with a minimal public roadmap or link to GitHub Issues.

---

## 9. Cleanup Checklist

```
Pre-release checklist:
- [ ] Add LICENSE (MIT)
- [ ] Write README.md
- [ ] Add CONTRIBUTING.md
- [ ] Update package.json metadata
- [ ] Add .github/ templates
- [ ] Run secrets audit on git history
- [ ] Update .gitignore
- [ ] Decide on deploy.sh (remove or gitignore)
- [ ] Check root index.ts purpose
- [ ] Add history/README.md
- [ ] Move openclaw-release-impact.md to history/
- [ ] Move TODO.md to history/, create public roadmap
- [ ] Verify build works: pnpm build && pnpm test
- [ ] Tag v0.1.0 release
```

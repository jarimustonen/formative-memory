---
name: release
description: Publish a new version to npm and create a GitHub Release with release notes. Use when asked to release, publish, bump version, or create a new version.
argument-hint: "[bump-version] (patch, minor, major)"
---

# Release

Publish a new version to npm and GitHub with release notes.

**Arguments:** $ARGUMENTS

Argument must deivne if this is a patch, minor, or major bump.

## Workflow

### 1. Pre-flight checks

Verify the release is safe to proceed:

- Working tree is clean (`git status`)
- On the `main` branch
- Up to date with remote (`git pull --dry-run` or check ahead/behind)
- All worktree branches are merged (check `workmux list` if available)
- Build succeeds (`pnpm build`)
- Tests pass (`pnpm test`) — ignore `node:sqlite` failures on Node < 22

If any check fails, report and stop.

### 2. Determine version

Bump version accordingly to the user instructions from current version in `package.json`.

Analyse the changes never the less, and report to the user if it seems that the update does not match this convention:
- **major**: breaking changes
- **minor**: new features
- **patch**: only fixes

Ask the user to confirm the version before proceeding.

### 3. Generate release notes

Collect all commits since the last git tag (or since initial commit if no tags):

```bash
git log --oneline <last-tag>..HEAD
```

Organize into sections:

```markdown
## Changes
- description (#issue)

## Fixes
- description (#issue)

## Breaking Changes
- description
```

Rules:
- **Breaking Changes**: anything that changes config defaults, renames public APIs, changes plugin ID, or removes features. Include migration instructions.
- **Changes**: new features and enhancements (`feat:` commits)
- **Fixes**: bug fixes (`fix:` commits)
- Omit empty sections
- Omit chore/docs commits unless user-facing (e.g. README rewrite)
- Reference issue numbers where available
- Write from the user's perspective — what changed for them, not internal details
- Keep it concise — one line per change, expand only for breaking changes

### 4. Update version

Edit `package.json` version field. Do NOT use `npm version` (it auto-commits with its own format).

### 5. Build

```bash
pnpm build
```

### 6. Commit, tag, and push

```bash
git add package.json
git commit -m "release: v<version>"
git tag v<version>
git push && git push --tags
```

### 7. Create GitHub Release

```bash
gh release create v<version> --title "v<version>" --notes "<release notes>"
```

Use a HEREDOC for the notes body to preserve formatting.

### 8. Publish to npm

```bash
npm publish --access public
```

If npm auth fails, tell the user to run `! npm login` or provide an OTP.

### 9. Confirm

Report:
- Version published
- GitHub Release URL
- npm package URL (https://www.npmjs.com/package/formative-memory)

## Safety Rules

- Never release from a dirty working tree
- Never release from a branch other than `main`
- Always build and test before publishing
- Always confirm version with the user if not explicitly provided
- Never skip the GitHub Release — npm + GitHub must stay in sync
- If anything fails mid-release (e.g. npm publish fails), report clearly what succeeded and what didn't, so the user can recover

---
name: issue
description: Manage issues and epics in issues/. Use when creating, searching, updating, or closing issues and epics.
---

# Issue Management

Manage issues and epics in `issues/`. The user's message determines the action:

- **Create**: user describes a problem, task, or feature → create a new issue/epic
- **Search/list**: user asks to find, list, or check issues → search and display results
- **Close**: user says an issue is done/resolved → move it from `open/` to `closed/`
- **Update**: user wants to change status, assignee, or other details → edit the item.md

Determine the action from the user's message and arguments. If unclear, ask.

## Arguments

Argument: $ARGUMENTS

## Actions

### Action: Search / List

Search `issues/open/` (and optionally `closed/`) for matching issues. Search by:
- Keyword in title/slug or item.md content
- Issue number (e.g. `#12`, `12`)
- Type, status, assignee, or priority (grep frontmatter)

Display results as a compact list: `#NN — Title (type, status, assignee)`. Read item.md for each match to get details.

If the user asks about a specific issue number, show its full details.

### Action: Close

1. Find the issue in `issues/open/`
2. Update `status: closed` and `updated:` date in item.md frontmatter
3. Move the directory from `open/` to `closed/` using `git mv`
4. Confirm to user

### Action: Update

1. Find the issue in `issues/open/`
2. Update the requested fields in item.md (status, assignee, priority, add commits, etc.)
3. Update the `updated:` date
4. Confirm to user

### Action: Create

## Process

### 1. Gather Information

If arguments already provides enough context, use it. Otherwise ask the user interactively for missing details. We need to think the nature of the issue to ask relevant things.

Possible questions:

- **What type?** — bug, task, feature, improvement, chore, or epic (infer from context when possible: "X is broken" = bug, "we need to build Y" = feature/task, "set up Z" = chore)
- **What is the problem/goal?** — clear description of the issue or desired outcome
- **Where does it happen?** — which service/page/feature (e.g. staging.simuna.io, local Moodle, bcf-tool)
- **How to reproduce?** — steps to reproduce (bugs only), or "not reproducible" / "always happens"
- **Quick test** — a brief command, URL, or action to verify the issue still exists (optional — skip if not applicable)
- **Screenshots** — ask if the user has screenshot file paths to include
- **Reporter** — who is filing this (detect via `whoami`, map to team member)
- **Assignee** — who is responsible for this (ask the user if not known)
- **Priority** — normal or high (default: normal)
- **Epic** — does this belong to an existing epic? (check `issues/open/` for items with `type: epic`)

Be smart: if arguments already contains a clear description and location, don't re-ask those. Only ask for what's missing and only what is relevant for the issue type.

**Epic suggestion**: If the user describes something that sounds like a large multi-phase initiative (spanning weeks, involving 3+ related tasks), suggest creating an epic instead of a regular issue. Ask: "This sounds like a larger initiative. Should I create it as an epic?"

### 2. Determine Item Number

Scan `issues/open/` and `issues/closed/`. Find the highest existing number (from directory names like `07-simulaatiot-ei-avaudu`), increment by 1. Use zero-padded two-digit format (e.g. `11`).

**Important**: Numbers must be unique and sequential. Never reuse or duplicate a number.

### 3. Create Directory

Both issues and epics use the same directory structure:

```
issues/open/NN-short-slug/
├── item.md
└── (optional copied screenshots or other such attachments)
```

Generate a short kebab-case slug from the title. Finnish is fine. Follow existing pattern:

- `07-simulaatiot-ei-avaudu`
- `01-moodle-pitää-saada-suomeksi-ruotsiksi-ja`

### 4. File Format

#### item.md (regular issues)

Use the frontmatter format from `issues/AGENTS.md`. Include the `type` field:

```markdown
---
created: YYYY-MM-DD
updated: YYYY-MM-DD
type: bug | task | feature | improvement | chore
reporter: username
assignee: username
status: open
priority: normal | high
---

# NN. Issue title

_Source: where it happens_
_Epic: **#NN** epic title_

## Description

...
```

Adapt sections to the type:
- **Bugs**: include Reproduction and Quick Test sections
- **Tasks/features**: include Scope or Acceptance Criteria if useful
- **Chores**: keep it brief — Description is often enough

#### item.md (epics)

Epics use `type: epic` and `owner` instead of `reporter`/`assignee`:

```markdown
---
created: YYYY-MM-DD
updated: YYYY-MM-DD
type: epic
owner: username
status: open
priority: normal | high
---

# ENN. Epic title

## Goal

One-paragraph description.

## Issues

- **#NN** Issue title (status)

## Phases

### Phase 1: Name
- [ ] Task description

## Notes

Context and decisions.
```

### 5. Copy Screenshots

If the user provides file paths to screenshots or images, convert the images to avif format and copy them into the issue directory and reference them in item.md with relative paths.

### 6. Confirm

Show the created issue/epic path and a brief summary of what was filed.

## Notes

- Use today's date for the `created` and `updated` fields
- Write issue content in English
- Keep the slug reasonably short (3-6 words)
- Default status is `open`
- Default priority is `normal`
- There is no default type — always determine or ask
- All images must be in AVIF format — convert PNG/JPG/WebP to AVIF before saving

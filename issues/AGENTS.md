# Issues

Issues, tasks, features, and epics are tracked here.

## Structure

```
issues/
├── AGENTS.md
├── open/       # Unresolved items (issues and epics)
│   └── NN-short-title/
│       ├── item.md           # Issue/epic description
│       ├── analysis.md       # Optional deeper analysis
│       └── screenshot.avif   # Optional (always AVIF)
└── closed/     # Resolved items (move from open/)
```

## Issue Types

| Type          | When to use                                | Examples                        |
| ------------- | ------------------------------------------ | ------------------------------- |
| `bug`         | Something is broken                        | UI glitch, crash, wrong output  |
| `task`        | Concrete work item with clear scope        | Deploy X, set up Y, migrate Z   |
| `feature`     | New capability or system                   | New CLI command, new integration |
| `improvement` | Enhancement to existing functionality      | Performance, UX, code quality   |
| `chore`       | Maintenance, infrastructure, cleanup       | Backups, key rotation, upgrades |
| `epic`        | Large initiative spanning multiple issues  | simuna-cli implementation, 3dbear.io redesign |

There is no default type. You need to decide or ask for the type.

## item.md Format

```markdown
---
created: YYYY-MM-DD
updated: YYYY-MM-DD
type: bug
reporter: username
assignee: username
status: open
priority: normal
commits:
  - hash: abcdef12
    summary: "fix: description of the fix"
---

# NN. Issue title

_Source: where it happens_
_Epic: **#NN** epic title_

## Description

Description of the problem.

## Reproduction

Steps to reproduce or where the issue is visible.

## Quick Test

Quick way to verify the issue (optional section, omit if not applicable).

## Screenshots

![description](filename.avif)
```

### Frontmatter Fields

| Field      | Required | Description                                        |
| ---------- | -------- | -------------------------------------------------- |
| `created`  | yes      | Date issue was created (YYYY-MM-DD)                |
| `updated`  | yes      | Date of last update (YYYY-MM-DD)                   |
| `type`     | yes      | `bug`, `task`, `feature`, `improvement`, `chore`, or `epic` |
| `reporter` | yes      | Who reported the issue (epics: use `owner` instead) |
| `assignee` | yes      | Who is currently responsible (epics: use `owner` instead) |
| `status`   | yes      | Current status (see workflow below)                |
| `priority` | yes      | `normal` or `high`                                 |
| `commits`  | no       | List of related commits (hash + summary)           |

Note: `type` defaults to `bug` if omitted (backward compatibility with existing issues).

### Status Workflow

| Status        | Meaning                                           |
| ------------- | ------------------------------------------------- |
| `open`        | Created, not yet started                          |
| `in-progress` | Actively being worked on                          |
| `fixed`       | Fix committed, awaiting testing (for bugs)        |
| `done`        | Work completed, awaiting verification (for tasks/features) |
| `testing`     | Being tested by the assigned tester               |
| `closed`      | Verified complete, moved to `closed/`             |

`fixed` and `done` are the same transition point — use whichever fits the type. When either is set, change `assignee` to whoever needs to verify it.

Typical flows:
- **Bug**: open → in-progress → fixed → testing → closed
- **Task/feature**: open → in-progress → done → testing → closed
- **Chore**: open → in-progress → done → closed (testing often skipped)
- **Epic**: open → in-progress → done → closed

### Body Conventions

- `_Source: where it happens_` — which service/page/feature
- `_Epic: **#NN** title_` — reference to parent epic (if any)
- `_Continues: #NN_` — reference to predecessor issue

These are in the markdown body, not frontmatter.

## Epics

Epics track larger initiatives that span multiple issues and weeks. They live in `open/` and `closed/` just like regular issues, distinguished by `type: epic`.

### When to create an epic

- The work will span multiple weeks
- It involves 3+ related issues
- It has distinct phases or milestones

### Epic item.md format

Epics use the same directory structure as issues (`open/NN-slug/item.md`) but with `type: epic` and adapted frontmatter and body:

```markdown
---
created: YYYY-MM-DD
updated: YYYY-MM-DD
type: epic
owner: username
status: open
priority: normal
---

# ENN. Epic title

## Goal

One-paragraph description of what this epic achieves.

## Issues

- **#NN** Issue title (status)
- **#NN** Issue title (status)

## Phases

### Phase 1: Name
- [x] Completed task (#NN)
- [ ] Pending task

### Phase 2: Name
- [ ] Pending task (#NN)

## Notes

Free-form notes, decisions, context.
```

### Epic frontmatter

Epics use `owner` instead of `reporter`/`assignee` since they are owned long-term, not assigned for a specific fix.

| Field      | Required | Description                        |
| ---------- | -------- | ---------------------------------- |
| `created`  | yes      | Date epic was created              |
| `updated`  | yes      | Date of last update                |
| `type`     | yes      | Always `epic`                      |
| `owner`    | yes      | Who owns this epic                 |
| `status`   | yes      | `open`, `in-progress`, `done`, or `closed` |
| `priority` | yes      | `normal` or `high`                 |

### Epic lifecycle

Epics follow the same open/closed flow as issues:
- Created in `open/NN-slug/item.md`
- When all phases complete: status → `done` → `closed`, move to `closed/`
- The `E` prefix in the title (`# E40.`) distinguishes epics visually

### Back-references

Child issues reference their epic with a line in the body:

```markdown
_Epic: **#40** simuna-cli implementation_
```

## Issue Numbering

Issue numbers are sequential across the entire tracker (`open/` and `closed/`). Each item gets a unique, zero-padded two-digit number (e.g. `01`, `14`). Epics share the same number space.

**Important**: Numbers must be unique — never reuse or duplicate a number. When creating a new issue or epic, scan both directories to find the highest existing number and increment by 1.

## Creating Issues

Use the `/issue` skill to create new issues and epics interactively.

The skill determines the next number, gathers details (including type), and creates the directory. It suggests creating an epic when the described work sounds like a larger initiative.

## Workflow

- Create new issues with `/issue` skill
- Add `analysis.md` for deeper investigation notes
- When work starts, update status to `in-progress`
- When a fix/implementation is committed, update status to `fixed` (bugs) or `done` (others), add the commit to `commits`, set `assignee` to tester
- When verified, set status to `closed` and move directory from `open/` to `closed/`
- Epics: update the `## Issues` and `## Phases` sections as child issues progress

## Images

All images in issues must be in AVIF format. Convert any PNG/JPG/WebP screenshots to AVIF before adding them to the issue directory.

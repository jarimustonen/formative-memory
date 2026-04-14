---
created: 2026-04-14
updated: 2026-04-14
type: feature
reporter: jari
assignee: jari
status: open
priority: normal
---

# 18. User-configurable salience profile for autoCapture

_Epic: **#17** v0.2_

## Description

AutoCapture (#16) uses a hardcoded salience definition to decide what facts the LLM should extract from conversation turns. This works as a default, but different users care about different things — a developer wants technology decisions remembered, a parent wants family events, a researcher wants citations and findings.

A **salience profile** is a user-editable description of what this user considers worth remembering. The autoCapture extraction prompt would incorporate it, making fact extraction personalized.

## Design

### Salience profile file

A markdown file in the memory workspace directory (e.g. `salience.md`) that the user can edit directly or via a command. Contains natural-language descriptions of what matters:

```markdown
# What to remember

- Technology decisions and architecture choices
- Family events, birthdays, plans
- Project deadlines and commitments  
- Health-related information
- Travel plans
- People I mention and their roles/relationships
```

### Integration with autoCapture

The extraction prompt (`buildExtractionPrompt` in `context-engine.ts`) reads the salience profile and appends it to the LLM prompt:

```
In addition to general facts, this user specifically wants you to remember:
<salience>
{contents of salience.md}
</salience>
```

When no profile exists, the current hardcoded defaults apply.

### Profile management

- Profile can be edited directly as a file
- Optionally: agent can update the profile when user says "from now on, also remember X" (could be a separate enhancement)
- Profile is read lazily at extraction time — no restart needed after edits

## Scope

- Read salience profile from workspace directory
- Inject into extraction prompt
- Fallback to defaults when no profile exists
- Document the feature and file format

## Fact type taxonomy

The extraction LLM assigns a type to each extracted fact. The taxonomy must cover broadly human-relevant topics, not just software engineering:

### Current types
`preference`, `fact`, `goal`, `project`, `event`, `relationship`

### Known gaps
- **`constraint`** — "must use Node 18", "no Docker", "budget is €500/month", "allergic to nuts"
- **`profile`/`background`** — "senior backend engineer", "new to Rust", "lives in Helsinki", "has two kids"
- **`fact` is too broad** — absorbs profile, constraints, habits, health, location, background. Should be narrowed or split.
- **`project` is ambiguous** — conflates durable project identity ("building a memory plugin") with transient implementation ("refactoring merge logic"). Needs narrow definition.

### Design principles for taxonomy
- Must cover personal life, work, health, relationships, hobbies, preferences, constraints — not just coding
- Types are used for merge candidate selection, so overly broad types degrade consolidation quality
- Unknown types from LLM should fall back to `fact`, not crash
- Taxonomy should be extensible via salience profile (user-defined types?)

This taxonomy design is part of the salience profile work since the profile may want to influence which types are extracted.

## Out of scope (for now)

- Automatic profile learning/updating from conversation patterns
- Per-type salience weighting (e.g. "preferences are more important than project context")
- UI for profile editing

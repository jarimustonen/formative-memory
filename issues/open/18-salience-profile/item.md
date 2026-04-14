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

The extraction LLM assigns a type to each extracted fact. Types are used for merge candidate selection in consolidation (only same-type memories merge), so the taxonomy directly affects memory quality.

### Current types (implemented)

| Type | What it covers | Examples |
|------|---------------|----------|
| `preference` | Tastes, values, styles, dislikes | "Prefers TypeScript", "Doesn't like ORMs", "Vegan" |
| `about` | Background, identity, skills, life situation | "Lives in Helsinki", "Senior developer", "Two kids", "Learning Rust" |
| `person` | People and relationships | "Lyra is their daughter", "Mikko is team lead" |
| `event` | Events, schedules, deadlines | "Moving to Berlin in May", "Dentist on Friday" |
| `goal` | Objectives, plans, aspirations | "Training for marathon in October", "Wants to learn Rust" |
| `work` | Durable work/project context, constraints, architecture | "Building a memory plugin", "Project uses SQLite only", "Node 22+ required" |
| `fact` | Other durable information (fallback) | "Coffee brewed with Chemex", "Dog is a golden retriever" |

### Design principles
- Taxonomy covers real human life — personal, work, health, relationships, hobbies — not just software engineering
- Types are human-readable labels, not developer jargon
- `fact` is intentionally the broad fallback — better to capture with a generic type than miss entirely
- Unknown types from LLM fall back to `fact` silently
- Taxonomy may be extensible via salience profile in the future (user-defined types)

### Future considerations
- Should salience profile be able to add custom types?
- Should types influence consolidation behavior (e.g. `event` types decay faster after the date passes)?
- Should `work` be split further if it becomes a catch-all for project+constraint+architecture?

## Out of scope (for now)

- Automatic profile learning/updating from conversation patterns
- Per-type salience weighting (e.g. "preferences are more important than project context")
- UI for profile editing

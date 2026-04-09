# Proposal: Decouple memory instructions from workspace templates

## Problem

OpenClaw's default workspace templates (`AGENTS.md`, `SOUL.md`) contain hardcoded instructions for a specific file-based memory architecture. This conflicts with the pluggable memory system (`plugins.slots.memory`, `registerMemoryPromptSection()`).

### What the templates currently prescribe

**AGENTS.md** (lines 27–53, 204–213) defines a two-tier file-based memory system:

```markdown
## Memory

- **Daily notes:** `memory/YYYY-MM-DD.md` — raw logs of what happened
- **Long-term:** `MEMORY.md` — your curated memories

### 🧠 MEMORY.md - Your Long-Term Memory
- You can **read, edit, and update** MEMORY.md freely in main sessions
- This is your curated memory — the distilled essence, not raw logs

### ✍️ Write It Down — No "Mental Notes"!
- **Memory is limited** — if you want to remember something, WRITE IT TO A FILE
- When someone says "remember this" → update `memory/YYYY-MM-DD.md` or relevant file
```

It also prescribes heartbeat-based memory maintenance (lines 204–213):

```markdown
### 🔄 Memory Maintenance (During Heartbeats)
1. Read through recent `memory/YYYY-MM-DD.md` files
2. Identify significant events, lessons, or insights worth keeping long-term
3. Update `MEMORY.md` with distilled learnings
4. Remove outdated info from MEMORY.md that's no longer relevant
```

**SOUL.md** (lines 35–37) reinforces this:

```markdown
## Continuity

Each session, you wake up fresh. These files _are_ your memory. Read them. Update them. They're how you persist.
```

### Why this is a problem

1. **Conflicts with memory plugins.** When a user installs a memory plugin (e.g. one providing `memory_store`, `memory_search` tools and a context engine), the agent ignores the plugin's tools because the workspace instructions tell it to write to files instead. The plugin's `registerMemoryPromptSection()` output is overridden by the more authoritative workspace instructions.

2. **Not how the plugin system is designed.** OpenClaw already has the infrastructure for pluggable memory:
   - `plugins.slots.memory` — selects the active memory plugin
   - `registerMemoryPromptSection()` — lets the active plugin own memory-related system prompt content
   - `registerMemoryFlushPlan()` — lets the plugin own flush behavior
   - `registerMemoryRuntime()` — lets the plugin own the runtime adapter

   But the workspace templates bypass all of this by baking file-based instructions directly into the agent's identity files.

3. **Hard to override.** Workspace files are semi-personalized — bots edit them over time. A new memory plugin cannot safely remove these instructions because it doesn't know what else the user or bot has added to the files. The result is that memory plugin authors must ask users to manually edit their workspace files, which is fragile and doesn't scale.

### Concrete case

The `openclaw-associative-memory` plugin registers `memory_store`, `memory_search`, `memory_get`, and `memory_feedback` tools, plus a context engine that auto-injects relevant memories. It also registers a memory prompt section via `registerMemoryPromptSection()`.

After deployment, the agent was asked "Muista tämä: lempivärini on vihreä" ("Remember this: my favorite color is green"). Instead of calling `memory_store`, the agent tried to edit `USER.md` — because `AGENTS.md` says "When someone says 'remember this' → update `memory/YYYY-MM-DD.md` or relevant file." The plugin's tools were completely ignored despite being available.

## Proposed change

### Move memory instructions behind the active memory plugin

Remove the hardcoded file-based memory instructions from the default templates and let the active memory plugin provide memory-related guidance via `registerMemoryPromptSection()`.

#### AGENTS.md changes

Remove or gate these sections:

1. **"Memory" section** (lines 27–53) — the two-tier file architecture, MEMORY.md rules, "Write It Down" mandate
2. **"Memory Maintenance" section** (lines 204–213) — heartbeat-based MEMORY.md curation
3. **Boot sequence line 14–15** — `Read memory/YYYY-MM-DD.md` and `read MEMORY.md`

Replace with a minimal pointer:

```markdown
## Memory

Memory persistence is handled by the active memory plugin. Use the memory tools
available to you (visible in your tool list) to store and retrieve memories.
If no memory plugin is active, you can use workspace files as a fallback.
```

#### SOUL.md changes

Replace the Continuity section (lines 35–37):

```markdown
## Continuity

Each session, you wake up fresh. Your workspace files (IDENTITY.md, SOUL.md,
USER.md, TOOLS.md) define who you are. Your memory plugin handles what you
remember. If you change identity files, tell your human.
```

#### AGENTS.dev.md changes

Remove the "Daily Memory" section (lines 36–40) and "backup tip" (lines 19–22) that reference `memory/YYYY-MM-DD.md`.

### What stays in the templates

- Identity instructions (IDENTITY.md, USER.md) — these are not memory, they're configuration
- Tool instructions (TOOLS.md) — plugin-independent
- Heartbeat instructions (minus the memory maintenance part)
- Boot sequence (minus the memory file reads)
- Security rules about MEMORY.md in shared contexts — these move to the memory-core plugin's `registerMemoryPromptSection()` where they belong

### What memory-core should do after this change

The built-in `memory-core` plugin should register its own prompt section via `registerMemoryPromptSection()` that provides the file-based instructions currently in the templates. This way:

- Users with `memory-core` (the default) see the same behavior as today
- Users who switch to a different memory plugin get that plugin's instructions instead
- No instructions conflict

## Impact

### Template files

- `docs/reference/templates/AGENTS.md` — Remove Memory section, Memory Maintenance section, memory-related boot lines
- `docs/reference/templates/AGENTS.dev.md` — Remove Daily Memory section and backup tip
- `docs/reference/templates/SOUL.md` — Update Continuity section
- `docs/reference/templates/BOOTSTRAP.md` — Update "no memory yet" reference if present

### memory-core plugin

- `extensions/memory-core/index.ts` (or equivalent) — Add `registerMemoryPromptSection()` call that provides the file-based memory instructions currently in the templates. This preserves backward compatibility for all existing users.

### session-memory hook

The `session-memory` internal hook writes to `memory/YYYY-MM-DD.md` on `/new` and `/reset`. This hook should be aware of the active memory plugin:

- If `plugins.slots.memory` is set to a non-core plugin, `session-memory` should either auto-disable or defer to the plugin's flush plan
- Alternatively, document that users should disable `session-memory` when using a custom memory plugin

This is a separate concern from the template changes but worth noting as a follow-up.

## Files to examine

- `docs/reference/templates/AGENTS.md` — Main template with memory instructions
- `docs/reference/templates/AGENTS.dev.md` — Dev template with daily memory instructions
- `docs/reference/templates/SOUL.md` — Continuity section
- `docs/reference/templates/BOOTSTRAP.md` — First-run references to memory files
- `extensions/memory-core/` — Built-in memory plugin (should adopt the removed instructions)
- `src/hooks/internal/session-memory/` — Session memory hook (related follow-up)
- `src/workspace/` — `ensureAgentWorkspace()`, `writeFileIfMissing()`, `loadTemplate()`

## Backward compatibility

- **No behavior change for default users.** The `memory-core` plugin's new `registerMemoryPromptSection()` provides the same instructions that were in the templates. Users who never change `plugins.slots.memory` see identical behavior.
- **Existing workspace files are not modified.** Templates only apply to new workspaces (`writeFileIfMissing` with `wx` flag). Existing users keep their current files — this is a separate migration concern for individual plugins.
- **Custom memory plugins work correctly.** After this change, a plugin's `registerMemoryPromptSection()` output is no longer contradicted by workspace instructions.

## What the associative-memory plugin does regardless of this PR

The upstream PR removes the problem for *new* installations. But existing workspaces already have the file-based memory instructions baked into their AGENTS.md and SOUL.md — files that the bot may have further personalized over time.

The plugin's migration service (`runMigration()`, Phase 6.2) handles this on first activation:

1. **Detect** — Read AGENTS.md and SOUL.md from the workspace directory. Run a heuristic check for file-based memory patterns (`memory/YYYY-MM-DD`, `MEMORY.md`, "WRITE IT TO A FILE", "tiedostot ovat muistisi", etc.).

2. **Clean with LLM** — If patterns are found, send the file content to the LLM (`runEmbeddedPiAgent()`) with a prompt that asks it to remove file-based memory instructions while preserving all other content (identity, tool instructions, personality, security rules, etc.). The LLM returns the cleaned version.

3. **Write back** — Save the cleaned file, keeping a backup of the original (e.g. `AGENTS.md.pre-associative-memory`).

4. **Mark done** — Store a flag in the plugin's DB state so the cleanup is not repeated on subsequent starts.

This is idempotent and safe: the heuristic check avoids unnecessary LLM calls, the backup preserves the original, and the DB flag prevents re-runs. It runs as part of the same migration that imports old memory-core memories.

### After the upstream PR lands

Once the templates no longer contain file-based instructions, new installations won't need the LLM cleanup step. The plugin keeps the migration code for backward compatibility with workspaces created before the PR, but new workspaces will just work.

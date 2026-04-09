---
created: 2026-04-04T12:00:00+03:00
source_branch: main
task: Implement memory-core migration tool (Phase 6.1–6.3)
merged: 2026-04-06T08:11:17+03:00
commits:
  - hash: 28e9245
    message: "docs: update todo — migration service logic complete"
  - hash: 749beac
    message: "feat: add memory-core migration service"
  - hash: 2654585
    message: "docs: update migration plan to automatic service architecture"
  - hash: 565b14f
    message: "fix: apply review findings to import preprocessor"
  - hash: aa72f83
    message: "refactor: remove batch machinery from import preprocessor"
  - hash: fa02ae5
    message: "docs: add worktree prompt for memory-core-migration"
---

# Task: Memory-core Migration Tool

## Objective

Implement the memory-core → associative memory migration pipeline:
1. **Esiprosessointi** (`src/import-preprocess.ts`) — markdown file discovery and segmentation
2. **CLI-komento** — `openclaw memory migrate` via `api.registerCli()`
3. **Agenttityökalu** — `memory_import_batch` tool for batch-based agent enrichment

Session transcripts (6.4) are out of scope for this worktree.

## Context

The associative memory plugin replaces OpenClaw's memory-core. Users need a way to migrate their existing memory-core memories (markdown files) into the new system. The architecture uses a two-phase approach:

1. **Preprocessing (CLI, deterministic):** Scan workspace for memory-core files (`MEMORY.md`, `memory.md`, `memory/*.md`, extra paths), segment them by heading level, extract metadata, write `import-segments.json`
2. **Enrichment (Agent, LLM):** Agent calls `memory_import_batch` to get segments in batches (3–5), enriches them (infers type, temporal_state, temporal_anchor), and stores via existing `memory_store` tool

Key design decisions:
- No separate LLM integration — the OpenClaw agent IS the LLM
- Content-hash deduplication is sufficient for idempotency
- `api.config` provides access to memory-core's configured file paths
- `registerCli()` gets access to `api.config` and full OpenClaw configuration

## Files to Examine

### Planning & reference
- `history/plan-memory-core-importer.md` — full design document with type definitions, API shapes, skill prompt
- `history/todo-memory-core-migration.md` — task breakdown
- `history/02-research-06-current-memory.md` — memory-core's file format and discovery logic
- `history/02-research-05-plugins.md` — plugin API (registerCli, registerTool, registerCommand)

### Existing code to build on
- `src/index.ts` — plugin registration (registerTool, registerCli, registerCommand patterns)
- `src/cli.ts` — existing standalone CLI tool (import command as reference)
- `src/chunks.ts` — existing chunk parser/formatter
- `src/types.ts` — Memory, Association, TemporalState types
- `src/memory-manager.ts` — MemoryManager.store() for understanding how memories are created
- `src/config.ts` — plugin configuration

### Test references
- `src/cli.test.ts` — CLI testing patterns
- `src/chunks.test.ts` — chunk parsing tests
- `src/memory-manager.test.ts` — memory store/search test patterns

## Implementation Plan

### Step 1: `src/import-preprocess.ts` — Core segmentation logic

```typescript
type ImportSegment = {
  id: number;
  source_file: string;
  heading: string | null;
  date: string | null;
  evergreen: boolean;
  content: string;
  char_count: number;
};
```

Functions:
- `discoverMemoryFiles(workspaceDir: string): string[]` — scan MEMORY.md, memory.md, memory/*.md
- `segmentMarkdown(content: string, filePath: string): ImportSegment[]` — split by H1/H2/H3
  - Segments >2000 chars → split by paragraph
  - Segments <200 chars → merge with next
- `prepareImport(workspaceDir: string, outputPath: string): PrepareResult` — full pipeline

### Step 2: Tests for import-preprocess (`src/import-preprocess.test.ts`)

Extensive testing is critical. Test at multiple levels:

**Unit tests for segmentMarkdown:**
- Normal H1/H2/H3 structure
- Large segment → paragraph splitting
- Small segment → merging with next
- Mixed heading levels
- No headings (flat content)
- Empty file
- File with only headings, no content
- Frontmatter handling (YAML between ---)
- Lists and code blocks within segments
- Unicode content

**Unit tests for discoverMemoryFiles:**
- Standard layout (MEMORY.md + memory/*.md)
- Case variations (memory.md vs MEMORY.md)
- Nested directories
- No memory files found
- Date extraction from filenames (YYYY-MM-DD.md)
- Non-date filenames in memory/

**Integration tests for prepareImport:**
- Full pipeline with realistic file structure
- Output JSON schema validation
- Segment count verification
- Metadata correctness (evergreen, date, heading)

### Step 3: `memory_import_batch` tool in `src/index.ts`

Register via `api.registerTool()`:
- Parameters: `{ action: "status" | "next" | "skip" }`
- Reads `import-segments.json` from plugin directory
- Returns batches of 3–5 segments
- Tracks progress (which batches processed)
- Returns `{ done: true, summary }` when complete

### Step 4: Tests for batch tool (`src/import-batch.test.ts`)

- Status when no import prepared
- Status with pending segments
- Next returns correct batch size
- Batch progression through all segments
- Skip advances without processing
- Done state and summary
- Repeated calls after done

### Step 5: CLI registration

Register `openclaw memory migrate` via `api.registerCli()` in `src/index.ts`:
- Calls `prepareImport(workspaceDir, outputPath)`
- Prints summary and instructions
- `--scope memories` (default) vs `--scope full` (future: sessions)

## Testing Strategy

**IMPORTANT: Extensive testing at multiple levels is a key requirement.**

1. **Pure unit tests** — test each function in isolation with mocked filesystem
2. **Integration tests** — test full pipeline with temp directories containing real markdown files
3. **Snapshot/fixture tests** — known markdown inputs → expected segment outputs
4. **Edge case tests** — empty files, huge files, special characters, deeply nested headings
5. **CLI output tests** — verify command output format (following patterns in cli.test.ts)
6. **Batch state machine tests** — status/next/skip transitions, done detection

Use temp directories (mkdtempSync) for filesystem tests. Follow existing test patterns in the codebase (vitest).

## Success Criteria

- [ ] `discoverMemoryFiles()` correctly finds all memory-core file types
- [ ] `segmentMarkdown()` produces well-formed segments with correct metadata
- [ ] Large segments are split, small segments are merged
- [ ] Date and evergreen detection works correctly
- [ ] `import-segments.json` has correct schema
- [ ] `memory_import_batch` tool returns batches correctly
- [ ] Batch progression and done state work
- [ ] Error handling for missing/corrupt files
- [ ] All tests pass with good coverage of edge cases
- [ ] Code follows existing patterns in the codebase

## Workflow

You implement the task. When complete, the user will review your changes.
The user should commit all changes using `/commit`.
The user should finalize and merge worktree with `/worktree-merge`.

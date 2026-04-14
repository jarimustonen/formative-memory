/**
 * Automatic memory-core → associative memory migration service.
 *
 * Runs at plugin startup. Detects old memory-core files, segments them,
 * enriches with LLM, and stores via the memory system.
 *
 * Designed as an independent module with injected dependencies to
 * minimize coupling with index.ts (which is being modified by the
 * embed-provider-integration branch).
 */

import { join } from "node:path";
import { existsSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import type { ImportSegment, PrepareResult } from "./import-preprocess.ts";
import { prepareImport } from "./import-preprocess.ts";
import { buildExtractionPrompt, parseExtractionResponse } from "./context-engine.ts";
import { TemporalStateGuard, type TemporalState } from "./types.ts";

// -- Types --

/** Minimal interface for storing a memory. Matches MemoryManager.store() shape. */
export type StoreMemoryFn = (params: {
  content: string;
  type: string;
  source: "import";
  temporal_state?: TemporalState;
  temporal_anchor?: string | null;
}) => Promise<{ id: string }>;

/** Minimal interface for checking/setting db state. */
export type DbStateFn = {
  get: (key: string) => string | null;
  set: (key: string, value: string) => void;
};

/** LLM enrichment function. Takes segments, returns enriched metadata. */
export type EnrichFn = (
  segments: ImportSegment[],
) => Promise<EnrichedSegment[]>;

export type EnrichedSegment = {
  id: number;
  type: string;
  temporal_state: string;
  temporal_anchor: string | null;
  /** If LLM splits a segment, additional sub-segments can be returned. */
  sub_segments?: Array<{
    content: string;
    type: string;
    temporal_state: string;
    temporal_anchor: string | null;
  }>;
};

export type MigrationDeps = {
  workspaceDir: string;
  stateDir: string;
  store: StoreMemoryFn;
  /** Update strength of a stored memory. Used to apply age-based decay after import. */
  updateStrength?: (id: string, strength: number) => void;
  dbState: DbStateFn;
  enrich: EnrichFn;
  logger: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
  extraPaths?: string[];
  /** Path to OpenClaw sessions directory for JSONL session import. */
  sessionsDir?: string;
  /** Raw LLM call function for session fact extraction. Required when sessionsDir is set. */
  llmCall?: LlmCallFn;
};

export type MigrationResult = {
  status: "skipped" | "no_files" | "completed" | "error";
  filesFound?: number;
  segmentsImported?: number;
  errors?: string[];
};

// -- Constants --

const STATE_KEY_COMPLETED = "migration_completed_at";
const STATE_KEY_SOURCE_COUNT = "migration_source_count";
const STATE_KEY_SEGMENT_COUNT = "migration_segment_count";
const BATCH_SIZE = 4;

/** Consolidated decay factor per day — same as consolidation-steps.ts DECAY_CONSOLIDATED. */
const DECAY_PER_DAY = 0.977;
/** Minimum strength after decay — below this the memory would be pruned anyway. */
const MIN_IMPORT_STRENGTH = 0.05;

/**
 * Calculate age-based strength for an imported memory.
 * Uses consolidated decay (0.977/day) applied for each day since the segment's date.
 * Segments without a date get strength 1.0 (no decay).
 */
function calculateImportStrength(segmentDate: string | null): number {
  if (!segmentDate) return 1.0;
  const ageMs = Date.now() - new Date(segmentDate).getTime();
  if (ageMs <= 0) return 1.0;
  const ageDays = ageMs / (24 * 60 * 60 * 1000);
  const strength = Math.pow(DECAY_PER_DAY, ageDays);
  return Math.max(strength, MIN_IMPORT_STRENGTH);
}

// -- Main --

/**
 * Run the memory-core migration. Idempotent — checks db state before proceeding.
 */
export async function runMigration(deps: MigrationDeps): Promise<MigrationResult> {
  const { workspaceDir, store, dbState, enrich, logger, extraPaths, sessionsDir } = deps;

  // 1. Check if already migrated
  const completedAt = dbState.get(STATE_KEY_COMPLETED);
  if (completedAt) {
    logger.info(`Memory migration already completed at ${completedAt}`);
    return { status: "skipped" };
  }

  // 2. Discover and segment
  logger.info("Scanning for memory-core files...");
  const result = prepareImport(workspaceDir, extraPaths, sessionsDir);

  if (result.errors.length > 0) {
    for (const err of result.errors) {
      logger.warn(`Could not read ${err.path}: ${err.error}`);
    }
  }

  if (result.totalSegments === 0) {
    // Don't mark complete — files may appear on a later startup (late mount, etc.)
    logger.info("No memory-core files found. Will re-check on next startup.");
    return { status: "no_files", filesFound: 0, segmentsImported: 0 };
  }

  logger.info(
    `Found ${result.files.length} files, ${result.totalSegments} segments. Starting migration...`,
  );

  // 3. Split segments by source type
  const mdSegments = result.segments.filter((s) => !s.session);
  const sessionSegments = result.segments.filter((s) => s.session);

  let importedCount = 0;
  const importErrors: string[] = [];

  // 3a. Markdown segments: enrich with LLM (type classification), then store
  for (let i = 0; i < mdSegments.length; i += BATCH_SIZE) {
    const batch = mdSegments.slice(i, i + BATCH_SIZE);

    try {
      const enriched = await enrichBatch(batch, enrich, logger);
      const stored = await storeBatch(batch, enriched, store, logger, deps.updateStrength);
      importedCount += stored;
    } catch (err) {
      const msg = `Batch ${Math.floor(i / BATCH_SIZE) + 1} failed: ${err instanceof Error ? err.message : String(err)}`;
      logger.error(msg);
      importErrors.push(msg);

      // Fallback: store with heuristic defaults
      try {
        const stored = await storeBatchWithDefaults(batch, store, logger, deps.updateStrength);
        importedCount += stored;
      } catch (fallbackErr) {
        const fallbackMsg = `Batch ${Math.floor(i / BATCH_SIZE) + 1} fallback failed: ${fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)}`;
        logger.error(fallbackMsg);
        importErrors.push(fallbackMsg);
      }
    }
  }

  // 3b. Session segments: extract facts via LLM (same pipeline as autoCapture)
  if (sessionSegments.length > 0) {
    const extracted = await extractSessionSegments(
      sessionSegments,
      store,
      deps.llmCall,
      logger,
      deps.updateStrength,
    );
    importedCount += extracted.stored;
    if (extracted.errors.length > 0) {
      importErrors.push(...extracted.errors);
    }
  }

  // 4. Mark migration as complete only if no errors occurred
  if (importErrors.length === 0) {
    dbState.set(STATE_KEY_COMPLETED, new Date().toISOString());
  }
  dbState.set(STATE_KEY_SOURCE_COUNT, String(result.files.length));
  dbState.set(STATE_KEY_SEGMENT_COUNT, String(importedCount));

  logger.info(
    `Migration complete: ${importedCount} memories imported from ${result.files.length} files.` +
      (importErrors.length > 0 ? ` (${importErrors.length} batch errors, used fallback)` : ""),
  );

  return {
    status: "completed",
    filesFound: result.files.length,
    segmentsImported: importedCount,
    errors: importErrors.length > 0 ? importErrors : undefined,
  };
}

// -- Batch processing --

async function enrichBatch(
  segments: ImportSegment[],
  enrich: EnrichFn,
  logger: MigrationDeps["logger"],
): Promise<Map<number, EnrichedSegment>> {
  const enriched = await enrich(segments);
  const map = new Map<number, EnrichedSegment>();
  for (const e of enriched) {
    map.set(e.id, e);
  }
  return map;
}

async function storeBatch(
  segments: ImportSegment[],
  enriched: Map<number, EnrichedSegment>,
  store: StoreMemoryFn,
  logger: MigrationDeps["logger"],
  updateStrength?: (id: string, strength: number) => void,
): Promise<number> {
  let count = 0;

  for (const seg of segments) {
    const meta = enriched.get(seg.id);
    try {
      if (meta?.sub_segments && meta.sub_segments.length > 0) {
        for (const sub of meta.sub_segments) {
          const result = await store({
            content: sub.content,
            type: sub.type,
            source: "import",
            temporal_state: safeTemporalState(sub.temporal_state, inferTemporalState(seg)),
            temporal_anchor: sub.temporal_anchor,
          });
          applyImportDecay(result.id, sub.temporal_anchor ?? seg.date, updateStrength);
          count++;
        }
      } else {
        const anchor = meta?.temporal_anchor ?? seg.date;
        const result = await store({
          content: seg.content,
          type: meta?.type ?? inferType(seg),
          source: "import",
          temporal_state: safeTemporalState(meta?.temporal_state, inferTemporalState(seg)),
          temporal_anchor: anchor,
        });
        applyImportDecay(result.id, anchor, updateStrength);
        count++;
      }
    } catch (err) {
      logger.warn(`Failed to store segment ${seg.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return count;
}

async function storeBatchWithDefaults(
  segments: ImportSegment[],
  store: StoreMemoryFn,
  logger: MigrationDeps["logger"],
  updateStrength?: (id: string, strength: number) => void,
): Promise<number> {
  let count = 0;

  for (const seg of segments) {
    try {
      const result = await store({
        content: seg.content,
        type: inferType(seg),
        source: "import",
        temporal_state: inferTemporalState(seg),
        temporal_anchor: seg.date,
      });
      applyImportDecay(result.id, seg.date, updateStrength);
      count++;
    } catch (err) {
      logger.warn(`Failed to store segment ${seg.id} (fallback): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return count;
}

/** Apply age-based decay to an imported memory. */
function applyImportDecay(
  id: string,
  date: string | null,
  updateStrength?: (id: string, strength: number) => void,
): void {
  if (!updateStrength || !date) return;
  const strength = calculateImportStrength(date);
  if (strength < 1.0) {
    updateStrength(id, strength);
  }
}

// -- Session fact extraction --

/**
 * Process JSONL session segments by extracting facts via LLM.
 * Uses the same extraction pipeline as autoCapture (buildExtractionPrompt/parseExtractionResponse).
 * Each segment's conversation exchange is sent to the LLM, which distills durable facts.
 * Requires llmCall — session import is skipped without LLM.
 */
async function extractSessionSegments(
  segments: ImportSegment[],
  store: StoreMemoryFn,
  llmCall: LlmCallFn | undefined,
  logger: MigrationDeps["logger"],
  updateStrength?: (id: string, strength: number) => void,
): Promise<{ stored: number; errors: string[] }> {
  if (!llmCall) {
    logger.warn("Session import skipped: LLM extraction required but llmCall not available");
    return { stored: 0, errors: [] };
  }

  let stored = 0;
  const errors: string[] = [];

  for (const seg of segments) {
    try {
      const prompt = buildExtractionPrompt(seg.content);
      const response = await llmCall(prompt);
      const facts = parseExtractionResponse(response);

      if (facts.length === 0) {
        // LLM found nothing worth remembering — expected for many exchanges
        continue;
      }

      for (const fact of facts) {
        try {
          const result = await store({
            content: fact.content,
            type: fact.type,
            source: "import",
            temporal_state: seg.date ? "past" as TemporalState : "none" as TemporalState,
            temporal_anchor: seg.date,
          });
          applyImportDecay(result.id, seg.date, updateStrength);
          stored++;
        } catch (err) {
          logger.warn(`Failed to store extracted fact from segment ${seg.id}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    } catch (err) {
      const msg = `Session segment ${seg.id} extraction failed: ${err instanceof Error ? err.message : String(err)}`;
      logger.error(msg);
      errors.push(msg);
    }
  }

  return { stored, errors };
}

// -- Heuristic inference (fallback when LLM unavailable) --

function inferType(seg: ImportSegment): string {
  if (seg.evergreen) return "fact";
  if (seg.date) return "observation";
  return "observation";
}

function inferTemporalState(seg: ImportSegment): TemporalState {
  if (seg.date) return "past";
  if (seg.evergreen) return "none";
  return "none";
}

/** Validate a temporal_state from LLM enrichment, falling back to a safe default. */
function safeTemporalState(value: string | undefined, fallback: TemporalState): TemporalState {
  if (value != null && TemporalStateGuard.is(value)) return value;
  return fallback;
}

// -- LLM enrichment prompt builder --

/**
 * Build the enrichment prompt for a batch of segments.
 * Used by the caller to construct the actual LLM call.
 */
export function buildEnrichmentPrompt(segments: ImportSegment[], language?: string): string {
  const segmentDescriptions = segments.map((seg) => {
    const meta = [
      `ID: ${seg.id}`,
      seg.source_file && `Source: ${seg.source_file}`,
      seg.heading && `Heading: ${seg.heading}`,
      seg.date && `File date: ${seg.date}`,
      seg.evergreen && "Evergreen: true",
    ]
      .filter(Boolean)
      .join(", ");

    return `### Segment ${seg.id}\n${meta}\n\n${seg.content}`;
  });

  const languageInstruction = language
    ? `\n\nIMPORTANT: All output content (including sub_segments) MUST be written in ${language}. Translate any non-${language} content.`
    : "";

  return `Analyze these memory segments from a memory-core migration.
For each segment, determine:
- **type**: fact | decision | preference | observation | plan | narrative
- **temporal_state**: none (timeless) | past (happened) | present (ongoing) | future (upcoming)
- **temporal_anchor**: ISO date if identifiable, null otherwise
- If a segment contains multiple distinct items, split into sub-segments.${languageInstruction}

${segmentDescriptions.join("\n\n---\n\n")}

Respond with a JSON array. Each element:
\`\`\`json
{
  "id": <segment id>,
  "type": "<type>",
  "temporal_state": "<state>",
  "temporal_anchor": "<date or null>",
  "sub_segments": [
    { "content": "...", "type": "...", "temporal_state": "...", "temporal_anchor": "..." }
  ]
}
\`\`\`
Only include \`sub_segments\` if you split the segment. Respond ONLY with the JSON array.`;
}

/**
 * Parse the LLM response into enriched segments.
 * Robust against malformed responses — returns empty array on failure.
 */
export function parseEnrichmentResponse(response: string): EnrichedSegment[] {
  try {
    // Extract JSON: try fenced code block first, then raw parse, then bracket extraction
    const fenced = response.match(/```(?:json)?\s*([\s\S]*?)```/i);
    let candidate = fenced ? fenced[1].trim() : response.trim();

    // If candidate doesn't start with [, try bracket extraction as last resort
    if (!candidate.startsWith("[")) {
      const start = candidate.indexOf("[");
      const end = candidate.lastIndexOf("]");
      if (start === -1 || end === -1 || end <= start) return [];
      candidate = candidate.slice(start, end + 1);
    }

    const parsed = JSON.parse(candidate);
    if (!Array.isArray(parsed)) return [];

    return parsed.map((item: any) => ({
      id: Number(item.id),
      type: String(item.type ?? "observation"),
      temporal_state: String(item.temporal_state ?? "none"),
      temporal_anchor: item.temporal_anchor ? String(item.temporal_anchor) : null,
      sub_segments: Array.isArray(item.sub_segments)
        ? item.sub_segments.map((sub: any) => ({
            content: String(sub.content ?? ""),
            type: String(sub.type ?? "observation"),
            temporal_state: String(sub.temporal_state ?? "none"),
            temporal_anchor: sub.temporal_anchor ? String(sub.temporal_anchor) : null,
          }))
        : undefined,
    }));
  } catch {
    return [];
  }
}

// -- Workspace file cleanup --

/** Generic LLM call: prompt in, text out. */
export type LlmCallFn = (prompt: string) => Promise<string>;

export type WorkspaceCleanupDeps = {
  workspaceDir: string;
  dbState: DbStateFn;
  llm: LlmCallFn;
  logger: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
  };
};

export type WorkspaceCleanupResult = {
  status: "skipped" | "clean" | "cleaned" | "error";
  filesModified?: string[];
};

const STATE_KEY_WORKSPACE_CLEANED = "workspace_cleanup_completed_at";

/** Patterns that indicate file-based memory instructions in workspace files. */
const FILE_MEMORY_PATTERNS = [
  /memory\/YYYY-MM-DD/,
  /MEMORY\.md/,
  /WRITE IT TO A FILE/i,
  /tiedostot.*ovat.*muistisi/i,
  /muistisi.*tiedosto/i,
  /memory maintenance/i,
  /daily.*notes.*memory\//i,
  /memory\/\d{4}-\d{2}-\d{2}/,
  /curated.*memor/i,
  /update.*MEMORY\.md/i,
];

export function hasFileMemoryInstructions(content: string): boolean {
  return FILE_MEMORY_PATTERNS.some((p) => p.test(content));
}

/**
 * Clean file-based memory instructions from workspace files (AGENTS.md, SOUL.md).
 *
 * Runs once on first activation. Uses LLM to surgically remove memory-related
 * instructions while preserving everything else. Backs up originals.
 */
export async function cleanupWorkspaceFiles(
  deps: WorkspaceCleanupDeps,
): Promise<WorkspaceCleanupResult> {
  const { workspaceDir, dbState, llm, logger } = deps;

  // Idempotent — skip if already done
  if (dbState.get(STATE_KEY_WORKSPACE_CLEANED)) {
    return { status: "skipped" };
  }

  const targets = ["AGENTS.md", "SOUL.md"];
  const filesToClean: Array<{ name: string; path: string; content: string }> = [];

  for (const name of targets) {
    const filePath = join(workspaceDir, name);
    if (!existsSync(filePath)) continue;

    const content = readFileSync(filePath, "utf-8");
    if (hasFileMemoryInstructions(content)) {
      filesToClean.push({ name, path: filePath, content });
    }
  }

  if (filesToClean.length === 0) {
    logger.info("Workspace files have no file-based memory instructions. Skipping cleanup.");
    dbState.set(STATE_KEY_WORKSPACE_CLEANED, new Date().toISOString());
    return { status: "clean" };
  }

  logger.info(
    `Found file-based memory instructions in: ${filesToClean.map((f) => f.name).join(", ")}. Cleaning...`,
  );

  const modified: string[] = [];
  let hadFailure = false;

  for (const file of filesToClean) {
    try {
      const cleaned = await llm(buildWorkspaceCleanupPrompt(file.name, file.content));

      // Validate: LLM should return non-empty content
      if (!cleaned || cleaned.trim().length < 20) {
        logger.warn(`LLM returned empty/too-short result for ${file.name}. Skipping.`);
        hadFailure = true;
        continue;
      }

      // Retention ratio: reject if LLM removed too much content.
      // Memory instructions are typically 20-30% of the file; removing >50% is suspicious.
      const retentionRatio = cleaned.trim().length / file.content.length;
      if (retentionRatio < 0.4) {
        logger.warn(
          `LLM removed too much content from ${file.name} (${Math.round(retentionRatio * 100)}% retained). Skipping to prevent data loss.`,
        );
        hadFailure = true;
        continue;
      }

      // Backup original
      const backupPath = `${file.path}.pre-formative-memory`;
      if (!existsSync(backupPath)) {
        copyFileSync(file.path, backupPath);
      }

      writeFileSync(file.path, cleaned, "utf-8");
      modified.push(file.name);
      logger.info(`Cleaned ${file.name} (backup: ${file.name}.pre-formative-memory)`);
    } catch (err) {
      logger.warn(
        `Failed to clean ${file.name}: ${err instanceof Error ? err.message : String(err)}`,
      );
      hadFailure = true;
    }
  }

  // Only mark complete if all target files were handled successfully.
  // Failed files will be retried on next startup.
  if (!hadFailure) {
    dbState.set(STATE_KEY_WORKSPACE_CLEANED, new Date().toISOString());
  }

  return {
    status: hadFailure && modified.length === 0 ? "error" : modified.length > 0 ? "cleaned" : "clean",
    filesModified: modified.length > 0 ? modified : undefined,
  };
}

function buildWorkspaceCleanupPrompt(fileName: string, content: string): string {
  return `You are editing an OpenClaw workspace file (${fileName}). The user has installed an associative memory plugin that replaces the file-based memory system.

Remove all instructions that tell the agent to use file-based memory persistence. This includes:
- Instructions about writing to memory/YYYY-MM-DD.md files
- Instructions about reading/updating MEMORY.md
- "Write It Down" / "No Mental Notes" sections
- Memory Maintenance sections (heartbeat-based MEMORY.md curation)
- Boot sequence lines about reading memory files
- Statements like "these files are your memory" or "tiedostot ovat muistisi"
- References to session-memory or daily memory logs

KEEP everything else intact:
- Identity, personality, and behavior instructions
- Tool instructions (email, calendar, weather, etc.)
- Security rules and boundaries
- Heartbeat instructions (minus memory maintenance parts)
- Any personalized content the bot or user has added

If a section mixes memory instructions with other content, remove only the memory parts.

Return ONLY the cleaned file content. No explanations, no code blocks, no markdown wrapping.

Here is the current content of ${fileName}:

${content}`;
}

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
import { mkdirSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { ImportSegment, PrepareResult } from "./import-preprocess.ts";
import { prepareImport } from "./import-preprocess.ts";

// -- Types --

/** Minimal interface for storing a memory. Matches MemoryManager.store() shape. */
export type StoreMemoryFn = (params: {
  content: string;
  type: string;
  source: "import";
  temporal_state?: string;
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
  dbState: DbStateFn;
  enrich: EnrichFn;
  logger: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
  extraPaths?: string[];
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

// -- Main --

/**
 * Run the memory-core migration. Idempotent — checks db state before proceeding.
 */
export async function runMigration(deps: MigrationDeps): Promise<MigrationResult> {
  const { workspaceDir, store, dbState, enrich, logger, extraPaths } = deps;

  // 1. Check if already migrated
  const completedAt = dbState.get(STATE_KEY_COMPLETED);
  if (completedAt) {
    logger.info(`Memory migration already completed at ${completedAt}`);
    return { status: "skipped" };
  }

  // 2. Discover and segment
  logger.info("Scanning for memory-core files...");
  const result = prepareImport(workspaceDir, extraPaths);

  if (result.errors.length > 0) {
    for (const err of result.errors) {
      logger.warn(`Could not read ${err.path}: ${err.error}`);
    }
  }

  if (result.totalSegments === 0) {
    logger.info("No memory-core files found. Marking migration as complete.");
    dbState.set(STATE_KEY_COMPLETED, new Date().toISOString());
    dbState.set(STATE_KEY_SOURCE_COUNT, "0");
    dbState.set(STATE_KEY_SEGMENT_COUNT, "0");
    return { status: "no_files", filesFound: 0, segmentsImported: 0 };
  }

  logger.info(
    `Found ${result.files.length} files, ${result.totalSegments} segments. Starting migration...`,
  );

  // 3. Process in batches: enrich with LLM, then store
  let importedCount = 0;
  const importErrors: string[] = [];

  for (let i = 0; i < result.segments.length; i += BATCH_SIZE) {
    const batch = result.segments.slice(i, i + BATCH_SIZE);

    try {
      const enriched = await enrichBatch(batch, enrich, logger);
      const stored = await storeBatch(batch, enriched, store, logger);
      importedCount += stored;
    } catch (err) {
      const msg = `Batch ${Math.floor(i / BATCH_SIZE) + 1} failed: ${err instanceof Error ? err.message : String(err)}`;
      logger.error(msg);
      importErrors.push(msg);

      // Fallback: store with heuristic defaults
      const stored = await storeBatchWithDefaults(batch, store, logger);
      importedCount += stored;
    }
  }

  // 4. Mark migration as complete
  dbState.set(STATE_KEY_COMPLETED, new Date().toISOString());
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
): Promise<number> {
  let count = 0;

  for (const seg of segments) {
    const meta = enriched.get(seg.id);
    try {
      if (meta?.sub_segments && meta.sub_segments.length > 0) {
        // LLM split the segment into sub-segments
        for (const sub of meta.sub_segments) {
          await store({
            content: sub.content,
            type: sub.type,
            source: "import",
            temporal_state: sub.temporal_state,
            temporal_anchor: sub.temporal_anchor,
          });
          count++;
        }
      } else {
        await store({
          content: seg.content,
          type: meta?.type ?? inferType(seg),
          source: "import",
          temporal_state: meta?.temporal_state ?? inferTemporalState(seg),
          temporal_anchor: meta?.temporal_anchor ?? seg.date,
        });
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
): Promise<number> {
  let count = 0;

  for (const seg of segments) {
    try {
      await store({
        content: seg.content,
        type: inferType(seg),
        source: "import",
        temporal_state: inferTemporalState(seg),
        temporal_anchor: seg.date,
      });
      count++;
    } catch (err) {
      logger.warn(`Failed to store segment ${seg.id} (fallback): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return count;
}

// -- Heuristic inference (fallback when LLM unavailable) --

function inferType(seg: ImportSegment): string {
  if (seg.evergreen) return "fact";
  if (seg.date) return "observation";
  return "observation";
}

function inferTemporalState(seg: ImportSegment): string {
  if (seg.date) return "past";
  if (seg.evergreen) return "none";
  return "none";
}

// -- LLM enrichment prompt builder --

/**
 * Build the enrichment prompt for a batch of segments.
 * Used by the caller to construct the actual LLM call.
 */
export function buildEnrichmentPrompt(segments: ImportSegment[]): string {
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

  return `Analyze these memory segments from a memory-core migration.
For each segment, determine:
- **type**: fact | decision | preference | observation | plan | narrative
- **temporal_state**: none (timeless) | past (happened) | present (ongoing) | future (upcoming)
- **temporal_anchor**: ISO date if identifiable, null otherwise
- If a segment contains multiple distinct items, split into sub-segments.

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
    // Extract JSON from potential markdown code block
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]);
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

/**
 * Create an EnrichFn that uses runEmbeddedPiAgent.
 * The caller provides the runtime reference captured during register().
 */
export function createLlmEnrichFn(opts: {
  runEmbeddedPiAgent: (params: any) => Promise<any>;
  sessionDir: string;
  workspaceDir: string;
  config?: any;
}): EnrichFn {
  return async (segments: ImportSegment[]): Promise<EnrichedSegment[]> => {
    const prompt = buildEnrichmentPrompt(segments);
    const sessionId = `memory-migration-${randomUUID()}`;
    const sessionFile = join(opts.sessionDir, `${sessionId}.jsonl`);

    // Ensure session directory exists
    if (!existsSync(opts.sessionDir)) {
      mkdirSync(opts.sessionDir, { recursive: true });
    }

    const result = await opts.runEmbeddedPiAgent({
      sessionId,
      sessionFile,
      workspaceDir: opts.workspaceDir,
      config: opts.config,
      prompt,
      timeoutMs: 60_000,
      runId: `migration-${randomUUID()}`,
      trigger: "memory" as const,
      disableTools: true, // Pure classification, no tools needed
      bootstrapContextMode: "lightweight" as const,
    });

    // Extract text from result payloads
    const text = result?.payloads
      ?.filter((p: any) => p.type === "text")
      ?.map((p: any) => p.text)
      ?.join("") ?? "";

    return parseEnrichmentResponse(text);
  };
}

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildEnrichmentPrompt,
  createLlmEnrichFn,
  parseEnrichmentResponse,
  runMigration,
  type DbStateFn,
  type EnrichedSegment,
  type EnrichFn,
  type MigrationDeps,
  type StoreMemoryFn,
} from "./migration-service.ts";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "migration-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// -- Test helpers --

function createMockDeps(overrides?: Partial<MigrationDeps>): MigrationDeps {
  const state = new Map<string, string>();
  const stored: Array<{ content: string; type: string; temporal_state?: string }> = [];

  return {
    workspaceDir: tmpDir,
    stateDir: join(tmpDir, ".state"),
    store: vi.fn(async (params) => {
      stored.push(params);
      return { id: `mock-${stored.length}` };
    }) as unknown as StoreMemoryFn,
    dbState: {
      get: (key) => state.get(key) ?? null,
      set: (key, value) => state.set(key, value),
    },
    enrich: vi.fn(async (segments) =>
      segments.map((seg) => ({
        id: seg.id,
        type: seg.evergreen ? "fact" : "observation",
        temporal_state: seg.date ? "past" : "none",
        temporal_anchor: seg.date,
      })),
    ) as unknown as EnrichFn,
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    ...overrides,
  };
}

function writeTestMemoryFiles() {
  writeFileSync(
    join(tmpDir, "MEMORY.md"),
    `# Project Architecture

The project uses a plugin-based architecture with SQLite for storage. This is a long-term architectural decision that should be remembered across all sessions and conversations.

## Database Choice

We chose SQLite with WAL mode for concurrent reads. This decision was made after evaluating PostgreSQL and found SQLite sufficient for our use case.`,
  );

  mkdirSync(join(tmpDir, "memory"));
  writeFileSync(
    join(tmpDir, "memory", "2026-03-15.md"),
    `# Sprint Planning

Today we planned the next sprint. Key decisions: migrate to the new memory system, implement consolidation, and add temporal awareness to all memories.`,
  );
}

// -- runMigration --

describe("runMigration", () => {
  it("skips when already migrated", async () => {
    const deps = createMockDeps();
    deps.dbState.set("migration_completed_at", "2026-04-04T00:00:00Z");

    const result = await runMigration(deps);

    expect(result.status).toBe("skipped");
    expect(deps.store).not.toHaveBeenCalled();
  });

  it("marks complete with no_files when no memory-core files found", async () => {
    const deps = createMockDeps();

    const result = await runMigration(deps);

    expect(result.status).toBe("no_files");
    expect(result.filesFound).toBe(0);
    expect(result.segmentsImported).toBe(0);
    expect(deps.dbState.get("migration_completed_at")).toBeTruthy();
    expect(deps.dbState.get("migration_source_count")).toBe("0");
  });

  it("discovers, enriches, and stores memories", async () => {
    writeTestMemoryFiles();
    const deps = createMockDeps();

    const result = await runMigration(deps);

    expect(result.status).toBe("completed");
    expect(result.filesFound).toBeGreaterThanOrEqual(2);
    expect(result.segmentsImported).toBeGreaterThan(0);
    expect(deps.store).toHaveBeenCalled();
    expect(deps.enrich).toHaveBeenCalled();
    expect(deps.dbState.get("migration_completed_at")).toBeTruthy();
  });

  it("calls enrich with batches of segments", async () => {
    writeTestMemoryFiles();
    const deps = createMockDeps();

    await runMigration(deps);

    // enrich should have been called at least once
    expect(deps.enrich).toHaveBeenCalled();
    // Each call should receive an array of segments
    const calls = (deps.enrich as any).mock.calls;
    for (const call of calls) {
      expect(Array.isArray(call[0])).toBe(true);
      expect(call[0].length).toBeLessThanOrEqual(4); // BATCH_SIZE
    }
  });

  it("stores with enriched metadata", async () => {
    writeTestMemoryFiles();
    const enrichFn: EnrichFn = async (segments) =>
      segments.map((seg) => ({
        id: seg.id,
        type: "decision",
        temporal_state: "past",
        temporal_anchor: "2026-03-15",
      }));

    const deps = createMockDeps({ enrich: enrichFn });
    await runMigration(deps);

    const storeCalls = (deps.store as any).mock.calls;
    expect(storeCalls.length).toBeGreaterThan(0);
    // At least one should have the enriched type
    const types = storeCalls.map((c: any) => c[0].type);
    expect(types).toContain("decision");
  });

  it("falls back to heuristic defaults on LLM failure", async () => {
    writeTestMemoryFiles();
    const failingEnrich: EnrichFn = async () => {
      throw new Error("LLM unavailable");
    };

    const deps = createMockDeps({ enrich: failingEnrich });
    const result = await runMigration(deps);

    expect(result.status).toBe("completed");
    expect(result.segmentsImported).toBeGreaterThan(0);
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
    // Should have stored with fallback types
    expect(deps.store).toHaveBeenCalled();
  });

  it("handles sub-segments from LLM", async () => {
    writeTestMemoryFiles();
    const splittingEnrich: EnrichFn = async (segments) =>
      segments.map((seg) => ({
        id: seg.id,
        type: "fact",
        temporal_state: "none",
        temporal_anchor: null,
        sub_segments: [
          { content: "Sub item 1", type: "fact", temporal_state: "none", temporal_anchor: null },
          { content: "Sub item 2", type: "decision", temporal_state: "past", temporal_anchor: "2026-03-15" },
        ],
      }));

    const deps = createMockDeps({ enrich: splittingEnrich });
    const result = await runMigration(deps);

    // Each segment splits into 2 sub-segments, so more stores than segments
    expect(result.segmentsImported).toBeGreaterThan(result.filesFound!);
    const storeCalls = (deps.store as any).mock.calls;
    const contents = storeCalls.map((c: any) => c[0].content);
    expect(contents).toContain("Sub item 1");
    expect(contents).toContain("Sub item 2");
  });

  it("is idempotent — second run skips", async () => {
    writeTestMemoryFiles();
    const deps = createMockDeps();

    const result1 = await runMigration(deps);
    expect(result1.status).toBe("completed");

    const result2 = await runMigration(deps);
    expect(result2.status).toBe("skipped");
  });

  it("stores source as 'import'", async () => {
    writeTestMemoryFiles();
    const deps = createMockDeps();

    await runMigration(deps);

    const storeCalls = (deps.store as any).mock.calls;
    for (const call of storeCalls) {
      expect(call[0].source).toBe("import");
    }
  });

  it("continues when individual store fails", async () => {
    writeTestMemoryFiles();
    let callCount = 0;
    const failingStore: StoreMemoryFn = async (params) => {
      callCount++;
      if (callCount === 1) throw new Error("Store failed");
      return { id: `ok-${callCount}` };
    };

    const deps = createMockDeps({ store: failingStore });
    const result = await runMigration(deps);

    expect(result.status).toBe("completed");
    // Should have imported at least some segments despite the failure
    expect(result.segmentsImported).toBeGreaterThan(0);
  });
});

// -- buildEnrichmentPrompt --

describe("buildEnrichmentPrompt", () => {
  it("includes segment content and metadata", () => {
    const segments = [
      { id: 0, source_file: "MEMORY.md", heading: "# Facts", heading_level: 1, date: null, evergreen: true, content: "SQLite is our database", char_count: 22 },
      { id: 1, source_file: "memory/2026-03-15.md", heading: "# Notes", heading_level: 1, date: "2026-03-15", evergreen: false, content: "Sprint planning notes", char_count: 21 },
    ];

    const prompt = buildEnrichmentPrompt(segments);

    expect(prompt).toContain("Segment 0");
    expect(prompt).toContain("Segment 1");
    expect(prompt).toContain("SQLite is our database");
    expect(prompt).toContain("Sprint planning notes");
    expect(prompt).toContain("Evergreen: true");
    expect(prompt).toContain("File date: 2026-03-15");
    expect(prompt).toContain("JSON");
  });

  it("includes type and temporal_state instructions", () => {
    const prompt = buildEnrichmentPrompt([
      { id: 0, source_file: "test.md", heading: null, heading_level: null, date: null, evergreen: false, content: "Test", char_count: 4 },
    ]);

    expect(prompt).toContain("fact");
    expect(prompt).toContain("decision");
    expect(prompt).toContain("temporal_state");
    expect(prompt).toContain("sub_segments");
  });
});

// -- parseEnrichmentResponse --

describe("parseEnrichmentResponse", () => {
  it("parses valid JSON response", () => {
    const response = `[
      {"id": 0, "type": "fact", "temporal_state": "none", "temporal_anchor": null},
      {"id": 1, "type": "decision", "temporal_state": "past", "temporal_anchor": "2026-03-15"}
    ]`;

    const result = parseEnrichmentResponse(response);

    expect(result).toHaveLength(2);
    expect(result[0].type).toBe("fact");
    expect(result[1].temporal_anchor).toBe("2026-03-15");
  });

  it("extracts JSON from markdown code block", () => {
    const response = `Here is the analysis:
\`\`\`json
[{"id": 0, "type": "observation", "temporal_state": "past", "temporal_anchor": null}]
\`\`\``;

    const result = parseEnrichmentResponse(response);

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("observation");
  });

  it("returns empty array for invalid JSON", () => {
    expect(parseEnrichmentResponse("not json")).toHaveLength(0);
    expect(parseEnrichmentResponse("")).toHaveLength(0);
    expect(parseEnrichmentResponse("{invalid}")).toHaveLength(0);
  });

  it("handles sub_segments", () => {
    const response = `[{
      "id": 0,
      "type": "fact",
      "temporal_state": "none",
      "temporal_anchor": null,
      "sub_segments": [
        {"content": "Part A", "type": "fact", "temporal_state": "none", "temporal_anchor": null},
        {"content": "Part B", "type": "decision", "temporal_state": "past", "temporal_anchor": "2026-01-01"}
      ]
    }]`;

    const result = parseEnrichmentResponse(response);

    expect(result).toHaveLength(1);
    expect(result[0].sub_segments).toHaveLength(2);
    expect(result[0].sub_segments![0].content).toBe("Part A");
    expect(result[0].sub_segments![1].type).toBe("decision");
  });

  it("defaults missing fields", () => {
    const response = `[{"id": 0}]`;

    const result = parseEnrichmentResponse(response);

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("observation");
    expect(result[0].temporal_state).toBe("none");
    expect(result[0].temporal_anchor).toBeNull();
  });
});

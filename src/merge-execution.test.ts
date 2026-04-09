import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryDatabase } from "./db.ts";
import { executeMerge, executeMerges, type MergeContentProducer } from "./merge-execution.ts";
import type { MergePair } from "./merge-candidates.ts";
import { contentHash } from "./hash.ts";

let tmpDir: string;
let db: MemoryDatabase;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "merge-exec-test-"));
  db = new MemoryDatabase(join(tmpDir, "test.db"));
});

afterEach(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

function insertMemory(
  id: string,
  content: string,
  opts?: { strength?: number; source?: string; consolidated?: boolean },
) {
  db.insertMemory({
    id,
    type: "fact",
    content,
    temporal_state: "none",
    temporal_anchor: null,
    created_at: "2026-03-01T00:00:00Z",
    strength: opts?.strength ?? 0.8,
    source: (opts?.source ?? "agent_tool") as any,
    consolidated: opts?.consolidated ?? false,
  });
  db.insertFts(id, content, "fact");
}

/** Deterministic content producer — concatenates both contents. */
const stubProducer: MergeContentProducer = async (a, b) => ({
  content: `${a.content} + ${b.content}`,
  type: a.type,
});

function makePair(a: string, b: string): MergePair {
  return { a, b, jaccardScore: 0.8, embeddingScore: null, combinedScore: 0.8 };
}

// -- executeMerge --

describe("executeMerge", () => {
  it("creates new consolidated memory from two originals", async () => {
    insertMemory("mem-a", "PostgreSQL is our database");
    insertMemory("mem-b", "We chose PostgreSQL for reliability");

    const result = await executeMerge(db, makePair("mem-a", "mem-b"), stubProducer);

    // New memory exists
    const newMem = db.getMemory(result.newMemoryId);
    expect(newMem).not.toBeNull();
    expect(newMem!.content).toBe("PostgreSQL is our database + We chose PostgreSQL for reliability");
    expect(newMem!.source).toBe("consolidation");
    expect(newMem!.strength).toBe(1.0);
    expect(newMem!.consolidated).toBe(1);
  });

  it("weakens original memories to 30% strength", async () => {
    insertMemory("mem-a", "content A", { strength: 0.8 });
    insertMemory("mem-b", "content B", { strength: 0.6 });

    await executeMerge(db, makePair("mem-a", "mem-b"), stubProducer);

    expect(db.getMemory("mem-a")!.strength).toBeCloseTo(0.24, 5);
    expect(db.getMemory("mem-b")!.strength).toBeCloseTo(0.18, 5);
  });

  it("deletes intermediates (source=consolidation) and creates aliases", async () => {
    insertMemory("mem-a", "original content");
    insertMemory("mem-c", "prior consolidation result", { source: "consolidation" });

    const result = await executeMerge(db, makePair("mem-a", "mem-c"), stubProducer);

    // mem-a weakened (original), mem-c deleted (intermediate)
    expect(db.getMemory("mem-a")).not.toBeNull();
    expect(db.getMemory("mem-c")).toBeNull();
    expect(result.intermediatesDeleted).toContain("mem-c");
    expect(result.originalsWeakened).toContain("mem-a");

    // Alias created for deleted intermediate
    expect(db.getAlias("mem-c")).toBe(result.newMemoryId);
    expect(db.resolveAlias("mem-c")).toBe(result.newMemoryId);
  });

  it("inherits associations with probabilistic OR", async () => {
    insertMemory("mem-a", "content A");
    insertMemory("mem-b", "content B");
    insertMemory("mem-x", "neighbor");

    // A→X weight 0.5, B→X weight 0.3
    db.upsertAssociation("mem-a", "mem-x", 0.5, "2026-03-01T00:00:00Z");
    db.upsertAssociation("mem-b", "mem-x", 0.3, "2026-03-01T00:00:00Z");

    const result = await executeMerge(db, makePair("mem-a", "mem-b"), stubProducer);

    // New memory should inherit association to X
    // Probabilistic OR: 0.5 + 0.3 - 0.5*0.3 = 0.65
    const weight = db.getAssociationWeight(result.newMemoryId, "mem-x");
    expect(weight).toBeCloseTo(0.65, 5);
  });

  it("leaves source attributions untouched (no rewrite)", async () => {
    insertMemory("mem-a", "content A");
    insertMemory("mem-b", "content B");

    db.upsertAttribution({
      messageId: "t1:msg:1",
      memoryId: "mem-a",
      evidence: "tool_search_returned",
      confidence: 0.3,
      turnId: "t1",
      createdAt: "2026-03-01T00:00:00Z",
    });
    db.upsertAttribution({
      messageId: "t2:msg:1",
      memoryId: "mem-b",
      evidence: "tool_get",
      confidence: 0.6,
      turnId: "t2",
      createdAt: "2026-03-01T01:00:00Z",
    });

    const result = await executeMerge(db, makePair("mem-a", "mem-b"), stubProducer);

    // Source attributions remain on original memory IDs
    expect(db.getAttributionsByMemory("mem-a")).toHaveLength(1);
    expect(db.getAttributionsByMemory("mem-b")).toHaveLength(1);

    // New memory has no attributions — earns them through future usage
    expect(db.getAttributionsByMemory(result.newMemoryId)).toHaveLength(0);
  });

  it("deleted intermediate's attributions survive as durable orphans", async () => {
    insertMemory("mem-a", "original content");
    insertMemory("mem-c", "prior consolidation", { source: "consolidation" });

    db.upsertAttribution({
      messageId: "t1:msg:1",
      memoryId: "mem-c",
      evidence: "auto_injected",
      confidence: 0.15,
      turnId: "t1",
      createdAt: "2026-03-01T00:00:00Z",
    });

    await executeMerge(db, makePair("mem-a", "mem-c"), stubProducer);

    // mem-c is deleted, but its attribution row survives (durable by design)
    expect(db.getMemory("mem-c")).toBeNull();
    expect(db.getAttributionsByMemory("mem-c")).toHaveLength(1);
  });

  it("generates embedding for merged memory when embedder provided", async () => {
    insertMemory("mem-a", "content A");
    insertMemory("mem-b", "content B");

    const mockEmbedder = async (_text: string) => [0.1, 0.2, 0.3];

    const result = await executeMerge(db, makePair("mem-a", "mem-b"), stubProducer, mockEmbedder);

    const embedding = db.getEmbedding(result.newMemoryId);
    expect(embedding).not.toBeNull();
    expect(embedding!.length).toBe(3);
  });

  it("gracefully handles embedder failure", async () => {
    insertMemory("mem-a", "content A");
    insertMemory("mem-b", "content B");

    const failingEmbedder = async () => { throw new Error("API error"); };

    const result = await executeMerge(db, makePair("mem-a", "mem-b"), stubProducer, failingEmbedder);

    // Memory created without embedding — still searchable via FTS
    expect(db.getMemory(result.newMemoryId)).not.toBeNull();
    expect(db.getEmbedding(result.newMemoryId)).toBeNull();
  });

  it("uses content hash as new memory ID", async () => {
    insertMemory("mem-a", "content A");
    insertMemory("mem-b", "content B");

    const result = await executeMerge(db, makePair("mem-a", "mem-b"), stubProducer);

    const expectedContent = "content A + content B";
    expect(result.newMemoryId).toBe(contentHash(expectedContent));
  });

  it("throws if source memory does not exist", async () => {
    insertMemory("mem-a", "content A");

    await expect(
      executeMerge(db, makePair("mem-a", "nonexistent"), stubProducer),
    ).rejects.toThrow("memory not found");
  });
});

  describe("absorption", () => {
    it("absorbs when merged content matches source A", async () => {
      const memAContent = "User travels frequently to Germany";
      const memAId = contentHash(memAContent);
      insertMemory(memAId, memAContent, { strength: 0.7 });
      insertMemory("mem-b", "User traveled to Germany last week");

      // Producer returns A's exact content (A is already the best expression)
      const absorbingProducer: MergeContentProducer = async () => ({
        content: memAContent,
        type: "fact",
      });

      const result = await executeMerge(
        db, makePair(memAId, "mem-b"), absorbingProducer,
      );

      // A is the canonical result
      expect(result.newMemoryId).toBe(memAId);
      expect(result.absorbedInto).toBe(memAId);

      // A's strength boosted to 1.0
      expect(db.getMemory(memAId)!.strength).toBe(1.0);

      // B is weakened (original)
      expect(db.getMemory("mem-b")!.strength).toBeCloseTo(0.8 * 0.3, 5);
    });

    it("absorbs and deletes intermediate source", async () => {
      const memAContent = "Canonical fact about database";
      const memAId = contentHash(memAContent);
      insertMemory(memAId, memAContent);
      insertMemory("mem-c", "Prior consolidation version", { source: "consolidation" });

      const absorbingProducer: MergeContentProducer = async () => ({
        content: memAContent,
        type: "fact",
      });

      const result = await executeMerge(
        db, makePair(memAId, "mem-c"), absorbingProducer,
      );

      expect(result.absorbedInto).toBe(memAId);
      expect(result.intermediatesDeleted).toContain("mem-c");
      expect(db.getMemory("mem-c")).toBeNull();
      expect(db.getAlias("mem-c")).toBe(memAId);
    });

    it("inherits associations from absorbed source", async () => {
      const memAContent = "Main fact";
      const memAId = contentHash(memAContent);
      insertMemory(memAId, memAContent);
      insertMemory("mem-b", "Duplicate fact");
      insertMemory("mem-x", "Neighbor");

      // B has association to X
      db.upsertAssociation("mem-b", "mem-x", 0.5, "2026-03-01T00:00:00Z");

      const absorbingProducer: MergeContentProducer = async () => ({
        content: memAContent,
        type: "fact",
      });

      await executeMerge(db, makePair(memAId, "mem-b"), absorbingProducer);

      // A inherits B's association to X
      expect(db.getAssociationWeight(memAId, "mem-x")).toBeGreaterThan(0);
    });

    it("does not generate embedding for absorption (reuses existing)", async () => {
      const memAContent = "Existing content";
      const memAId = contentHash(memAContent);
      insertMemory(memAId, memAContent);
      insertMemory("mem-b", "Duplicate");

      let embedderCalled = false;
      const trackingEmbedder = async () => { embedderCalled = true; return [0.1]; };

      const absorbingProducer: MergeContentProducer = async () => ({
        content: memAContent,
        type: "fact",
      });

      await executeMerge(db, makePair(memAId, "mem-b"), absorbingProducer, trackingEmbedder);

      expect(embedderCalled).toBe(false);
    });
  });

// -- executeMerges --

describe("executeMerges", () => {
  it("processes multiple pairs", async () => {
    insertMemory("mem-a", "content A");
    insertMemory("mem-b", "content B");
    insertMemory("mem-c", "content C");
    insertMemory("mem-d", "content D");

    const pairs = [makePair("mem-a", "mem-b"), makePair("mem-c", "mem-d")];
    const results = await executeMerges(db, pairs, stubProducer);

    expect(results).toHaveLength(2);
  });

  it("skips pair if either memory was already consumed", async () => {
    insertMemory("mem-a", "content A");
    insertMemory("mem-b", "content B");
    insertMemory("mem-c", "content C");

    // mem-b appears in both pairs — second should be skipped
    const pairs = [makePair("mem-a", "mem-b"), makePair("mem-b", "mem-c")];
    const results = await executeMerges(db, pairs, stubProducer);

    expect(results).toHaveLength(1);
    expect(results[0].mergedFrom).toEqual(["mem-a", "mem-b"]);
  });

  it("skips pair if memory was pruned", async () => {
    insertMemory("mem-a", "content A");
    // mem-b not inserted — simulates pruning

    const pairs = [makePair("mem-a", "mem-b")];
    const results = await executeMerges(db, pairs, stubProducer);

    expect(results).toHaveLength(0);
  });

  it("chain handling: intermediate from first merge deleted in second", async () => {
    // Simulate A+B→C (first consolidation), then C+D→E (second)
    insertMemory("mem-a", "original A");
    insertMemory("mem-b", "original B");

    // First merge
    const [result1] = await executeMerges(
      db,
      [makePair("mem-a", "mem-b")],
      stubProducer,
    );
    const cId = result1.newMemoryId;

    // Now merge C (intermediate) with D
    insertMemory("mem-d", "original D");
    const [result2] = await executeMerges(
      db,
      [makePair(cId, "mem-d")],
      stubProducer,
    );

    // C should be deleted (intermediate), D weakened (original)
    expect(db.getMemory(cId)).toBeNull();
    expect(db.getMemory("mem-d")).not.toBeNull();
    expect(result2.intermediatesDeleted).toContain(cId);
    expect(result2.originalsWeakened).toContain("mem-d");

    // Alias chain: C → E
    expect(db.resolveAlias(cId)).toBe(result2.newMemoryId);
  });
});

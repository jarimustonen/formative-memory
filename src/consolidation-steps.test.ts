import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DECAY_ASSOCIATION,
  DECAY_CONSOLIDATED,
  DECAY_WORKING,
  ETA,
  MODE_WEIGHT_BM25_ONLY,
  MODE_WEIGHT_HYBRID,
  applyAssociationDecay,
  applyDecay,
  applyReinforcement,
} from "./consolidation-steps.ts";
import { MemoryDatabase } from "./db.ts";

let tmpDir: string;
let db: MemoryDatabase;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "consolidation-steps-test-"));
  db = new MemoryDatabase(join(tmpDir, "test.db"));
});

afterEach(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

function insertMemory(
  id: string,
  strength: number,
  consolidated = false,
) {
  db.insertMemory({
    id,
    type: "fact",
    content: `content for ${id}`,
    temporal_state: "none",
    temporal_anchor: null,
    created_at: "2026-03-01T00:00:00Z",
    strength,
    source: "agent_tool",
    consolidated,
    file_path: consolidated ? "consolidated.md" : "working.md",
  });
}

// -- applyReinforcement --

describe("applyReinforcement", () => {
  it("reinforces memory based on attribution confidence", () => {
    insertMemory("mem-a", 0.5);

    // Attribution: tool_search_returned (0.3) for mem-a
    db.upsertAttribution({
      messageId: "t1:msg:1",
      memoryId: "mem-a",
      evidence: "tool_search_returned",
      confidence: 0.3,
      turnId: "t1",
      createdAt: "2026-03-01T00:00:00Z",
    });

    // Exposure: hybrid mode
    db.insertExposure({
      sessionId: "s1",
      turnId: "t1",
      memoryId: "mem-a",
      mode: "tool_search_returned",
      score: 0.8,
      retrievalMode: "hybrid",
      createdAt: "2026-03-01T00:00:00Z",
    });

    const count = applyReinforcement(db);
    expect(count).toBe(1);

    // Expected: 0.5 + (0.7 × 0.3 × 1.0) = 0.5 + 0.21 = 0.71
    const mem = db.getMemory("mem-a")!;
    expect(mem.strength).toBeCloseTo(0.71, 5);
  });

  it("applies BM25-only mode weight (0.5)", () => {
    insertMemory("mem-a", 0.5);

    db.upsertAttribution({
      messageId: "t1:msg:1",
      memoryId: "mem-a",
      evidence: "tool_search_returned",
      confidence: 0.3,
      turnId: "t1",
      createdAt: "2026-03-01T00:00:00Z",
    });

    db.insertExposure({
      sessionId: "s1",
      turnId: "t1",
      memoryId: "mem-a",
      mode: "tool_search_returned",
      score: 0.8,
      retrievalMode: "bm25_only",
      createdAt: "2026-03-01T00:00:00Z",
    });

    applyReinforcement(db);

    // Expected: 0.5 + (0.7 × 0.3 × 0.5) = 0.5 + 0.105 = 0.605
    const mem = db.getMemory("mem-a")!;
    expect(mem.strength).toBeCloseTo(0.605, 5);
  });

  it("caps strength at 1.0", () => {
    insertMemory("mem-a", 0.95);

    db.upsertAttribution({
      messageId: "t1:msg:1",
      memoryId: "mem-a",
      evidence: "agent_feedback_positive",
      confidence: 0.95,
      turnId: "t1",
      createdAt: "2026-03-01T00:00:00Z",
    });

    applyReinforcement(db);

    const mem = db.getMemory("mem-a")!;
    expect(mem.strength).toBe(1.0);
  });

  it("handles negative confidence (negative feedback)", () => {
    insertMemory("mem-a", 0.5);

    db.upsertAttribution({
      messageId: "t1:msg:1",
      memoryId: "mem-a",
      evidence: "agent_feedback_negative",
      confidence: -0.5,
      turnId: "t1",
      createdAt: "2026-03-01T00:00:00Z",
    });

    applyReinforcement(db);

    // Expected: 0.5 + (0.7 × -0.5 × 1.0) = 0.5 - 0.35 = 0.15
    const mem = db.getMemory("mem-a")!;
    expect(mem.strength).toBeCloseTo(0.15, 5);
  });

  it("accumulates multiple attributions for same memory", () => {
    insertMemory("mem-a", 0.3);

    // Two attributions from different turns
    db.upsertAttribution({
      messageId: "t1:msg:1",
      memoryId: "mem-a",
      evidence: "auto_injected",
      confidence: 0.15,
      turnId: "t1",
      createdAt: "2026-03-01T00:00:00Z",
    });
    db.upsertAttribution({
      messageId: "t2:msg:1",
      memoryId: "mem-a",
      evidence: "tool_get",
      confidence: 0.6,
      turnId: "t2",
      createdAt: "2026-03-01T01:00:00Z",
    });

    applyReinforcement(db);

    // Expected: 0.3 + (0.7 × 0.15 × 1.0) + (0.7 × 0.6 × 1.0) = 0.3 + 0.105 + 0.42 = 0.825
    const mem = db.getMemory("mem-a")!;
    expect(mem.strength).toBeCloseTo(0.825, 5);
  });

  it("returns 0 when no attributions exist", () => {
    insertMemory("mem-a", 0.5);
    expect(applyReinforcement(db)).toBe(0);
  });

  it("skips attribution for deleted memory", () => {
    // Attribution exists but memory was deleted
    db.upsertAttribution({
      messageId: "t1:msg:1",
      memoryId: "nonexistent",
      evidence: "tool_get",
      confidence: 0.6,
      turnId: "t1",
      createdAt: "2026-03-01T00:00:00Z",
    });

    expect(applyReinforcement(db)).toBe(0);
  });
});

// -- applyDecay --

describe("applyDecay", () => {
  it("decays working memories by DECAY_WORKING factor", () => {
    insertMemory("mem-a", 0.8, false);
    applyDecay(db);

    const mem = db.getMemory("mem-a")!;
    expect(mem.strength).toBeCloseTo(0.8 * DECAY_WORKING, 5);
  });

  it("decays consolidated memories by DECAY_CONSOLIDATED factor", () => {
    insertMemory("mem-a", 0.8, true);
    applyDecay(db);

    const mem = db.getMemory("mem-a")!;
    expect(mem.strength).toBeCloseTo(0.8 * DECAY_CONSOLIDATED, 5);
  });

  it("returns count of decayed memories", () => {
    insertMemory("mem-a", 0.8, false);
    insertMemory("mem-b", 0.6, true);

    expect(applyDecay(db)).toBe(2);
  });

  it("returns 0 when no memories exist", () => {
    expect(applyDecay(db)).toBe(0);
  });
});

// -- applyAssociationDecay --

describe("applyAssociationDecay", () => {
  it("decays association weights by DECAY_ASSOCIATION factor", () => {
    insertMemory("mem-a", 0.5);
    insertMemory("mem-b", 0.5);
    db.upsertAssociation("mem-a", "mem-b", 0.8, "2026-03-01T00:00:00Z");

    applyAssociationDecay(db);

    const assocs = db.getAssociations("mem-a");
    expect(assocs).toHaveLength(1);
    expect(assocs[0].weight).toBeCloseTo(0.8 * DECAY_ASSOCIATION, 5);
  });

  it("decays all associations", () => {
    insertMemory("mem-a", 0.5);
    insertMemory("mem-b", 0.5);
    insertMemory("mem-c", 0.5);
    db.upsertAssociation("mem-a", "mem-b", 0.8, "2026-03-01T00:00:00Z");
    db.upsertAssociation("mem-a", "mem-c", 0.4, "2026-03-01T00:00:00Z");

    applyAssociationDecay(db);

    const assocs = db.getAssociations("mem-a");
    expect(assocs[0].weight).toBeCloseTo(0.8 * DECAY_ASSOCIATION, 5);
    expect(assocs[1].weight).toBeCloseTo(0.4 * DECAY_ASSOCIATION, 5);
  });
});

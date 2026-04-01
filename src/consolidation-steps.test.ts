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
  PRUNE_ASSOCIATION_THRESHOLD,
  PRUNE_STRENGTH_THRESHOLD,
  TRANSITIVE_WEIGHT_THRESHOLD,
  applyAssociationDecay,
  applyDecay,
  applyPruning,
  applyReinforcement,
  applyTemporalTransitions,
  updateCoRetrievalAssociations,
  updateTransitiveAssociations,
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

  it("clamps strength to 0 on strong negative reinforcement", () => {
    insertMemory("mem-a", 0.1);

    db.upsertAttribution({
      messageId: "t1:msg:1",
      memoryId: "mem-a",
      evidence: "agent_feedback_negative",
      confidence: -0.5,
      turnId: "t1",
      createdAt: "2026-03-01T00:00:00Z",
    });

    applyReinforcement(db);

    // 0.1 + (0.7 × -0.5 × 1.0) = 0.1 - 0.35 = -0.25 → clamped to 0
    const mem = db.getMemory("mem-a")!;
    expect(mem.strength).toBe(0);
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

  it("is idempotent — second run does not re-apply", () => {
    insertMemory("mem-a", 0.5);

    db.upsertAttribution({
      messageId: "t1:msg:1",
      memoryId: "mem-a",
      evidence: "tool_search_returned",
      confidence: 0.3,
      turnId: "t1",
      createdAt: "2026-03-01T00:00:00Z",
    });

    // First run applies reinforcement
    expect(applyReinforcement(db)).toBe(1);
    const afterFirst = db.getMemory("mem-a")!.strength;
    expect(afterFirst).toBeCloseTo(0.71, 5);

    // Second run — nothing to process
    expect(applyReinforcement(db)).toBe(0);
    const afterSecond = db.getMemory("mem-a")!.strength;
    expect(afterSecond).toBe(afterFirst); // unchanged
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

// -- updateCoRetrievalAssociations --

function insertExposure(sessionId: string, turnId: string, memoryId: string) {
  db.insertExposure({
    sessionId,
    turnId,
    memoryId,
    mode: "tool_search_returned",
    score: 0.8,
    retrievalMode: "hybrid",
    createdAt: "2026-03-01T00:00:00Z",
  });
}

describe("updateCoRetrievalAssociations", () => {
  it("creates associations from memories exposed in same turn", () => {
    insertMemory("mem-a", 0.5);
    insertMemory("mem-b", 0.5);
    insertMemory("mem-c", 0.5);

    insertExposure("s1", "t1", "mem-a");
    insertExposure("s1", "t1", "mem-b");
    insertExposure("s1", "t1", "mem-c");

    const count = updateCoRetrievalAssociations(db);
    // 3 pairs: a-b, a-c, b-c
    expect(count).toBe(3);

    expect(db.getAssociationWeight("mem-a", "mem-b")).toBeGreaterThan(0);
    expect(db.getAssociationWeight("mem-a", "mem-c")).toBeGreaterThan(0);
    expect(db.getAssociationWeight("mem-b", "mem-c")).toBeGreaterThan(0);
  });

  it("accumulates weight across multiple turns", () => {
    insertMemory("mem-a", 0.5);
    insertMemory("mem-b", 0.5);

    insertExposure("s1", "t1", "mem-a");
    insertExposure("s1", "t1", "mem-b");
    insertExposure("s1", "t2", "mem-a");
    insertExposure("s1", "t2", "mem-b");

    updateCoRetrievalAssociations(db);

    // Two turns of co-retrieval: probabilistic OR twice
    // First: 0 + 0.1 - 0*0.1 = 0.1
    // Second: 0.1 + 0.1 - 0.1*0.1 = 0.19
    expect(db.getAssociationWeight("mem-a", "mem-b")).toBeCloseTo(0.19, 5);
  });

  it("ignores turns with only one memory", () => {
    insertMemory("mem-a", 0.5);
    insertExposure("s1", "t1", "mem-a");

    expect(updateCoRetrievalAssociations(db)).toBe(0);
  });

  it("returns 0 when no exposures exist", () => {
    expect(updateCoRetrievalAssociations(db)).toBe(0);
  });

  it("skips deleted/nonexistent memories", () => {
    insertMemory("mem-a", 0.5);
    // mem-b not in memories table but has exposure
    insertExposure("s1", "t1", "mem-a");
    db.insertExposure({
      sessionId: "s1",
      turnId: "t1",
      memoryId: "orphan",
      mode: "tool_search_returned",
      score: 0.5,
      retrievalMode: "hybrid",
      createdAt: "2026-03-01T00:00:00Z",
    });

    const count = updateCoRetrievalAssociations(db);
    expect(count).toBe(0); // only one valid memory in the group
  });
});

// -- updateTransitiveAssociations --

describe("updateTransitiveAssociations", () => {
  it("creates indirect association from 1-hop path", () => {
    insertMemory("mem-a", 0.5);
    insertMemory("mem-b", 0.5);
    insertMemory("mem-c", 0.5);

    // A→B (0.5) and B→C (0.5) → A→C should be created
    db.upsertAssociation("mem-a", "mem-b", 0.5, "2026-03-01T00:00:00Z");
    db.upsertAssociation("mem-b", "mem-c", 0.5, "2026-03-01T00:00:00Z");

    const count = updateTransitiveAssociations(db);
    expect(count).toBeGreaterThanOrEqual(1);

    // Transitive weight: 0.5 × 0.5 = 0.25 (above threshold 0.1)
    expect(db.getAssociationWeight("mem-a", "mem-c")).toBeCloseTo(0.25, 5);
  });

  it("skips transitive if weight below threshold", () => {
    insertMemory("mem-a", 0.5);
    insertMemory("mem-b", 0.5);
    insertMemory("mem-c", 0.5);

    // A→B (0.2) and B→C (0.3) → 0.06 < 0.1 threshold
    db.upsertAssociation("mem-a", "mem-b", 0.2, "2026-03-01T00:00:00Z");
    db.upsertAssociation("mem-b", "mem-c", 0.3, "2026-03-01T00:00:00Z");

    updateTransitiveAssociations(db);
    expect(db.getAssociationWeight("mem-a", "mem-c")).toBe(0);
  });

  it("respects maxUpdates cap", () => {
    insertMemory("mem-a", 0.5);
    insertMemory("mem-b", 0.5);
    insertMemory("mem-c", 0.5);
    insertMemory("mem-d", 0.5);

    db.upsertAssociation("mem-a", "mem-b", 0.5, "2026-03-01T00:00:00Z");
    db.upsertAssociation("mem-a", "mem-c", 0.5, "2026-03-01T00:00:00Z");
    db.upsertAssociation("mem-a", "mem-d", 0.5, "2026-03-01T00:00:00Z");

    const count = updateTransitiveAssociations(db, 1);
    expect(count).toBe(1);
  });
});

// -- applyPruning --

describe("applyPruning", () => {
  it("prunes memories with strength ≤ threshold", () => {
    insertMemory("strong", 0.5);
    insertMemory("weak", 0.04); // below 0.05

    const result = applyPruning(db);
    expect(result.memoriesPruned).toBe(1);
    expect(db.getMemory("strong")).not.toBeNull();
    expect(db.getMemory("weak")).toBeNull();
  });

  it("prunes memory at exactly the threshold", () => {
    insertMemory("borderline", 0.05);

    const result = applyPruning(db);
    expect(result.memoriesPruned).toBe(1);
    expect(db.getMemory("borderline")).toBeNull();
  });

  it("preserves attribution after memory pruning", () => {
    insertMemory("mem-a", 0.03);
    db.upsertAttribution({
      messageId: "t1:msg:1",
      memoryId: "mem-a",
      evidence: "tool_get",
      confidence: 0.6,
      turnId: "t1",
      createdAt: "2026-03-01T00:00:00Z",
    });

    applyPruning(db);

    expect(db.getMemory("mem-a")).toBeNull();
    // Attribution survives (durable)
    const attrs = db.getAttributionsByMemory("mem-a");
    expect(attrs).toHaveLength(1);
  });

  it("prunes weak associations", () => {
    insertMemory("mem-a", 0.5);
    insertMemory("mem-b", 0.5);
    insertMemory("mem-c", 0.5);
    db.upsertAssociation("mem-a", "mem-b", 0.005, "2026-03-01T00:00:00Z"); // below 0.01
    db.upsertAssociation("mem-a", "mem-c", 0.5, "2026-03-01T00:00:00Z");

    const result = applyPruning(db);
    expect(result.associationsPruned).toBe(1);
    expect(db.getAssociationWeight("mem-a", "mem-b")).toBe(0);
    expect(db.getAssociationWeight("mem-a", "mem-c")).toBe(0.5);
  });

  it("returns zeros when nothing to prune", () => {
    insertMemory("healthy", 0.8);
    const result = applyPruning(db);
    expect(result.memoriesPruned).toBe(0);
    expect(result.associationsPruned).toBe(0);
  });
});

// -- applyTemporalTransitions --

describe("applyTemporalTransitions", () => {
  it("transitions future → present when anchor date has passed", () => {
    const pastDate = new Date(Date.now() - 1000 * 60 * 60).toISOString(); // 1h ago
    db.insertMemory({
      id: "mem-a",
      type: "plan",
      content: "meeting tomorrow",
      temporal_state: "future",
      temporal_anchor: pastDate,
      created_at: "2026-03-01T00:00:00Z",
      strength: 1.0,
      source: "agent_tool",
      consolidated: false,
      file_path: "working.md",
    });

    const count = applyTemporalTransitions(db);
    expect(count).toBe(1);
    expect(db.getMemory("mem-a")!.temporal_state).toBe("present");
  });

  it("transitions present → past when anchor is > 24h old", () => {
    const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(); // 25h ago
    db.insertMemory({
      id: "mem-a",
      type: "event",
      content: "meeting happened",
      temporal_state: "present",
      temporal_anchor: oldDate,
      created_at: "2026-03-01T00:00:00Z",
      strength: 1.0,
      source: "agent_tool",
      consolidated: false,
      file_path: "working.md",
    });

    const count = applyTemporalTransitions(db);
    expect(count).toBe(1);
    expect(db.getMemory("mem-a")!.temporal_state).toBe("past");
  });

  it("does not transition present → past if anchor < 24h old", () => {
    const recentDate = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(); // 12h ago
    db.insertMemory({
      id: "mem-a",
      type: "event",
      content: "meeting just happened",
      temporal_state: "present",
      temporal_anchor: recentDate,
      created_at: "2026-03-01T00:00:00Z",
      strength: 1.0,
      source: "agent_tool",
      consolidated: false,
      file_path: "working.md",
    });

    expect(applyTemporalTransitions(db)).toBe(0);
    expect(db.getMemory("mem-a")!.temporal_state).toBe("present");
  });

  it("ignores memories without temporal_anchor", () => {
    insertMemory("mem-a", 0.5); // temporal_anchor is null
    expect(applyTemporalTransitions(db)).toBe(0);
  });

  it("does not transition 'none' state", () => {
    db.insertMemory({
      id: "mem-a",
      type: "fact",
      content: "atemporal fact",
      temporal_state: "none",
      temporal_anchor: new Date(Date.now() - 100 * 60 * 60 * 1000).toISOString(),
      created_at: "2026-03-01T00:00:00Z",
      strength: 1.0,
      source: "agent_tool",
      consolidated: false,
      file_path: "working.md",
    });

    expect(applyTemporalTransitions(db)).toBe(0);
  });
});

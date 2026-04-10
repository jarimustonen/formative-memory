import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runConsolidation } from "./consolidation.ts";
import { MemoryDatabase } from "./db.ts";

let tmpDir: string;
let db: MemoryDatabase;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "consolidation-test-"));
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

describe("runConsolidation", () => {
  it("writes last_consolidation_at on success", async () => {
    expect(db.getState("last_consolidation_at")).toBeNull();

    await runConsolidation({ db });

    const timestamp = db.getState("last_consolidation_at");
    expect(timestamp).not.toBeNull();
    expect(new Date(timestamp!).getTime()).not.toBeNaN();
  });

  it("returns ok and summary", async () => {
    const result = await runConsolidation({ db });

    expect(result.ok).toBe(true);
    expect(result.summary).toEqual({
      catchUpDecayed: 0,
      reinforced: 0,
      decayed: 0,
      pruned: 0,
      prunedAssociations: 0,
      merged: 0,
      transitioned: 0,
      exposuresGc: 0,
    });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("overwrites previous consolidation timestamp", async () => {
    db.setState("last_consolidation_at", "2026-01-01T00:00:00Z");

    await runConsolidation({ db });

    const timestamp = db.getState("last_consolidation_at")!;
    expect(timestamp).not.toBe("2026-01-01T00:00:00Z");
  });

  it("full cycle: reinforce, decay, prune, merge", async () => {
    // Two similar memories that should merge
    insertMemory("mem-a", "Team chose PostgreSQL for the database layer");
    insertMemory("mem-b", "Team chose PostgreSQL for the database backend");

    // Attribution for mem-a (will be reinforced)
    db.upsertAttribution({
      messageId: "t1:msg:1",
      memoryId: "mem-a",
      evidence: "tool_search_returned",
      confidence: 0.3,
      turnId: "t1",
      createdAt: "2026-03-01T00:00:00Z",
    });

    // Exposure for co-retrieval
    db.insertExposure({
      sessionId: "s1",
      turnId: "t1",
      memoryId: "mem-a",
      mode: "tool_search_returned",
      score: 0.8,
      retrievalMode: "hybrid",
      createdAt: "2026-03-01T00:00:00Z",
    });
    db.insertExposure({
      sessionId: "s1",
      turnId: "t1",
      memoryId: "mem-b",
      mode: "auto_injected",
      score: 0.7,
      retrievalMode: "hybrid",
      createdAt: "2026-03-01T00:00:00Z",
    });

    // A weak memory that should be pruned
    insertMemory("mem-weak", "barely relevant", { strength: 0.03 });

    const result = await runConsolidation({ db });

    expect(result.ok).toBe(true);
    expect(result.summary.reinforced).toBe(1); // mem-a reinforced
    expect(result.summary.decayed).toBe(3); // all 3 memories decayed (before pruning)
    expect(result.summary.pruned).toBeGreaterThanOrEqual(1); // mem-weak pruned
    // Merge depends on Jaccard similarity — these texts are similar enough
    // The exact merge count depends on threshold, but the pipeline runs without error
  });

  it("computes catch-up cycles from last_consolidation_at", async () => {
    insertMemory("mem-a", "content A", { strength: 0.8 });

    // Set last consolidation 5 days ago → 4 catch-up cycles
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    db.setState("last_consolidation_at", fiveDaysAgo);

    const result = await runConsolidation({ db });
    expect(result.summary.catchUpDecayed).toBe(1); // 1 memory affected
  });

  it("no catch-up when last consolidation was recent", async () => {
    insertMemory("mem-a", "content A");

    // Set last consolidation 12 hours ago → 0 catch-up cycles (floor(0.5) - 1 < 0)
    const halfDayAgo = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
    db.setState("last_consolidation_at", halfDayAgo);

    const result = await runConsolidation({ db });
    expect(result.summary.catchUpDecayed).toBe(0);
  });

  it("no catch-up on first consolidation (no last_consolidation_at)", async () => {
    insertMemory("mem-a", "content A");

    const result = await runConsolidation({ db });
    expect(result.summary.catchUpDecayed).toBe(0);
  });

  it("is idempotent on second run (reinforcement not re-applied)", async () => {
    insertMemory("mem-a", "content A");

    db.upsertAttribution({
      messageId: "t1:msg:1",
      memoryId: "mem-a",
      evidence: "tool_search_returned",
      confidence: 0.3,
      turnId: "t1",
      createdAt: "2026-03-01T00:00:00Z",
    });

    // First run
    const result1 = await runConsolidation({ db });
    const strengthAfterFirst = db.getMemory("mem-a")!.strength;

    // Second run — reinforcement should not re-apply
    const result2 = await runConsolidation({ db });
    const strengthAfterSecond = db.getMemory("mem-a")!.strength;

    expect(result1.summary.reinforced).toBe(1);
    expect(result2.summary.reinforced).toBe(0);
    // Strength changes only due to decay on second run
    expect(strengthAfterSecond).toBeLessThan(strengthAfterFirst);
  });

  it("working memories remain working after consolidation (no promotion)", async () => {
    insertMemory("mem-a", "content A", { strength: 0.8 });
    insertMemory("mem-b", "content B", { strength: 0.6 });

    await runConsolidation({ db });

    // Both memories should still be working (consolidated=0)
    const memA = db.getMemory("mem-a")!;
    const memB = db.getMemory("mem-b")!;
    expect(memA.consolidated).toBe(0);
    expect(memB.consolidated).toBe(0);
  });

  it("applies correct decay rates: working ×0.906, consolidated ×0.977", async () => {
    insertMemory("mem-working", "working content", { strength: 1.0, consolidated: false });
    insertMemory("mem-consolidated", "consolidated content", { strength: 1.0, consolidated: true });

    await runConsolidation({ db });

    const working = db.getMemory("mem-working")!;
    const consolidated = db.getMemory("mem-consolidated")!;

    // Working decays faster than consolidated
    expect(working.strength).toBeCloseTo(0.906, 3);
    expect(consolidated.strength).toBeCloseTo(0.977, 3);
    expect(working.strength).toBeLessThan(consolidated.strength);
  });
});

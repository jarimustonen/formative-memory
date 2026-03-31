import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runConsolidation } from "./consolidation.ts";
import { MemoryDatabase } from "./db.ts";
import type { MemoryManager } from "./memory-manager.ts";

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

function stubManager(): MemoryManager {
  return {} as unknown as MemoryManager;
}

describe("runConsolidation", () => {
  it("writes last_consolidation_at on success", async () => {
    expect(db.getState("last_consolidation_at")).toBeNull();

    await runConsolidation({
      db,
      manager: stubManager(),
      logPath: join(tmpDir, "retrieval.log"),
    });

    const timestamp = db.getState("last_consolidation_at");
    expect(timestamp).not.toBeNull();
    // Should be a valid ISO timestamp
    expect(new Date(timestamp!).getTime()).not.toBeNaN();
  });

  it("returns ok and summary", async () => {
    const result = await runConsolidation({
      db,
      manager: stubManager(),
      logPath: join(tmpDir, "retrieval.log"),
    });

    expect(result.ok).toBe(true);
    expect(result.summary).toEqual({
      reinforced: 0,
      decayed: 0,
      pruned: 0,
      merged: 0,
      transitioned: 0,
    });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("overwrites previous consolidation timestamp", async () => {
    db.setState("last_consolidation_at", "2026-01-01T00:00:00Z");

    await runConsolidation({
      db,
      manager: stubManager(),
      logPath: join(tmpDir, "retrieval.log"),
    });

    const timestamp = db.getState("last_consolidation_at")!;
    expect(timestamp).not.toBe("2026-01-01T00:00:00Z");
  });
});

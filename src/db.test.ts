import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryDatabase } from "./db.ts";

let db: MemoryDatabase;
let dbDir: string;

beforeEach(() => {
  dbDir = join(tmpdir(), `amem-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dbDir, { recursive: true });
  db = new MemoryDatabase(join(dbDir, "test.db"));
});

afterEach(() => {
  db.close();
  rmSync(dbDir, { recursive: true, force: true });
});

describe("MemoryDatabase", () => {
  describe("state", () => {
    it("gets and sets state", () => {
      db.setState("test_key", "test_value");
      expect(db.getState("test_key")).toBe("test_value");
    });

    it("returns null for missing key", () => {
      expect(db.getState("nonexistent")).toBeNull();
    });
  });

  describe("memories", () => {
    const sampleMemory = {
      id: "abc123",
      type: "fact",
      temporal_state: "none" as const,
      temporal_anchor: null,
      created_at: "2026-03-01T10:00:00Z",
      strength: 1.0,
      source: "agent_tool" as const,
      consolidated: false,
      file_path: "working.md",
    };

    it("inserts and retrieves memory", () => {
      db.insertMemory(sampleMemory);
      const mem = db.getMemory("abc123");
      expect(mem).not.toBeNull();
      expect(mem!.id).toBe("abc123");
      expect(mem!.type).toBe("fact");
      expect(mem!.strength).toBe(1.0);
    });

    it("returns null for missing memory", () => {
      expect(db.getMemory("nonexistent")).toBeNull();
    });

    it("updates strength", () => {
      db.insertMemory(sampleMemory);
      db.updateStrength("abc123", 0.5);
      expect(db.getMemory("abc123")!.strength).toBe(0.5);
    });

    it("deletes memory and related data", () => {
      db.insertMemory(sampleMemory);
      db.setEmbedding("abc123", [1, 2, 3]);
      db.insertFts("abc123", "test content", "fact");
      db.deleteMemory("abc123");
      expect(db.getMemory("abc123")).toBeNull();
      expect(db.getEmbedding("abc123")).toBeNull();
    });

    it("lists working vs consolidated memories", () => {
      db.insertMemory(sampleMemory);
      db.insertMemory({
        ...sampleMemory,
        id: "def456",
        consolidated: true,
        file_path: "consolidated.md",
      });
      expect(db.getWorkingMemories()).toHaveLength(1);
      expect(db.getConsolidatedMemories()).toHaveLength(1);
    });
  });

  describe("embeddings", () => {
    it("stores and retrieves embedding", () => {
      const embedding = [0.1, 0.2, 0.3, 0.4];
      db.setEmbedding("test_id", embedding);
      const result = db.getEmbedding("test_id");
      expect(result).not.toBeNull();
      expect(result!).toHaveLength(4);
      expect(result![0]).toBeCloseTo(0.1, 5);
      expect(result![3]).toBeCloseTo(0.4, 5);
    });

    it("returns null for missing embedding", () => {
      expect(db.getEmbedding("nonexistent")).toBeNull();
    });

    it("gets all embeddings", () => {
      db.setEmbedding("a", [1, 2]);
      db.setEmbedding("b", [3, 4]);
      const all = db.getAllEmbeddings();
      expect(all).toHaveLength(2);
    });
  });

  describe("FTS", () => {
    it("indexes and searches", () => {
      db.insertFts("id1", "the quick brown fox", "fact");
      db.insertFts("id2", "the lazy dog", "narrative");
      const results = db.searchFts('"fox"');
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("id1");
    });
  });

  describe("associations", () => {
    it("creates and retrieves association", () => {
      db.upsertAssociation("aaa", "bbb", 0.5, "2026-03-01");
      const assocs = db.getAssociations("aaa");
      expect(assocs).toHaveLength(1);
      expect(assocs[0].weight).toBe(0.5);
    });

    it("sorts memory_a < memory_b", () => {
      db.upsertAssociation("zzz", "aaa", 0.3, "2026-03-01");
      const assocs = db.getAssociations("aaa");
      expect(assocs[0].memory_a).toBe("aaa");
      expect(assocs[0].memory_b).toBe("zzz");
    });

    it("updates existing association", () => {
      db.upsertAssociation("a", "b", 0.3, "2026-03-01");
      db.upsertAssociation("a", "b", 0.7, "2026-03-02");
      const assocs = db.getAssociations("a");
      expect(assocs).toHaveLength(1);
      expect(assocs[0].weight).toBe(0.7);
    });

    it("deletes association", () => {
      db.upsertAssociation("a", "b", 0.5, "2026-03-01");
      db.deleteAssociation("a", "b");
      expect(db.getAssociations("a")).toHaveLength(0);
    });
  });

  describe("stats", () => {
    it("returns correct counts", () => {
      const s = db.stats();
      expect(s.total).toBe(0);
      expect(s.working).toBe(0);
      expect(s.consolidated).toBe(0);
      expect(s.associations).toBe(0);
    });
  });

  describe("schema migration", () => {
    it("sets schema_version to 2", () => {
      expect(db.getState("schema_version")).toBe("2");
    });
  });

  describe("exposure (provenance)", () => {
    const exposure = {
      sessionId: "s1",
      turnId: "t1",
      memoryId: "mem1",
      mode: "auto_injected",
      score: 0.85,
      retrievalMode: "hybrid",
      createdAt: "2026-03-31T10:00:00Z",
    };

    it("inserts and retrieves exposure", () => {
      db.insertExposure(exposure);
      const rows = db.getExposures("s1", "t1");
      expect(rows).toHaveLength(1);
      expect(rows[0].memory_id).toBe("mem1");
      expect(rows[0].mode).toBe("auto_injected");
      expect(rows[0].score).toBe(0.85);
      expect(rows[0].retrieval_mode).toBe("hybrid");
    });

    it("is idempotent (INSERT OR IGNORE on PK conflict)", () => {
      db.insertExposure(exposure);
      db.insertExposure(exposure); // same PK
      expect(db.getExposures("s1", "t1")).toHaveLength(1);
    });

    it("allows multiple modes for same memory in same turn", () => {
      db.insertExposure(exposure);
      db.insertExposure({ ...exposure, mode: "tool_search" });
      expect(db.getExposures("s1", "t1")).toHaveLength(2);
    });

    it("queries by memory_id", () => {
      db.insertExposure(exposure);
      db.insertExposure({ ...exposure, sessionId: "s2", turnId: "t2" });
      expect(db.getExposuresByMemory("mem1")).toHaveLength(2);
    });

    it("deletes exposures for session", () => {
      db.insertExposure(exposure);
      db.insertExposure({ ...exposure, sessionId: "s2", turnId: "t2" });
      db.deleteExposuresForSession("s1");
      expect(db.getExposuresByMemory("mem1")).toHaveLength(1);
    });

    it("deletes exposures older than cutoff", () => {
      db.insertExposure(exposure);
      db.insertExposure({ ...exposure, turnId: "t2", createdAt: "2026-04-30T10:00:00Z" });
      db.deleteExposuresOlderThan("2026-04-01T00:00:00Z");
      const remaining = db.getExposures("s1", "t2");
      expect(remaining).toHaveLength(1);
    });
  });

  describe("attribution (provenance)", () => {
    const attribution = {
      messageId: "msg1",
      memoryId: "mem1",
      evidence: "tool_search_returned",
      confidence: 0.3,
      turnId: "t1",
      createdAt: "2026-03-31T10:00:00Z",
    };

    it("inserts and retrieves attribution", () => {
      db.upsertAttribution(attribution);
      const rows = db.getAttributions("mem1");
      expect(rows).toHaveLength(1);
      expect(rows[0].evidence).toBe("tool_search_returned");
      expect(rows[0].confidence).toBe(0.3);
    });

    it("upserts on PK conflict (updates evidence and confidence)", () => {
      db.upsertAttribution(attribution);
      db.upsertAttribution({ ...attribution, evidence: "agent_feedback_positive", confidence: 0.95 });
      const rows = db.getAttributions("mem1");
      expect(rows).toHaveLength(1);
      expect(rows[0].evidence).toBe("agent_feedback_positive");
      expect(rows[0].confidence).toBe(0.95);
    });

    it("queries by turn_id", () => {
      db.upsertAttribution(attribution);
      db.upsertAttribution({ ...attribution, messageId: "msg2", memoryId: "mem2" });
      expect(db.getAttributionsForTurn("t1")).toHaveLength(2);
    });

    it("deletes attributions for specific messages", () => {
      db.upsertAttribution(attribution);
      db.upsertAttribution({ ...attribution, messageId: "msg2" });
      db.deleteAttributionsForMessages(["msg1"]);
      const rows = db.getAttributions("mem1");
      expect(rows).toHaveLength(1);
      expect(rows[0].message_id).toBe("msg2");
    });

    it("handles empty message list in delete", () => {
      db.upsertAttribution(attribution);
      db.deleteAttributionsForMessages([]);
      expect(db.getAttributions("mem1")).toHaveLength(1);
    });
  });

  describe("replaceMemoryId", () => {
    it("replaces id in memories, FTS, embeddings and associations", () => {
      db.insertMemory({
        id: "old_id",
        type: "fact",
        temporal_state: "none",
        temporal_anchor: null,
        created_at: "2026-03-01",
        strength: 0.8,
        source: "agent_tool",
        consolidated: false,
        file_path: "working.md",
      });
      db.setEmbedding("old_id", [1, 2, 3]);
      db.insertFts("old_id", "some content", "fact");
      db.upsertAssociation("old_id", "other_id", 0.5, "2026-03-01");

      db.replaceMemoryId("old_id", "new_id", "new content");

      expect(db.getMemory("old_id")).toBeNull();
      expect(db.getMemory("new_id")).not.toBeNull();
      expect(db.getEmbedding("new_id")).not.toBeNull();
      const assocs = db.getAssociations("new_id");
      expect(assocs).toHaveLength(1);
    });
  });
});

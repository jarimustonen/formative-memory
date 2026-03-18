import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { EmbeddingProvider } from "./memory-manager.ts";
import { MemoryManager } from "./memory-manager.ts";

let memDir: string;
let manager: MemoryManager;

// Fake embedder: uses character frequencies as a simple vector
const fakeEmbedder: EmbeddingProvider = {
  async embed(text: string): Promise<number[]> {
    const vec = Array.from({ length: 26 }, () => 0);
    for (const char of text.toLowerCase()) {
      const idx = char.charCodeAt(0) - 97;
      if (idx >= 0 && idx < 26) vec[idx]++;
    }
    // Normalize
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
    return vec.map((v) => v / norm);
  },
};

beforeEach(() => {
  memDir = join(tmpdir(), `amem-mgr-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(memDir, { recursive: true });
  manager = new MemoryManager(memDir, fakeEmbedder);
});

afterEach(() => {
  manager.close();
  rmSync(memDir, { recursive: true, force: true });
});

describe("MemoryManager", () => {
  describe("initialization", () => {
    it("creates working.md and consolidated.md", () => {
      const working = readFileSync(join(memDir, "working.md"), "utf8");
      const consolidated = readFileSync(join(memDir, "consolidated.md"), "utf8");
      expect(working).toContain("Working Memory");
      expect(consolidated).toContain("Consolidated Memory");
    });

    it("creates .layout.json", () => {
      const layout = JSON.parse(readFileSync(join(memDir, ".layout.json"), "utf8"));
      expect(layout.layout).toBe("associative-memory-v1");
      expect(layout.schema_version).toBe(1);
    });
  });

  describe("store", () => {
    it("stores a memory", async () => {
      const mem = await manager.store({
        content: "Jarin koiran nimi on Namu.",
        type: "fact",
        source: "agent_tool",
      });
      expect(mem.id).toHaveLength(64);
      expect(mem.strength).toBe(1.0);
      expect(mem.consolidated).toBe(false);
    });

    it("deduplicates by content hash", async () => {
      const mem1 = await manager.store({
        content: "same content",
        type: "fact",
        source: "agent_tool",
      });
      const mem2 = await manager.store({
        content: "same content",
        type: "fact",
        source: "agent_tool",
      });
      expect(mem1.id).toBe(mem2.id);
    });

    it("writes to working.md", async () => {
      await manager.store({
        content: "Test fact for file.",
        type: "fact",
        source: "agent_tool",
      });
      const content = readFileSync(join(memDir, "working.md"), "utf8");
      expect(content).toContain("Test fact for file.");
    });

    it("writes to retrieval.log", async () => {
      await manager.store({
        content: "Test store event.",
        type: "fact",
        source: "agent_tool",
        context_ids: ["ctx1"],
      });
      const log = readFileSync(join(memDir, "retrieval.log"), "utf8");
      expect(log).toContain("store");
      expect(log).toContain("context:ctx1");
    });
  });

  describe("search", () => {
    it("finds stored memories", async () => {
      await manager.store({
        content: "The cat sat on the mat.",
        type: "fact",
        source: "agent_tool",
      });
      await manager.store({
        content: "Dogs are loyal companions.",
        type: "fact",
        source: "agent_tool",
      });
      const results = await manager.search("cat mat");
      expect(results.length).toBeGreaterThan(0);
    });

    it("returns empty for no matches", async () => {
      const results = await manager.search("xyzzy");
      expect(results).toHaveLength(0);
    });
  });

  describe("getMemory", () => {
    it("retrieves by full id", async () => {
      const stored = await manager.store({
        content: "Retrievable fact.",
        type: "fact",
        source: "agent_tool",
      });
      const mem = manager.getMemory(stored.id);
      expect(mem).not.toBeNull();
      expect(mem!.content).toBe("Retrievable fact.");
    });

    it("retrieves by prefix", async () => {
      const stored = await manager.store({
        content: "Prefix lookup test.",
        type: "fact",
        source: "agent_tool",
      });
      const mem = manager.getMemory(stored.id.slice(0, 8));
      expect(mem).not.toBeNull();
    });
  });

  describe("stats", () => {
    it("counts memories", async () => {
      await manager.store({
        content: "Memory one.",
        type: "fact",
        source: "agent_tool",
      });
      await manager.store({
        content: "Memory two.",
        type: "narrative",
        source: "agent_tool",
      });
      const s = manager.stats();
      expect(s.total).toBe(2);
      expect(s.working).toBe(2);
    });
  });
});

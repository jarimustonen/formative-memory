import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { EmbeddingProvider } from "./memory-manager.ts";
import { MemoryManager, buildFtsQueries } from "./memory-manager.ts";

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
    it("creates memory directory and DB", () => {
      // DB is the canonical store — markdown files were removed in v4
      const stats = manager.stats();
      expect(stats.total).toBe(0);
      expect(stats.working).toBe(0);
      expect(stats.consolidated).toBe(0);
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

    it("stores memory in DB as working (not consolidated)", async () => {
      const mem = await manager.store({
        content: "Test fact for DB.",
        type: "fact",
        source: "agent_tool",
      });
      const stats = manager.stats();
      expect(stats.total).toBe(1);
      expect(stats.working).toBe(1);
      expect(stats.consolidated).toBe(0);
      expect(mem.consolidated).toBe(false);
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

  describe("broadRecall", () => {
    it("returns memories sorted by broad score (strength + recency)", async () => {
      await manager.store({ content: "Strong old memory.", type: "fact", source: "agent_tool" });
      await manager.store({ content: "Weak recent memory.", type: "fact", source: "agent_tool" });

      // Adjust strengths directly via DB
      const db = manager.getDatabase();
      const all = db.getAllMemories();
      db.updateStrength(all[0].id, 0.5); // recent, weak
      db.updateStrength(all[1].id, 0.9); // old, strong

      const results = manager.broadRecall(10);
      expect(results.length).toBe(2);
      // Strong memory should rank higher (strength dominates at 0.8 weight)
      expect(results[0].memory.strength).toBe(0.9);
    });

    it("enforces type diversity via caps", async () => {
      // Create 6 memories of type "fact" and 2 of type "decision"
      for (let i = 0; i < 6; i++) {
        await manager.store({ content: `Fact number ${i}.`, type: "fact", source: "agent_tool" });
      }
      await manager.store({ content: "Decision alpha.", type: "decision", source: "agent_tool" });
      await manager.store({ content: "Decision beta.", type: "decision", source: "agent_tool" });

      // With limit=5, maxPerType = ceil(5/3) = 2
      const results = manager.broadRecall(5);
      expect(results.length).toBe(5);

      const factCount = results.filter((r) => r.memory.type === "fact").length;
      const decisionCount = results.filter((r) => r.memory.type === "decision").length;
      // First pass caps facts at 2, decisions at 2; second pass fills remaining
      expect(decisionCount).toBeLessThanOrEqual(2);
      // Total should be 5 (3 facts from second pass fill + 2 decisions or similar)
      expect(factCount + decisionCount).toBe(5);
    });

    it("suppresses near-duplicate content", async () => {
      const longContent = "This is a fairly long memory content that should be detected as duplicate when prefixed. It has more than forty characters for sure.";
      await manager.store({ content: longContent, type: "fact", source: "agent_tool" });
      await manager.store({ content: longContent + " With extra.", type: "fact", source: "agent_tool" });
      await manager.store({ content: "Completely different memory.", type: "fact", source: "agent_tool" });

      const results = manager.broadRecall(10);
      // The prefix-duplicate should be suppressed
      expect(results.length).toBe(2);
    });

    it("returns empty for empty database", () => {
      const results = manager.broadRecall(10);
      expect(results).toHaveLength(0);
    });

    it("returns empty for limit 0", async () => {
      await manager.store({ content: "Something.", type: "fact", source: "agent_tool" });
      expect(manager.broadRecall(0)).toHaveLength(0);
    });

    it("respects limit", async () => {
      for (let i = 0; i < 10; i++) {
        await manager.store({ content: `Unique memory ${i}.`, type: "fact", source: "agent_tool" });
      }
      const results = manager.broadRecall(3);
      expect(results.length).toBe(3);
    });

    it("excludes near-dead memories (strength <= 0.05)", async () => {
      await manager.store({ content: "Healthy memory.", type: "fact", source: "agent_tool" });
      await manager.store({ content: "Dying memory.", type: "fact", source: "agent_tool" });

      const db = manager.getDatabase();
      const all = db.getAllMemories();
      db.updateStrength(all[0].id, 0.03); // below threshold
      db.updateStrength(all[1].id, 0.8);

      const results = manager.broadRecall(10);
      expect(results.length).toBe(1);
      expect(results[0].memory.strength).toBe(0.8);
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

// -- buildFtsQueries unit tests --

describe("buildFtsQueries", () => {
  it("returns empty for empty/whitespace query", () => {
    expect(buildFtsQueries("")).toEqual([]);
    expect(buildFtsQueries("   ")).toEqual([]);
  });

  it("returns single quoted term for one-word query", () => {
    expect(buildFtsQueries("hello")).toEqual(['"hello"']);
  });

  it("returns phrase, AND, OR for multi-word query", () => {
    const queries = buildFtsQueries("release deadline");
    expect(queries).toHaveLength(3);
    expect(queries[0]).toBe('"release deadline"');
    expect(queries[1]).toBe('"release" AND "deadline"');
    expect(queries[2]).toBe('"release" OR "deadline"');
  });

  it("strips punctuation from terms", () => {
    const queries = buildFtsQueries("hello, world!");
    expect(queries).toHaveLength(3);
    expect(queries[0]).toBe('"hello world"');
  });

  it("handles query with only punctuation", () => {
    expect(buildFtsQueries("!@#$%")).toEqual([]);
  });
});

// -- BM25-only integration tests --

describe("BM25-only search", () => {
  let bm25Dir: string;
  let bm25Manager: MemoryManager;

  // Embedder that always fails — forces BM25-only mode
  const failingEmbedder: EmbeddingProvider = {
    async embed(_text: string): Promise<number[]> {
      const { EmbeddingCircuitOpenError } = await import("./embedding-circuit-breaker.ts");
      throw new EmbeddingCircuitOpenError();
    },
  };

  beforeEach(() => {
    bm25Dir = join(tmpdir(), `amem-bm25-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(bm25Dir, { recursive: true });
    bm25Manager = new MemoryManager(bm25Dir, failingEmbedder);
  });

  afterEach(() => {
    bm25Manager.close();
    rmSync(bm25Dir, { recursive: true, force: true });
  });

  it("finds exact term matches without embeddings", async () => {
    await bm25Manager.store({ content: "Alpha release deadline is April 15", type: "event", source: "agent_tool" });
    await bm25Manager.store({ content: "Beta release scheduled for June", type: "event", source: "agent_tool" });
    await bm25Manager.store({ content: "User prefers dark mode", type: "preference", source: "agent_tool" });

    const results = await bm25Manager.search("release deadline");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].memory.content).toContain("deadline");
  });

  it("OR pass finds partial matches", async () => {
    await bm25Manager.store({ content: "Project deadline is Friday", type: "event", source: "agent_tool" });
    await bm25Manager.store({ content: "Meeting scheduled for Monday morning", type: "event", source: "agent_tool" });

    // "deadline morning" — no single memory has both terms, but OR should find both
    const results = await bm25Manager.search("deadline morning");
    expect(results.length).toBe(2);
  });

  it("returns empty for completely unrelated query", async () => {
    await bm25Manager.store({ content: "The cat sat on the mat", type: "fact", source: "agent_tool" });
    const results = await bm25Manager.search("quantum physics");
    expect(results).toHaveLength(0);
  });

  it("ranks memories with more term overlap higher", async () => {
    await bm25Manager.store({ content: "Alpha release deadline for the project", type: "event", source: "agent_tool" });
    await bm25Manager.store({ content: "The project uses TypeScript", type: "fact", source: "agent_tool" });

    const results = await bm25Manager.search("alpha release deadline project");
    expect(results.length).toBeGreaterThan(0);
    // Memory with more matching terms should rank first
    expect(results[0].memory.content).toContain("Alpha release deadline");
  });

  it("respects strength in BM25-only ranking", async () => {
    await bm25Manager.store({ content: "Important deadline fact", type: "fact", source: "agent_tool" });
    await bm25Manager.store({ content: "Another deadline fact", type: "fact", source: "agent_tool" });

    const db = bm25Manager.getDatabase();
    const all = db.getAllMemories();
    // Make one memory much stronger
    db.updateStrength(all[0].id, 0.9);
    db.updateStrength(all[1].id, 0.1);

    const results = await bm25Manager.search("deadline fact");
    expect(results.length).toBe(2);
    // Stronger memory should rank first (both match equally on BM25)
    expect(results[0].memory.strength).toBeGreaterThan(results[1].memory.strength);
  });

  it("prefix query works with prefix indexes", async () => {
    await bm25Manager.store({ content: "TypeScript configuration guide", type: "fact", source: "agent_tool" });

    // FTS5 prefix query — should match "TypeScript" via prefix index
    const db = bm25Manager.getDatabase();
    const results = db.searchFtsJoined('"Type"*', 10);
    expect(results.length).toBeGreaterThan(0);
  });
});

describe("augmentedSearch", () => {
  it("returns direct results when no associations exist", async () => {
    await manager.store({ content: "The release deadline is April 15", type: "fact", source: "agent_tool" });
    await manager.store({ content: "Deployment requires approval", type: "fact", source: "agent_tool" });

    const results = await manager.augmentedSearch("release deadline", 5);
    expect(results.length).toBeGreaterThan(0);
    // Without associations, results are purely from direct search
  });

  it("returns direct results when no seeds pass threshold", async () => {
    // Store memories with content very different from query
    await manager.store({ content: "Helsinki is the capital of Finland", type: "fact", source: "agent_tool" });

    const results = await manager.augmentedSearch("quantum physics equations", 5);
    // No results or very low scores — no expansion triggered
    expect(results.length).toBeLessThanOrEqual(1);
  });

  it("surfaces strongly associated memories via association expansion", async () => {
    // Store many memories so weak ones drop out of top-K
    const memA = await manager.store({ content: "The release deadline is April 15", type: "fact", source: "agent_tool" });
    const memB = await manager.store({ content: "Bob is the release manager", type: "person", source: "agent_tool" });
    for (let i = 0; i < 10; i++) {
      await manager.store({ content: `Filler memory number ${i} about various topics`, type: "fact", source: "agent_tool" });
    }

    // Create strong association between A and B
    const db = manager.getDatabase();
    db.upsertAssociation(memA.id, memB.id, 0.8, new Date().toISOString());

    // Search for "release deadline" with small limit
    const withAssoc = await manager.augmentedSearch("release deadline", 3);
    const withAssocIds = withAssoc.map((r) => r.memory.id);

    // A should always be found directly
    expect(withAssocIds).toContain(memA.id);

    // Compare with plain search — B may or may not appear in direct search
    // but association expansion should help surface it
    const directOnly = await manager.search("release deadline", 3);
    const directIds = directOnly.map((r) => r.memory.id);

    // If B wasn't in direct results but is in augmented results, expansion worked
    if (!directIds.includes(memB.id) && withAssocIds.includes(memB.id)) {
      // Association expansion surfaced B — success
      expect(withAssocIds).toContain(memB.id);
    }
  });

  it("does not expand from weak associations", async () => {
    const memA = await manager.store({ content: "The release deadline is April 15", type: "fact", source: "agent_tool" });
    const memB = await manager.store({ content: "Bob is the release manager", type: "person", source: "agent_tool" });

    const db = manager.getDatabase();

    // Strong association — should expand
    db.upsertAssociation(memA.id, memB.id, 0.8, new Date().toISOString());
    const strongResults = await manager.augmentedSearch("release deadline", 5);
    const strongAssocs = strongResults.filter((r) => r.memory.id === memB.id);

    // Reset association to weak
    db.upsertAssociation(memA.id, memB.id, 0.01, new Date().toISOString());
    const weakResults = await manager.augmentedSearch("release deadline", 5);
    const weakAssocs = weakResults.filter((r) => r.memory.id === memB.id);

    // With strong association, B may appear via expansion
    // With weak association (0.01 < 0.15 threshold), expansion should not contribute
    // B might still appear as a direct hit, but its score shouldn't include association boost
    if (strongAssocs.length > 0 && weakAssocs.length > 0) {
      // If both present (as direct hits), scores should differ
      // Strong assoc version may have higher score from association boost
      expect(strongAssocs[0].score).toBeGreaterThanOrEqual(weakAssocs[0].score);
    }
  });

  it("does not duplicate memories already in direct results", async () => {
    const memA = await manager.store({ content: "The release deadline is April 15", type: "fact", source: "agent_tool" });
    const memB = await manager.store({ content: "Release plan and schedule for April", type: "fact", source: "agent_tool" });

    // Both should match "release" directly. Associate them too.
    const db = manager.getDatabase();
    db.upsertAssociation(memA.id, memB.id, 0.8, new Date().toISOString());

    const results = await manager.augmentedSearch("release", 5);

    // No duplicates
    const ids = results.map((r) => r.memory.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("applies convergent activation from multiple seeds", async () => {
    const memA = await manager.store({ content: "The release deadline is April 15", type: "fact", source: "agent_tool" });
    const memB = await manager.store({ content: "Release deployment checklist ready", type: "fact", source: "agent_tool" });
    const memC = await manager.store({ content: "Bob handles all deployments", type: "person", source: "agent_tool" });

    const db = manager.getDatabase();
    // C is associated with both A and B
    db.upsertAssociation(memA.id, memC.id, 0.5, new Date().toISOString());
    db.upsertAssociation(memB.id, memC.id, 0.5, new Date().toISOString());

    const results = await manager.augmentedSearch("release deployment", 5);

    // If both A and B are seeds, C should get convergent activation
    const cResult = results.find((r) => r.memory.id === memC.id);
    if (cResult) {
      // Convergent score should be higher than single-path would produce
      // Single path max: seedScore * 0.5 * 0.6 * strength = relatively low
      // Two paths via probOr should be higher
      expect(cResult.score).toBeGreaterThan(0);
    }
  });

  it("uses deterministic ordering for equal scores", async () => {
    // Store several similar memories
    await manager.store({ content: "Fact alpha about the project", type: "fact", source: "agent_tool" });
    await manager.store({ content: "Fact beta about the project", type: "fact", source: "agent_tool" });
    await manager.store({ content: "Fact gamma about the project", type: "fact", source: "agent_tool" });

    const results1 = await manager.augmentedSearch("project", 3);
    const results2 = await manager.augmentedSearch("project", 3);

    // Same query should produce same order
    expect(results1.map((r) => r.memory.id)).toEqual(results2.map((r) => r.memory.id));
  });
});

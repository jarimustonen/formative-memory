/**
 * Consolidation test harness
 *
 * Tests consolidation with realistic memory fixtures. Each test:
 * 1. Creates a temp DB
 * 2. Imports a fixture (inline JSON matching export format)
 * 3. Runs consolidation with a configurable merge producer
 * 4. Asserts on the result state
 *
 * This lets us test consolidation behavior without the full OpenClaw runtime.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryDatabase } from "./db.ts";
import { runConsolidation, type ConsolidationResult } from "./consolidation.ts";
import type { MergeContentProducer } from "./merge-execution.ts";
import type { AttributionEvidence, RetrievalMode } from "./types.ts";

// -- Helpers --

let tmpDir: string;
let db: MemoryDatabase;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "consolidation-harness-"));
  db = new MemoryDatabase(join(tmpDir, "associations.db"));
});

afterEach(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

type MemoryFixture = {
  id: string;
  content: string;
  type?: string;
  strength?: number;
  temporal_state?: string;
  temporal_anchor?: string | null;
  source?: string;
  consolidated?: boolean;
  created_at?: string;
};

type ExposureFixture = {
  session_id: string;
  turn_id: string;
  memory_ids: string[];
  retrieval_mode?: RetrievalMode;
};

type AttributionFixture = {
  message_id: string;
  turn_id: string;
  memory_id: string;
  confidence: number;
  evidence?: AttributionEvidence;
};

function loadFixture(
  memories: MemoryFixture[],
  opts?: { exposures?: ExposureFixture[]; attributions?: AttributionFixture[] },
) {
  for (const mem of memories) {
    db.insertMemory({
      id: mem.id,
      type: mem.type ?? "fact",
      content: mem.content,
      temporal_state: (mem.temporal_state as any) ?? "none",
      temporal_anchor: mem.temporal_anchor ?? null,
      created_at: mem.created_at ?? "2026-04-06T10:00:00.000Z",
      strength: mem.strength ?? 1.0,
      source: (mem.source as any) ?? "agent_tool",
      consolidated: mem.consolidated ?? false,
    });
  }

  // Write provenance: exposures (co-retrieval source)
  if (opts?.exposures) {
    for (const exp of opts.exposures) {
      for (const memId of exp.memory_ids) {
        db.insertExposure({
          sessionId: exp.session_id,
          turnId: exp.turn_id,
          memoryId: memId,
          mode: "auto_injected",
          score: 0.5,
          retrievalMode: exp.retrieval_mode ?? "hybrid",
          createdAt: new Date().toISOString(),
        });
      }
    }
  }

  // Write provenance: attributions (reinforcement source)
  if (opts?.attributions) {
    for (const attr of opts.attributions) {
      db.upsertAttribution({
        messageId: attr.message_id,
        memoryId: attr.memory_id,
        turnId: attr.turn_id,
        confidence: attr.confidence,
        evidence: attr.evidence ?? "auto_injected",
        createdAt: new Date().toISOString(),
      });
    }
  }
}

function consolidate(mergeProducer?: MergeContentProducer): Promise<ConsolidationResult> {
  return runConsolidation({
    db,
    mergeContentProducer: mergeProducer,
  });
}

function getMemories() {
  return db.getAllMemories().map((m) => ({
    id: m.id,
    shortId: m.id.slice(0, 8),
    content: m.content.slice(0, 80),
    strength: Math.round(m.strength * 1000) / 1000,
    type: m.type,
    temporal_state: m.temporal_state,
    temporal_anchor: m.temporal_anchor,
    consolidated: m.consolidated === 1,
    source: m.source,
  }));
}

/** Pad short name to 64 chars (SHA-256 hash length). Use 8-char names for readable short IDs. */
function id(short: string): string {
  if (short.length > 8) throw new Error(`ID prefix must be ≤8 chars: "${short}"`);
  return short.padEnd(64, "0");
}

// LLM merge mock that actually merges content intelligently
const smartMerge: MergeContentProducer = async (a, b) => ({
  content: `${a.content} (also: ${b.content})`.slice(0, 200),
  type: a.type,
});

// -- Tests --

describe("consolidation harness", () => {
  describe("basic lifecycle", () => {
    it("empty DB — no-op", async () => {
      const result = await consolidate();

      expect(result.ok).toBe(true);
      expect(result.summary.reinforced).toBe(0);
      expect(result.summary.decayed).toBe(0);
      expect(result.summary.merged).toBe(0);
    });

    it("single memory — decay + promote", async () => {
      loadFixture([
        { id: id("fct00001"), content: "Jarin lempiväri on vihreä." },
      ]);

      const result = await consolidate();

      expect(result.summary.decayed).toBeGreaterThan(0);
      expect(result.summary.promoted).toBeGreaterThan(0);

      const mems = getMemories();
      expect(mems).toHaveLength(1);
      expect(mems[0].strength).toBeLessThan(1.0); // decayed
      expect(mems[0].consolidated).toBe(true); // promoted
    });
  });

  describe("duplicate merge", () => {
    it("near-duplicate memories get merged with LLM (smart merge)", async () => {
      // Use highly overlapping content to exceed Jaccard threshold (0.6)
      loadFixture([
        {
          id: id("hlsnki01"),
          content: "Jari on työmatkalla Helsingissä viikolla 15 huhtikuussa 2026 maanantaista perjantaihin.",
          temporal_state: "future",
          temporal_anchor: "2026-04-13",
        },
        {
          id: id("hlsnki02"),
          content: "Jari on työmatkalla Helsingissä viikolla 15 huhtikuussa 2026 maanantaista perjantaihin asti.",
          temporal_state: "future",
          temporal_anchor: "2026-04-13",
        },
      ]);

      const result = await consolidate(smartMerge);

      expect(result.summary.merged).toBe(1);

      const mems = getMemories();
      // Should have 3: 2 originals (weakened) + 1 merged
      const strong = mems.filter((m) => m.strength > 0.5);
      const weak = mems.filter((m) => m.strength <= 0.5);
      expect(strong).toHaveLength(1);
      expect(weak).toHaveLength(2);
      expect(strong[0].source).toBe("consolidation");
    });

    it("near-duplicate memories get merged with LLM producer", async () => {
      loadFixture([
        {
          id: id("hlsnki01"),
          content: "Jari on työmatkalla Helsingissä viikolla 15 huhtikuussa 2026 maanantaista perjantaihin.",
        },
        {
          id: id("hlsnki02"),
          content: "Jari on työmatkalla Helsingissä viikolla 15 huhtikuussa 2026 maanantaista perjantaihin asti.",
        },
      ]);

      const mockLlmMerge: MergeContentProducer = async (a, b) => ({
        content: "Jari on työmatkalla Helsingissä viikolla 15 (ma–pe) huhtikuussa 2026.",
        type: "fact",
      });

      const result = await consolidate(mockLlmMerge);

      expect(result.summary.merged).toBe(1);

      const mems = getMemories();
      const merged = mems.find((m) => m.source === "consolidation");
      expect(merged).toBeDefined();
      expect(merged!.content).toContain("työmatkalla Helsingissä");
    });

    it("LLM merge produces a single coherent sentence, not concatenation", async () => {
      const contentA = "Jari on työmatkalla Helsingissä viikolla 15 huhtikuussa 2026 maanantaista perjantaihin.";
      const contentB = "Jari on työmatkalla Helsingissä viikolla 15 huhtikuussa 2026 maanantaista perjantaihin asti.";

      loadFixture([
        { id: id("hlsnki01"), content: contentA },
        { id: id("hlsnki02"), content: contentB },
      ]);

      const mockLlmMerge: MergeContentProducer = async (a, b) => {
        // Simulate what a good LLM should return: a single coherent sentence,
        // NOT a concatenation of both inputs.
        return {
          content: "Jari on työmatkalla Helsingissä viikolla 15 (ma–pe) huhtikuussa 2026.",
          type: "fact",
        };
      };

      await consolidate(mockLlmMerge);

      const mems = getMemories();
      const merged = mems.find((m) => m.source === "consolidation");
      expect(merged).toBeDefined();

      // Merged content should be SHORTER than either original (concise synthesis)
      expect(merged!.content.length).toBeLessThanOrEqual(Math.max(contentA.length, contentB.length));

      // Should NOT contain both originals verbatim (that's concatenation, not merging)
      expect(merged!.content).not.toContain(contentA);
      expect(merged!.content).not.toContain(contentB);

      // Should still contain the essential information
      expect(merged!.content).toContain("Helsingissä");
      expect(merged!.content).toContain("viikolla 15");
    });

    it("no merge without LLM — duplicates survive until LLM is available", async () => {
      loadFixture([
        {
          id: id("hlsnki01"),
          content: "Jari on työmatkalla Helsingissä viikolla 15 huhtikuussa 2026 maanantaista perjantaihin.",
        },
        {
          id: id("hlsnki02"),
          content: "Jari on työmatkalla Helsingissä viikolla 15 huhtikuussa 2026 maanantaista perjantaihin asti.",
        },
      ]);

      // No merge producer = merge phase skipped entirely
      const result = await consolidate();

      expect(result.summary.merged).toBe(0);

      // Both memories survive (decayed but not merged)
      const mems = getMemories();
      expect(mems.filter((m) => m.source !== "consolidation")).toHaveLength(2);
    });
  });

  describe("decay and reinforcement", () => {
    it("unretrieved memories decay", async () => {
      loadFixture([
        { id: id("pgres001"), content: "Jarin suosikkitietokanta on PostgreSQL." },
        { id: id("tscrpt01"), content: "Jarin suosikkikieli on TypeScript." },
      ]);

      const result = await consolidate();

      const mems = getMemories();
      for (const m of mems) {
        expect(m.strength).toBeLessThan(1.0);
      }
    });

    it("retrieved memories get reinforced (decay less)", async () => {
      // Use sub-1.0 strength so reinforcement can increase it
      loadFixture(
        [
          { id: id("pgres001"), content: "Jarin suosikkitietokanta on PostgreSQL.", strength: 0.5 },
          { id: id("tscrpt01"), content: "Jarin suosikkikieli on TypeScript.", strength: 0.5 },
        ],
        {
          exposures: [
            {
              session_id: "s1",
              turn_id: "t1",
              memory_ids: [id("pgres001")],
            },
          ],
          attributions: [
            {
              message_id: "m1",
              turn_id: "t1",
              memory_id: id("pgres001"),
              confidence: 0.5,
              evidence: "auto_injected",
            },
          ],
        },
      );

      const result = await consolidate();

      expect(result.summary.reinforced).toBeGreaterThan(0);

      const mems = getMemories();
      const postgres = mems.find((m) => m.shortId === "pgres001");
      const typescript = mems.find((m) => m.shortId === "tscrpt01");
      expect(postgres).toBeDefined();
      expect(typescript).toBeDefined();
      // Retrieved memory should be stronger than unretrieved
      expect(postgres!.strength).toBeGreaterThan(typescript!.strength);
    });
  });

  describe("pruning", () => {
    it("very weak memories get pruned", async () => {
      loadFixture([
        { id: id("strong01"), content: "Important fact.", strength: 0.8 },
        { id: id("dying001"), content: "Forgotten fact.", strength: 0.04 },
      ]);

      const result = await consolidate();

      expect(result.summary.pruned).toBe(1);

      const mems = getMemories();
      expect(mems).toHaveLength(1);
      expect(mems[0].shortId).toBe("strong01");
    });
  });

  describe("temporal transitions", () => {
    it("past-due future memories transition to present/past", async () => {
      loadFixture([
        {
          id: id("pastdue1"),
          content: "Kokous eilen klo 10.",
          temporal_state: "future",
          temporal_anchor: "2026-04-01T10:00:00.000Z", // in the past
        },
      ]);

      const result = await consolidate();

      expect(result.summary.transitioned).toBe(1);

      const mems = getMemories();
      expect(mems[0].temporal_state).not.toBe("future");
    });
  });

  describe("co-retrieval associations", () => {
    it("memories retrieved together get associated", async () => {
      loadFixture(
        [
          { id: id("color001"), content: "Jarin lempiväri on vihreä." },
          { id: id("nature01"), content: "Jari asuu metsän keskellä." },
          { id: id("unrelat1"), content: "PostgreSQL on hyvä tietokanta." },
        ],
        {
          exposures: [
            {
              session_id: "s1",
              turn_id: "t1",
              memory_ids: [id("color001"), id("nature01")],
            },
          ],
        },
      );

      const result = await consolidate();

      // Check associations were created
      const assocs = db.getAssociations(id("color001"));
      expect(assocs.length).toBeGreaterThan(0);
      const assocIds = assocs.map((a) => a.memory_a === id("color001") ? a.memory_b : a.memory_a);
      expect(assocIds).toContain(id("nature01"));
      // Unrelated memory should not be associated
      expect(assocIds).not.toContain(id("unrelat1"));
    });
  });

  describe("realistic scenario: Sylvia's first week", () => {
    it("full lifecycle with mixed memories, retrievals, and merge", async () => {
      loadFixture(
        [
          {
            id: id("green001"),
            content: "Jarin lempiväri on vihreä.",
            type: "fact",
            strength: 0.7,
          },
          {
            id: id("leevi001"),
            content: "Leevi harrastaa judoa.",
            type: "fact",
            strength: 0.7,
          },
          {
            id: id("pgres001"),
            content: "Jarin suosikkitietokanta on PostgreSQL.",
            type: "preference",
            strength: 0.7,
          },
          {
            id: id("hlsnki01"),
            content: "Jari on Helsingissä viikolla 15.",
            type: "fact",
            temporal_state: "future",
            temporal_anchor: "2026-04-13",
          },
          {
            id: id("hlsnki02"),
            content: "Jari on työmatkalla Helsingissä viikolla 15 (13.–18.4.2026).",
            type: "fact",
            temporal_state: "future",
            temporal_anchor: "2026-04-13",
          },
          {
            id: id("fading01"),
            content: "Vanha muistutus joka ei ole enää relevantti.",
            type: "observation",
            strength: 0.03, // below pruning threshold
          },
        ],
        {
          exposures: [
            // Green retrieved in two turns (popular)
            { session_id: "s1", turn_id: "t1", memory_ids: [id("green001")] },
            { session_id: "s1", turn_id: "t2", memory_ids: [id("green001"), id("leevi001")] },
            // PostgreSQL once
            { session_id: "s1", turn_id: "t3", memory_ids: [id("pgres001")] },
          ],
          attributions: [
            { message_id: "m1", turn_id: "t1", memory_id: id("green001"), confidence: 0.5 },
            { message_id: "m2", turn_id: "t2", memory_id: id("green001"), confidence: 0.7 },
            { message_id: "m3", turn_id: "t2", memory_id: id("leevi001"), confidence: 0.3 },
            { message_id: "m4", turn_id: "t3", memory_id: id("pgres001"), confidence: 0.5 },
          ],
        },
      );

      const result = await consolidate(smartMerge);

      // Should have: 1 prune, decay on all, reinforcement on retrieved
      expect(result.summary.pruned).toBe(1); // fading01
      expect(result.summary.reinforced).toBeGreaterThan(0);
      expect(result.summary.decayed).toBeGreaterThan(0);

      const mems = getMemories();

      // Pruned memory should be gone
      expect(mems.find((m) => m.content.includes("Vanha muistutus"))).toBeUndefined();

      // Green (retrieved twice) should be stronger than PostgreSQL (retrieved once)
      const green = mems.find((m) => m.shortId === "green001");
      const postgres = mems.find((m) => m.shortId === "pgres001");
      expect(green).toBeDefined();
      expect(postgres).toBeDefined();
      if (green && postgres) {
        expect(green.strength).toBeGreaterThanOrEqual(postgres.strength);
      }

      // Green and Leevi should be associated (co-retrieved in turn t2)
      const assocs = db.getAssociations(id("green001"));
      const assocIds = assocs.map((a) => a.memory_a === id("green001") ? a.memory_b : a.memory_a);
      expect(assocIds).toContain(id("leevi001"));
    });
  });
});


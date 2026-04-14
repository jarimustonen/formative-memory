/**
 * Merge execution — Phase 4.5
 *
 * Executes memory merges: creates new consolidated memory from a pair,
 * manages originals (weaken or delete intermediates), inherits
 * associations, and writes aliases.
 *
 * Supports three outcomes:
 * - **New memory**: merged content is novel → create new canonical memory
 * - **Absorption**: merged content matches one source → that source becomes canonical
 * - **Reuse**: merged content matches an existing third memory → validate and refresh
 *
 * Historical attributions are NOT rewritten.
 * Alias table enables provenance tracing from old IDs to canonical IDs.
 *
 * Architecture: v2 §9.
 */

import type { MemoryDatabase, MemoryRow } from "./db.ts";
import { contentHash } from "./hash.ts";
import type { Logger } from "./logger.ts";
import { nullLogger } from "./logger.ts";
import type { MergePair } from "./merge-candidates.ts";
import type { MemorySource } from "./types.ts";

// -- Types --

export type MergeContentProducer = (
  memoryA: { id: string; content: string; type: string },
  memoryB: { id: string; content: string; type: string },
) => Promise<{ content: string; type: string }>;

export type EmbedderFn = (text: string) => Promise<number[] | null>;

export type MergeResult = {
  newMemoryId: string;
  mergedFrom: [string, string];
  /** Which source was absorbed (null if new memory created). */
  absorbedInto: string | null;
  originalsWeakened: string[];
  intermediatesDeleted: string[];
  aliasesCreated: string[];
};

// -- Main entry point --

/**
 * Execute a single merge: A + B → C.
 *
 * Three possible outcomes based on content hash:
 * 1. newId matches source A or B (absorption): that source is the canonical result,
 *    the other source is weakened/deleted+aliased. No new memory created.
 * 2. newId matches an existing third memory (reuse): validate content match,
 *    refresh strength to 1.0, handle sources normally.
 * 3. newId is novel: create new memory with source="consolidation".
 */
export async function executeMerge(
  db: MemoryDatabase,
  pair: MergePair,
  contentProducer: MergeContentProducer,
  embedder?: EmbedderFn,
  log: Logger = nullLogger,
): Promise<MergeResult> {
  if (pair.a === pair.b) {
    throw new Error(`Merge failed: cannot merge memory with itself (${pair.a})`);
  }

  const memA = db.getMemory(pair.a);
  const memB = db.getMemory(pair.b);

  if (!memA || !memB) {
    throw new Error(`Merge failed: memory not found (${pair.a}, ${pair.b})`);
  }

  log.debug(`merge: combining:\n  A: "${memA.content.slice(0, 100)}"\n  B: "${memB.content.slice(0, 100)}"`);

  // 1. Produce merged content (async, outside transaction)
  const merged = await contentProducer(
    { id: memA.id, content: memA.content, type: memA.type },
    { id: memB.id, content: memB.content, type: memB.type },
  );

  const newId = contentHash(merged.content);
  const now = new Date().toISOString();

  // Determine merge outcome
  const isAbsorptionA = newId === memA.id;
  const isAbsorptionB = newId === memB.id;
  const isAbsorption = isAbsorptionA || isAbsorptionB;

  // Generate embedding only for novel content (absorption reuses existing)
  let embedding: number[] | null = null;
  if (!isAbsorption && embedder) {
    try {
      embedding = await embedder(merged.content);
    } catch {
      // Circuit breaker or API error — memory is still searchable via BM25/FTS
    }
  }

  // 2. All DB mutations in a single transaction
  return db.transaction(() => {
    let canonicalId: string;

    if (isAbsorption) {
      // Absorption: one source IS the canonical result
      // The canonical source gets strength boost, the other is absorbed
      canonicalId = newId;
      db.updateStrength(canonicalId, 1.0);
    } else {
      // Check if newId matches an existing third memory
      const existing = db.getMemory(newId);
      if (existing) {
        // Reuse: validate content match, refresh strength
        if (existing.content !== merged.content) {
          throw new Error(`Merge failed: hash collision for ${newId} with different content`);
        }
        db.updateStrength(newId, 1.0);
      } else {
        // Novel: create new memory
        db.insertMemory({
          id: newId,
          type: merged.type,
          content: merged.content,
          temporal_state: "none",
          temporal_anchor: null,
          created_at: now,
          strength: 1.0,
          source: "consolidation",
          consolidated: true,
        });
        db.insertFts(newId, merged.content, merged.type);
        if (embedding) {
          db.setEmbedding(newId, embedding);
        }
      }
      canonicalId = newId;
    }

    // Handle the other source(s) — skip the canonical source in absorption
    const originalsWeakened: string[] = [];
    const intermediatesDeleted: string[] = [];
    const aliasesCreated: string[] = [];

    for (const mem of [memA, memB]) {
      // In absorption, the canonical source is kept as-is (already strength-boosted)
      if (mem.id === canonicalId) continue;

      if (isIntermediate(mem)) {
        db.deleteMemory(mem.id);
        db.insertAlias(mem.id, canonicalId, "merged", now);
        intermediatesDeleted.push(mem.id);
        aliasesCreated.push(mem.id);
      } else {
        const weakenedStrength = Math.max(0, mem.strength * 0.3);
        db.updateStrength(mem.id, weakenedStrength);
        originalsWeakened.push(mem.id);
      }
    }

    // Inherit associations from absorbed/weakened sources into canonical
    inheritAssociations(db, [memA.id, memB.id], canonicalId, now);

    const outcome = isAbsorption ? "absorption" : "new";
    log.info(
      `merge: ${outcome} → "${merged.content.slice(0, 80)}" (${canonicalId.slice(0, 8)}…)`,
    );
    if (originalsWeakened.length > 0) {
      log.debug(`merge: weakened originals: ${originalsWeakened.map((id) => id.slice(0, 8) + "…").join(", ")}`);
    }
    if (intermediatesDeleted.length > 0) {
      log.debug(`merge: deleted intermediates: ${intermediatesDeleted.map((id) => id.slice(0, 8) + "…").join(", ")}`);
    }

    return {
      newMemoryId: canonicalId,
      mergedFrom: [pair.a, pair.b] as [string, string],
      absorbedInto: isAbsorption ? canonicalId : null,
      originalsWeakened,
      intermediatesDeleted,
      aliasesCreated,
    };
  });
}

/**
 * Execute multiple merges from a list of candidate pairs.
 * Pairs are processed in order (highest score first).
 * Skips pairs where either memory was already consumed.
 */
export async function executeMerges(
  db: MemoryDatabase,
  pairs: MergePair[],
  contentProducer: MergeContentProducer,
  embedder?: EmbedderFn,
  log: Logger = nullLogger,
): Promise<MergeResult[]> {
  const consumed = new Set<string>();
  const results: MergeResult[] = [];

  for (const pair of pairs) {
    if (consumed.has(pair.a) || consumed.has(pair.b)) continue;
    if (!db.getMemory(pair.a) || !db.getMemory(pair.b)) continue;

    const result = await executeMerge(db, pair, contentProducer, embedder, log);
    results.push(result);

    consumed.add(pair.a);
    consumed.add(pair.b);
    consumed.add(result.newMemoryId);
  }

  if (results.length > 0) {
    log.info(`merge: ${results.length} merges completed`);
  }

  return results;
}

// -- Helpers --

function isIntermediate(mem: MemoryRow): boolean {
  return mem.source === "consolidation";
}

/**
 * Inherit associations from source memories to the canonical memory.
 * Uses probabilistic OR for combining weights.
 * Respects existing associations on canonical (combines, doesn't overwrite).
 * Skips edges from canonical to itself or between sources.
 */
function inheritAssociations(
  db: MemoryDatabase,
  sourceIds: string[],
  canonicalId: string,
  now: string,
): void {
  const sourceSet = new Set(sourceIds);
  const neighborWeights = new Map<string, number>();

  for (const sourceId of sourceIds) {
    // In absorption, canonical is one of the sources — skip its self-edges
    if (sourceId === canonicalId) continue;

    const assocs = db.getAssociations(sourceId);
    for (const assoc of assocs) {
      const neighbor = assoc.memory_a === sourceId ? assoc.memory_b : assoc.memory_a;
      if (neighbor === canonicalId || sourceSet.has(neighbor)) continue;

      const existing = neighborWeights.get(neighbor) ?? 0;
      const combined = existing + assoc.weight - existing * assoc.weight;
      neighborWeights.set(neighbor, combined);
    }
  }

  for (const [neighbor, inheritedWeight] of neighborWeights) {
    const existingWeight = db.getAssociationWeight(canonicalId, neighbor);
    const finalWeight = existingWeight + inheritedWeight - existingWeight * inheritedWeight;
    db.upsertAssociation(canonicalId, neighbor, finalWeight, now);
  }
}

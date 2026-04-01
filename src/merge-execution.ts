/**
 * Merge execution — Phase 4.5
 *
 * Executes memory merges: creates new consolidated memory from a pair,
 * manages originals (weaken or delete intermediates), inherits
 * associations and attributions, writes aliases.
 *
 * Architecture: v2 §9.
 */

import type { MemoryDatabase, MemoryRow } from "./db.ts";
import { contentHash } from "./hash.ts";
import type { MergePair } from "./merge-candidates.ts";
import type { MemorySource } from "./types.ts";

// -- Types --

/**
 * Content producer function. In production this calls an LLM.
 * In tests, it can be a deterministic stub.
 */
export type MergeContentProducer = (
  memoryA: { id: string; content: string; type: string },
  memoryB: { id: string; content: string; type: string },
) => Promise<{ content: string; type: string }>;

export type MergeResult = {
  newMemoryId: string;
  mergedFrom: [string, string];
  originalsWeakened: string[];
  intermediatesDeleted: string[];
  aliasesCreated: string[];
};

// -- Main entry point --

/**
 * Execute a single merge: A + B → C.
 *
 * 1. Produce merged content (via contentProducer — LLM or stub)
 * 2. Create new memory C (source: "consolidation", strength: 1.0)
 * 3. Handle originals:
 *    - If source is "consolidation" (intermediate) → delete + alias
 *    - Otherwise (original) → weaken to strength × 0.1
 * 4. Inherit associations from A and B to C (probabilistic OR)
 * 5. Rewrite attributions from A and B to C
 *
 * Must be called inside a DB transaction.
 */
export async function executeMerge(
  db: MemoryDatabase,
  pair: MergePair,
  contentProducer: MergeContentProducer,
): Promise<MergeResult> {
  const memA = db.getMemory(pair.a);
  const memB = db.getMemory(pair.b);

  if (!memA || !memB) {
    throw new Error(`Merge failed: memory not found (${pair.a}, ${pair.b})`);
  }

  const now = new Date().toISOString();

  // 1. Produce merged content
  const merged = await contentProducer(
    { id: memA.id, content: memA.content, type: memA.type },
    { id: memB.id, content: memB.content, type: memB.type },
  );

  // 2. Create new memory
  const newId = contentHash(merged.content);

  // Skip if merged content produces same hash as existing memory
  if (!db.getMemory(newId)) {
    db.insertMemory({
      id: newId,
      type: merged.type,
      content: merged.content,
      temporal_state: "none",
      temporal_anchor: null,
      created_at: now,
      strength: 1.0,
      source: "consolidation" as MemorySource,
      consolidated: true,
      file_path: "consolidated.md",
    });
    db.insertFts(newId, merged.content, merged.type);
  }

  // 3. Handle originals
  const originalsWeakened: string[] = [];
  const intermediatesDeleted: string[] = [];
  const aliasesCreated: string[] = [];

  for (const mem of [memA, memB]) {
    if (isIntermediate(mem)) {
      // Intermediate (prior consolidation product) → delete + alias
      db.deleteMemory(mem.id);
      db.insertAlias(mem.id, newId, "merged", now);
      intermediatesDeleted.push(mem.id);
      aliasesCreated.push(mem.id);
    } else {
      // Original → weaken
      const weakenedStrength = Math.max(0, mem.strength * 0.1);
      db.updateStrength(mem.id, weakenedStrength);
      originalsWeakened.push(mem.id);
    }
  }

  // 4. Inherit associations (probabilistic OR)
  inheritAssociations(db, [memA.id, memB.id], newId, now);

  // 5. Rewrite attributions from merged sources to new memory
  rewriteAttributions(db, [memA.id, memB.id], newId);

  return {
    newMemoryId: newId,
    mergedFrom: [pair.a, pair.b],
    originalsWeakened,
    intermediatesDeleted,
    aliasesCreated,
  };
}

/**
 * Execute multiple merges from a list of candidate pairs.
 * Pairs are processed in order (highest score first from findMergeCandidates).
 * Skips pairs where either memory was already consumed by a prior merge.
 */
export async function executeMerges(
  db: MemoryDatabase,
  pairs: MergePair[],
  contentProducer: MergeContentProducer,
): Promise<MergeResult[]> {
  const consumed = new Set<string>();
  const results: MergeResult[] = [];

  for (const pair of pairs) {
    // Skip if either memory was already merged in this run
    if (consumed.has(pair.a) || consumed.has(pair.b)) continue;

    // Skip if either memory no longer exists (pruned earlier)
    if (!db.getMemory(pair.a) || !db.getMemory(pair.b)) continue;

    const result = await executeMerge(db, pair, contentProducer);
    results.push(result);

    consumed.add(pair.a);
    consumed.add(pair.b);
  }

  return results;
}

// -- Helpers --

/** A memory is an intermediate consolidation product if source is "consolidation". */
function isIntermediate(mem: MemoryRow): boolean {
  return mem.source === "consolidation";
}

/**
 * Inherit associations from source memories to the new merged memory.
 * Uses probabilistic OR: f(a,b) = a + b - a*b for combining weights
 * when both sources have an association to the same neighbor.
 */
function inheritAssociations(
  db: MemoryDatabase,
  sourceIds: string[],
  newId: string,
  now: string,
): void {
  // Collect all neighbor weights from all sources
  const neighborWeights = new Map<string, number>();

  for (const sourceId of sourceIds) {
    const assocs = db.getAssociations(sourceId);
    for (const assoc of assocs) {
      const neighbor = assoc.memory_a === sourceId ? assoc.memory_b : assoc.memory_a;

      // Skip self-references and other source memories
      if (neighbor === newId || sourceIds.includes(neighbor)) continue;

      const existing = neighborWeights.get(neighbor) ?? 0;
      // Probabilistic OR
      const combined = existing + assoc.weight - existing * assoc.weight;
      neighborWeights.set(neighbor, combined);
    }
  }

  // Write inherited associations
  for (const [neighbor, weight] of neighborWeights) {
    db.upsertAssociation(newId, neighbor, weight, now);
  }
}

/**
 * Rewrite attributions from source memory IDs to the new merged memory ID.
 * Uses mergeAttributionRow via replaceMemoryId-style logic to handle
 * PK collisions when both sources attributed the same message.
 */
function rewriteAttributions(
  db: MemoryDatabase,
  sourceIds: string[],
  newId: string,
): void {
  for (const sourceId of sourceIds) {
    const attrs = db.getAttributionsByMemory(sourceId);
    for (const attr of attrs) {
      // Use upsertAttribution which handles PK collision via mergeAttributionRow
      db.upsertAttribution({
        messageId: attr.message_id,
        memoryId: newId,
        evidence: attr.evidence,
        confidence: attr.confidence,
        turnId: attr.turn_id,
        createdAt: attr.created_at,
      });
    }
    // Delete old attributions for the source
    db.deleteAttributionsForMemory(sourceId);
  }
}

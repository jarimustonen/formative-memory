/**
 * Merge execution — Phase 4.5
 *
 * Executes memory merges: creates new consolidated memory from a pair,
 * manages originals (weaken or delete intermediates), inherits
 * associations, and writes aliases.
 *
 * Historical attributions are NOT rewritten. They remain attached to
 * the original memory IDs that actually influenced earlier responses.
 * Alias table enables provenance tracing from old IDs to canonical IDs.
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

/** Embedding generator. Returns null if unavailable (circuit breaker open, etc). */
export type EmbedderFn = (text: string) => Promise<number[] | null>;

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
 * 2. All DB mutations in a single transaction:
 *    - Create new memory C (source: "consolidation", strength: 1.0)
 *    - Handle originals: intermediates deleted+aliased, originals weakened
 *    - Inherit associations from A and B to C (probabilistic OR)
 * 3. Historical attributions left unchanged — old IDs stay in attribution rows
 */
export async function executeMerge(
  db: MemoryDatabase,
  pair: MergePair,
  contentProducer: MergeContentProducer,
  embedder?: EmbedderFn,
): Promise<MergeResult> {
  if (pair.a === pair.b) {
    throw new Error(`Merge failed: cannot merge memory with itself (${pair.a})`);
  }

  const memA = db.getMemory(pair.a);
  const memB = db.getMemory(pair.b);

  if (!memA || !memB) {
    throw new Error(`Merge failed: memory not found (${pair.a}, ${pair.b})`);
  }

  // 1. Produce merged content (async, outside transaction)
  const merged = await contentProducer(
    { id: memA.id, content: memA.content, type: memA.type },
    { id: memB.id, content: memB.content, type: memB.type },
  );

  const newId = contentHash(merged.content);
  const now = new Date().toISOString();

  // Generate embedding (async, outside transaction — graceful degradation)
  let embedding: number[] | null = null;
  if (embedder) {
    try {
      embedding = await embedder(merged.content);
    } catch {
      // Circuit breaker or API error — memory is still searchable via BM25/FTS
    }
  }

  // 2. All DB mutations in a single transaction
  return db.transaction(() => {
    // Create new memory (skip if hash collision with existing)
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
      if (embedding) {
        db.setEmbedding(newId, embedding);
      }
    }

    // Handle originals
    const originalsWeakened: string[] = [];
    const intermediatesDeleted: string[] = [];
    const aliasesCreated: string[] = [];

    for (const mem of [memA, memB]) {
      if (isIntermediate(mem)) {
        db.deleteMemory(mem.id);
        db.insertAlias(mem.id, newId, "merged", now);
        intermediatesDeleted.push(mem.id);
        aliasesCreated.push(mem.id);
      } else {
        const weakenedStrength = Math.max(0, mem.strength * 0.3);
        db.updateStrength(mem.id, weakenedStrength);
        originalsWeakened.push(mem.id);
      }
    }

    // Inherit associations (probabilistic OR, respects existing edges on newId)
    inheritAssociations(db, [memA.id, memB.id], newId, now);

    return {
      newMemoryId: newId,
      mergedFrom: [pair.a, pair.b] as [string, string],
      originalsWeakened,
      intermediatesDeleted,
      aliasesCreated,
    };
  });
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
  embedder?: EmbedderFn,
): Promise<MergeResult[]> {
  const consumed = new Set<string>();
  const results: MergeResult[] = [];

  for (const pair of pairs) {
    if (consumed.has(pair.a) || consumed.has(pair.b)) continue;
    if (!db.getMemory(pair.a) || !db.getMemory(pair.b)) continue;

    const result = await executeMerge(db, pair, contentProducer, embedder);
    results.push(result);

    consumed.add(pair.a);
    consumed.add(pair.b);
    consumed.add(result.newMemoryId);
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
 * Respects existing associations on newId (combines, doesn't overwrite).
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
      if (neighbor === newId || sourceIds.includes(neighbor)) continue;

      const existing = neighborWeights.get(neighbor) ?? 0;
      const combined = existing + assoc.weight - existing * assoc.weight;
      neighborWeights.set(neighbor, combined);
    }
  }

  // Write inherited associations, combining with any existing edges on newId
  for (const [neighbor, inheritedWeight] of neighborWeights) {
    const existingWeight = db.getAssociationWeight(newId, neighbor);
    const finalWeight = existingWeight + inheritedWeight - existingWeight * inheritedWeight;
    db.upsertAssociation(newId, neighbor, finalWeight, now);
  }
}

/**
 * Consolidation steps — Phase 4.1+
 *
 * Pure functions for each consolidation step.
 * All dependencies injected via parameters for testability.
 *
 * Architecture: v2 §8 (reinforcement), §9 (consolidation).
 */

import { writeFileSync } from "node:fs";
import { formatChunkFile, type ChunkEntry } from "./chunks.ts";
import type { MemoryDatabase } from "./db.ts";
import type { TemporalState } from "./types.ts";

// -- Constants --

/** Retrieval reinforcement learning rate (η). */
export const ETA = 0.7;

/** Decay multiplier for working (unconsolidated) memories per cycle. */
export const DECAY_WORKING = 0.906;

/** Decay multiplier for consolidated memories per cycle. */
export const DECAY_CONSOLIDATED = 0.977;

/** Decay multiplier for association weights per cycle. */
export const DECAY_ASSOCIATION = 0.9;

/** Mode weight for hybrid retrieval. */
export const MODE_WEIGHT_HYBRID = 1.0;

/** Mode weight for BM25-only retrieval (degraded). */
export const MODE_WEIGHT_BM25_ONLY = 0.5;

// -- Step 1: Retrieval reinforcement --

/**
 * Apply retrieval-based reinforcement to memory strengths.
 *
 * Processes only attribution rows not yet reinforced (reinforcement_applied=0).
 * For each, computes: reinforcement = η × confidence × mode_weight
 * and adds it to the memory's strength. Marks rows as reinforced atomically.
 *
 * mode_weight is determined by looking up the same-turn exposure's
 * retrieval_mode. If no exposure found, defaults to hybrid (1.0).
 *
 * Returns count of memories reinforced.
 */
export function applyReinforcement(db: MemoryDatabase): number {
  const pendingAttrs = db.getUnreinforcedAttributions();
  if (pendingAttrs.length === 0) return 0;

  // Group by memory_id and compute total reinforcement per memory
  const reinforcements = new Map<string, number>();

  for (const attr of pendingAttrs) {
    // Deterministic mode_weight: same turn exposure, or default hybrid
    const retrievalMode = db.getExposureRetrievalMode(attr.memory_id, attr.turn_id);
    const modeWeight =
      retrievalMode === "bm25_only" ? MODE_WEIGHT_BM25_ONLY : MODE_WEIGHT_HYBRID;

    const reinforcement = ETA * attr.confidence * modeWeight;

    const current = reinforcements.get(attr.memory_id) ?? 0;
    reinforcements.set(attr.memory_id, current + reinforcement);
  }

  // Apply reinforcements and mark as processed — all in one transaction
  return db.transaction(() => {
    let count = 0;

    for (const [memoryId, totalReinforcement] of reinforcements) {
      if (totalReinforcement === 0) continue;
      const mem = db.getMemory(memoryId);
      if (!mem) continue;

      const newStrength = Math.max(0, Math.min(mem.strength + totalReinforcement, 1.0));
      if (newStrength !== mem.strength) {
        db.updateStrength(memoryId, newStrength);
        count++;
      }
    }

    // Mark all processed rows as reinforced
    for (const attr of pendingAttrs) {
      db.markAttributionsReinforced(attr.message_id, attr.memory_id);
    }

    return count;
  });
}

// -- Step 2: Decay --

/**
 * Apply time-based decay to all memory strengths and association weights.
 *
 * Working memories decay faster (×0.906) than consolidated (×0.977).
 * Association weights also decay (×0.9) so they can eventually be pruned.
 *
 * Returns count of memories decayed.
 */
export function applyDecay(db: MemoryDatabase): number {
  const allMemories = db.getAllMemories();
  let count = 0;

  for (const mem of allMemories) {
    const factor = mem.consolidated ? DECAY_CONSOLIDATED : DECAY_WORKING;
    const newStrength = mem.strength * factor;
    db.updateStrength(mem.id, newStrength);
    count++;
  }

  // Decay association weights
  applyAssociationDecay(db);

  return count;
}

/**
 * Decay all association weights by DECAY_ASSOCIATION factor.
 */
export function applyAssociationDecay(db: MemoryDatabase): void {
  db.decayAllAssociationWeights(DECAY_ASSOCIATION);
}

// -- Step 3: Co-retrieval association update --

/** Minimum weight for a transitive association to be created. */
export const TRANSITIVE_WEIGHT_THRESHOLD = 0.1;

/** Base weight for a new co-retrieval association. */
const CO_RETRIEVAL_BASE_WEIGHT = 0.1;

/**
 * Update associations from co-retrieval events in the exposure table.
 *
 * Memories exposed in the same turn are co-retrieved and get an
 * association. Uses probabilistic OR for weight accumulation:
 * f(a,b) = a + b - a*b.
 *
 * Reads from turn_memory_exposure (SQLite) instead of retrieval.log,
 * which avoids replay-on-rerun issues. Exposure data is written by
 * afterTurn() and is already canonical in the DB.
 *
 * Returns count of associations updated.
 */
export function updateCoRetrievalAssociations(db: MemoryDatabase): number {
  const groups = db.getCoRetrievalGroups();
  const now = new Date().toISOString();
  const validIds = new Set(db.getAllMemories().map((m) => m.id));
  let count = 0;

  for (const group of groups) {
    const ids = group.memory_ids.filter((id) => validIds.has(id));
    if (ids.length < 2) continue;

    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = ids[i];
        const b = ids[j];

        const existing = db.getAssociationWeight(a, b);
        const newWeight = existing + CO_RETRIEVAL_BASE_WEIGHT - existing * CO_RETRIEVAL_BASE_WEIGHT;

        db.upsertAssociation(a, b, newWeight, now);
        count++;
      }
    }
  }

  return count;
}

// -- Step 4: Bounded transitive associations --

/**
 * Create indirect associations from 1-hop transitive paths.
 *
 * If A→B (weight w1) and B→C (weight w2), creates A→C with
 * weight = w1 × w2, but only if the result exceeds the threshold.
 *
 * Cap: at most maxUpdates new/updated associations per run.
 *
 * Returns count of associations created/updated.
 */
export function updateTransitiveAssociations(
  db: MemoryDatabase,
  maxUpdates = 100,
): number {
  const allMemories = db.getAllMemories();
  const now = new Date().toISOString();
  let count = 0;

  for (const mem of allMemories) {
    if (count >= maxUpdates) break;

    const neighbors = db.getAssociations(mem.id);
    for (let i = 0; i < neighbors.length && count < maxUpdates; i++) {
      for (let j = i + 1; j < neighbors.length && count < maxUpdates; j++) {
        const n1 = neighbors[i];
        const n2 = neighbors[j];

        // n1 and n2 are both neighbors of mem.id — they share a 1-hop path
        const otherId1 = n1.memory_a === mem.id ? n1.memory_b : n1.memory_a;
        const otherId2 = n2.memory_a === mem.id ? n2.memory_b : n2.memory_a;

        if (otherId1 === otherId2) continue;

        const transitiveWeight = n1.weight * n2.weight;
        if (transitiveWeight < TRANSITIVE_WEIGHT_THRESHOLD) continue;

        const existing = db.getAssociationWeight(otherId1, otherId2);
        // Probabilistic OR
        const newWeight = existing + transitiveWeight - existing * transitiveWeight;

        // Skip no-op updates to avoid wasting maxUpdates cap
        if (newWeight - existing < 1e-9) continue;

        db.upsertAssociation(otherId1, otherId2, newWeight, now);
        count++;
      }
    }
  }

  return count;
}

// -- Step pre-merge: Pruning --

/** Strength threshold below which memories are pruned. */
export const PRUNE_STRENGTH_THRESHOLD = 0.05;

/** Association weight threshold below which associations are pruned. */
export const PRUNE_ASSOCIATION_THRESHOLD = 0.01;

/**
 * Remove memories with strength ≤ threshold and weak associations.
 *
 * deleteMemory() handles cascade: embeddings, FTS, associations, exposure
 * are deleted. Attribution is preserved (durable historical data).
 *
 * Returns count of memories pruned.
 */
export function applyPruning(db: MemoryDatabase): { memoriesPruned: number; associationsPruned: number } {
  const allMemories = db.getAllMemories();
  let memoriesPruned = 0;

  for (const mem of allMemories) {
    if (mem.strength <= PRUNE_STRENGTH_THRESHOLD) {
      db.deleteMemory(mem.id);
      memoriesPruned++;
    }
  }

  const associationsPruned = db.pruneWeakAssociations(PRUNE_ASSOCIATION_THRESHOLD);

  return { memoriesPruned, associationsPruned };
}

// -- Step 6: Temporal transitions --

/**
 * Transition memories based on temporal anchors.
 * future → present when anchor date has passed.
 * present → past when anchor date is older than 24h.
 *
 * Returns count of memories transitioned.
 */
export function applyTemporalTransitions(db: MemoryDatabase): number {
  const now = new Date();
  const allMemories = db.getAllMemories();
  let count = 0;

  for (const mem of allMemories) {
    if (!mem.temporal_anchor) continue;
    const anchor = new Date(mem.temporal_anchor);
    if (Number.isNaN(anchor.getTime())) continue;

    let newState: TemporalState | null = null;

    if (mem.temporal_state === "future" && anchor <= now) {
      newState = "present";
    } else if (mem.temporal_state === "present") {
      const hoursSinceAnchor = (now.getTime() - anchor.getTime()) / (1000 * 60 * 60);
      if (hoursSinceAnchor >= 24) {
        newState = "past";
      }
    }

    if (newState) {
      db.updateTemporalState(mem.id, newState);
      count++;
    }
  }

  return count;
}

// -- Phase 4.6: Finalization --

/**
 * Promote working memories to consolidated state.
 * Sets consolidated=1, file_path="consolidated.md".
 * Preserves current strength — reinforcement/decay dynamics are not reset.
 * Run AFTER merge/prune so only surviving working memories are promoted.
 *
 * Returns count of memories promoted.
 */
export function promoteWorkingToConsolidated(db: MemoryDatabase): number {
  const working = db.getWorkingMemories();
  let count = 0;

  for (const mem of working) {
    db.updateConsolidated(mem.id, true, "consolidated.md");
    count++;
  }

  return count;
}

/**
 * Provenance garbage collection.
 * - Exposure rows older than cutoffDays → delete
 *
 * Attribution rows are durable and NOT deleted here.
 *
 * Returns count of exposure rows deleted.
 */
export function provenanceGC(db: MemoryDatabase, cutoffDays = 30): number {
  const cutoffDate = new Date(Date.now() - cutoffDays * 24 * 60 * 60 * 1000).toISOString();
  return db.deleteExposuresOlderThan(cutoffDate);
}

/**
 * Regenerate working.md and consolidated.md from SQLite canonical state.
 */
export function regenerateMarkdownFiles(
  db: MemoryDatabase,
  workingPath: string,
  consolidatedPath: string,
): void {
  const workingMemories = db.getWorkingMemories();
  const consolidatedMemories = db.getConsolidatedMemories();

  const toChunks = (rows: Array<{ id: string; type: string; content: string; created_at: string; strength: number }>): ChunkEntry[] =>
    rows.map((m) => ({
      id: m.id.slice(0, 8),
      type: m.type,
      created: m.created_at,
      strength: m.strength,
      content: m.content,
    }));

  const workingContent = formatChunkFile("Working Memory", toChunks(workingMemories));
  const consolidatedContent = formatChunkFile("Consolidated Memory", toChunks(consolidatedMemories));

  writeFileSync(workingPath, workingContent);
  writeFileSync(consolidatedPath, consolidatedContent);
}

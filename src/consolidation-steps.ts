/**
 * Consolidation steps — Phase 4.1+
 *
 * Pure functions for each consolidation step.
 * All dependencies injected via parameters for testability.
 *
 * Architecture: v2 §8 (reinforcement), §9 (consolidation).
 */

import type { MemoryDatabase } from "./db.ts";

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
 * For each attribution row, computes:
 *   reinforcement = η × confidence × mode_weight
 * and adds it to the memory's strength.
 *
 * mode_weight is determined by looking up the corresponding exposure
 * row's retrieval_mode (hybrid=1.0, bm25_only=0.5).
 *
 * Returns count of memories reinforced.
 */
export function applyReinforcement(db: MemoryDatabase): number {
  // Get all attribution rows — each represents a memory that influenced a response
  const allAttrs = db.getAllAttributions();

  // Group by memory_id and compute total reinforcement per memory
  const reinforcements = new Map<string, number>();

  for (const attr of allAttrs) {
    // Look up exposure for this memory to get retrieval_mode
    const exposures = db.getExposuresByMemory(attr.memory_id);
    // Find the most relevant exposure (same turn if possible)
    const exposure = exposures.find((e) => e.turn_id === attr.turn_id) ?? exposures[0];
    const modeWeight =
      exposure?.retrieval_mode === "bm25_only" ? MODE_WEIGHT_BM25_ONLY : MODE_WEIGHT_HYBRID;

    const reinforcement = ETA * attr.confidence * modeWeight;

    const current = reinforcements.get(attr.memory_id) ?? 0;
    reinforcements.set(attr.memory_id, current + reinforcement);
  }

  // Apply reinforcements to DB
  let count = 0;
  for (const [memoryId, totalReinforcement] of reinforcements) {
    if (totalReinforcement === 0) continue;
    const mem = db.getMemory(memoryId);
    if (!mem) continue;

    const newStrength = Math.min(mem.strength + totalReinforcement, 1.0);
    if (newStrength !== mem.strength) {
      db.updateStrength(memoryId, newStrength);
      count++;
    }
  }

  return count;
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

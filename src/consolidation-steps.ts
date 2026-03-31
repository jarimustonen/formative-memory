/**
 * Consolidation steps — Phase 4.1+
 *
 * Pure functions for each consolidation step.
 * All dependencies injected via parameters for testability.
 *
 * Architecture: v2 §8 (reinforcement), §9 (consolidation).
 */

import type { MemoryDatabase } from "./db.ts";
import { parseRetrievalLog } from "./retrieval-log.ts";
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

// -- Step 3: Co-retrieval association update --

/** Max transitive hops for indirect associations. */
export const TRANSITIVE_MAX_HOPS = 1;

/** Minimum weight for a transitive association to be created. */
export const TRANSITIVE_WEIGHT_THRESHOLD = 0.1;

/** Base weight for a new co-retrieval association. */
const CO_RETRIEVAL_BASE_WEIGHT = 0.1;

/**
 * Update associations from co-retrieval events in the retrieval log.
 *
 * Memories that appear together in the same search/recall event are
 * co-retrieved and get an association. Uses probabilistic OR for
 * weight accumulation: f(a,b) = a + b - a*b.
 *
 * Returns count of associations updated.
 */
export function updateCoRetrievalAssociations(
  db: MemoryDatabase,
  logPath: string,
): number {
  const entries = parseRetrievalLog(logPath);
  const now = new Date().toISOString();
  let count = 0;

  for (const entry of entries) {
    if (entry.event !== "search" && entry.event !== "recall") continue;
    if (entry.ids.length < 2) continue;

    // All pairs in this event are co-retrieved
    for (let i = 0; i < entry.ids.length; i++) {
      for (let j = i + 1; j < entry.ids.length; j++) {
        const a = entry.ids[i];
        const b = entry.ids[j];

        // Get existing weight
        const existing = db.getAssociationWeight(a, b);
        // Probabilistic OR: new = old + base - old*base
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

        db.upsertAssociation(otherId1, otherId2, newWeight, now);
        count++;
      }
    }
  }

  return count;
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

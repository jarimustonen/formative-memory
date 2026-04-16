/**
 * Consolidation steps — Phase 4.1+
 *
 * Pure functions for each consolidation step.
 * All dependencies injected via parameters for testability.
 *
 * Architecture: v2 §8 (reinforcement), §9 (consolidation).
 */

import type { MemoryDatabase } from "./db.ts";
import type { Logger } from "./logger.ts";
import { nullLogger, preview } from "./logger.ts";
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

/**
 * Cap on per-item info-level log lines per consolidation step.
 * Items beyond the cap fall through to debug; an overflow summary is
 * emitted at info so operators see the count without log-storm volume.
 */
export const PER_ITEM_INFO_CAP = 20;

/**
 * Reinforcement delta at or above which a per-memory line is promoted
 * from debug to info ("notable" reinforcement). Tuned so a single
 * tool_get hit (η × 0.6 = 0.42) is notable, but auto_injected dribble
 * (η × 0.15 = 0.105) is not.
 */
export const REINFORCE_NOTABLE_THRESHOLD = 0.3;

// -- Step 0: Catch-up decay --

/** Maximum catch-up cycles to prevent amnesia on very long gaps. */
export const MAX_CATCHUP_CYCLES = 30;

/**
 * Apply catch-up decay for missed consolidation cycles.
 *
 * Computes per-memory effective missed cycles based on
 * max(lastConsolidationMs, memory.created_at), so memories created
 * after the last consolidation are not punished for old sleep debt.
 *
 * Uses pow() for efficiency instead of iterative loops.
 * Capped at MAX_CATCHUP_CYCLES to prevent amnesia.
 *
 * @param lastConsolidationMs Timestamp (ms) of last consolidation run, or null if never run.
 * @param nowMs Current time in ms (injectable for testing).
 */
export function applyCatchUpDecay(
  db: MemoryDatabase,
  lastConsolidationMs: number | null,
  nowMs: number = Date.now(),
  log: Logger = nullLogger,
): number {
  if (lastConsolidationMs == null || !Number.isFinite(lastConsolidationMs)) return 0;

  const allMemories = db.getAllMemories();
  const debug = log.isDebugEnabled();
  let count = 0;
  const dayMs = 1000 * 60 * 60 * 24;

  for (const mem of allMemories) {
    // Per-memory baseline: the later of last consolidation or memory creation
    const createdMs = new Date(mem.created_at).getTime();
    const baselineMs = Number.isFinite(createdMs)
      ? Math.max(lastConsolidationMs, createdMs)
      : lastConsolidationMs;

    const daysSince = (nowMs - baselineMs) / dayMs;
    const cycles = Math.max(0, Math.floor(daysSince) - 1);
    if (cycles <= 0) continue;

    const effectiveCycles = Math.min(cycles, MAX_CATCHUP_CYCLES);
    const factor = mem.consolidated ? DECAY_CONSOLIDATED : DECAY_WORKING;
    const newStrength = mem.strength * Math.pow(factor, effectiveCycles);
    if (debug) {
      log.debug(
        `catch-up decay: "${preview(mem.content)}" ${mem.strength.toFixed(3)} → ${newStrength.toFixed(3)} (${effectiveCycles} cycles, ${mem.consolidated ? "consolidated" : "working"})`,
      );
    }
    db.updateStrength(mem.id, newStrength);
    count++;
  }

  // Association catch-up uses the global cycle count (conservative: max possible)
  const globalDaysSince = (nowMs - lastConsolidationMs) / dayMs;
  const globalCycles = Math.max(0, Math.floor(globalDaysSince) - 1);
  if (globalCycles > 0) {
    const effectiveGlobal = Math.min(globalCycles, MAX_CATCHUP_CYCLES);
    const associationFactor = Math.pow(DECAY_ASSOCIATION, effectiveGlobal);
    if (debug) {
      log.debug(`catch-up decay: associations ×${associationFactor.toFixed(4)} (${effectiveGlobal} cycles)`);
    }
    db.decayAllAssociationWeights(associationFactor);
  }

  if (count > 0) {
    log.info(`catch-up decay: ${count} memories adjusted for missed cycles`);
  }

  return count;
}

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
export function applyReinforcement(db: MemoryDatabase, log: Logger = nullLogger): number {
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
    const debug = log.isDebugEnabled();
    let count = 0;
    let notableLogged = 0;
    let notableSuppressed = 0;

    for (const [memoryId, totalReinforcement] of reinforcements) {
      if (totalReinforcement === 0) continue;
      const mem = db.getMemory(memoryId);
      if (!mem) continue;

      const newStrength = Math.max(0, Math.min(mem.strength + totalReinforcement, 1.0));
      if (newStrength !== mem.strength) {
        db.updateStrength(memoryId, newStrength);
        const sign = totalReinforcement >= 0 ? "+" : "";
        const line = `reinforce: "${preview(mem.content)}" ${mem.strength.toFixed(3)} → ${newStrength.toFixed(3)} (${sign}${totalReinforcement.toFixed(3)})`;
        const isNotable = Math.abs(totalReinforcement) >= REINFORCE_NOTABLE_THRESHOLD;
        if (isNotable && notableLogged < PER_ITEM_INFO_CAP) {
          log.info(line);
          notableLogged++;
        } else {
          if (isNotable) notableSuppressed++;
          if (debug) log.debug(line);
        }
        count++;
      }
    }

    // Mark all processed rows as reinforced
    for (const attr of pendingAttrs) {
      db.markAttributionsReinforced(attr.message_id, attr.memory_id);
    }

    if (count > 0) {
      log.info(`reinforce: ${count} memories strengthened from ${pendingAttrs.length} attributions`);
    }
    if (notableSuppressed > 0) {
      log.info(`reinforce: ${notableSuppressed} additional notable reinforcements (enable debug for details)`);
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
export function applyDecay(db: MemoryDatabase, log: Logger = nullLogger): number {
  const allMemories = db.getAllMemories();
  const debug = log.isDebugEnabled();
  let count = 0;

  for (const mem of allMemories) {
    const factor = mem.consolidated ? DECAY_CONSOLIDATED : DECAY_WORKING;
    const newStrength = mem.strength * factor;
    if (debug) {
      log.debug(
        `decay: "${preview(mem.content)}" ${mem.strength.toFixed(3)} → ${newStrength.toFixed(3)} (×${factor})`,
      );
    }
    db.updateStrength(mem.id, newStrength);
    count++;
  }

  // Decay association weights
  if (debug) {
    log.debug(`decay: associations ×${DECAY_ASSOCIATION}`);
  }
  applyAssociationDecay(db);

  if (count > 0) {
    log.info(`decay: ${count} memories decayed`);
  }

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
export function updateCoRetrievalAssociations(db: MemoryDatabase, log: Logger = nullLogger): number {
  const groups = db.getCoRetrievalGroups();
  const now = new Date().toISOString();
  const validIds = new Set(db.getAllMemories().map((m) => m.id));
  const debug = log.isDebugEnabled();
  let count = 0;

  for (const group of groups) {
    const ids = group.memory_ids.filter((id) => validIds.has(id));
    if (ids.length < 2) continue;

    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        db.upsertAssociationProbOr(ids[i], ids[j], CO_RETRIEVAL_BASE_WEIGHT, now);
        if (debug) {
          log.debug(`associate: co-retrieval ${ids[i].slice(0, 8)}…↔${ids[j].slice(0, 8)}… (+${CO_RETRIEVAL_BASE_WEIGHT})`);
        }
        count++;
      }
    }
  }

  if (count > 0) {
    log.info(`associate: ${count} co-retrieval associations updated from ${groups.length} turn groups`);
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
  log: Logger = nullLogger,
): number {
  const allMemories = db.getAllMemories();
  const now = new Date().toISOString();
  const debug = log.isDebugEnabled();
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
        if (debug) {
          log.debug(
            `associate: transitive ${otherId1.slice(0, 8)}…↔${otherId2.slice(0, 8)}… via ${mem.id.slice(0, 8)}… weight=${newWeight.toFixed(3)}`,
          );
        }
        count++;
      }
    }
  }

  if (count > 0) {
    log.info(`associate: ${count} transitive associations created/updated`);
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
export function applyPruning(db: MemoryDatabase, log: Logger = nullLogger): { memoriesPruned: number; associationsPruned: number } {
  const allMemories = db.getAllMemories();
  const debug = log.isDebugEnabled();
  let memoriesPruned = 0;
  let infoLogged = 0;
  let suppressed = 0;

  for (const mem of allMemories) {
    if (mem.strength <= PRUNE_STRENGTH_THRESHOLD) {
      const line = `prune: removing "${preview(mem.content, 80)}" (strength=${mem.strength.toFixed(3)}, type=${mem.type})`;
      if (infoLogged < PER_ITEM_INFO_CAP) {
        log.info(line);
        infoLogged++;
      } else {
        suppressed++;
        if (debug) log.debug(line);
      }
      db.deleteMemory(mem.id);
      memoriesPruned++;
    }
  }

  const associationsPruned = db.pruneWeakAssociations(PRUNE_ASSOCIATION_THRESHOLD);

  if (memoriesPruned > 0 || associationsPruned > 0) {
    log.info(`prune: ${memoriesPruned} memories, ${associationsPruned} associations removed`);
  }
  if (suppressed > 0) {
    log.info(`prune: ${suppressed} additional memories pruned (per-item logs suppressed; enable debug for details)`);
  }

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
export function applyTemporalTransitions(db: MemoryDatabase, log: Logger = nullLogger): number {
  const now = new Date();
  const allMemories = db.getAllMemories();
  const debug = log.isDebugEnabled();
  let count = 0;
  let infoLogged = 0;
  let suppressed = 0;

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
      const line = `temporal: "${preview(mem.content)}" ${mem.temporal_state} → ${newState}`;
      if (infoLogged < PER_ITEM_INFO_CAP) {
        log.info(line);
        infoLogged++;
      } else {
        suppressed++;
        if (debug) log.debug(line);
      }
      db.updateTemporalState(mem.id, newState);
      count++;
    }
  }

  if (count > 0) {
    log.info(`temporal: ${count} memories transitioned`);
  }
  if (suppressed > 0) {
    log.info(`temporal: ${suppressed} additional transitions (per-item logs suppressed; enable debug for details)`);
  }

  return count;
}

// -- Phase 4.6: Finalization --

/**
 * Promote working memories to consolidated state.
 * Sets consolidated=1.
 * Preserves current strength — reinforcement/decay dynamics are not reset.
 *
 * @deprecated Do not call in normal consolidation. Blanket promotion gives
 * all memories the slower consolidated decay rate (0.977) regardless of
 * whether they were merged. Only merge results should be consolidated —
 * this is handled by executeMerge() setting consolidated=true on new memories.
 */
export function promoteWorkingToConsolidated(db: MemoryDatabase): number {
  const working = db.getWorkingMemories();
  let count = 0;

  for (const mem of working) {
    db.updateConsolidated(mem.id, true);
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
export function provenanceGC(db: MemoryDatabase, cutoffDays = 30, log: Logger = nullLogger): number {
  const cutoffDate = new Date(Date.now() - cutoffDays * 24 * 60 * 60 * 1000).toISOString();
  const count = db.deleteExposuresOlderThan(cutoffDate);
  if (count > 0) {
    log.debug(`gc: ${count} exposure rows older than ${cutoffDays}d removed`);
  }
  return count;
}


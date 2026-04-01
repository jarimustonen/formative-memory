/**
 * Consolidation ("sleep") — Phase 4
 *
 * Batch process that strengthens associations, decays unused
 * memories, merges duplicates, and prunes dead memories.
 * Synchronous and blocking in V1.
 *
 * Architecture: v2 §9, §13.
 */

import {
  applyDecay,
  applyPruning,
  applyReinforcement,
  applyTemporalTransitions,
  updateCoRetrievalAssociations,
  updateTransitiveAssociations,
} from "./consolidation-steps.ts";
import type { MemoryDatabase } from "./db.ts";

export type ConsolidationParams = {
  db: MemoryDatabase;
};

export type ConsolidationSummary = {
  reinforced: number;
  decayed: number;
  pruned: number;
  merged: number;
  transitioned: number;
};

export type ConsolidationResult = {
  ok: boolean;
  summary: ConsolidationSummary;
  durationMs: number;
};

/**
 * Run the full consolidation process.
 *
 * All DB mutations run in a single transaction — if any step fails,
 * everything rolls back and last_consolidation_at is not updated.
 * Retry is safe.
 */
export async function runConsolidation(
  params: ConsolidationParams,
): Promise<ConsolidationResult> {
  const start = Date.now();

  const summary: ConsolidationSummary = {
    reinforced: 0,
    decayed: 0,
    pruned: 0,
    merged: 0,
    transitioned: 0,
  };

  params.db.transaction(() => {
    // Phase 4.1 — Reinforcement + decay
    summary.reinforced = applyReinforcement(params.db);
    summary.decayed = applyDecay(params.db);
    // Phase 4.2 — Associations + temporal transitions
    updateCoRetrievalAssociations(params.db);
    updateTransitiveAssociations(params.db);
    summary.transitioned = applyTemporalTransitions(params.db);
    // Phase 4.3 — Pre-merge pruning
    const pruneResult = applyPruning(params.db);
    summary.pruned = pruneResult.memoriesPruned;
    // TODO: Phase 4.4 — Merge candidate detection
    // TODO: Phase 4.5 — Merge execution
    // TODO: Phase 4.6 — Finalization (working→consolidated, GC, markdown regen)

    // Write completion timestamp inside transaction — only persists on success
    params.db.setState("last_consolidation_at", new Date().toISOString());
  });

  return {
    ok: true,
    summary,
    durationMs: Date.now() - start,
  };
}

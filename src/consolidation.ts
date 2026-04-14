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
  applyCatchUpDecay,
  applyDecay,
  applyPruning,
  applyReinforcement,
  applyTemporalTransitions,
  provenanceGC,
  updateCoRetrievalAssociations,
  updateTransitiveAssociations,
} from "./consolidation-steps.ts";
import type { MemoryDatabase, MemoryRow } from "./db.ts";
import type { Logger } from "./logger.ts";
import { nullLogger } from "./logger.ts";
import {
  findMergeCandidatesDelta,
  MERGE_SOURCE_MIN_STRENGTH,
  MERGE_TARGET_MIN_STRENGTH,
  type MemoryCandidate,
} from "./merge-candidates.ts";
import { executeMerges, type EmbedderFn, type MergeContentProducer } from "./merge-execution.ts";

export type ConsolidationParams = {
  db: MemoryDatabase;
  /** Content producer for merges. In production this calls an LLM. */
  mergeContentProducer?: MergeContentProducer;
  /** Embedding generator for merged memories. */
  embedder?: EmbedderFn;
  /** Logger instance. Falls back to nullLogger (silent). */
  logger?: Logger;
};

export type ConsolidationSummary = {
  catchUpDecayed: number;
  reinforced: number;
  decayed: number;
  pruned: number;
  prunedAssociations: number;
  merged: number;
  transitioned: number;
  exposuresGc: number;
};

export type ConsolidationResult = {
  ok: boolean;
  summary: ConsolidationSummary;
  durationMs: number;
};

/**
 * Run the full consolidation process.
 *
 * Pre-merge steps (reinforcement, decay, associations, pruning) run
 * in a single transaction. Merge execution runs separately because
 * the content producer may be async (LLM call). Finalization
 * (GC, timestamp update) runs in its own transaction.
 *
 * Working memories stay working — only merge results get consolidated.
 * This is intentional: consolidated status means "produced by merging
 * multiple memories" and grants slower decay (0.977 vs 0.906).
 * Unique unmerged memories remain working and depend on retrieval
 * reinforcement to maintain their strength.
 *
 * If no mergeContentProducer is provided, the merge phase is skipped entirely.
 * Concatenation is not acceptable — merging requires an LLM to produce
 * coherent, deduplicated content.
 */
export async function runConsolidation(
  params: ConsolidationParams,
): Promise<ConsolidationResult> {
  const start = Date.now();
  const log = params.logger ?? nullLogger;
  // Capture cutoff before any queries to prevent race with concurrent writes.
  // Memories/exposures arriving after this point will be picked up next run.
  const consolidationCutoff = new Date().toISOString();

  const summary: ConsolidationSummary = {
    catchUpDecayed: 0,
    reinforced: 0,
    decayed: 0,
    pruned: 0,
    prunedAssociations: 0,
    merged: 0,
    transitioned: 0,
    exposuresGc: 0,
  };

  log.info("consolidation: starting");

  // Transaction 1: Pre-merge deterministic steps
  params.db.transaction(() => {
    // Phase 4.0 — Catch-up decay for missed cycles
    const lastAt = params.db.getState("last_consolidation_at");
    let lastConsolidationMs: number | null = null;
    if (lastAt) {
      const ms = new Date(lastAt).getTime();
      if (Number.isFinite(ms)) lastConsolidationMs = ms;
    }
    summary.catchUpDecayed = applyCatchUpDecay(params.db, lastConsolidationMs, Date.now(), log);

    // Phase 4.1 — Reinforcement + decay
    summary.reinforced = applyReinforcement(params.db, log);
    summary.decayed = applyDecay(params.db, log);
    // Phase 4.2 — Associations + temporal transitions
    updateCoRetrievalAssociations(params.db, log);
    updateTransitiveAssociations(params.db, 100, log);
    summary.transitioned = applyTemporalTransitions(params.db, log);
    // Phase 4.3 — Pre-merge pruning
    const pruneResult = applyPruning(params.db, log);
    summary.pruned = pruneResult.memoriesPruned;
    summary.prunedAssociations = pruneResult.associationsPruned;
  });

  // Phase 4.4–4.5 — Merge (delta: new/exposed sources vs strength-filtered targets)
  // Wrapped in try/finally: finalization always runs to prevent double-decay on retry.
  try {
    if (params.mergeContentProducer) {
      const lastAt = params.db.getState("last_consolidation_at");

      const sourceMems = params.db.getMergeSources(
        MERGE_SOURCE_MIN_STRENGTH, lastAt,
      );
      const targetMems = params.db.getMergeTargets(MERGE_TARGET_MIN_STRENGTH);

      log.debug(`merge: ${sourceMems.length} sources, ${targetMems.length} targets`);

      // Bulk-load embeddings only for relevant candidate IDs
      const uniqueIds = [...new Set([...sourceMems, ...targetMems].map((m) => m.id))];
      const embeddingMap = params.db.getEmbeddingsByIds(uniqueIds);

      const toCandidate = (m: MemoryRow): MemoryCandidate => ({
        id: m.id, content: m.content, type: m.type,
        embedding: embeddingMap.get(m.id) ?? null,
      });

      const pairs = findMergeCandidatesDelta(
        sourceMems.map(toCandidate),
        targetMems.map(toCandidate),
      );

      if (pairs.length > 0) {
        log.info(`merge: ${pairs.length} candidate pairs found`);
        const mergeResults = await executeMerges(
          params.db, pairs, params.mergeContentProducer, params.embedder, log,
        );
        summary.merged = mergeResults.length;
      }
    }
  } finally {
    // Transaction 2: Finalization — always runs to advance the clock.
    // If merge failed, pre-merge steps are already applied; not advancing
    // would cause double-decay on the next run.
    params.db.transaction(() => {
      summary.exposuresGc = provenanceGC(params.db, 30, log);
      params.db.setState("last_consolidation_at", consolidationCutoff);
    });
  }

  const s = summary;
  log.info(
    `consolidation: done in ${Date.now() - start}ms — reinforced=${s.reinforced} decayed=${s.decayed} pruned=${s.pruned}+${s.prunedAssociations} merged=${s.merged} transitioned=${s.transitioned}`,
  );

  return {
    ok: true,
    summary,
    durationMs: Date.now() - start,
  };
}

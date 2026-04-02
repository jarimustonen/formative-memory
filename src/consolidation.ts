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
  promoteWorkingToConsolidated,
  provenanceGC,
  regenerateMarkdownFiles,
  updateCoRetrievalAssociations,
  updateTransitiveAssociations,
} from "./consolidation-steps.ts";
import type { MemoryDatabase } from "./db.ts";
import { findMergeCandidates, type MemoryCandidate } from "./merge-candidates.ts";
import { executeMerges, type EmbedderFn, type MergeContentProducer } from "./merge-execution.ts";

export type ConsolidationParams = {
  db: MemoryDatabase;
  /** Content producer for merges. In production this calls an LLM. */
  mergeContentProducer?: MergeContentProducer;
  /** Embedding generator for merged memories. */
  embedder?: EmbedderFn;
  /** Path to working.md for markdown regeneration. */
  workingPath?: string;
  /** Path to consolidated.md for markdown regeneration. */
  consolidatedPath?: string;
};

export type ConsolidationSummary = {
  reinforced: number;
  decayed: number;
  pruned: number;
  prunedAssociations: number;
  merged: number;
  transitioned: number;
  promoted: number;
  exposuresGc: number;
};

export type ConsolidationResult = {
  ok: boolean;
  summary: ConsolidationSummary;
  durationMs: number;
};

/** Default content producer — simple concatenation (no LLM). */
const defaultContentProducer: MergeContentProducer = async (a, b) => ({
  content: `${a.content}\n\n${b.content}`,
  type: a.type,
});

/**
 * Run the full consolidation process.
 *
 * Pre-merge steps (reinforcement, decay, associations, pruning) run
 * in a single transaction. Merge execution runs separately because
 * the content producer may be async (LLM call). Finalization
 * (promote, GC, markdown regen) runs in its own transaction.
 */
export async function runConsolidation(
  params: ConsolidationParams,
): Promise<ConsolidationResult> {
  const start = Date.now();
  const producer = params.mergeContentProducer ?? defaultContentProducer;

  const summary: ConsolidationSummary = {
    reinforced: 0,
    decayed: 0,
    pruned: 0,
    prunedAssociations: 0,
    merged: 0,
    transitioned: 0,
    promoted: 0,
    exposuresGc: 0,
  };

  // Transaction 1: Pre-merge deterministic steps
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
    summary.prunedAssociations = pruneResult.associationsPruned;
  });

  // Phase 4.4 — Merge candidate detection (pure, no mutations)
  const allMemories = params.db.getAllMemories();
  const candidates: MemoryCandidate[] = allMemories.map((m) => ({
    id: m.id,
    content: m.content,
    embedding: params.db.getEmbedding(m.id),
  }));
  const pairs = findMergeCandidates(candidates);

  // Phase 4.5 — Merge execution (async content producer, then DB transaction per merge)
  if (pairs.length > 0) {
    const mergeResults = await executeMerges(params.db, pairs, producer, params.embedder);
    summary.merged = mergeResults.length;
  }

  // Transaction 2: Finalization
  params.db.transaction(() => {
    // Phase 4.6 — Promote working → consolidated
    summary.promoted = promoteWorkingToConsolidated(params.db);
    // Provenance GC
    summary.exposuresGc = provenanceGC(params.db);
    // Write completion timestamp
    params.db.setState("last_consolidation_at", new Date().toISOString());
  });

  // Regenerate markdown files (outside transaction — file I/O)
  if (params.workingPath && params.consolidatedPath) {
    regenerateMarkdownFiles(params.db, params.workingPath, params.consolidatedPath);
  }

  return {
    ok: true,
    summary,
    durationMs: Date.now() - start,
  };
}

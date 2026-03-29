/**
 * Associative Memory Context Engine
 *
 * Minimal context engine implementation (Phase 3.1).
 * - assemble(): passes messages through, no injection yet (added in 3.2)
 * - ingest(): no-op
 * - compact(): delegates to runtime
 * - dispose(): closes DB connections, resets per-run state
 */

import type { ContextEngine, ContextEngineInfo } from "openclaw/plugin-sdk";
import { delegateCompactionToRuntime } from "openclaw/plugin-sdk";
import type { MemoryManager } from "./memory-manager.ts";

export const CONTEXT_ENGINE_ID = "associative-memory";

export type AssociativeMemoryContextEngineOptions = {
  /** Lazy accessor — engine does not own the manager lifecycle. */
  getManager: () => MemoryManager;
};

export function createAssociativeMemoryContextEngine(
  options: AssociativeMemoryContextEngineOptions,
): ContextEngine {
  const { getManager } = options;

  const info: ContextEngineInfo = {
    id: CONTEXT_ENGINE_ID,
    name: "Associative Memory",
    ownsCompaction: false,
  };

  return {
    info,

    async assemble(params) {
      // Phase 3.1: passthrough — no memory injection yet (added in 3.2)
      return {
        messages: params.messages,
        estimatedTokens: 0,
      };
    },

    async ingest(_params) {
      // No-op: we don't need per-message ingestion.
      // Memory storage happens via tool calls (memory_store).
      return { ingested: false };
    },

    async compact(params) {
      return delegateCompactionToRuntime(params);
    },

    async dispose() {
      // Phase 3.1: manager lifecycle is owned by the plugin (lazy singleton),
      // not the engine instance. Nothing to dispose per-run yet.
      // Future phases will reset transcript cache and turn ledger here.
      void getManager;
    },
  };
}

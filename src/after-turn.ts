/**
 * afterTurn() logic — Phase 3.7
 *
 * Processes turn results and writes provenance data to SQLite and
 * the retrieval log. All dependencies injected via params for testability.
 *
 * Architecture: v2 §12. Only deterministic operations —
 * async signal analysis deferred to Phase 6.
 */

import type { MemoryDatabase } from "./db.ts";
import { appendRecallEvent } from "./retrieval-log.ts";
import type { TurnMemoryLedger } from "./turn-memory-ledger.ts";

// -- Types --

export type AfterTurnParams = {
  sessionId: string;
  turnId: string;
  messages: unknown[];
  prePromptMessageCount: number;
  ledger: TurnMemoryLedger;
  db: MemoryDatabase;
  /** Path to retrieval log. Empty string or omitted disables logging. */
  logPath?: string;
  isBm25Only: boolean;
};

/** A memory_feedback tool call extracted from the transcript. */
export type FeedbackCall = {
  memoryId: string;
  rating: number;
};

// -- Confidence constants (architecture v2 §8) --

export const CONFIDENCE = {
  auto_injected: 0.15,
  tool_search_returned: 0.3,
  tool_get: 0.6,
  agent_feedback_neutral: 0.4,
  agent_feedback_positive: 0.95,
  agent_feedback_negative: -0.5,
} as const;

// -- Main entry point --

export function processAfterTurn(params: AfterTurnParams): void {
  const { sessionId, turnId, ledger, db, logPath, isBm25Only } = params;

  const now = new Date().toISOString();
  const retrievalMode = isBm25Only ? "bm25_only" : "hybrid";

  // All DB writes in a single transaction for atomicity and performance.
  // File-based log is written AFTER the transaction succeeds to avoid
  // log/DB inconsistency on failure.
  db.transaction(() => {
    // 1. Write exposure records
    for (const [memoryId, { score }] of ledger.autoInjected) {
      db.insertExposure({
        sessionId,
        turnId,
        memoryId,
        mode: "auto_injected",
        score,
        retrievalMode,
        createdAt: now,
      });
    }

    for (const [memoryId, { score }] of ledger.searchResults) {
      db.insertExposure({
        sessionId,
        turnId,
        memoryId,
        mode: "tool_search_returned",
        score,
        retrievalMode,
        createdAt: now,
      });
    }

    for (const memoryId of ledger.explicitlyOpened) {
      db.insertExposure({
        sessionId,
        turnId,
        memoryId,
        mode: "tool_get",
        score: null,
        retrievalMode: null,
        createdAt: now,
      });
    }

    for (const memoryId of ledger.storedThisTurn) {
      db.insertExposure({
        sessionId,
        turnId,
        memoryId,
        mode: "tool_store",
        score: null,
        retrievalMode: null,
        createdAt: now,
      });
    }

    // 2. Write attribution records
    //    Find the last assistant message index for message_id generation.
    const lastAssistantIdx = findLastAssistantMessageIndex(params.messages);
    const messageId = lastAssistantIdx !== -1
      ? `${turnId}:msg:${lastAssistantIdx}`
      : null;

    if (messageId) {
      for (const memoryId of ledger.autoInjected.keys()) {
        db.upsertAttribution({
          messageId,
          memoryId,
          evidence: "auto_injected",
          confidence: CONFIDENCE.auto_injected,
          turnId,
          createdAt: now,
        });
      }

      for (const memoryId of ledger.searchResults.keys()) {
        db.upsertAttribution({
          messageId,
          memoryId,
          evidence: "tool_search_returned",
          confidence: CONFIDENCE.tool_search_returned,
          turnId,
          createdAt: now,
        });
      }

      for (const memoryId of ledger.explicitlyOpened) {
        db.upsertAttribution({
          messageId,
          memoryId,
          evidence: "tool_get",
          confidence: CONFIDENCE.tool_get,
          turnId,
          createdAt: now,
        });
      }
    }

    // 3. Cross-turn feedback attribution promotion
    //    When feedback references a memory that was attributed in a PRIOR turn,
    //    we update that prior attribution row rather than creating a new one
    //    for the current turn. This implements the cross-turn promotion described
    //    in TODO 3.7: "feedback voi tulla myöhemmässä turnissa".
    //    Feedback processing is independent of the current turn having an
    //    assistant message — it targets existing attribution rows.
    const feedbackCalls = parseFeedbackCalls(
      params.messages,
      params.prePromptMessageCount,
    );

    for (const { memoryId, rating } of feedbackCalls) {
      const { evidence, confidence } = feedbackEvidenceForRating(rating);

      // Look up the most recent existing attribution for this memory.
      // If found, upsert to that row (cross-turn promotion/demotion).
      // If not found, attribute to the current turn's assistant message (if any).
      const existing = db.getAttributionsByMemory(memoryId);
      const targetMessageId = existing.length > 0
        ? existing[existing.length - 1].message_id
        : messageId;

      if (targetMessageId) {
        db.upsertAttribution({
          messageId: targetMessageId,
          memoryId,
          evidence,
          confidence,
          turnId,
          createdAt: now,
        });
      }
    }
  });

  // 4. Write recall event for auto-injected memories (after DB success)
  if (logPath && ledger.autoInjected.size > 0) {
    appendRecallEvent(logPath, [...ledger.autoInjected.keys()]);
  }
}

// -- Helpers --

/**
 * Find the index of the last assistant message in the full message list.
 * Returns -1 if no assistant message exists.
 */
export function findLastAssistantMessageIndex(messages: unknown[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg != null && typeof msg === "object" && (msg as Record<string, unknown>).role === "assistant") {
      return i;
    }
  }
  return -1;
}

/**
 * Parse memory_feedback tool calls from new messages (after prePromptMessageCount).
 *
 * Looks for assistant messages with tool_use blocks named "memory_feedback",
 * extracting memory_id and rating from the input.
 */
export function parseFeedbackCalls(
  messages: unknown[],
  prePromptMessageCount: number,
): FeedbackCall[] {
  const newMessages = messages.slice(prePromptMessageCount);
  const calls: FeedbackCall[] = [];

  for (const msg of newMessages) {
    if (msg == null || typeof msg !== "object") continue;
    const { role, content } = msg as Record<string, unknown>;
    if (role !== "assistant" || !Array.isArray(content)) continue;

    for (const block of content) {
      if (block == null || typeof block !== "object") continue;
      const b = block as Record<string, unknown>;
      if (b.type !== "tool_use" || b.name !== "memory_feedback") continue;

      if (b.input == null || typeof b.input !== "object") continue;
      const input = b.input as Record<string, unknown>;

      const memoryId = input.memory_id;
      const rating = input.rating;
      if (typeof memoryId === "string" && isValidRating(rating)) {
        calls.push({ memoryId, rating });
      }
    }
  }

  return calls;
}

/** Validate that a rating is an integer 1–5. */
export function isValidRating(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5;
}

/**
 * Map a feedback rating (1–5) to evidence type and confidence value.
 */
export function feedbackEvidenceForRating(rating: number): {
  evidence: string;
  confidence: number;
} {
  if (rating >= 4) {
    return { evidence: "agent_feedback_positive", confidence: CONFIDENCE.agent_feedback_positive };
  }
  if (rating === 3) {
    return { evidence: "agent_feedback_neutral", confidence: CONFIDENCE.agent_feedback_neutral };
  }
  return { evidence: "agent_feedback_negative", confidence: CONFIDENCE.agent_feedback_negative };
}

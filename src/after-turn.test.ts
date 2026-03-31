import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CONFIDENCE,
  feedbackEvidenceForRating,
  findLastAssistantMessageIndex,
  parseFeedbackCalls,
  processAfterTurn,
} from "./after-turn.ts";
import { MemoryDatabase } from "./db.ts";
import { TurnMemoryLedger } from "./turn-memory-ledger.ts";

// -- Test helpers --

let tmpDir: string;
let db: MemoryDatabase;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "after-turn-test-"));
  db = new MemoryDatabase(join(tmpDir, "test.db"));
});

afterEach(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

function makeLedger(): TurnMemoryLedger {
  return new TurnMemoryLedger();
}

function makeMessages(
  prePromptCount: number,
  newMessages: Array<{ role: string; content: unknown }>,
): unknown[] {
  const prePrompt = Array.from({ length: prePromptCount }, (_, i) => ({
    role: "user",
    content: `pre-prompt message ${i}`,
  }));
  return [...prePrompt, ...newMessages];
}

// -- findLastAssistantMessageIndex --

describe("findLastAssistantMessageIndex", () => {
  it("returns index of last assistant message", () => {
    const msgs = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
      { role: "user", content: "bye" },
      { role: "assistant", content: "goodbye" },
    ];
    expect(findLastAssistantMessageIndex(msgs)).toBe(3);
  });

  it("returns -1 when no assistant message exists", () => {
    const msgs = [{ role: "user", content: "hi" }];
    expect(findLastAssistantMessageIndex(msgs)).toBe(-1);
  });

  it("handles empty messages", () => {
    expect(findLastAssistantMessageIndex([])).toBe(-1);
  });
});

// -- parseFeedbackCalls --

describe("parseFeedbackCalls", () => {
  it("extracts memory_feedback tool calls from new messages", () => {
    const msgs = makeMessages(1, [
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "toolu_1",
            name: "memory_feedback",
            input: { memory_id: "abc123", rating: 5 },
          },
        ],
      },
    ]);

    const calls = parseFeedbackCalls(msgs, 1);
    expect(calls).toEqual([{ memoryId: "abc123", rating: 5 }]);
  });

  it("ignores non-feedback tool calls", () => {
    const msgs = makeMessages(1, [
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "toolu_1",
            name: "memory_search",
            input: { query: "test" },
          },
        ],
      },
    ]);

    expect(parseFeedbackCalls(msgs, 1)).toEqual([]);
  });

  it("extracts multiple feedback calls", () => {
    const msgs = makeMessages(0, [
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "toolu_1",
            name: "memory_feedback",
            input: { memory_id: "aaa", rating: 5 },
          },
          {
            type: "tool_use",
            id: "toolu_2",
            name: "memory_feedback",
            input: { memory_id: "bbb", rating: 1 },
          },
        ],
      },
    ]);

    const calls = parseFeedbackCalls(msgs, 0);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({ memoryId: "aaa", rating: 5 });
    expect(calls[1]).toEqual({ memoryId: "bbb", rating: 1 });
  });

  it("skips pre-prompt messages", () => {
    const msgs = makeMessages(2, [
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "toolu_1",
            name: "memory_feedback",
            input: { memory_id: "abc", rating: 4 },
          },
        ],
      },
    ]);

    // Feedback is only in message index 2 (after 2 pre-prompt messages)
    expect(parseFeedbackCalls(msgs, 2)).toHaveLength(1);
  });

  it("handles string content gracefully", () => {
    const msgs = makeMessages(0, [
      { role: "assistant", content: "just text, no tool calls" },
    ]);
    expect(parseFeedbackCalls(msgs, 0)).toEqual([]);
  });
});

// -- feedbackEvidenceForRating --

describe("feedbackEvidenceForRating", () => {
  it("rating 5 → positive", () => {
    expect(feedbackEvidenceForRating(5)).toEqual({
      evidence: "agent_feedback_positive",
      confidence: CONFIDENCE.agent_feedback_positive,
    });
  });

  it("rating 4 → positive", () => {
    expect(feedbackEvidenceForRating(4)).toEqual({
      evidence: "agent_feedback_positive",
      confidence: CONFIDENCE.agent_feedback_positive,
    });
  });

  it("rating 3 → neutral", () => {
    expect(feedbackEvidenceForRating(3)).toEqual({
      evidence: "agent_feedback_neutral",
      confidence: CONFIDENCE.agent_feedback_neutral,
    });
  });

  it("rating 2 → negative", () => {
    expect(feedbackEvidenceForRating(2)).toEqual({
      evidence: "agent_feedback_negative",
      confidence: CONFIDENCE.agent_feedback_negative,
    });
  });

  it("rating 1 → negative", () => {
    expect(feedbackEvidenceForRating(1)).toEqual({
      evidence: "agent_feedback_negative",
      confidence: CONFIDENCE.agent_feedback_negative,
    });
  });
});

// -- processAfterTurn --

describe("processAfterTurn", () => {
  const SESSION_ID = "session-001";
  const TURN_ID = "session-001:2026-03-31T12:00:00.000Z";
  const MEM_A = "aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111";
  const MEM_B = "bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222";
  const MEM_C = "cccc3333cccc3333cccc3333cccc3333cccc3333cccc3333cccc3333cccc3333";
  const MEM_D = "dddd4444dddd4444dddd4444dddd4444dddd4444dddd4444dddd4444dddd4444";

  function defaultParams(overrides: Partial<{
    ledger: TurnMemoryLedger;
    messages: unknown[];
    prePromptMessageCount: number;
  }> = {}) {
    return {
      sessionId: SESSION_ID,
      turnId: TURN_ID,
      messages: overrides.messages ?? [
        { role: "user", content: "hello" },
        { role: "assistant", content: "hi there" },
      ],
      prePromptMessageCount: overrides.prePromptMessageCount ?? 0,
      ledger: overrides.ledger ?? makeLedger(),
      db,
      logPath: join(tmpDir, "retrieval.log"),
      isBm25Only: false,
    };
  }

  it("writes exposure records for all ledger categories", () => {
    const ledger = makeLedger();
    ledger.addAutoInjected(MEM_A, 0.9);
    ledger.addSearchResults([{ id: MEM_B, score: 0.8, query: "test" }]);
    ledger.addExplicitlyOpened(MEM_C);
    ledger.addStoredThisTurn(MEM_D);

    processAfterTurn(defaultParams({ ledger }));

    const exposures = db.getExposures(SESSION_ID, TURN_ID);
    expect(exposures).toHaveLength(4);

    const byMode = new Map(exposures.map((e) => [e.mode, e]));
    expect(byMode.get("auto_injected")!.memory_id).toBe(MEM_A);
    expect(byMode.get("auto_injected")!.score).toBe(0.9);
    expect(byMode.get("auto_injected")!.retrieval_mode).toBe("hybrid");

    expect(byMode.get("tool_search_returned")!.memory_id).toBe(MEM_B);
    expect(byMode.get("tool_search_returned")!.score).toBe(0.8);

    expect(byMode.get("tool_get")!.memory_id).toBe(MEM_C);
    expect(byMode.get("tool_get")!.score).toBeNull();
    expect(byMode.get("tool_get")!.retrieval_mode).toBeNull();

    expect(byMode.get("tool_store")!.memory_id).toBe(MEM_D);
    expect(byMode.get("tool_store")!.score).toBeNull();
  });

  it("writes bm25_only retrieval_mode when circuit breaker is open", () => {
    const ledger = makeLedger();
    ledger.addAutoInjected(MEM_A, 0.7);

    processAfterTurn({ ...defaultParams({ ledger }), isBm25Only: true });

    const exposures = db.getExposures(SESSION_ID, TURN_ID);
    expect(exposures[0].retrieval_mode).toBe("bm25_only");
  });

  it("writes attribution records for auto_injected, search, and get", () => {
    const ledger = makeLedger();
    ledger.addAutoInjected(MEM_A, 0.9);
    ledger.addSearchResults([{ id: MEM_B, score: 0.8, query: "test" }]);
    ledger.addExplicitlyOpened(MEM_C);
    ledger.addStoredThisTurn(MEM_D); // should NOT get attribution

    processAfterTurn(defaultParams({ ledger }));

    const attributions = db.getAttributionsForTurn(TURN_ID);
    expect(attributions).toHaveLength(3);

    const byMemory = new Map(attributions.map((a) => [a.memory_id, a]));
    expect(byMemory.get(MEM_A)!.evidence).toBe("auto_injected");
    expect(byMemory.get(MEM_A)!.confidence).toBe(CONFIDENCE.auto_injected);

    expect(byMemory.get(MEM_B)!.evidence).toBe("tool_search_returned");
    expect(byMemory.get(MEM_B)!.confidence).toBe(CONFIDENCE.tool_search_returned);

    expect(byMemory.get(MEM_C)!.evidence).toBe("tool_get");
    expect(byMemory.get(MEM_C)!.confidence).toBe(CONFIDENCE.tool_get);

    // MEM_D (stored) should NOT have attribution
    expect(byMemory.has(MEM_D)).toBe(false);
  });

  it("generates correct message_id from last assistant index", () => {
    const ledger = makeLedger();
    ledger.addAutoInjected(MEM_A, 0.9);

    const messages = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
      { role: "user", content: "more" },
      { role: "assistant", content: "sure" }, // index 3
    ];

    processAfterTurn(defaultParams({ ledger, messages }));

    const attributions = db.getAttributionsForTurn(TURN_ID);
    expect(attributions[0].message_id).toBe(`${TURN_ID}:msg:3`);
  });

  it("writes recall event to retrieval log for auto-injected memories", () => {
    const ledger = makeLedger();
    ledger.addAutoInjected(MEM_A, 0.9);
    ledger.addAutoInjected(MEM_B, 0.7);

    processAfterTurn(defaultParams({ ledger }));

    const logContent = readFileSync(join(tmpDir, "retrieval.log"), "utf8");
    expect(logContent).toContain("recall");
    expect(logContent).toContain(MEM_A);
    expect(logContent).toContain(MEM_B);
  });

  it("does not write recall event when no auto-injected memories", () => {
    const ledger = makeLedger();
    ledger.addSearchResults([{ id: MEM_A, score: 0.8, query: "test" }]);

    processAfterTurn(defaultParams({ ledger }));

    try {
      readFileSync(join(tmpDir, "retrieval.log"), "utf8");
      // File should not exist or be empty
      expect.unreachable("should not have created retrieval.log");
    } catch {
      // Expected: file does not exist
    }
  });

  it("different turns in same session do not collide on message_id", () => {
    const messages = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" }, // index 1 in both turns
    ];

    const ledger1 = makeLedger();
    ledger1.addAutoInjected(MEM_A, 0.9);
    const turn1Id = "session-001:2026-03-31T12:00:00.000Z";

    const ledger2 = makeLedger();
    ledger2.addAutoInjected(MEM_B, 0.8);
    const turn2Id = "session-001:2026-03-31T12:01:00.000Z";

    processAfterTurn({ ...defaultParams({ ledger: ledger1, messages }), turnId: turn1Id });
    processAfterTurn({ ...defaultParams({ ledger: ledger2, messages }), turnId: turn2Id });

    // Both turns have assistant at index 1, but message_ids differ due to turnId
    const attrs1 = db.getAttributionsForTurn(turn1Id);
    const attrs2 = db.getAttributionsForTurn(turn2Id);
    expect(attrs1).toHaveLength(1);
    expect(attrs2).toHaveLength(1);
    expect(attrs1[0].message_id).toBe(`${turn1Id}:msg:1`);
    expect(attrs2[0].message_id).toBe(`${turn2Id}:msg:1`);
    expect(attrs1[0].message_id).not.toBe(attrs2[0].message_id);
  });

  it("is idempotent — running twice produces no duplicates", () => {
    const ledger = makeLedger();
    ledger.addAutoInjected(MEM_A, 0.9);

    const params = defaultParams({ ledger });
    processAfterTurn(params);
    processAfterTurn(params); // second call

    const exposures = db.getExposures(SESSION_ID, TURN_ID);
    expect(exposures).toHaveLength(1); // ON CONFLICT DO NOTHING
  });

  it("handles empty ledger without errors", () => {
    const ledger = makeLedger();
    processAfterTurn(defaultParams({ ledger }));

    const exposures = db.getExposures(SESSION_ID, TURN_ID);
    expect(exposures).toHaveLength(0);
  });

  it("skips attribution when no assistant message exists", () => {
    const ledger = makeLedger();
    ledger.addAutoInjected(MEM_A, 0.9);

    const messages = [{ role: "user", content: "hi" }]; // no assistant
    processAfterTurn(defaultParams({ ledger, messages }));

    // Exposure should still be written
    const exposures = db.getExposures(SESSION_ID, TURN_ID);
    expect(exposures).toHaveLength(1);

    // But no attribution (no assistant message to attribute to)
    const attributions = db.getAttributionsForTurn(TURN_ID);
    expect(attributions).toHaveLength(0);
  });

  describe("cross-turn feedback attribution promotion", () => {
    it("promotes attribution to positive on rating ≥ 4", () => {
      const ledger = makeLedger();
      const messages = makeMessages(1, [
        {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "toolu_1",
              name: "memory_feedback",
              input: { memory_id: MEM_A, rating: 5 },
            },
          ],
        },
      ]);

      processAfterTurn(defaultParams({ ledger, messages, prePromptMessageCount: 1 }));

      const attributions = db.getAttributionsForTurn(TURN_ID);
      const attr = attributions.find((a) => a.memory_id === MEM_A);
      expect(attr).toBeDefined();
      expect(attr!.evidence).toBe("agent_feedback_positive");
      expect(attr!.confidence).toBe(CONFIDENCE.agent_feedback_positive);
    });

    it("writes neutral attribution on rating = 3", () => {
      const ledger = makeLedger();
      const messages = makeMessages(1, [
        {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "toolu_1",
              name: "memory_feedback",
              input: { memory_id: MEM_A, rating: 3 },
            },
          ],
        },
      ]);

      processAfterTurn(defaultParams({ ledger, messages, prePromptMessageCount: 1 }));

      const attributions = db.getAttributionsForTurn(TURN_ID);
      const attr = attributions.find((a) => a.memory_id === MEM_A);
      expect(attr!.evidence).toBe("agent_feedback_neutral");
      expect(attr!.confidence).toBe(CONFIDENCE.agent_feedback_neutral);
    });

    it("writes negative attribution on rating ≤ 2", () => {
      const ledger = makeLedger();
      const messages = makeMessages(1, [
        {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "toolu_1",
              name: "memory_feedback",
              input: { memory_id: MEM_A, rating: 1 },
            },
          ],
        },
      ]);

      processAfterTurn(defaultParams({ ledger, messages, prePromptMessageCount: 1 }));

      const attributions = db.getAttributionsForTurn(TURN_ID);
      const attr = attributions.find((a) => a.memory_id === MEM_A);
      expect(attr!.evidence).toBe("agent_feedback_negative");
      expect(attr!.confidence).toBe(CONFIDENCE.agent_feedback_negative);
    });

    it("feedback promotes existing search attribution via upsert", () => {
      const ledger = makeLedger();
      ledger.addSearchResults([{ id: MEM_A, score: 0.8, query: "test" }]);

      const messages = makeMessages(1, [
        {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "toolu_1",
              name: "memory_feedback",
              input: { memory_id: MEM_A, rating: 5 },
            },
          ],
        },
      ]);

      processAfterTurn(defaultParams({ ledger, messages, prePromptMessageCount: 1 }));

      const attributions = db.getAttributionsForTurn(TURN_ID);
      // Should have been promoted from tool_search_returned (0.3) to agent_feedback_positive (0.95)
      const attrs = attributions.filter((a) => a.memory_id === MEM_A);
      expect(attrs).toHaveLength(1); // upsert, not two rows
      expect(attrs[0].evidence).toBe("agent_feedback_positive");
      expect(attrs[0].confidence).toBe(CONFIDENCE.agent_feedback_positive);
    });

    it("negative feedback demotes existing search attribution", () => {
      const ledger = makeLedger();
      ledger.addSearchResults([{ id: MEM_A, score: 0.8, query: "test" }]);

      const messages = makeMessages(1, [
        {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "toolu_1",
              name: "memory_feedback",
              input: { memory_id: MEM_A, rating: 1 },
            },
          ],
        },
      ]);

      processAfterTurn(defaultParams({ ledger, messages, prePromptMessageCount: 1 }));

      const attrs = db.getAttributionsForTurn(TURN_ID).filter((a) => a.memory_id === MEM_A);
      expect(attrs).toHaveLength(1);
      // Negative feedback (-0.5) should override search (0.3) because explicit > implicit
      expect(attrs[0].evidence).toBe("agent_feedback_negative");
      expect(attrs[0].confidence).toBe(CONFIDENCE.agent_feedback_negative);
    });

    it("cross-turn: feedback in later turn updates prior turn's attribution row", () => {
      // Turn 1: search returns MEM_A → attribution with tool_search_returned
      const ledger1 = makeLedger();
      ledger1.addSearchResults([{ id: MEM_A, score: 0.8, query: "test" }]);
      const turn1Id = "session-001:2026-03-31T12:00:00.000Z";
      const turn1Messages = [
        { role: "user", content: "find stuff" },
        { role: "assistant", content: "found it" },
      ];
      processAfterTurn({
        ...defaultParams({ ledger: ledger1, messages: turn1Messages }),
        turnId: turn1Id,
      });

      // Verify turn 1 attribution exists
      const attrsBefore = db.getAttributionsByMemory(MEM_A);
      expect(attrsBefore).toHaveLength(1);
      expect(attrsBefore[0].evidence).toBe("tool_search_returned");
      expect(attrsBefore[0].confidence).toBe(CONFIDENCE.tool_search_returned);
      const priorMessageId = attrsBefore[0].message_id;

      // Turn 2: feedback on MEM_A with rating 5 (no ledger entries for MEM_A)
      const ledger2 = makeLedger();
      const turn2Id = "session-001:2026-03-31T12:05:00.000Z";
      const turn2Messages = makeMessages(2, [
        {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "toolu_1",
              name: "memory_feedback",
              input: { memory_id: MEM_A, rating: 5 },
            },
          ],
        },
      ]);
      processAfterTurn({
        ...defaultParams({ ledger: ledger2, messages: turn2Messages, prePromptMessageCount: 2 }),
        turnId: turn2Id,
      });

      // The prior turn's attribution row should be promoted (same message_id)
      const attrsAfter = db.getAttributionsByMemory(MEM_A);
      expect(attrsAfter).toHaveLength(1); // same row updated, not a new one
      expect(attrsAfter[0].message_id).toBe(priorMessageId);
      expect(attrsAfter[0].evidence).toBe("agent_feedback_positive");
      expect(attrsAfter[0].confidence).toBe(CONFIDENCE.agent_feedback_positive);
    });

    it("cross-turn: feedback for unknown memory creates new attribution on current turn", () => {
      const ledger = makeLedger();
      const messages = makeMessages(1, [
        {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "toolu_1",
              name: "memory_feedback",
              input: { memory_id: MEM_A, rating: 4 },
            },
          ],
        },
      ]);

      processAfterTurn(defaultParams({ ledger, messages, prePromptMessageCount: 1 }));

      // No prior attribution exists — should create new row with current turn's messageId
      const attrs = db.getAttributionsByMemory(MEM_A);
      expect(attrs).toHaveLength(1);
      expect(attrs[0].message_id).toBe(`${TURN_ID}:msg:1`); // assistant at index 1 (after 1 pre-prompt)
      expect(attrs[0].evidence).toBe("agent_feedback_positive");
    });
  });
});

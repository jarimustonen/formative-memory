import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendFeedbackEvent,
  appendRecallEvent,
  appendSearchEvent,
  appendStoreEvent,
  parseRetrievalLog,
} from "./retrieval-log.ts";

let logDir: string;
let logPath: string;

beforeEach(() => {
  logDir = join(tmpdir(), `amem-log-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(logDir, { recursive: true });
  logPath = join(logDir, "retrieval.log");
});

afterEach(() => {
  rmSync(logDir, { recursive: true, force: true });
});

describe("retrieval log", () => {
  it("appends and parses search event", () => {
    appendSearchEvent(logPath, ["id1", "id2", "id3"]);
    const entries = parseRetrievalLog(logPath);
    expect(entries).toHaveLength(1);
    expect(entries[0].event).toBe("search");
    expect(entries[0].ids).toEqual(["id1", "id2", "id3"]);
  });

  it("appends and parses recall event", () => {
    appendRecallEvent(logPath, ["id1", "id2"]);
    const entries = parseRetrievalLog(logPath);
    expect(entries[0].event).toBe("recall");
    expect(entries[0].ids).toEqual(["id1", "id2"]);
  });

  it("appends and parses feedback event", () => {
    appendFeedbackEvent(logPath, { id1: 3, id2: 1 }, "good results");
    const entries = parseRetrievalLog(logPath);
    expect(entries[0].event).toBe("feedback");
    expect(entries[0].ratings).toEqual({ id1: 3, id2: 1 });
    expect(entries[0].comment).toBe("good results");
  });

  it("appends and parses store event", () => {
    appendStoreEvent(logPath, "new_id", ["ctx1", "ctx2"]);
    const entries = parseRetrievalLog(logPath);
    expect(entries[0].event).toBe("store");
    expect(entries[0].ids).toEqual(["new_id"]);
    expect(entries[0].context_ids).toEqual(["ctx1", "ctx2"]);
  });

  it("handles multiple events", () => {
    appendSearchEvent(logPath, ["a"]);
    appendRecallEvent(logPath, ["b"]);
    appendStoreEvent(logPath, "c", []);
    const entries = parseRetrievalLog(logPath);
    expect(entries).toHaveLength(3);
  });

  it("returns empty for nonexistent log", () => {
    const entries = parseRetrievalLog(join(logDir, "nonexistent.log"));
    expect(entries).toEqual([]);
  });

  it("skips empty ids", () => {
    appendSearchEvent(logPath, []);
    const entries = parseRetrievalLog(logPath);
    expect(entries).toHaveLength(0);
  });
});

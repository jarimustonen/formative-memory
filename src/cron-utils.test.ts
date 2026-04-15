import { describe, expect, it, vi } from "vitest";
import {
  normalizeTrimmedString,
  includesSystemEventToken,
  reconcileCronJob,
  type CronService,
  type DesiredCronJob,
} from "./cron-utils.ts";

// -- normalizeTrimmedString --

describe("normalizeTrimmedString", () => {
  it("returns trimmed string for non-empty input", () => {
    expect(normalizeTrimmedString("  hello  ")).toBe("hello");
  });

  it("returns undefined for empty string", () => {
    expect(normalizeTrimmedString("")).toBeUndefined();
  });

  it("returns undefined for whitespace-only string", () => {
    expect(normalizeTrimmedString("   ")).toBeUndefined();
  });

  it("returns undefined for non-string types", () => {
    expect(normalizeTrimmedString(null)).toBeUndefined();
    expect(normalizeTrimmedString(undefined)).toBeUndefined();
    expect(normalizeTrimmedString(42)).toBeUndefined();
    expect(normalizeTrimmedString({})).toBeUndefined();
  });
});

// -- includesSystemEventToken --

describe("includesSystemEventToken", () => {
  const TOKEN = "__associative_memory_consolidation__";

  it("matches exact body", () => {
    expect(includesSystemEventToken(TOKEN, TOKEN)).toBe(true);
  });

  it("matches with surrounding whitespace", () => {
    expect(includesSystemEventToken(`  ${TOKEN}  `, TOKEN)).toBe(true);
  });

  it("matches token on one line in multi-line body", () => {
    expect(includesSystemEventToken(`some preamble\n${TOKEN}\nother stuff`, TOKEN)).toBe(true);
  });

  it("matches token with whitespace on its line", () => {
    expect(includesSystemEventToken(`first line\n  ${TOKEN}  \nlast line`, TOKEN)).toBe(true);
  });

  it("rejects substring match (not on its own line)", () => {
    expect(includesSystemEventToken(`prefix${TOKEN}suffix`, TOKEN)).toBe(false);
  });

  it("rejects partial token", () => {
    expect(includesSystemEventToken("__associative_memory_", TOKEN)).toBe(false);
  });

  it("rejects empty body", () => {
    expect(includesSystemEventToken("", TOKEN)).toBe(false);
  });

  it("rejects whitespace-only body", () => {
    expect(includesSystemEventToken("   ", TOKEN)).toBe(false);
  });

  it("rejects empty token", () => {
    expect(includesSystemEventToken(TOKEN, "")).toBe(false);
  });

  it("handles CRLF line endings", () => {
    expect(includesSystemEventToken(`line1\r\n${TOKEN}\r\nline3`, TOKEN)).toBe(true);
  });

  it("can distinguish between two different tokens", () => {
    const TEMPORAL = "__associative_memory_temporal_transitions__";
    const body = TOKEN;
    expect(includesSystemEventToken(body, TOKEN)).toBe(true);
    expect(includesSystemEventToken(body, TEMPORAL)).toBe(false);
  });

  it("detects both tokens when both present in body", () => {
    const TEMPORAL = "__associative_memory_temporal_transitions__";
    const body = `${TOKEN}\n${TEMPORAL}`;
    expect(includesSystemEventToken(body, TOKEN)).toBe(true);
    expect(includesSystemEventToken(body, TEMPORAL)).toBe(true);
  });
});

// -- reconcileCronJob --

describe("reconcileCronJob", () => {
  const TAG = "[managed-by=test]";

  function makeDesired(overrides: Partial<DesiredCronJob> = {}): DesiredCronJob {
    return {
      name: "Test Job",
      description: `${TAG} Test description.`,
      enabled: true,
      schedule: { kind: "cron", expr: "0 3 * * *" },
      sessionTarget: "main",
      wakeMode: "now",
      payload: { kind: "systemEvent", text: "__test_token__" },
      ...overrides,
    };
  }

  function makeCron(): CronService & { calls: Record<string, any[][]> } {
    const calls: Record<string, any[][]> = { add: [], update: [], remove: [] };
    return {
      calls,
      add: vi.fn(async (...args: any[]) => { calls.add.push(args); }),
      update: vi.fn(async (...args: any[]) => { calls.update.push(args); }),
      remove: vi.fn(async (...args: any[]) => { calls.remove.push(args); }),
    };
  }

  const logger = { info: vi.fn(), warn: vi.fn() };

  it("creates job when no managed jobs exist", async () => {
    const cron = makeCron();
    const desired = makeDesired();
    await reconcileCronJob(cron, [], desired, TAG, logger);

    expect(cron.calls.add).toHaveLength(1);
    expect(cron.calls.add[0][0]).toEqual(desired);
    expect(cron.calls.update).toHaveLength(0);
  });

  it("does not update when existing job matches desired state", async () => {
    const cron = makeCron();
    const desired = makeDesired();
    const existing = {
      id: "job-1",
      name: "Test Job",
      description: `${TAG} Test description.`,
      schedule: { kind: "cron", expr: "0 3 * * *" },
      wakeMode: "now",
      enabled: true,
      payload: { kind: "systemEvent", text: "__test_token__" },
      sessionTarget: "main",
      createdAtMs: 1000,
    };

    await reconcileCronJob(cron, [existing], desired, TAG, logger);

    expect(cron.calls.add).toHaveLength(0);
    expect(cron.calls.update).toHaveLength(0);
  });

  it("updates when schedule.expr drifted", async () => {
    const cron = makeCron();
    const desired = makeDesired();
    const existing = {
      id: "job-1",
      description: `${TAG} old`,
      schedule: { kind: "cron", expr: "0 4 * * *" }, // different
      wakeMode: "now",
      enabled: true,
      payload: { kind: "systemEvent", text: "__test_token__" },
      sessionTarget: "main",
    };

    await reconcileCronJob(cron, [existing], desired, TAG, logger);

    expect(cron.calls.update).toHaveLength(1);
    expect(cron.calls.update[0][0]).toBe("job-1");
    expect(cron.calls.update[0][1].schedule.expr).toBe("0 3 * * *");
  });

  it("updates when wakeMode drifted", async () => {
    const cron = makeCron();
    const desired = makeDesired();
    const existing = {
      id: "job-1",
      description: `${TAG} old`,
      schedule: { kind: "cron", expr: "0 3 * * *" },
      wakeMode: "next-heartbeat", // different
      enabled: true,
      payload: { kind: "systemEvent", text: "__test_token__" },
      sessionTarget: "main",
    };

    await reconcileCronJob(cron, [existing], desired, TAG, logger);

    expect(cron.calls.update).toHaveLength(1);
    expect(cron.calls.update[0][1].wakeMode).toBe("now");
  });

  it("updates when enabled drifted", async () => {
    const cron = makeCron();
    const desired = makeDesired();
    const existing = {
      id: "job-1",
      description: `${TAG} old`,
      schedule: { kind: "cron", expr: "0 3 * * *" },
      wakeMode: "now",
      enabled: false, // different
      payload: { kind: "systemEvent", text: "__test_token__" },
      sessionTarget: "main",
    };

    await reconcileCronJob(cron, [existing], desired, TAG, logger);

    expect(cron.calls.update).toHaveLength(1);
    expect(cron.calls.update[0][1].enabled).toBe(true);
  });

  it("updates when payload.text drifted", async () => {
    const cron = makeCron();
    const desired = makeDesired();
    const existing = {
      id: "job-1",
      description: `${TAG} old`,
      schedule: { kind: "cron", expr: "0 3 * * *" },
      wakeMode: "now",
      enabled: true,
      payload: { kind: "systemEvent", text: "__old_token__" }, // different
      sessionTarget: "main",
      name: "Test Job",
    };

    await reconcileCronJob(cron, [existing], desired, TAG, logger);

    expect(cron.calls.update).toHaveLength(1);
    expect(cron.calls.update[0][1].payload.text).toBe("__test_token__");
  });

  it("updates when name or description drifted", async () => {
    const cron = makeCron();
    const desired = makeDesired();
    const existing = {
      id: "job-1",
      description: `${TAG} Old description.`, // tag present so it matches
      name: "Old Name", // drifted name
      schedule: { kind: "cron", expr: "0 3 * * *" },
      wakeMode: "now",
      enabled: true,
      payload: { kind: "systemEvent", text: "__test_token__" },
      sessionTarget: "main",
    };

    await reconcileCronJob(cron, [existing], desired, TAG, logger);

    expect(cron.calls.update).toHaveLength(1);
    expect(cron.calls.update[0][1].name).toBe("Test Job");
    expect(cron.calls.update[0][1].description).toContain(TAG);
  });

  it("identifies job by name + payload when description tag missing", async () => {
    const cron = makeCron();
    const desired = makeDesired();
    const existing = {
      id: "job-1",
      description: "Some other description", // no tag
      name: "Test Job",
      schedule: { kind: "cron", expr: "0 3 * * *" },
      wakeMode: "now",
      enabled: true,
      payload: { kind: "systemEvent", text: "__test_token__" },
      sessionTarget: "main",
    };

    await reconcileCronJob(cron, [existing], desired, TAG, logger);

    // Should match by name+payload, not create a new one
    expect(cron.calls.add).toHaveLength(0);
  });

  it("selects oldest job as primary when duplicates exist", async () => {
    const cron = makeCron();
    const desired = makeDesired();
    const older = {
      id: "old",
      description: `${TAG} old`,
      name: "Test Job",
      schedule: { kind: "cron", expr: "0 3 * * *" },
      wakeMode: "now",
      enabled: true,
      payload: { kind: "systemEvent", text: "__test_token__" },
      sessionTarget: "main",
      createdAtMs: 1000,
    };
    const newer = {
      id: "new",
      description: `${TAG} new`,
      name: "Test Job",
      schedule: { kind: "cron", expr: "0 3 * * *" },
      wakeMode: "now",
      enabled: true,
      payload: { kind: "systemEvent", text: "__test_token__" },
      sessionTarget: "main",
      createdAtMs: 2000,
    };

    // Pass in reverse order to verify sorting
    await reconcileCronJob(cron, [newer, older], desired, TAG, logger);

    // Should remove the newer one, keep the older
    expect(cron.calls.remove).toHaveLength(1);
    expect(cron.calls.remove[0][0]).toBe("new");
  });

  it("jobs without createdAtMs sort last (not treated as oldest)", async () => {
    const cron = makeCron();
    const desired = makeDesired();
    const withTimestamp = {
      id: "valid",
      description: `${TAG}`,
      name: "Test Job",
      schedule: { kind: "cron", expr: "0 3 * * *" },
      wakeMode: "now",
      enabled: true,
      payload: { kind: "systemEvent", text: "__test_token__" },
      sessionTarget: "main",
      createdAtMs: 5000,
    };
    const withoutTimestamp = {
      id: "malformed",
      description: `${TAG}`,
      name: "Test Job",
      schedule: { kind: "cron", expr: "0 3 * * *" },
      wakeMode: "now",
      enabled: true,
      payload: { kind: "systemEvent", text: "__test_token__" },
      sessionTarget: "main",
      // no createdAtMs
    };

    await reconcileCronJob(cron, [withoutTimestamp, withTimestamp], desired, TAG, logger);

    // Should keep the one with a valid timestamp, remove the malformed one
    expect(cron.calls.remove).toHaveLength(1);
    expect(cron.calls.remove[0][0]).toBe("malformed");
  });

  it("continues pruning when one duplicate removal fails", async () => {
    const cron = makeCron();
    cron.remove = vi.fn()
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce(undefined) as any;

    const desired = makeDesired();
    const jobs = [
      { id: "a", description: `${TAG}`, createdAtMs: 1, schedule: { expr: "0 3 * * *" }, wakeMode: "now", enabled: true, payload: { kind: "systemEvent", text: "__test_token__" }, sessionTarget: "main" },
      { id: "b", description: `${TAG}`, createdAtMs: 2, schedule: { expr: "0 3 * * *" }, wakeMode: "now", enabled: true, payload: { kind: "systemEvent", text: "__test_token__" }, sessionTarget: "main" },
      { id: "c", description: `${TAG}`, createdAtMs: 3, schedule: { expr: "0 3 * * *" }, wakeMode: "now", enabled: true, payload: { kind: "systemEvent", text: "__test_token__" }, sessionTarget: "main" },
    ];

    // Should not throw
    await reconcileCronJob(cron, jobs, desired, TAG, logger);

    // Both duplicates attempted removal
    expect(cron.remove).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalled();
  });

  it("does not match unrelated jobs", async () => {
    const cron = makeCron();
    const desired = makeDesired();
    const unrelated = {
      id: "other",
      description: "Something completely different",
      name: "Other Job",
      schedule: { kind: "cron", expr: "0 6 * * *" },
      wakeMode: "now",
      enabled: true,
      payload: { kind: "systemEvent", text: "__other_token__" },
      sessionTarget: "main",
    };

    await reconcileCronJob(cron, [unrelated], desired, TAG, logger);

    // Should create new, not touch the unrelated job
    expect(cron.calls.add).toHaveLength(1);
    expect(cron.calls.update).toHaveLength(0);
    expect(cron.calls.remove).toHaveLength(0);
  });
});

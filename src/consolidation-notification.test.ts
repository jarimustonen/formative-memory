import { describe, expect, it, vi } from "vitest";
import {
  formatDetailedReport,
  buildSummaryPrompt,
  formatConsolidationNotification,
  formatTemporalDetailedReport,
  buildTemporalSummaryPrompt,
  formatTemporalNotification,
} from "./consolidation-notification.ts";
import type { ConsolidationResult } from "./consolidation.ts";

const baseResult: ConsolidationResult = {
  ok: true,
  summary: {
    catchUpDecayed: 0,
    reinforced: 5,
    decayed: 3,
    pruned: 1,
    prunedAssociations: 2,
    merged: 2,
    transitioned: 0,
    exposuresGc: 4,
  },
  durationMs: 142,
};

describe("formatDetailedReport", () => {
  it("produces the technical report format", () => {
    const text = formatDetailedReport(baseResult);
    expect(text).toContain("Memory consolidation complete (142ms)");
    expect(text).toContain("Reinforced: 5");
    expect(text).toContain("Decayed: 3");
    expect(text).toContain("Pruned: 1 memories + 2 associations");
    expect(text).toContain("Merged: 2");
    expect(text).toContain("Exposure GC: 4");
  });

  it("includes catch-up info when non-zero", () => {
    const result = { ...baseResult, summary: { ...baseResult.summary, catchUpDecayed: 7 } };
    const text = formatDetailedReport(result);
    expect(text).toContain("Catch-up decayed: 7");
  });

  it("omits catch-up info when zero", () => {
    const text = formatDetailedReport(baseResult);
    expect(text).not.toContain("Catch-up");
  });
});

describe("buildSummaryPrompt", () => {
  it("includes consolidation data", () => {
    const prompt = buildSummaryPrompt(baseResult.summary);
    expect(prompt).toContain("Memories strengthened: 5");
    expect(prompt).toContain("Memories faded: 3");
    expect(prompt).toContain("Duplicate memories merged: 2");
  });

  it("includes persona hint when provided", () => {
    const prompt = buildSummaryPrompt(baseResult.summary, "a playful cat named Kisu");
    expect(prompt).toContain("a playful cat named Kisu");
    expect(prompt).toContain("Match this voice");
  });

  it("omits catch-up line when zero", () => {
    const prompt = buildSummaryPrompt(baseResult.summary);
    expect(prompt).not.toContain("Catch-up");
  });

  it("includes catch-up line when non-zero", () => {
    const summary = { ...baseResult.summary, catchUpDecayed: 3 };
    const prompt = buildSummaryPrompt(summary);
    expect(prompt).toContain("Catch-up fading");
  });
});

describe("formatConsolidationNotification", () => {
  it("returns null when level is off", async () => {
    const result = await formatConsolidationNotification(baseResult, {
      level: "off",
      llmConfig: null,
    });
    expect(result).toBeNull();
  });

  it("returns null when level is errors (success path)", async () => {
    const result = await formatConsolidationNotification(baseResult, {
      level: "errors",
      llmConfig: null,
    });
    expect(result).toBeNull();
  });

  it("returns detailed report when level is detailed", async () => {
    const result = await formatConsolidationNotification(baseResult, {
      level: "detailed",
      llmConfig: null,
    });
    expect(result).toContain("Memory consolidation complete (142ms)");
    expect(result).toContain("Reinforced: 5");
  });

  it("calls LLM and returns summary when level is summary", async () => {
    const mockCallLlm = vi.fn().mockResolvedValue("I tidied up my memories while you were away.");
    vi.spyOn(await import("./llm-caller.ts"), "callLlm").mockImplementation(mockCallLlm);

    const result = await formatConsolidationNotification(baseResult, {
      level: "summary",
      llmConfig: { provider: "anthropic", apiKey: "test-key" },
    });

    expect(mockCallLlm).toHaveBeenCalledOnce();
    expect(result).toBe("I tidied up my memories while you were away.");

    vi.restoreAllMocks();
  });

  it("falls back to short message when LLM fails", async () => {
    vi.spyOn(await import("./llm-caller.ts"), "callLlm").mockRejectedValue(
      new Error("rate limit exceeded"),
    );

    const result = await formatConsolidationNotification(baseResult, {
      level: "summary",
      llmConfig: { provider: "anthropic", apiKey: "test-key" },
    });

    expect(result).toBe("Memory maintenance complete.");

    vi.restoreAllMocks();
  });

  it("falls back to short message when no LLM config available", async () => {
    const result = await formatConsolidationNotification(baseResult, {
      level: "summary",
      llmConfig: null,
    });

    expect(result).toBe("Memory maintenance complete.");
  });

  it("uses short timeout and token limit for LLM call", async () => {
    const mockCallLlm = vi.fn().mockResolvedValue("Done.");
    vi.spyOn(await import("./llm-caller.ts"), "callLlm").mockImplementation(mockCallLlm);

    await formatConsolidationNotification(baseResult, {
      level: "summary",
      llmConfig: { provider: "anthropic", apiKey: "test-key" },
    });

    const config = mockCallLlm.mock.calls[0][1];
    expect(config.maxTokens).toBe(256);
    expect(config.timeoutMs).toBe(15_000);

    vi.restoreAllMocks();
  });
});

describe("formatTemporalDetailedReport", () => {
  it("reports count when non-zero", () => {
    expect(formatTemporalDetailedReport(3)).toBe("Temporal transitions: 3 updated.");
  });

  it("reports no transitions needed when zero", () => {
    expect(formatTemporalDetailedReport(0)).toBe("No temporal transitions needed.");
  });
});

describe("buildTemporalSummaryPrompt", () => {
  it("includes count info", () => {
    const prompt = buildTemporalSummaryPrompt(5);
    expect(prompt).toContain("5 memories");
  });

  it("mentions nothing needed when count is zero", () => {
    const prompt = buildTemporalSummaryPrompt(0);
    expect(prompt).toContain("No memories needed time updates");
  });
});

describe("formatTemporalNotification", () => {
  it("returns null when level is off", async () => {
    const result = await formatTemporalNotification(3, { level: "off", llmConfig: null });
    expect(result).toBeNull();
  });

  it("returns null when level is errors (success path)", async () => {
    const result = await formatTemporalNotification(3, { level: "errors", llmConfig: null });
    expect(result).toBeNull();
  });

  it("returns detailed report when level is detailed", async () => {
    const result = await formatTemporalNotification(3, { level: "detailed", llmConfig: null });
    expect(result).toBe("Temporal transitions: 3 updated.");
  });

  it("returns null for summary when count is zero and LLM available", async () => {
    const result = await formatTemporalNotification(0, {
      level: "summary",
      llmConfig: { provider: "anthropic", apiKey: "test-key" },
    });
    expect(result).toBeNull();
  });

  it("calls LLM for summary when count > 0", async () => {
    const mockCallLlm = vi.fn().mockResolvedValue("Some events have arrived!");
    vi.spyOn(await import("./llm-caller.ts"), "callLlm").mockImplementation(mockCallLlm);

    const result = await formatTemporalNotification(2, {
      level: "summary",
      llmConfig: { provider: "anthropic", apiKey: "test-key" },
    });

    expect(mockCallLlm).toHaveBeenCalledOnce();
    expect(result).toBe("Some events have arrived!");

    vi.restoreAllMocks();
  });

  it("falls back on LLM failure", async () => {
    vi.spyOn(await import("./llm-caller.ts"), "callLlm").mockRejectedValue(new Error("timeout"));

    const result = await formatTemporalNotification(2, {
      level: "summary",
      llmConfig: { provider: "anthropic", apiKey: "test-key" },
    });

    expect(result).toBe("Temporal memory review complete.");

    vi.restoreAllMocks();
  });

  it("falls back to short message when no LLM config and count > 0", async () => {
    const result = await formatTemporalNotification(3, { level: "summary", llmConfig: null });
    expect(result).toBe("Temporal memory review complete.");
  });

  it("returns null when no LLM config and count is 0", async () => {
    const result = await formatTemporalNotification(0, { level: "summary", llmConfig: null });
    expect(result).toBeNull();
  });
});

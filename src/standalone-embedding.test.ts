import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "openclaw/plugin-sdk";
import {
  tryCreateStandaloneProvider,
  autoSelectStandaloneProvider,
} from "./standalone-embedding.ts";

// Mock the SDK's resolveApiKeyForProvider
vi.mock("openclaw/plugin-sdk/provider-auth-runtime", () => ({
  resolveApiKeyForProvider: vi.fn(),
}));

import { resolveApiKeyForProvider } from "openclaw/plugin-sdk/provider-auth-runtime";
const mockResolve = vi.mocked(resolveApiKeyForProvider);

const EMPTY_CFG = {} as OpenClawConfig;

beforeEach(() => {
  mockResolve.mockReset();
});

// -- Provider creation --

describe("tryCreateStandaloneProvider", () => {
  it("returns null for unknown provider ID", async () => {
    expect(await tryCreateStandaloneProvider("voyage", EMPTY_CFG)).toBeNull();
  });

  it("returns null when no API key available", async () => {
    mockResolve.mockResolvedValue({ source: "none", mode: "api-key" });
    const logger = { warn: vi.fn() };
    expect(await tryCreateStandaloneProvider("openai", EMPTY_CFG, undefined, undefined, logger)).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("no API key found for openai"),
    );
  });

  it("creates openai provider with correct shape", async () => {
    mockResolve.mockResolvedValue({ apiKey: "sk-test", source: "profile", mode: "api-key" });
    const provider = await tryCreateStandaloneProvider("openai", EMPTY_CFG);
    expect(provider).not.toBeNull();
    expect(provider!.id).toBe("openai");
    expect(provider!.model).toBe("text-embedding-3-small");
    expect(provider!.embedQuery).toBeTypeOf("function");
    expect(provider!.embedBatch).toBeTypeOf("function");
  });

  it("creates gemini provider with correct shape", async () => {
    mockResolve.mockResolvedValue({ apiKey: "AIza-test", source: "profile", mode: "api-key" });
    const provider = await tryCreateStandaloneProvider("gemini", EMPTY_CFG);
    expect(provider).not.toBeNull();
    expect(provider!.id).toBe("gemini");
    expect(provider!.model).toBe("text-embedding-004");
    expect(provider!.embedQuery).toBeTypeOf("function");
    expect(provider!.embedBatch).toBeTypeOf("function");
  });

  it("uses custom model when specified", async () => {
    mockResolve.mockResolvedValue({ apiKey: "sk-test", source: "profile", mode: "api-key" });
    const provider = await tryCreateStandaloneProvider("openai", EMPTY_CFG, undefined, "text-embedding-3-large");
    expect(provider!.model).toBe("text-embedding-3-large");
  });

  it("strips 'gemini:' prefix from gemini model name (#66452 compat)", async () => {
    mockResolve.mockResolvedValue({ apiKey: "AIza-test", source: "profile", mode: "api-key" });
    const provider = await tryCreateStandaloneProvider(
      "gemini",
      EMPTY_CFG,
      undefined,
      "gemini:text-embedding-004",
    );
    expect(provider!.model).toBe("text-embedding-004");
  });

  it("leaves un-prefixed gemini model names untouched", async () => {
    mockResolve.mockResolvedValue({ apiKey: "AIza-test", source: "profile", mode: "api-key" });
    const provider = await tryCreateStandaloneProvider("gemini", EMPTY_CFG, undefined, "text-embedding-005");
    expect(provider!.model).toBe("text-embedding-005");
  });

  it("passes provider and agentDir to SDK", async () => {
    mockResolve.mockResolvedValue({ apiKey: "sk-test", source: "profile", mode: "api-key" });
    await tryCreateStandaloneProvider("openai", EMPTY_CFG, "/agent/dir");
    expect(mockResolve).toHaveBeenCalledWith({
      provider: "openai",
      cfg: EMPTY_CFG,
      agentDir: "/agent/dir",
    });
  });

  it("maps gemini provider to google for SDK resolution", async () => {
    mockResolve.mockResolvedValue({ apiKey: "AIza-test", source: "profile", mode: "api-key" });
    await tryCreateStandaloneProvider("gemini", EMPTY_CFG);
    expect(mockResolve).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "google" }),
    );
  });
});

// -- Auto-select --

describe("autoSelectStandaloneProvider", () => {
  it("prefers openai when both keys available (backward compatibility)", async () => {
    mockResolve.mockImplementation(async ({ provider }: any) => {
      if (provider === "openai") return { apiKey: "sk-test", source: "profile", mode: "api-key" as const };
      return { apiKey: "AIza-test", source: "profile", mode: "api-key" as const };
    });
    const provider = await autoSelectStandaloneProvider(EMPTY_CFG);
    expect(provider!.id).toBe("openai");
  });

  it("falls back to gemini when openai key not available", async () => {
    mockResolve.mockImplementation(async ({ provider }: any) => {
      if (provider === "openai") return { source: "none", mode: "api-key" as const };
      return { apiKey: "AIza-test", source: "profile", mode: "api-key" as const };
    });
    const provider = await autoSelectStandaloneProvider(EMPTY_CFG);
    expect(provider!.id).toBe("gemini");
  });

  it("uses provider-specific default models", async () => {
    mockResolve.mockResolvedValue({ apiKey: "sk-test", source: "profile", mode: "api-key" });
    const provider = await autoSelectStandaloneProvider(EMPTY_CFG);
    expect(provider!.model).toBe("text-embedding-3-small");
  });

  it("returns null when no keys available", async () => {
    mockResolve.mockResolvedValue({ source: "none", mode: "api-key" });
    expect(await autoSelectStandaloneProvider(EMPTY_CFG)).toBeNull();
  });

  it("warns only once (terminal failure) when no provider succeeds", async () => {
    mockResolve.mockResolvedValue({ source: "none", mode: "api-key" });
    const logger = { warn: vi.fn() };
    expect(await autoSelectStandaloneProvider(EMPTY_CFG, undefined, logger)).toBeNull();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("no API key found for openai or gemini"),
    );
  });
});

// -- Fetch-based API calls (mocked) --

describe("openai provider fetch calls", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("embedQuery calls OpenAI embeddings API", async () => {
    const mockEmbedding = Array.from({ length: 1536 }, (_, i) => i * 0.001);
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({
        data: [{ embedding: mockEmbedding, index: 0 }],
      })),
    );

    mockResolve.mockResolvedValue({ apiKey: "sk-test", source: "profile", mode: "api-key" });
    const provider = (await tryCreateStandaloneProvider("openai", EMPTY_CFG))!;
    const result = await provider.embedQuery("hello world");

    expect(result).toEqual(mockEmbedding);
    expect(globalThis.fetch).toHaveBeenCalledOnce();
    const [url, init] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/embeddings");
    const body = JSON.parse(init.body);
    expect(body.model).toBe("text-embedding-3-small");
    expect(body.input).toEqual(["hello world"]);
    expect(init.headers.Authorization).toBe("Bearer sk-test");
  });

  it("embedBatch sends multiple texts", async () => {
    const embeddings = [
      Array.from({ length: 3 }, () => 0.1),
      Array.from({ length: 3 }, () => 0.2),
    ];
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({
        data: [
          { embedding: embeddings[0], index: 0 },
          { embedding: embeddings[1], index: 1 },
        ],
      })),
    );

    mockResolve.mockResolvedValue({ apiKey: "sk-test", source: "profile", mode: "api-key" });
    const provider = (await tryCreateStandaloneProvider("openai", EMPTY_CFG))!;
    const result = await provider.embedBatch(["hello", "world"]);

    expect(result).toEqual(embeddings);
    const body = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
    expect(body.input).toEqual(["hello", "world"]);
  });

  it("throws on API error", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response("Unauthorized", { status: 401 }),
    );

    mockResolve.mockResolvedValue({ apiKey: "sk-bad", source: "profile", mode: "api-key" });
    const provider = (await tryCreateStandaloneProvider("openai", EMPTY_CFG))!;
    await expect(provider.embedQuery("test")).rejects.toThrow("OpenAI Embeddings API error 401");
  });
});

describe("gemini provider fetch calls", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("embedQuery calls Gemini embedContent API with header auth (no URL key)", async () => {
    const mockValues = Array.from({ length: 768 }, (_, i) => i * 0.001);
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({
        embedding: { values: mockValues },
      })),
    );

    mockResolve.mockResolvedValue({ apiKey: "AIza-test", source: "profile", mode: "api-key" });
    const provider = (await tryCreateStandaloneProvider("gemini", EMPTY_CFG))!;
    const result = await provider.embedQuery("hello world");

    expect(result).toEqual(mockValues);
    expect(globalThis.fetch).toHaveBeenCalledOnce();
    const [url, init] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toContain("text-embedding-004:embedContent");
    // SECURITY: API key must be in header, not URL
    expect(url).not.toContain("AIza-test");
    expect(url).not.toContain("key=");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("AIza-test");
    const body = JSON.parse(init.body);
    expect(body.content.parts[0].text).toBe("hello world");
  });

  it("embedBatch calls Gemini batchEmbedContents API", async () => {
    const embeddings = [
      { values: Array.from({ length: 3 }, () => 0.1) },
      { values: Array.from({ length: 3 }, () => 0.2) },
    ];
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ embeddings })),
    );

    mockResolve.mockResolvedValue({ apiKey: "AIza-test", source: "profile", mode: "api-key" });
    const provider = (await tryCreateStandaloneProvider("gemini", EMPTY_CFG))!;
    const result = await provider.embedBatch(["hello", "world"]);

    expect(result).toEqual(embeddings.map((e) => e.values));
    const [url, init] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toContain("batchEmbedContents");
    // SECURITY: API key must be in header, not URL
    expect(url).not.toContain("AIza-test");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("AIza-test");
  });

  it("calls Gemini API with bare model name when user passes 'gemini:' prefix (#66452)", async () => {
    const mockValues = Array.from({ length: 768 }, () => 0.1);
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ embedding: { values: mockValues } })),
    );

    mockResolve.mockResolvedValue({ apiKey: "AIza-test", source: "profile", mode: "api-key" });
    const provider = (await tryCreateStandaloneProvider(
      "gemini",
      EMPTY_CFG,
      undefined,
      "gemini:text-embedding-004",
    ))!;
    await provider.embedQuery("hi");

    const [url, init] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toContain("text-embedding-004:embedContent");
    expect(url).not.toContain("gemini%3A");
    expect(url).not.toContain("gemini:");
    const body = JSON.parse(init.body);
    expect(body.model).toBe("models/text-embedding-004");
  });

  it("chunks embedBatch into 100-item requests (Gemini API limit)", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn(async (_url: any, init: any) => {
      callCount++;
      const body = JSON.parse(init.body);
      const n = body.requests.length;
      return new Response(JSON.stringify({
        embeddings: Array.from({ length: n }, () => ({ values: [0.1, 0.2, 0.3] })),
      }));
    });

    mockResolve.mockResolvedValue({ apiKey: "AIza-test", source: "profile", mode: "api-key" });
    const provider = (await tryCreateStandaloneProvider("gemini", EMPTY_CFG))!;

    // 250 items → should chunk into 100 + 100 + 50 = 3 calls
    const texts = Array.from({ length: 250 }, (_, i) => `text-${i}`);
    const result = await provider.embedBatch(texts);

    expect(result).toHaveLength(250);
    expect(callCount).toBe(3);

    // Verify chunk sizes
    const bodies = (globalThis.fetch as any).mock.calls.map((c: any) =>
      JSON.parse(c[1].body),
    );
    expect(bodies[0].requests).toHaveLength(100);
    expect(bodies[1].requests).toHaveLength(100);
    expect(bodies[2].requests).toHaveLength(50);
  });

  it("throws on API error", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response("Bad Request", { status: 400 }),
    );

    mockResolve.mockResolvedValue({ apiKey: "AIza-bad", source: "profile", mode: "api-key" });
    const provider = (await tryCreateStandaloneProvider("gemini", EMPTY_CFG))!;
    await expect(provider.embedQuery("test")).rejects.toThrow("Gemini Embeddings API error 400");
  });
});

// -- Empty-batch and response validation --

describe("empty batch handling", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("openai embedBatch([]) returns [] without calling API", async () => {
    globalThis.fetch = vi.fn();
    mockResolve.mockResolvedValue({ apiKey: "sk-test", source: "profile", mode: "api-key" });
    const provider = (await tryCreateStandaloneProvider("openai", EMPTY_CFG))!;

    expect(await provider.embedBatch([])).toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("gemini embedBatch([]) returns [] without calling API", async () => {
    globalThis.fetch = vi.fn();
    mockResolve.mockResolvedValue({ apiKey: "AIza-test", source: "profile", mode: "api-key" });
    const provider = (await tryCreateStandaloneProvider("gemini", EMPTY_CFG))!;

    expect(await provider.embedBatch([])).toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe("response shape validation", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("openai throws actionable error on missing data field", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ foo: "bar" })),
    );

    mockResolve.mockResolvedValue({ apiKey: "sk-test", source: "profile", mode: "api-key" });
    const provider = (await tryCreateStandaloneProvider("openai", EMPTY_CFG))!;
    await expect(provider.embedQuery("test")).rejects.toThrow(
      /OpenAI.*invalid response.*data/,
    );
  });

  it("openai throws when embedding is not a number array", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({
        data: [{ embedding: "not an array", index: 0 }],
      })),
    );

    mockResolve.mockResolvedValue({ apiKey: "sk-test", source: "profile", mode: "api-key" });
    const provider = (await tryCreateStandaloneProvider("openai", EMPTY_CFG))!;
    await expect(provider.embedQuery("test")).rejects.toThrow(
      /embedding.*not an array/,
    );
  });

  it("gemini throws actionable error on missing embedding field", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ foo: "bar" })),
    );

    mockResolve.mockResolvedValue({ apiKey: "AIza-test", source: "profile", mode: "api-key" });
    const provider = (await tryCreateStandaloneProvider("gemini", EMPTY_CFG))!;
    await expect(provider.embedQuery("test")).rejects.toThrow(
      /Gemini.*invalid response.*embedding/,
    );
  });

  it("gemini throws actionable error on missing embeddings array", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ foo: "bar" })),
    );

    mockResolve.mockResolvedValue({ apiKey: "AIza-test", source: "profile", mode: "api-key" });
    const provider = (await tryCreateStandaloneProvider("gemini", EMPTY_CFG))!;
    await expect(provider.embedBatch(["a", "b"])).rejects.toThrow(
      /Gemini.*invalid response.*embeddings/,
    );
  });

  it("gemini throws when values is not a number array", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({
        embedding: { values: null },
      })),
    );

    mockResolve.mockResolvedValue({ apiKey: "AIza-test", source: "profile", mode: "api-key" });
    const provider = (await tryCreateStandaloneProvider("gemini", EMPTY_CFG))!;
    await expect(provider.embedQuery("test")).rejects.toThrow(
      /embedding\.values.*not an array/,
    );
  });
});

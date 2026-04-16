import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resolveEmbeddingApiKey,
  tryCreateStandaloneProvider,
  autoSelectStandaloneProvider,
} from "./standalone-embedding.ts";

// -- API key resolution --

describe("resolveEmbeddingApiKey", () => {
  it("resolves openai key by profile key prefix", () => {
    const profiles = {
      "openai:default": { key: "sk-test-123" },
      "google:default": { key: "AIza-test" },
    };
    expect(resolveEmbeddingApiKey(profiles, "openai")).toBe("sk-test-123");
  });

  it("resolves gemini key by profile key prefix (google:*)", () => {
    const profiles = {
      "openai:default": { key: "sk-test-123" },
      "google:default": { key: "AIza-test" },
    };
    expect(resolveEmbeddingApiKey(profiles, "gemini")).toBe("AIza-test");
  });

  it("resolves by provider field when prefix doesn't match", () => {
    const profiles = {
      "custom-openai": { provider: "openai", key: "sk-custom" },
    };
    expect(resolveEmbeddingApiKey(profiles, "openai")).toBe("sk-custom");
  });

  it("resolves gemini by google provider field", () => {
    const profiles = {
      "my-google": { provider: "google", key: "AIza-custom" },
    };
    expect(resolveEmbeddingApiKey(profiles, "gemini")).toBe("AIza-custom");
  });

  it("returns null when profiles is null (no env var fallback)", () => {
    expect(resolveEmbeddingApiKey(null, "openai")).toBeNull();
    expect(resolveEmbeddingApiKey(null, "gemini")).toBeNull();
  });

  it("ignores process.env.OPENAI_API_KEY even when set", () => {
    // Env vars are intentionally not consulted — auth-profiles.json is the
    // only supported source. This guards against re-introducing env fallback.
    const original = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "sk-env-should-be-ignored";
    try {
      expect(resolveEmbeddingApiKey(null, "openai")).toBeNull();
      expect(resolveEmbeddingApiKey({}, "openai")).toBeNull();
    } finally {
      if (original === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = original;
    }
  });

  it("returns null for empty profiles", () => {
    expect(resolveEmbeddingApiKey({}, "openai")).toBeNull();
  });

  it("skips profiles without key field", () => {
    const profiles = { "openai:default": { provider: "openai" } };
    expect(resolveEmbeddingApiKey(profiles, "openai")).toBeNull();
  });

  it("prefers 'openai:default' over other openai profiles without warning", () => {
    const logger = { warn: vi.fn() };
    const profiles = {
      "openai:work": { key: "sk-work" },
      "openai:default": { key: "sk-default" },
      "openai:personal": { key: "sk-personal" },
    };
    expect(resolveEmbeddingApiKey(profiles, "openai", logger)).toBe("sk-default");
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("prefers 'google:default' over other gemini profiles", () => {
    const profiles = {
      "google:work": { key: "AIza-work" },
      "google:default": { key: "AIza-default" },
    };
    expect(resolveEmbeddingApiKey(profiles, "gemini")).toBe("AIza-default");
  });

  it("warns when multiple non-default profiles match and picks first", () => {
    const logger = { warn: vi.fn() };
    const profiles = {
      "openai:work": { key: "sk-work" },
      "openai:personal": { key: "sk-personal" },
    };
    const result = resolveEmbeddingApiKey(profiles, "openai", logger);
    expect(result).toBe("sk-work"); // deterministic: first-inserted
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringMatching(/Multiple auth profiles.*openai:work.*openai:personal/),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Add a "openai:default" profile'),
    );
  });

  it("does not warn with a single non-default matching profile", () => {
    const logger = { warn: vi.fn() };
    const profiles = {
      "openai:only-one": { key: "sk-single" },
    };
    expect(resolveEmbeddingApiKey(profiles, "openai", logger)).toBe("sk-single");
    expect(logger.warn).not.toHaveBeenCalled();
  });
});

// -- Provider creation --

describe("tryCreateStandaloneProvider", () => {
  it("returns null for unknown provider ID", () => {
    expect(tryCreateStandaloneProvider("voyage", null)).toBeNull();
  });

  it("returns null when no API key available", () => {
    const logger = { warn: vi.fn() };
    expect(tryCreateStandaloneProvider("openai", null, undefined, logger)).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("no API key found for openai"),
    );
  });

  it("creates openai provider with correct shape", () => {
    const profiles = { "openai:default": { key: "sk-test" } };
    const provider = tryCreateStandaloneProvider("openai", profiles);
    expect(provider).not.toBeNull();
    expect(provider!.id).toBe("openai");
    expect(provider!.model).toBe("text-embedding-3-small");
    expect(provider!.embedQuery).toBeTypeOf("function");
    expect(provider!.embedBatch).toBeTypeOf("function");
  });

  it("creates gemini provider with correct shape", () => {
    const profiles = { "google:default": { key: "AIza-test" } };
    const provider = tryCreateStandaloneProvider("gemini", profiles);
    expect(provider).not.toBeNull();
    expect(provider!.id).toBe("gemini");
    expect(provider!.model).toBe("text-embedding-004");
    expect(provider!.embedQuery).toBeTypeOf("function");
    expect(provider!.embedBatch).toBeTypeOf("function");
  });

  it("uses custom model when specified", () => {
    const profiles = { "openai:default": { key: "sk-test" } };
    const provider = tryCreateStandaloneProvider("openai", profiles, "text-embedding-3-large");
    expect(provider!.model).toBe("text-embedding-3-large");
  });
});

// -- Auto-select --

describe("autoSelectStandaloneProvider", () => {
  it("prefers openai when both keys available (backward compatibility)", () => {
    const profiles = {
      "openai:default": { key: "sk-test" },
      "google:default": { key: "AIza-test" },
    };
    const provider = autoSelectStandaloneProvider(profiles);
    expect(provider!.id).toBe("openai");
  });

  it("falls back to gemini when openai key not available", () => {
    const profiles = { "google:default": { key: "AIza-test" } };
    const provider = autoSelectStandaloneProvider(profiles);
    expect(provider!.id).toBe("gemini");
  });

  it("uses provider-specific default models (ignores cross-provider model)", () => {
    // Verify no model parameter is accepted — auto-select must always use
    // each provider's default to avoid cross-provider model pollution.
    const profiles = { "openai:default": { key: "sk-test" } };
    const provider = autoSelectStandaloneProvider(profiles);
    expect(provider!.model).toBe("text-embedding-3-small");
  });

  it("returns null when no profiles available", () => {
    expect(autoSelectStandaloneProvider(null)).toBeNull();
    expect(autoSelectStandaloneProvider({})).toBeNull();
  });

  it("does not spam per-provider warnings when one provider succeeds", () => {
    // Only openai key present → gemini probe should not warn
    const profiles = { "openai:default": { key: "sk-test" } };
    const logger = { warn: vi.fn() };
    const provider = autoSelectStandaloneProvider(profiles, logger);
    expect(provider!.id).toBe("openai");
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("warns only once (terminal failure) when no provider succeeds", () => {
    const logger = { warn: vi.fn() };
    expect(autoSelectStandaloneProvider(null, logger)).toBeNull();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("no API key found for openai or gemini"),
    );
  });

  it("surfaces multi-profile ambiguity warnings during auto-select (#31)", () => {
    // Regression: auto-select used to pass undefined logger to suppress
    // per-provider "no key" noise, which also swallowed the genuinely
    // useful multi-profile ambiguity warning. The warning must surface.
    const logger = { warn: vi.fn() };
    const profiles = {
      "openai:work": { key: "sk-work" },
      "openai:personal": { key: "sk-personal" },
    };
    const provider = autoSelectStandaloneProvider(profiles, logger);
    expect(provider!.id).toBe("openai");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Multiple auth profiles match openai"),
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

    const profiles = { "openai:default": { key: "sk-test" } };
    const provider = tryCreateStandaloneProvider("openai", profiles)!;
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

    const profiles = { "openai:default": { key: "sk-test" } };
    const provider = tryCreateStandaloneProvider("openai", profiles)!;
    const result = await provider.embedBatch(["hello", "world"]);

    expect(result).toEqual(embeddings);
    const body = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
    expect(body.input).toEqual(["hello", "world"]);
  });

  it("throws on API error", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response("Unauthorized", { status: 401 }),
    );

    const profiles = { "openai:default": { key: "sk-bad" } };
    const provider = tryCreateStandaloneProvider("openai", profiles)!;
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

    const profiles = { "google:default": { key: "AIza-test" } };
    const provider = tryCreateStandaloneProvider("gemini", profiles)!;
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

    const profiles = { "google:default": { key: "AIza-test" } };
    const provider = tryCreateStandaloneProvider("gemini", profiles)!;
    const result = await provider.embedBatch(["hello", "world"]);

    expect(result).toEqual(embeddings.map((e) => e.values));
    const [url, init] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toContain("batchEmbedContents");
    // SECURITY: API key must be in header, not URL
    expect(url).not.toContain("AIza-test");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("AIza-test");
  });

  it("chunks embedBatch into 100-item requests (Gemini API limit)", async () => {
    // Return 100 embeddings per call to match the chunk size
    let callCount = 0;
    globalThis.fetch = vi.fn(async (_url: any, init: any) => {
      callCount++;
      const body = JSON.parse(init.body);
      const n = body.requests.length;
      return new Response(JSON.stringify({
        embeddings: Array.from({ length: n }, () => ({ values: [0.1, 0.2, 0.3] })),
      }));
    });

    const profiles = { "google:default": { key: "AIza-test" } };
    const provider = tryCreateStandaloneProvider("gemini", profiles)!;

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

    const profiles = { "google:default": { key: "AIza-bad" } };
    const provider = tryCreateStandaloneProvider("gemini", profiles)!;
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
    const profiles = { "openai:default": { key: "sk-test" } };
    const provider = tryCreateStandaloneProvider("openai", profiles)!;

    expect(await provider.embedBatch([])).toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("gemini embedBatch([]) returns [] without calling API", async () => {
    globalThis.fetch = vi.fn();
    const profiles = { "google:default": { key: "AIza-test" } };
    const provider = tryCreateStandaloneProvider("gemini", profiles)!;

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

    const profiles = { "openai:default": { key: "sk-test" } };
    const provider = tryCreateStandaloneProvider("openai", profiles)!;
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

    const profiles = { "openai:default": { key: "sk-test" } };
    const provider = tryCreateStandaloneProvider("openai", profiles)!;
    await expect(provider.embedQuery("test")).rejects.toThrow(
      /embedding.*not an array/,
    );
  });

  it("gemini throws actionable error on missing embedding field", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ foo: "bar" })),
    );

    const profiles = { "google:default": { key: "AIza-test" } };
    const provider = tryCreateStandaloneProvider("gemini", profiles)!;
    await expect(provider.embedQuery("test")).rejects.toThrow(
      /Gemini.*invalid response.*embedding/,
    );
  });

  it("gemini throws actionable error on missing embeddings array", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ foo: "bar" })),
    );

    const profiles = { "google:default": { key: "AIza-test" } };
    const provider = tryCreateStandaloneProvider("gemini", profiles)!;
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

    const profiles = { "google:default": { key: "AIza-test" } };
    const provider = tryCreateStandaloneProvider("gemini", profiles)!;
    await expect(provider.embedQuery("test")).rejects.toThrow(
      /embedding\.values.*not an array/,
    );
  });
});

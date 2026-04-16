import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resolveEmbeddingApiKey,
  tryCreateStandaloneProvider,
  autoSelectStandaloneProvider,
} from "./standalone-embedding.ts";

// -- API key resolution --

describe("resolveEmbeddingApiKey", () => {
  const savedEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...savedEnv };
  });

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

  it("falls back to OPENAI_API_KEY env var", () => {
    process.env.OPENAI_API_KEY = "sk-env-test";
    expect(resolveEmbeddingApiKey(null, "openai")).toBe("sk-env-test");
  });

  it("falls back to GEMINI_API_KEY env var", () => {
    process.env.GEMINI_API_KEY = "AIza-env-test";
    expect(resolveEmbeddingApiKey(null, "gemini")).toBe("AIza-env-test");
  });

  it("falls back to GOOGLE_API_KEY env var for gemini", () => {
    delete process.env.GEMINI_API_KEY;
    process.env.GOOGLE_API_KEY = "AIza-google-env";
    expect(resolveEmbeddingApiKey(null, "gemini")).toBe("AIza-google-env");
  });

  it("prefers profile key over env var", () => {
    process.env.OPENAI_API_KEY = "sk-env";
    const profiles = { "openai:default": { key: "sk-profile" } };
    expect(resolveEmbeddingApiKey(profiles, "openai")).toBe("sk-profile");
  });

  it("returns null when no key found anywhere", () => {
    delete process.env.OPENAI_API_KEY;
    expect(resolveEmbeddingApiKey(null, "openai")).toBeNull();
  });

  it("returns null for empty profiles and no env var", () => {
    delete process.env.OPENAI_API_KEY;
    expect(resolveEmbeddingApiKey({}, "openai")).toBeNull();
  });

  it("skips profiles without key field", () => {
    delete process.env.OPENAI_API_KEY;
    const profiles = { "openai:default": { provider: "openai" } };
    expect(resolveEmbeddingApiKey(profiles, "openai")).toBeNull();
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
  const savedEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it("prefers gemini when both keys available", () => {
    const profiles = {
      "openai:default": { key: "sk-test" },
      "google:default": { key: "AIza-test" },
    };
    const provider = autoSelectStandaloneProvider(profiles);
    expect(provider!.id).toBe("gemini");
  });

  it("falls back to openai when gemini key not available", () => {
    const profiles = { "openai:default": { key: "sk-test" } };
    const provider = autoSelectStandaloneProvider(profiles);
    expect(provider!.id).toBe("openai");
  });

  it("returns null when no keys available", () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    expect(autoSelectStandaloneProvider(null)).toBeNull();
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

  it("embedQuery calls Gemini embedContent API", async () => {
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
    expect(url).toContain("key=AIza-test");
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
    const [url] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toContain("batchEmbedContents");
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

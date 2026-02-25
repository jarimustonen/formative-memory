import { describe, expect, it } from "vitest";
import { memoryConfigSchema, vectorDimsForModel } from "./config.ts";

describe("vectorDimsForModel", () => {
  it("returns 1536 for text-embedding-3-small", () => {
    expect(vectorDimsForModel("text-embedding-3-small")).toBe(1536);
  });

  it("returns 3072 for text-embedding-3-large", () => {
    expect(vectorDimsForModel("text-embedding-3-large")).toBe(3072);
  });

  it("throws for unknown model", () => {
    expect(() => vectorDimsForModel("unknown-model")).toThrow("Unsupported embedding model");
  });
});

describe("memoryConfigSchema.parse", () => {
  it("parses minimal config", () => {
    const config = memoryConfigSchema.parse({
      embedding: { apiKey: "sk-test-key" },
    });

    expect(config.embedding.provider).toBe("openai");
    expect(config.embedding.model).toBe("text-embedding-3-small");
    expect(config.embedding.apiKey).toBe("sk-test-key");
    expect(config.autoRecall).toBe(true);
    expect(config.autoCapture).toBe(false);
  });

  it("parses full config", () => {
    const config = memoryConfigSchema.parse({
      embedding: { apiKey: "sk-test-key", model: "text-embedding-3-large" },
      dbPath: "/custom/path",
      autoCapture: true,
      autoRecall: false,
    });

    expect(config.embedding.model).toBe("text-embedding-3-large");
    expect(config.dbPath).toBe("/custom/path");
    expect(config.autoCapture).toBe(true);
    expect(config.autoRecall).toBe(false);
  });

  it("rejects missing embedding", () => {
    expect(() => memoryConfigSchema.parse({})).toThrow("embedding.apiKey is required");
  });

  it("rejects unknown keys", () => {
    expect(() =>
      memoryConfigSchema.parse({
        embedding: { apiKey: "sk-test" },
        unknownKey: true,
      }),
    ).toThrow("unknown keys");
  });

  it("rejects unsupported embedding model", () => {
    expect(() =>
      memoryConfigSchema.parse({
        embedding: { apiKey: "sk-test", model: "bad-model" },
      }),
    ).toThrow("Unsupported embedding model");
  });
});

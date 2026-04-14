import { describe, expect, it } from "vitest";
import { memoryConfigSchema } from "./config.ts";

describe("memoryConfigSchema.parse", () => {
  it("parses minimal config (empty object)", () => {
    const config = memoryConfigSchema.parse({});

    expect(config.embedding.provider).toBe("auto");
    expect(config.embedding.model).toBeUndefined();
    expect(config.autoRecall).toBe(true);
    expect(config.autoCapture).toBe(true);
  });

  it("parses config with explicit provider", () => {
    const config = memoryConfigSchema.parse({
      embedding: { provider: "openai", model: "text-embedding-3-large" },
    });

    expect(config.embedding.provider).toBe("openai");
    expect(config.embedding.model).toBe("text-embedding-3-large");
  });

  it("parses full config", () => {
    const config = memoryConfigSchema.parse({
      embedding: { provider: "gemini" },
      dbPath: "/custom/path",
      autoCapture: true,
      autoRecall: false,
    });

    expect(config.embedding.provider).toBe("gemini");
    expect(config.dbPath).toBe("/custom/path");
    expect(config.autoCapture).toBe(true);
    expect(config.autoRecall).toBe(false);
  });

  it("defaults provider to auto when embedding is omitted", () => {
    const config = memoryConfigSchema.parse({ dbPath: "/tmp/test" });
    expect(config.embedding.provider).toBe("auto");
  });

  it("defaults provider to auto when embedding is empty", () => {
    const config = memoryConfigSchema.parse({ embedding: {} });
    expect(config.embedding.provider).toBe("auto");
  });

  it("accepts any string as provider (extensible registry)", () => {
    const config = memoryConfigSchema.parse({
      embedding: { provider: "my-custom-provider" },
    });
    expect(config.embedding.provider).toBe("my-custom-provider");
  });

  it("rejects unknown top-level keys", () => {
    expect(() =>
      memoryConfigSchema.parse({ unknownKey: true }),
    ).toThrow("unknown keys");
  });

  it("rejects unknown embedding keys", () => {
    expect(() =>
      memoryConfigSchema.parse({
        embedding: { provider: "openai", apiKey: "sk-test" },
      }),
    ).toThrow("unknown keys");
  });

  it("rejects non-object embedding value (array)", () => {
    expect(() =>
      memoryConfigSchema.parse({ embedding: [] }),
    ).toThrow("embedding must be an object");
  });

  it("rejects non-object embedding value (string)", () => {
    expect(() =>
      memoryConfigSchema.parse({ embedding: "openai" }),
    ).toThrow("embedding must be an object");
  });

  it("ignores non-string provider (defaults to auto)", () => {
    const config = memoryConfigSchema.parse({ embedding: { provider: 123 } });
    expect(config.embedding.provider).toBe("auto");
  });

  it("ignores non-string model (remains undefined)", () => {
    const config = memoryConfigSchema.parse({ embedding: { model: 42 } });
    expect(config.embedding.model).toBeUndefined();
  });

  it("rejects non-object root", () => {
    expect(() => memoryConfigSchema.parse(null)).toThrow("memory config required");
    expect(() => memoryConfigSchema.parse("string")).toThrow("memory config required");
    expect(() => memoryConfigSchema.parse(42)).toThrow("memory config required");
    expect(() => memoryConfigSchema.parse([])).toThrow("memory config required");
  });
});

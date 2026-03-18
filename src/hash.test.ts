import { describe, expect, it } from "vitest";
import { contentHash } from "./hash.ts";

describe("contentHash", () => {
  it("produces deterministic SHA-256 hex", () => {
    const hash = contentHash("hello world");
    expect(hash).toBe("b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9");
  });

  it("same content = same hash", () => {
    expect(contentHash("test")).toBe(contentHash("test"));
  });

  it("different content = different hash", () => {
    expect(contentHash("a")).not.toBe(contentHash("b"));
  });

  it("handles unicode content", () => {
    const hash = contentHash("Jarin koiran nimi on Namu 🐕");
    expect(hash).toHaveLength(64);
  });
});

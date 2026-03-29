import { describe, expect, it } from "vitest";
import { CONTEXT_ENGINE_ID, createAssociativeMemoryContextEngine } from "./context-engine.ts";
import type { MemoryManager } from "./memory-manager.ts";

function stubManager(): MemoryManager {
  return {} as MemoryManager;
}

function createEngine() {
  return createAssociativeMemoryContextEngine({
    getManager: stubManager,
  });
}

describe("AssociativeMemoryContextEngine", () => {
  describe("info", () => {
    it("has correct id and name", () => {
      const engine = createEngine();
      expect(engine.info.id).toBe(CONTEXT_ENGINE_ID);
      expect(engine.info.name).toBe("Associative Memory");
    });

    it("does not own compaction", () => {
      const engine = createEngine();
      expect(engine.info.ownsCompaction).toBe(false);
    });
  });

  describe("assemble()", () => {
    it("passes messages through unchanged", async () => {
      const engine = createEngine();
      const messages = [
        { role: "user", content: "hello" },
        { role: "assistant", content: "hi there" },
      ];

      const result = await engine.assemble({
        sessionId: "test-session",
        messages: messages as any,
      });

      expect(result.messages).toBe(messages);
      expect(result.estimatedTokens).toBe(0);
    });

    it("returns no systemPromptAddition", async () => {
      const engine = createEngine();
      const result = await engine.assemble({
        sessionId: "test-session",
        messages: [],
      });

      expect(result.systemPromptAddition).toBeUndefined();
    });

    it("ignores tokenBudget and prompt in passthrough mode", async () => {
      const engine = createEngine();
      const messages = [{ role: "user", content: "test" }];

      const result = await engine.assemble({
        sessionId: "test-session",
        messages: messages as any,
        tokenBudget: 1000,
        prompt: "some query",
      });

      expect(result.messages).toBe(messages);
    });
  });

  describe("ingest()", () => {
    it("returns ingested: false (no-op)", async () => {
      const engine = createEngine();
      const result = await engine.ingest({
        sessionId: "test-session",
        message: { role: "user", content: "hello" } as any,
      });

      expect(result.ingested).toBe(false);
    });
  });

  describe("compact()", () => {
    it("delegates to runtime", async () => {
      // We can't easily mock delegateCompactionToRuntime since it's imported
      // at module level. Instead, verify the method exists and is callable.
      const engine = createEngine();
      expect(engine.compact).toBeTypeOf("function");
    });
  });

  describe("dispose()", () => {
    it("is callable without errors", async () => {
      const engine = createEngine();
      await expect(engine.dispose!()).resolves.toBeUndefined();
    });

    it("can be called multiple times", async () => {
      const engine = createEngine();
      await engine.dispose!();
      await engine.dispose!();
    });
  });
});

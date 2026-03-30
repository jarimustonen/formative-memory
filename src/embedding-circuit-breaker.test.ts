import { describe, expect, it, vi } from "vitest";
import {
  EmbeddingCircuitBreaker,
  EmbeddingCircuitOpenError,
  EmbeddingTimeoutError,
} from "./embedding-circuit-breaker.ts";

function createBreaker(opts: {
  failureThreshold?: number;
  cooldownMs?: number;
  timeoutMs?: number;
  now?: () => number;
} = {}) {
  return new EmbeddingCircuitBreaker(opts);
}

describe("EmbeddingCircuitBreaker", () => {
  describe("initial state", () => {
    it("starts in CLOSED state", () => {
      const breaker = createBreaker();
      expect(breaker.getState()).toBe("CLOSED");
    });

    it("is not BM25-only initially", () => {
      const breaker = createBreaker();
      expect(breaker.isBm25Only()).toBe(false);
    });
  });

  describe("CLOSED state", () => {
    it("passes through successful calls", async () => {
      const breaker = createBreaker();
      const result = await breaker.call(() => Promise.resolve([1, 2, 3]));
      expect(result).toEqual([1, 2, 3]);
      expect(breaker.getState()).toBe("CLOSED");
    });

    it("stays CLOSED after one failure (threshold=2)", async () => {
      const breaker = createBreaker({ failureThreshold: 2 });
      await expect(breaker.call(() => Promise.reject(new Error("fail")))).rejects.toThrow("fail");
      expect(breaker.getState()).toBe("CLOSED");
    });

    it("transitions to OPEN after N consecutive failures", async () => {
      const breaker = createBreaker({ failureThreshold: 2 });
      await expect(breaker.call(() => Promise.reject(new Error("fail1")))).rejects.toThrow();
      await expect(breaker.call(() => Promise.reject(new Error("fail2")))).rejects.toThrow();
      expect(breaker.getState()).toBe("OPEN");
      expect(breaker.isBm25Only()).toBe(true);
    });

    it("resets failure count on success", async () => {
      const breaker = createBreaker({ failureThreshold: 2 });
      await expect(breaker.call(() => Promise.reject(new Error("fail")))).rejects.toThrow();
      await breaker.call(() => Promise.resolve("ok"));
      // One more failure should not open (counter reset)
      await expect(breaker.call(() => Promise.reject(new Error("fail")))).rejects.toThrow();
      expect(breaker.getState()).toBe("CLOSED");
    });
  });

  describe("OPEN state", () => {
    it("rejects immediately with EmbeddingCircuitOpenError", async () => {
      const breaker = createBreaker({ failureThreshold: 1 });
      await expect(breaker.call(() => Promise.reject(new Error("x")))).rejects.toThrow();

      await expect(breaker.call(() => Promise.resolve("ok"))).rejects.toThrow(
        EmbeddingCircuitOpenError,
      );
      expect(breaker.isBm25Only()).toBe(true);
    });

    it("does not call the function when OPEN", async () => {
      const breaker = createBreaker({ failureThreshold: 1 });
      await expect(breaker.call(() => Promise.reject(new Error("x")))).rejects.toThrow();

      const fn = vi.fn().mockResolvedValue("ok");
      await expect(breaker.call(fn)).rejects.toThrow(EmbeddingCircuitOpenError);
      expect(fn).not.toHaveBeenCalled();
    });
  });

  describe("OPEN → HALF_OPEN transition", () => {
    it("transitions to HALF_OPEN after cooldown", async () => {
      let time = 1000;
      const breaker = createBreaker({
        failureThreshold: 1,
        cooldownMs: 30_000,
        now: () => time,
      });

      await expect(breaker.call(() => Promise.reject(new Error("x")))).rejects.toThrow();
      expect(breaker.getState()).toBe("OPEN");

      // Advance time past cooldown
      time += 30_000;
      expect(breaker.getState()).toBe("HALF_OPEN");
    });

    it("stays OPEN before cooldown expires", async () => {
      let time = 1000;
      const breaker = createBreaker({
        failureThreshold: 1,
        cooldownMs: 30_000,
        now: () => time,
      });

      await expect(breaker.call(() => Promise.reject(new Error("x")))).rejects.toThrow();

      time += 29_999;
      expect(breaker.getState()).toBe("OPEN");
    });
  });

  describe("HALF_OPEN state", () => {
    it("transitions to CLOSED on success", async () => {
      let time = 1000;
      const breaker = createBreaker({
        failureThreshold: 1,
        cooldownMs: 100,
        now: () => time,
      });

      await expect(breaker.call(() => Promise.reject(new Error("x")))).rejects.toThrow();
      time += 100; // → HALF_OPEN

      const result = await breaker.call(() => Promise.resolve([1, 2]));
      expect(result).toEqual([1, 2]);
      expect(breaker.getState()).toBe("CLOSED");
      expect(breaker.isBm25Only()).toBe(false);
    });

    it("transitions back to OPEN on failure", async () => {
      let time = 1000;
      const breaker = createBreaker({
        failureThreshold: 1,
        cooldownMs: 100,
        now: () => time,
      });

      await expect(breaker.call(() => Promise.reject(new Error("x")))).rejects.toThrow();
      time += 100; // → HALF_OPEN

      await expect(breaker.call(() => Promise.reject(new Error("probe fail")))).rejects.toThrow();
      expect(breaker.getState()).toBe("OPEN");
    });

    it("rejects concurrent callers while probe is in flight", async () => {
      let time = 1000;
      const breaker = createBreaker({
        failureThreshold: 1,
        cooldownMs: 100,
        timeoutMs: 5000,
        now: () => time,
      });

      await expect(breaker.call(() => Promise.reject(new Error("x")))).rejects.toThrow();
      time += 100; // → HALF_OPEN

      // Start a slow probe that will eventually succeed
      let resolveProbe: (v: string) => void;
      const probePromise = breaker.call(
        () => new Promise<string>((resolve) => { resolveProbe = resolve; }),
      );

      // While probe is in flight, concurrent caller should be rejected
      await expect(breaker.call(() => Promise.resolve("concurrent"))).rejects.toThrow(
        EmbeddingCircuitOpenError,
      );

      // Complete the probe
      resolveProbe!("ok");
      await expect(probePromise).resolves.toBe("ok");
      expect(breaker.getState()).toBe("CLOSED");
    });
  });

  describe("timeout", () => {
    it("rejects with EmbeddingTimeoutError when call exceeds timeout", async () => {
      const breaker = createBreaker({ timeoutMs: 50 });
      const slowFn = () => new Promise<number[]>((resolve) => setTimeout(() => resolve([1]), 200));

      await expect(breaker.call(slowFn)).rejects.toThrow(EmbeddingTimeoutError);
      await expect(breaker.call(slowFn)).rejects.toThrow("50ms");
    });

    it("timeout counts as a failure", async () => {
      const breaker = createBreaker({ timeoutMs: 10, failureThreshold: 2 });
      const slowFn = () => new Promise<number[]>((resolve) => setTimeout(() => resolve([1]), 100));

      await expect(breaker.call(slowFn)).rejects.toThrow(EmbeddingTimeoutError);
      await expect(breaker.call(slowFn)).rejects.toThrow(EmbeddingTimeoutError);
      expect(breaker.getState()).toBe("OPEN");
    });

    it("does not timeout fast calls", async () => {
      const breaker = createBreaker({ timeoutMs: 500 });
      const result = await breaker.call(() => Promise.resolve([1, 2, 3]));
      expect(result).toEqual([1, 2, 3]);
    });
  });

  describe("custom failure threshold", () => {
    it("respects threshold=3", async () => {
      const breaker = createBreaker({ failureThreshold: 3 });
      await expect(breaker.call(() => Promise.reject(new Error("1")))).rejects.toThrow();
      await expect(breaker.call(() => Promise.reject(new Error("2")))).rejects.toThrow();
      expect(breaker.getState()).toBe("CLOSED");

      await expect(breaker.call(() => Promise.reject(new Error("3")))).rejects.toThrow();
      expect(breaker.getState()).toBe("OPEN");
    });
  });

  describe("full lifecycle", () => {
    it("CLOSED → OPEN → HALF_OPEN → CLOSED", async () => {
      let time = 0;
      const breaker = createBreaker({
        failureThreshold: 2,
        cooldownMs: 1000,
        now: () => time,
      });

      expect(breaker.getState()).toBe("CLOSED");

      // Two failures → OPEN
      await expect(breaker.call(() => Promise.reject(new Error("a")))).rejects.toThrow();
      await expect(breaker.call(() => Promise.reject(new Error("b")))).rejects.toThrow();
      expect(breaker.getState()).toBe("OPEN");

      // Cooldown → HALF_OPEN
      time += 1000;
      expect(breaker.getState()).toBe("HALF_OPEN");

      // Success → CLOSED
      await breaker.call(() => Promise.resolve("recovered"));
      expect(breaker.getState()).toBe("CLOSED");
      expect(breaker.isBm25Only()).toBe(false);
    });

    it("CLOSED → OPEN → HALF_OPEN → OPEN (probe fails)", async () => {
      let time = 0;
      const breaker = createBreaker({
        failureThreshold: 1,
        cooldownMs: 500,
        now: () => time,
      });

      // Failure → OPEN
      await expect(breaker.call(() => Promise.reject(new Error("a")))).rejects.toThrow();
      expect(breaker.getState()).toBe("OPEN");

      // Cooldown → HALF_OPEN
      time += 500;
      expect(breaker.getState()).toBe("HALF_OPEN");

      // Probe failure → OPEN
      await expect(breaker.call(() => Promise.reject(new Error("probe")))).rejects.toThrow();
      expect(breaker.getState()).toBe("OPEN");

      // Another cooldown → HALF_OPEN again
      time += 500;
      expect(breaker.getState()).toBe("HALF_OPEN");
    });
  });
});

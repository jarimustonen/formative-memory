import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLogger, nullLogger, type Logger } from "./logger.ts";

describe("createLogger", () => {
  const originalEnv = process.env.FORMATIVE_MEMORY_DEBUG;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.FORMATIVE_MEMORY_DEBUG;
    } else {
      process.env.FORMATIVE_MEMORY_DEBUG = originalEnv;
    }
  });

  describe("level filtering", () => {
    it("defaults to info level (suppresses debug)", () => {
      const spy = vi.fn();
      const log = createLogger({ host: { warn: spy, info: spy } });

      log.debug("should be suppressed");
      expect(spy).not.toHaveBeenCalled();

      log.info("visible");
      expect(spy).toHaveBeenCalledOnce();
    });

    it("emits debug when verbose is true", () => {
      const spy = vi.fn();
      const log = createLogger({ verbose: true, host: { warn: spy, info: spy } });

      log.debug("should appear");
      expect(spy).toHaveBeenCalledOnce();
      expect(spy.mock.calls[0][0]).toContain("should appear");
    });

    it("emits debug when FORMATIVE_MEMORY_DEBUG=1", () => {
      process.env.FORMATIVE_MEMORY_DEBUG = "1";
      const spy = vi.fn();
      const log = createLogger({ host: { warn: spy, info: spy } });

      log.debug("env debug");
      expect(spy).toHaveBeenCalledOnce();
      expect(spy.mock.calls[0][0]).toContain("env debug");
    });

    it("does not enable debug for other env values", () => {
      process.env.FORMATIVE_MEMORY_DEBUG = "true";
      const spy = vi.fn();
      const log = createLogger({ host: { warn: spy, info: spy } });

      log.debug("suppressed");
      expect(spy).not.toHaveBeenCalled();
    });

    it("always emits warn and error regardless of level", () => {
      const spy = vi.fn();
      const log = createLogger({ host: { warn: spy } });

      log.warn("w");
      log.error("e");
      expect(spy).toHaveBeenCalledTimes(2);
    });
  });

  describe("host logger routing", () => {
    it("routes warn to host.warn", () => {
      const warn = vi.fn();
      const log = createLogger({ host: { warn } });

      log.warn("test warning");
      expect(warn).toHaveBeenCalledOnce();
      expect(warn.mock.calls[0][0]).toContain("[warn]");
      expect(warn.mock.calls[0][0]).toContain("test warning");
    });

    it("routes error to host.error when available", () => {
      const warn = vi.fn();
      const error = vi.fn();
      const log = createLogger({ host: { warn, error } });

      log.error("test error");
      expect(error).toHaveBeenCalledOnce();
      expect(warn).not.toHaveBeenCalled();
    });

    it("falls back to host.warn when host.error is unavailable", () => {
      const warn = vi.fn();
      const log = createLogger({ host: { warn } });

      log.error("fallback error");
      expect(warn).toHaveBeenCalledOnce();
      expect(warn.mock.calls[0][0]).toContain("[error]");
    });

    it("routes info to host.info when available", () => {
      const warn = vi.fn();
      const info = vi.fn();
      const log = createLogger({ host: { warn, info } });

      log.info("test info");
      expect(info).toHaveBeenCalledOnce();
      expect(warn).not.toHaveBeenCalled();
    });

    it("falls back to host.warn when host.info is unavailable", () => {
      const warn = vi.fn();
      const log = createLogger({ host: { warn } });

      log.info("fallback info");
      expect(warn).toHaveBeenCalledOnce();
      expect(warn.mock.calls[0][0]).toContain("[info]");
    });
  });

  describe("console fallback", () => {
    it("uses console when no host is provided", () => {
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const log = createLogger({});

      log.warn("console test");
      expect(consoleSpy).toHaveBeenCalledOnce();
      expect(consoleSpy.mock.calls[0][0]).toContain("console test");

      consoleSpy.mockRestore();
    });
  });

  describe("message formatting", () => {
    it("includes [formative-memory] prefix", () => {
      const spy = vi.fn();
      const log = createLogger({ host: { warn: spy } });

      log.warn("msg");
      expect(spy.mock.calls[0][0]).toMatch(/^\[formative-memory\]/);
    });

    it("includes level tag", () => {
      const spy = vi.fn();
      const log = createLogger({ host: { warn: spy, info: spy } });

      log.info("x");
      expect(spy.mock.calls[0][0]).toContain("[info]");

      log.warn("y");
      expect(spy.mock.calls[1][0]).toContain("[warn]");
    });
  });
});

describe("nullLogger", () => {
  it("has all four log methods", () => {
    expect(typeof nullLogger.debug).toBe("function");
    expect(typeof nullLogger.info).toBe("function");
    expect(typeof nullLogger.warn).toBe("function");
    expect(typeof nullLogger.error).toBe("function");
  });

  it("does not throw when called", () => {
    expect(() => {
      nullLogger.debug("d");
      nullLogger.info("i");
      nullLogger.warn("w");
      nullLogger.error("e");
    }).not.toThrow();
  });
});

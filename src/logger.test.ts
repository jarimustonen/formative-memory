import { afterEach, describe, expect, it, vi } from "vitest";
import { createLogger, nullLogger } from "./logger.ts";

/** Minimal host logger matching PluginLogger shape. */
function makeHost() {
  return {
    debug: vi.fn() as unknown as ((msg: string) => void) | undefined,
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

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
      const host = makeHost();
      const log = createLogger({ host });

      log.debug("should be suppressed");
      expect(host.info).not.toHaveBeenCalled();

      log.info("visible");
      expect(host.info).toHaveBeenCalledOnce();
    });

    it("emits debug when verbose is true", () => {
      const host = makeHost();
      const log = createLogger({ verbose: true, host });

      log.debug("should appear");
      expect(host.debug).toHaveBeenCalledOnce();
      expect((host.debug as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain("should appear");
    });

    it("emits debug when FORMATIVE_MEMORY_DEBUG=1", () => {
      process.env.FORMATIVE_MEMORY_DEBUG = "1";
      const host = makeHost();
      const log = createLogger({ host });

      log.debug("env debug");
      expect(host.debug).toHaveBeenCalledOnce();
      expect((host.debug as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain("env debug");
    });

    it("does not enable debug for other env values", () => {
      process.env.FORMATIVE_MEMORY_DEBUG = "true";
      const host = makeHost();
      const log = createLogger({ host });

      log.debug("suppressed");
      expect(host.debug).not.toHaveBeenCalled();
      expect(host.info).not.toHaveBeenCalled();
    });

    it("always emits warn and error regardless of level", () => {
      const host = makeHost();
      const log = createLogger({ host });

      log.warn("w");
      log.error("e");
      expect(host.warn).toHaveBeenCalledOnce();
      expect(host.error).toHaveBeenCalledOnce();
    });
  });

  describe("host logger routing", () => {
    it("routes each level to the correct host method", () => {
      const host = makeHost();
      const log = createLogger({ verbose: true, host });

      log.debug("d");
      log.info("i");
      log.warn("w");
      log.error("e");

      expect(host.debug).toHaveBeenCalledOnce();
      expect(host.info).toHaveBeenCalledOnce();
      expect(host.warn).toHaveBeenCalledOnce();
      expect(host.error).toHaveBeenCalledOnce();
    });

    it("falls back debug to host.info when host.debug is unavailable", () => {
      const host = makeHost();
      host.debug = undefined;
      const log = createLogger({ verbose: true, host });

      log.debug("fallback debug");
      expect(host.info).toHaveBeenCalledOnce();
      expect(host.info.mock.calls[0][0]).toContain("[debug]");
    });
  });

  describe("args serialization", () => {
    it("inlines extra arguments into the log line", () => {
      const host = makeHost();
      const log = createLogger({ host });

      log.warn("migration failed", "detail-1", 42);
      expect(host.warn).toHaveBeenCalledOnce();
      const line = host.warn.mock.calls[0][0];
      expect(line).toContain("migration failed");
      expect(line).toContain("detail-1");
      expect(line).toContain("42");
    });

    it("serializes Error objects with stack trace", () => {
      const host = makeHost();
      const log = createLogger({ host });

      const err = new Error("db connection lost");
      log.error("crash", err);
      const line = host.error.mock.calls[0][0] as string;
      expect(line).toContain("db connection lost");
      // Stack trace should be included (starts with "Error:")
      expect(line).toContain("Error:");
    });

    it("survives circular references in objects", () => {
      const host = makeHost();
      const log = createLogger({ host });

      const obj: Record<string, unknown> = { a: 1 };
      obj.self = obj; // circular
      log.warn("circular", obj);
      const line = host.warn.mock.calls[0][0] as string;
      expect(line).toContain("[Unserializable]");
    });

    it("serializes objects as JSON", () => {
      const host = makeHost();
      const log = createLogger({ host });

      log.info("data", { key: "value" });
      const line = host.info.mock.calls[0][0];
      expect(line).toContain('"key":"value"');
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

    it("passes raw args to console for native formatting", () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const log = createLogger({});

      const err = new Error("boom");
      log.error("crash", err);
      // Raw Error object should be passed as second arg, not stringified
      expect(consoleSpy.mock.calls[0][1]).toBe(err);

      consoleSpy.mockRestore();
    });
  });

  describe("message formatting", () => {
    it("includes [formative-memory] prefix", () => {
      const host = makeHost();
      const log = createLogger({ host });

      log.warn("msg");
      expect(host.warn.mock.calls[0][0]).toMatch(/^\[formative-memory\]/);
    });

    it("includes level tag", () => {
      const host = makeHost();
      const log = createLogger({ host });

      log.info("x");
      expect(host.info.mock.calls[0][0]).toContain("[info]");

      log.warn("y");
      expect(host.warn.mock.calls[0][0]).toContain("[warn]");
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

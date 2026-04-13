/**
 * Centralized logger with configurable verbosity.
 *
 * Log level is determined by (in priority order):
 * 1. Environment variable FORMATIVE_MEMORY_DEBUG=1 → debug
 * 2. Plugin config `verbose: true` → debug
 * 3. Default → info
 *
 * All output goes through the host logger (OpenClaw's api.logger) when
 * available, falling back to console.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export type LogFn = (msg: string, ...args: unknown[]) => void;

export interface Logger {
  debug: LogFn;
  info: LogFn;
  warn: LogFn;
  error: LogFn;
  /** True when debug-level messages will actually be emitted. */
  isDebugEnabled: () => boolean;
}

/** Host logger shape — matches OpenClaw's PluginLogger (debug is optional). */
export type HostLogger = {
  debug?: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

/**
 * Create a logger that forwards to the host logger at or above the
 * configured minimum level.
 */
export function createLogger(opts: {
  verbose?: boolean;
  host?: HostLogger;
}): Logger {
  const envDebug = process.env.FORMATIVE_MEMORY_DEBUG === "1";
  const minLevel: LogLevel = opts.verbose || envDebug ? "debug" : "info";
  const minOrder = LEVEL_ORDER[minLevel];
  const host = opts.host;

  function stringifyArg(a: unknown): string {
    if (a instanceof Error) return a.stack || a.message;
    if (typeof a === "object" && a !== null) {
      try { return JSON.stringify(a); } catch { return "[Unserializable]"; }
    }
    return String(a);
  }

  function emit(level: LogLevel, msg: string, args: unknown[]) {
    if (LEVEL_ORDER[level] < minOrder) return;

    const prefix = `[formative-memory] [${level}]`;

    if (host) {
      // Host logger accepts a single string — inline extra args.
      const suffix = args.length > 0
        ? " " + args.map(stringifyArg).join(" ")
        : "";
      const line = `${prefix} ${msg}${suffix}`;
      if (level === "debug") {
        (host.debug ?? host.info)(line);
      } else {
        host[level](line);
      }
    } else {
      // Console — pass raw args for native formatting.
      const line = `${prefix} ${msg}`;
      if (level === "error") {
        console.error(line, ...args);
      } else if (level === "warn") {
        console.warn(line, ...args);
      } else {
        console.log(line, ...args);
      }
    }
  }

  return {
    debug: (msg, ...args) => emit("debug", msg, args),
    info: (msg, ...args) => emit("info", msg, args),
    warn: (msg, ...args) => emit("warn", msg, args),
    error: (msg, ...args) => emit("error", msg, args),
    isDebugEnabled: () => minOrder === LEVEL_ORDER.debug,
  };
}

/** A silent logger that discards all output. Useful for tests. */
export const nullLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  isDebugEnabled: () => false,
};

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
}

/** Host logger shape — matches OpenClaw's api.logger (info may be optional). */
export type HostLogger = {
  warn: (message: string, ...args: unknown[]) => void;
  info?: (msg: string) => void;
  error?: (msg: string) => void;
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

  function emit(level: LogLevel, msg: string, args: unknown[]) {
    if (LEVEL_ORDER[level] < minOrder) return;

    const prefix = `[formative-memory] [${level}]`;
    const line = `${prefix} ${msg}`;

    if (host) {
      // Route through host logger when available
      if (level === "error" && host.error) {
        host.error(line);
      } else if (level === "warn") {
        host.warn(line, ...args);
      } else if (host.info) {
        host.info(line);
      } else {
        // Fallback: host only has warn — use it for info/debug too
        host.warn(line, ...args);
      }
    } else {
      // No host logger — use console
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
  };
}

/** A silent logger that discards all output. Useful for tests. */
export const nullLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

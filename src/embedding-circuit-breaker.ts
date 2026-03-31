/**
 * Embedding Provider Circuit Breaker (Phase 3.5)
 *
 * Three-state machine that prevents cascading failures from embedding API:
 *
 *   CLOSED ──fail×N──► OPEN ──cooldown──► HALF_OPEN
 *     ▲                                       │
 *     └──────────── success ──────────────────┘
 *
 * CLOSED:    Normal hybrid search (embedding + BM25), with timeout.
 * OPEN:      BM25-only, no network calls.
 * HALF_OPEN: Single probe call to test recovery.
 *
 * State is in-memory, resets to CLOSED on process restart.
 * Architecture: v2 §6.
 */

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export type EmbeddingCircuitBreakerOptions = {
  /** Number of consecutive failures before opening the circuit (default: 2). */
  failureThreshold?: number;
  /** Cooldown in ms before transitioning OPEN → HALF_OPEN (default: 30_000). */
  cooldownMs?: number;
  /** Timeout in ms for embedding calls in CLOSED/HALF_OPEN state (default: 3000). */
  timeoutMs?: number;
  /** Clock function for testability (default: Date.now). */
  now?: () => number;
  /** Jitter factor for cooldown (0 = none, 0.2 = ±20%). Default: 0.2. Set to 0 in tests. */
  jitterFactor?: number;
  /** Called on state transitions for logging/metrics. */
  onStateChange?: (from: CircuitState, to: CircuitState) => void;
};

export class EmbeddingCircuitBreaker {
  private state: CircuitState = "CLOSED";
  private consecutiveFailures = 0;
  private lastFailureAt = 0;
  private halfOpenProbeInFlight = false;
  private effectiveCooldown = 0;

  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private readonly jitterFactor: number;
  private readonly onStateChange?: (from: CircuitState, to: CircuitState) => void;

  constructor(options: EmbeddingCircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 2;
    this.cooldownMs = options.cooldownMs ?? 30_000;
    this.timeoutMs = options.timeoutMs ?? 3000;
    this.now = options.now ?? Date.now;
    this.jitterFactor = options.jitterFactor ?? 0.2;
    this.onStateChange = options.onStateChange;

    if (this.failureThreshold < 1) {
      throw new Error("failureThreshold must be >= 1");
    }
    if (this.cooldownMs < 0) {
      throw new Error("cooldownMs must be >= 0");
    }
    if (this.timeoutMs <= 0) {
      throw new Error("timeoutMs must be > 0");
    }
  }

  getState(): CircuitState {
    // Compute effective state without mutation.
    // Actual OPEN → HALF_OPEN transition happens inside call() when a probe starts.
    if (this.state === "OPEN" && this.now() - this.lastFailureAt >= this.effectiveCooldown) {
      return "HALF_OPEN";
    }
    return this.state;
  }

  /** True when circuit is OPEN (no embedding calls, BM25-only). */
  isBm25Only(): boolean {
    return this.getState() === "OPEN";
  }

  /** True when circuit is not fully healthy (OPEN or HALF_OPEN). */
  isDegraded(): boolean {
    return this.getState() !== "CLOSED";
  }

  /**
   * Execute an embedding call through the circuit breaker.
   * Returns the embedding on success, or throws EmbeddingCircuitOpenError when OPEN.
   * Handles timeout (with AbortSignal) and failure tracking.
   */
  async call<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const currentState = this.getState();

    if (currentState === "OPEN") {
      throw new EmbeddingCircuitOpenError();
    }

    // HALF_OPEN: only one probe at a time. Reject concurrent callers.
    if (currentState === "HALF_OPEN") {
      if (this.halfOpenProbeInFlight) {
        throw new EmbeddingCircuitOpenError();
      }
      this.halfOpenProbeInFlight = true;
    }

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);

    try {
      const result = await fn(controller.signal);
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      if (timedOut && isAbortError(error)) {
        throw new EmbeddingTimeoutError(this.timeoutMs);
      }
      throw error;
    } finally {
      clearTimeout(timer);
      if (currentState === "HALF_OPEN") {
        this.halfOpenProbeInFlight = false;
      }
    }
  }

  private transition(to: CircuitState): void {
    if (this.state !== to) {
      const from = this.state;
      this.state = to;
      this.onStateChange?.(from, to);
    }
  }

  private onSuccess(): void {
    this.consecutiveFailures = 0;
    this.transition("CLOSED");
  }

  private onFailure(): void {
    this.consecutiveFailures++;
    this.lastFailureAt = this.now();

    if (this.consecutiveFailures >= this.failureThreshold) {
      this.transition("OPEN");
      // Add jitter to cooldown to prevent synchronized probes across instances
      const jitter = 1 + (Math.random() - 0.5) * 2 * this.jitterFactor;
      this.effectiveCooldown = Math.round(this.cooldownMs * jitter);
    }
  }
}

export class EmbeddingCircuitOpenError extends Error {
  constructor() {
    super("Embedding circuit breaker is OPEN — BM25-only mode");
    this.name = "EmbeddingCircuitOpenError";
  }
}

export class EmbeddingTimeoutError extends Error {
  constructor(ms: number) {
    super(`Embedding call timed out after ${ms}ms`);
    this.name = "EmbeddingTimeoutError";
  }
}

/** Runtime-agnostic AbortError check — works with DOMException, plain Error, or polyfills. */
function isAbortError(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    "name" in error &&
    (error as { name: unknown }).name === "AbortError"
  );
}

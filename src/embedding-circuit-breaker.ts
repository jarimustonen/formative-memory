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
};

export class EmbeddingCircuitBreaker {
  private state: CircuitState = "CLOSED";
  private consecutiveFailures = 0;
  private lastFailureAt = 0;
  private halfOpenProbeInFlight = false;

  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly timeoutMs: number;
  private readonly now: () => number;

  constructor(options: EmbeddingCircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 2;
    this.cooldownMs = options.cooldownMs ?? 30_000;
    this.timeoutMs = options.timeoutMs ?? 3000;
    this.now = options.now ?? Date.now;
  }

  getState(): CircuitState {
    // Compute effective state without mutation.
    // Actual OPEN → HALF_OPEN transition happens inside call() when a probe starts.
    if (this.state === "OPEN" && this.now() - this.lastFailureAt >= this.cooldownMs) {
      return "HALF_OPEN";
    }
    return this.state;
  }

  isBm25Only(): boolean {
    return this.getState() === "OPEN";
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
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const result = await fn(controller.signal);
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      if (error instanceof DOMException && error.name === "AbortError") {
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

  private onSuccess(): void {
    this.consecutiveFailures = 0;
    this.state = "CLOSED";
  }

  private onFailure(): void {
    this.consecutiveFailures++;
    this.lastFailureAt = this.now();

    if (this.consecutiveFailures >= this.failureThreshold) {
      this.state = "OPEN";
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

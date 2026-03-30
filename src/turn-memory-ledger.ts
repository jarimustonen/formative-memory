/**
 * Turn Memory Ledger (Phase 3.4)
 *
 * Tracks all memory interactions during a turn to enable dedup between
 * auto-injected (assemble) and tool-visible memories. Each mutation
 * increments the version counter, which is included in the assemble
 * cache key to ensure cache invalidation on tool calls.
 *
 * Architecture: v2 §4.
 */

export class TurnMemoryLedger {
  /** Memories auto-injected via assemble() systemPromptAddition. */
  readonly autoInjected = new Map<string, { score: number }>();
  /** Memories returned by memory_search tool (visible in transcript). */
  readonly searchResults = new Map<string, { score: number; query: string }>();
  /** Memories retrieved by memory_get tool (visible in transcript). */
  readonly explicitlyOpened = new Set<string>();
  /** Memories stored via memory_store this turn (visible in transcript). */
  readonly storedThisTurn = new Set<string>();
  /** Monotonic version counter — incremented on every mutation. */
  version = 0;

  addAutoInjected(id: string, score: number): void {
    this.autoInjected.set(id, { score });
    this.version++;
  }

  addSearchResults(results: Array<{ id: string; score: number; query: string }>): void {
    for (const r of results) {
      this.searchResults.set(r.id, { score: r.score, query: r.query });
    }
    if (results.length > 0) {
      this.version++;
    }
  }

  addExplicitlyOpened(id: string): void {
    this.explicitlyOpened.add(id);
    this.version++;
  }

  addStoredThisTurn(id: string): void {
    this.storedThisTurn.add(id);
    this.version++;
  }

  /** Returns true if the memory is already visible in the transcript via a tool call. */
  isExposedViaTools(id: string): boolean {
    return (
      this.searchResults.has(id) ||
      this.explicitlyOpened.has(id) ||
      this.storedThisTurn.has(id)
    );
  }

  /** Reset all state (called on dispose). */
  reset(): void {
    this.autoInjected.clear();
    this.searchResults.clear();
    this.explicitlyOpened.clear();
    this.storedThisTurn.clear();
    this.version = 0;
  }
}

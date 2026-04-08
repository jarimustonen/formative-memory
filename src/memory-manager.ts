import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { MemoryDatabase, type MemoryRow } from "./db.ts";
import {
  EmbeddingCircuitOpenError,
  EmbeddingTimeoutError,
} from "./embedding-circuit-breaker.ts";
import { contentHash } from "./hash.ts";
import { appendRecallEvent, appendSearchEvent, appendStoreEvent } from "./retrieval-log.ts";
import type { Memory, MemorySource, TemporalState } from "./types.ts";

/**
 * Embedding provider interface.
 *
 * Timeout is enforced by the circuit breaker via Promise.race — the
 * provider does not need to support AbortSignal.
 */
export type EmbeddingProvider = {
  embed(text: string): Promise<number[]>;
};

export type SearchResult = {
  memory: Memory;
  score: number;
};

export class MemoryManager {
  private db: MemoryDatabase;
  private memoryDir: string;
  private logPath: string;
  private embedder: EmbeddingProvider;

  constructor(memoryDir: string, embedder: EmbeddingProvider) {
    this.memoryDir = memoryDir;
    this.logPath = join(memoryDir, "retrieval.log");
    this.embedder = embedder;

    mkdirSync(memoryDir, { recursive: true });

    this.db = new MemoryDatabase(join(memoryDir, "associations.db"));
  }

  // -- Store --

  async store(params: {
    content: string;
    type: string;
    source: MemorySource;
    temporal_state?: TemporalState;
    temporal_anchor?: string;
    context_ids?: string[];
  }): Promise<Memory> {
    const id = contentHash(params.content);
    const now = new Date().toISOString();

    // Check for duplicate
    const existing = this.db.getMemory(id);
    if (existing) {
      return this.rowToMemory(existing);
    }

    // Generate embedding — gracefully degrade to null if unavailable
    // (circuit breaker open, timeout, API error). Memory is still
    // retrievable via BM25/FTS. Embedding can be backfilled later.
    let embedding: number[] | null = null;
    try {
      embedding = await this.embedder.embed(params.content);
    } catch (error) {
      // Expected breaker/timeout errors → store without embedding.
      // Unexpected errors (auth, config, bugs) → rethrow.
      if (
        !(error instanceof EmbeddingCircuitOpenError) &&
        !(error instanceof EmbeddingTimeoutError)
      ) {
        throw error;
      }
    }

    // Write to DB
    this.db.transaction(() => {
      this.db.insertMemory({
        id,
        type: params.type,
        content: params.content,
        temporal_state: params.temporal_state ?? "none",
        temporal_anchor: params.temporal_anchor ?? null,
        created_at: now,
        strength: 1.0,
        source: params.source,
        consolidated: false,
      });
      if (embedding) {
        this.db.setEmbedding(id, embedding);
      }
      this.db.insertFts(id, params.content, params.type);
    });

    // Log store event
    appendStoreEvent(this.logPath, id, params.context_ids ?? []);

    return {
      id,
      content: params.content,
      type: params.type,
      temporal_state: params.temporal_state ?? "none",
      temporal_anchor: params.temporal_anchor ?? null,
      created_at: now,
      strength: 1.0,
      source: params.source,
      consolidated: false,
      embedding,
    };
  }

  // -- Search --

  async search(query: string, limit = 5): Promise<SearchResult[]> {
    // Try embedding; fall back to BM25-only if embedding fails (circuit breaker, timeout, etc.)
    let queryEmbedding: number[] | null = null;
    try {
      queryEmbedding = await this.embedder.embed(query);
    } catch (error) {
      // Expected breaker/timeout errors → silent BM25 fallback.
      // Unexpected errors (auth, config, bugs) → rethrow so callers notice.
      if (
        !(error instanceof EmbeddingCircuitOpenError) &&
        !(error instanceof EmbeddingTimeoutError)
      ) {
        throw error;
      }
    }

    // Embedding search: cosine similarity against all embeddings
    const embeddingScores = new Map<string, number>();
    if (queryEmbedding) {
      const allEmbeddings = this.db.getAllEmbeddings();
      for (const { id, embedding } of allEmbeddings) {
        embeddingScores.set(id, cosineSimilarity(queryEmbedding, embedding));
      }
    }

    // BM25 search via FTS5
    const ftsResults = this.db.searchFts(escapeFtsQuery(query), limit * 4);
    const bm25Scores = new Map<string, number>();
    if (ftsResults.length > 0) {
      // Normalize BM25 ranks (they're negative; closer to 0 = better)
      const maxRank = Math.max(...ftsResults.map((r) => r.rank));
      const minRank = Math.min(...ftsResults.map((r) => r.rank));
      const range = maxRank - minRank || 1;
      for (const { id, rank } of ftsResults) {
        bm25Scores.set(id, 1 - (rank - minRank) / range);
      }
    }

    // Combine: α * embedding + (1-α) * BM25, weighted by strength
    // When embedding unavailable, effectively BM25-only (embScore = 0 for all)
    const ALPHA = queryEmbedding ? 0.6 : 0;
    const allIds = new Set([...embeddingScores.keys(), ...bm25Scores.keys()]);
    const strengthMap = this.db.getStrengthMap(); // Single bulk query
    const scored: Array<{ id: string; score: number }> = [];

    for (const id of allIds) {
      const embScore = embeddingScores.get(id) ?? 0;
      const bm25Score = bm25Scores.get(id) ?? 0;
      const hybridScore = ALPHA * embScore + (1 - ALPHA) * bm25Score;

      const strength = strengthMap.get(id);
      if (strength == null) continue;
      const finalScore = hybridScore * strength;
      scored.push({ id, score: finalScore });
    }

    scored.sort((a, b) => b.score - a.score);
    const topIds = scored.slice(0, limit);

    // Log search event
    appendSearchEvent(
      this.logPath,
      topIds.map((r) => r.id),
    );

    // Build results with content
    const results: SearchResult[] = [];
    for (const { id, score } of topIds) {
      const memory = this.getMemory(id);
      if (memory) {
        results.push({ memory, score });
      }
    }

    return results;
  }

  // -- Get --

  getMemory(id: string): Memory | null {
    // Support both full hash and short prefix
    let row = this.db.getMemory(id);
    if (!row && id.length < 64) {
      const all = this.db.getAllMemories();
      const matches = all.filter((m) => m.id.startsWith(id));
      if (matches.length > 1) {
        throw new Error(`Ambiguous memory ID prefix "${id}" — matches ${matches.length} memories`);
      }
      row = matches[0] ?? null;
    }
    if (!row) return null;
    return this.rowToMemory(row);
  }

  // -- Auto-recall --

  async recall(prompt: string, limit = 3): Promise<SearchResult[]> {
    const results = await this.search(prompt, limit);

    // Log recall event
    appendRecallEvent(
      this.logPath,
      results.map((r) => r.memory.id),
    );

    return results;
  }

  /**
   * Broad recall: return diverse, high-value memories for overview queries.
   *
   * Unlike search/recall which match a query, broadRecall returns memories
   * ranked by a combination of strength and recency, with type diversity
   * and near-duplicate suppression.
   *
   * Designed as a tool-callable function — the LLM decides when to use it
   * (e.g. "What do you remember about me?") rather than heuristic detection.
   */
  broadRecall(limit = 50): SearchResult[] {
    if (limit <= 0) return [];

    const poolSize = Math.min(200, Math.max(20, limit * 4));
    const candidates = this.db.getTopByStrength(poolSize);

    const now = Date.now();

    const scored = candidates.map((row) => {
      const ageDays = Math.max(0, (now - new Date(row.created_at).getTime()) / (1000 * 60 * 60 * 24));
      const recencyScore = Math.exp(-ageDays / 30);
      const broadScore = 0.8 * row.strength + 0.2 * recencyScore;

      return {
        memory: this.rowToMemory(row),
        score: broadScore,
        normalizedType: row.type.trim().toLowerCase(),
        normalizedContent: row.content.trim().toLowerCase().replace(/\s+/g, " "),
      };
    });

    scored.sort((a, b) => b.score - a.score);

    const maxPerType = Math.max(2, Math.ceil(limit / 3));
    const selected: typeof scored = [];
    const typeCounts = new Map<string, number>();

    // First pass: greedy selection with type cap + dedup
    for (const item of scored) {
      if (selected.length >= limit) break;
      if (isNearDuplicate(item.normalizedContent, selected)) continue;

      const count = typeCounts.get(item.normalizedType) ?? 0;
      if (count >= maxPerType) continue;

      selected.push(item);
      typeCounts.set(item.normalizedType, count + 1);
    }

    // Second pass: fill remaining slots ignoring type caps (keep dedup)
    if (selected.length < limit) {
      const selectedIds = new Set(selected.map((s) => s.memory.id));
      for (const item of scored) {
        if (selected.length >= limit) break;
        if (selectedIds.has(item.memory.id)) continue;
        if (isNearDuplicate(item.normalizedContent, selected)) continue;
        selected.push(item);
      }
    }

    const results = selected.map(({ memory, score }) => ({ memory, score }));

    // Log recall event
    if (results.length > 0) {
      appendRecallEvent(this.logPath, results.map((r) => r.memory.id));
    }

    return results;
  }

  getTransitionMemories(): Memory[] {
    const all = this.db.getAllMemories();
    const now = new Date();
    return all
      .filter((row) => {
        if (!row.temporal_anchor) return false;
        const anchor = new Date(row.temporal_anchor);
        const diffDays = (now.getTime() - anchor.getTime()) / (1000 * 60 * 60 * 24);

        if (row.temporal_state === "future" && diffDays >= 0) return true;
        if (row.temporal_state === "present" && diffDays > 1) return true;
        return false;
      })
      .map((row) => this.rowToMemory(row));
  }

  // -- Stats --

  stats() {
    return this.db.stats();
  }

  // -- Helpers --

  private rowToMemory(row: MemoryRow): Memory {
    return {
      id: row.id,
      content: row.content || "(content not found)",
      type: row.type,
      temporal_state: row.temporal_state as TemporalState,
      temporal_anchor: row.temporal_anchor,
      created_at: row.created_at,
      strength: row.strength,
      source: row.source as MemorySource,
      consolidated: row.consolidated === 1,
      embedding: null, // Don't load embedding by default
    };
  }

  getDatabase(): MemoryDatabase {
    return this.db;
  }

  close(): void {
    this.db.close();
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

function escapeFtsQuery(query: string): string {
  // FTS5 query: quote each term to avoid syntax errors
  return query
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => `"${term.replace(/"/g, '""')}"`)
    .join(" ");
}

/**
 * Check if a candidate's content is a near-duplicate of any already selected item.
 * Uses normalized content (lowercase, collapsed whitespace).
 */
function isNearDuplicate(
  content: string,
  selected: ReadonlyArray<{ normalizedContent: string }>,
): boolean {
  for (const s of selected) {
    if (content === s.normalizedContent) return true;
    // Prefix match: one is a prefix of the other (for len >= 40)
    const minLen = Math.min(content.length, s.normalizedContent.length);
    if (minLen >= 40 && (content.startsWith(s.normalizedContent) || s.normalizedContent.startsWith(content))) {
      return true;
    }
  }
  return false;
}

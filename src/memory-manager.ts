import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { MemoryDatabase, type MemoryRow } from "./db.ts";
import {
  EmbeddingCircuitOpenError,
  EmbeddingTimeoutError,
} from "./embedding-circuit-breaker.ts";
import { contentHash } from "./hash.ts";
import { appendRecallEvent, appendSearchEvent, appendStoreEvent } from "./retrieval-log.ts";
import type { Logger } from "./logger.ts";
import {
  MemorySourceGuard,
  TemporalStateGuard,
  type Memory,
  type MemorySource,
  type TemporalState,
} from "./types.ts";

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
  private logger?: Logger;
  private logQueries: boolean;

  constructor(memoryDir: string, embedder: EmbeddingProvider, logger?: Logger, logQueries = false) {
    this.memoryDir = memoryDir;
    this.logPath = join(memoryDir, "retrieval.log");
    this.embedder = embedder;
    this.logger = logger;
    this.logQueries = logQueries;

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

    // Check for duplicate — row was written by us, so rowToMemory cannot return null
    const existing = this.db.getMemory(id);
    if (existing) {
      this.logger?.debug(`memory store skipped: id=${id.slice(0, 8)} reason=duplicate`);
      return this.rowToMemory(existing)!;
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
      if (error instanceof EmbeddingCircuitOpenError) {
        this.logger?.debug("store: embedding unavailable reason=circuit-open");
      } else if (error instanceof EmbeddingTimeoutError) {
        this.logger?.debug("store: embedding unavailable reason=timeout");
      } else {
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

    this.logger?.info(`memory stored: id=${id.slice(0, 8)} type=${params.type} contentLen=${params.content.length} hasEmbedding=${embedding ? "yes" : "no"}`);

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
      // Expected breaker/timeout errors → BM25 fallback.
      // Unexpected errors (auth, config, bugs) → rethrow so callers notice.
      if (error instanceof EmbeddingCircuitOpenError) {
        this.logger?.debug("search: semantic unavailable reason=circuit-open, falling back to BM25");
      } else if (error instanceof EmbeddingTimeoutError) {
        this.logger?.debug("search: semantic unavailable reason=timeout, falling back to BM25");
      } else {
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

    // BM25 search via FTS5 — multi-pass waterfall: phrase → AND → OR
    // Each pass fills candidates up to the pool limit, deduplicating across passes.
    const poolLimit = queryEmbedding ? limit * 4 : limit * 8;
    const bm25Scores = new Map<string, number>();
    const ftsRowMap = new Map<string, MemoryRow & { rank: number }>();
    const ftsQueries = buildFtsQueries(query);
    const queryTerms = cleanQueryText(query);

    for (const ftsQuery of ftsQueries) {
      if (ftsRowMap.size >= poolLimit) break;
      try {
        const passResults = this.db.searchFtsJoined(ftsQuery, poolLimit);
        for (const row of passResults) {
          if (ftsRowMap.has(row.id)) continue; // already found in a stricter pass
          // Absolute BM25 normalization: maps (-∞, 0] → [0, 1) without batch
          // dependence. Unlike min-max normalization, a single result doesn't
          // automatically get score 1.0, and the worst of a strong batch doesn't
          // get forced to 0.0.
          const absRank = Math.max(0, -row.rank);
          let score = absRank / (1 + absRank);

          // In BM25-only mode, apply query term coverage penalty for OR-pass
          // results that match few query terms.
          if (!queryEmbedding && queryTerms.length > 1) {
            const coverage = queryTermCoverage(queryTerms, row.content);
            score *= Math.pow(coverage, 2);
          }

          bm25Scores.set(row.id, score);
          ftsRowMap.set(row.id, row);
        }
      } catch {
        // FTS query syntax error (e.g. empty query) — skip this pass
      }
    }

    // Combine: α * embedding + (1-α) * BM25, weighted by strength
    // When embedding unavailable, effectively BM25-only (embScore = 0 for all)
    const ALPHA = queryEmbedding ? 0.6 : 0;
    const allIds = new Set([...embeddingScores.keys(), ...bm25Scores.keys()]);
    const scored: Array<{ id: string; score: number }> = [];

    const now = Date.now();
    for (const id of allIds) {
      const embScore = embeddingScores.get(id) ?? 0;
      const bm25Score = bm25Scores.get(id) ?? 0;
      let hybridScore = ALPHA * embScore + (1 - ALPHA) * bm25Score;

      // Strength comes from the FTS JOIN row or, for embedding-only hits, a targeted lookup
      const ftsRow = ftsRowMap.get(id);
      const strength = ftsRow?.strength ?? this.db.getMemory(id)?.strength;
      if (strength == null) continue;

      // Recency boost: gentle exponential decay, BM25-only mode only.
      // In hybrid mode, embeddings already capture contextual relevance.
      // Half-life ~125 days (decay constant 180).
      if (!queryEmbedding && ftsRow) {
        const ageDays = Math.max(0, (now - new Date(ftsRow.created_at).getTime()) / 86_400_000);
        hybridScore *= Math.exp(-ageDays / 180);
      }

      const finalScore = hybridScore * strength;
      scored.push({ id, score: finalScore });
    }

    scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    const topIds = scored.slice(0, limit);

    // Log search event
    appendSearchEvent(
      this.logPath,
      topIds.map((r) => r.id),
    );

    // Build results — use FTS JOIN rows directly where available, avoiding N+1 lookups
    const results: SearchResult[] = [];
    for (const { id, score } of topIds) {
      const ftsRow = ftsRowMap.get(id);
      const memory = ftsRow ? this.rowToMemory(ftsRow) : this.getMemory(id);
      if (memory) {
        results.push({ memory, score });
      }
    }

    const queryInfo = this.logQueries
      ? (() => {
          const sanitized = query.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ");
          const preview = Array.from(sanitized).slice(0, 80).join("");
          return ` query="${preview}${sanitized.length > 80 ? "..." : ""}"`;
        })()
      : "";
    this.logger?.debug(
      `search: queryLen=${query.length}${queryInfo} results=${results.length} mode=${queryEmbedding ? "hybrid" : "bm25-only"} topScore=${results[0]?.score?.toFixed(3) ?? "n/a"}`,
    );

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

  // -- Association-augmented recall --

  /** Association expansion thresholds */
  private static readonly SEED_THRESHOLD = 0.3;
  private static readonly ASSOCIATION_BOOST = 0.6;
  private static readonly MIN_ASSOCIATION_WEIGHT = 0.15;
  private static readonly MIN_ASSOCIATION_STRENGTH = 0.1;
  private static readonly MAX_EXPANSION_PER_SEED = 5;

  /**
   * Search augmented with single-hop association expansion.
   *
   * 1. Run standard hybrid search
   * 2. Use top results as seeds — expand their associations
   * 3. Score association candidates and merge into a single pool
   * 4. Return top-K by score
   *
   * Single-path association scores are capped by ASSOCIATION_BOOST (0.6),
   * but convergent activation from multiple seeds can exceed this via
   * probabilistic OR — this is intentional: a memory strongly linked to
   * several relevant results deserves a high score.
   */
  async augmentedSearch(query: string, limit: number): Promise<SearchResult[]> {
    // Phase 1: Standard hybrid search
    const directResults = await this.search(query, limit);

    // Phase 2: Expand associations from seeds
    const seeds = directResults.filter(
      (r) => r.score >= MemoryManager.SEED_THRESHOLD,
    );
    if (seeds.length === 0) {
      return directResults;
    }

    const seedIds = seeds.map((s) => s.memory.id);
    const directIds = new Set(directResults.map((r) => r.memory.id));
    const allAssociations = this.db.getAssociationsBatch(seedIds);
    const candidateMap = new Map<string, number>(); // neighborId → activation

    for (const seed of seeds) {
      const assocs = allAssociations.get(seed.memory.id) ?? [];
      const topAssocs = assocs
        .filter((a) => a.weight >= MemoryManager.MIN_ASSOCIATION_WEIGHT)
        .sort(
          (a, b) =>
            b.weight - a.weight ||
            (b.last_updated_at ?? b.created_at).localeCompare(
              a.last_updated_at ?? a.created_at,
            ),
        )
        .slice(0, MemoryManager.MAX_EXPANSION_PER_SEED);

      for (const assoc of topAssocs) {
        const neighborId =
          assoc.memory_a === seed.memory.id
            ? assoc.memory_b
            : assoc.memory_a;
        if (directIds.has(neighborId)) continue;

        const activation =
          seed.score * assoc.weight * MemoryManager.ASSOCIATION_BOOST;
        const existing = candidateMap.get(neighborId);
        if (existing != null) {
          // Convergent activation: probabilistic OR
          candidateMap.set(neighborId, existing + activation - existing * activation);
        } else {
          candidateMap.set(neighborId, activation);
        }
      }
    }

    if (candidateMap.size === 0) {
      return directResults;
    }

    // Phase 3: Score association candidates (bulk fetch)
    const neighborIds = [...candidateMap.keys()];
    const neighborRows = this.db.getMemoriesByIds(neighborIds);

    const assocResults: SearchResult[] = [];
    for (const [id, activation] of candidateMap) {
      const row = neighborRows.get(id);
      if (!row || row.strength < MemoryManager.MIN_ASSOCIATION_STRENGTH) continue;
      const memory = this.rowToMemory(row);
      if (!memory) continue;
      assocResults.push({ memory, score: activation * row.strength });
    }

    // Phase 4: Merge into single pool, top-K wins
    const merged = [...directResults, ...assocResults];
    merged.sort((a, b) => b.score - a.score || a.memory.id.localeCompare(b.memory.id));

    const assocSelected = merged.slice(0, limit).filter(
      (r) => !directIds.has(r.memory.id),
    ).length;

    this.logger?.debug(
      `augmentedSearch: seeds=${seeds.length} expanded=${candidateMap.size} assocSelected=${assocSelected} limit=${limit}`,
    );

    return merged.slice(0, limit);
  }

  async recall(prompt: string, limit = 3): Promise<SearchResult[]> {
    const results = await this.augmentedSearch(prompt, limit);

    // Log recall event
    appendRecallEvent(
      this.logPath,
      results.map((r) => r.memory.id),
    );

    this.logger?.debug(`recall: results=${results.length} limit=${limit}`);

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

    this.logger?.debug(`broadRecall: pool=${candidates.length} selected=${results.length} limit=${limit}`);

    return results;
  }

  getTransitionMemories(): Memory[] {
    const all = this.db.getAllMemories();
    const now = new Date();
    return all
      .filter((row) => {
        if (!row.temporal_anchor) return false;
        const anchor = new Date(row.temporal_anchor);
        if (Number.isNaN(anchor.getTime())) return false;
        const diffDays = (now.getTime() - anchor.getTime()) / (1000 * 60 * 60 * 24);

        if (row.temporal_state === "future" && diffDays >= 0) return true;
        if (row.temporal_state === "present" && diffDays > 1) return true;
        return false;
      })
      .map((row) => this.rowToMemory(row))
      .filter((m): m is Memory => m !== null);
  }

  // -- Stats --

  stats() {
    return this.db.stats();
  }

  // -- Helpers --

  /**
   * Convert a raw DB row to a validated Memory object.
   * Returns null (with warning) if the row contains invalid enum values,
   * so a single corrupt row does not crash bulk operations.
   */
  private rowToMemory(row: MemoryRow): Memory | null {
    if (!TemporalStateGuard.is(row.temporal_state)) {
      this.logger?.warn(`Skipping memory ${row.id}: invalid temporal_state "${row.temporal_state}"`);
      return null;
    }
    if (!MemorySourceGuard.is(row.source)) {
      this.logger?.warn(`Skipping memory ${row.id}: invalid source "${row.source}"`);
      return null;
    }
    return {
      id: row.id,
      content: row.content || "(content not found)",
      type: row.type,
      temporal_state: row.temporal_state,
      temporal_anchor: row.temporal_anchor,
      created_at: row.created_at,
      strength: row.strength,
      source: row.source,
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
  if (denom === 0 || !Number.isFinite(denom)) return 0;
  const result = dot / denom;
  return Number.isFinite(result) ? result : 0;
}

/**
 * Strip punctuation and normalize query text for FTS5.
 * Keeps alphanumeric characters and whitespace only.
 */
function cleanQueryText(query: string): string[] {
  return query
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Quote a single term for FTS5, escaping internal double-quotes.
 */
function quoteTerm(term: string): string {
  return `"${term.replace(/"/g, '""')}"`;
}

/**
 * Build FTS5 query expressions for multi-pass waterfall retrieval.
 *
 * Returns up to 3 queries in decreasing strictness:
 * 1. Exact phrase (all terms adjacent in order)
 * 2. AND (all terms required, any position)
 * 3. OR (any term matches)
 *
 * For single-term queries, returns just one query.
 */
export function buildFtsQueries(query: string): string[] {
  const terms = cleanQueryText(query);
  if (terms.length === 0) return [];
  if (terms.length === 1) return [quoteTerm(terms[0])];

  const quoted = terms.map(quoteTerm);
  return [
    // Pass 1: exact phrase
    `"${terms.join(" ")}"`,
    // Pass 2: AND — all terms required
    quoted.join(" AND "),
    // Pass 3: OR — any term matches
    quoted.join(" OR "),
  ];
}

/**
 * Count how many query terms appear in the content text.
 * Used for query term coverage ranking in OR-pass results.
 */
function queryTermCoverage(terms: string[], content: string): number {
  const lower = content.toLowerCase();
  let matched = 0;
  for (const term of terms) {
    if (lower.includes(term.toLowerCase())) matched++;
  }
  return terms.length > 0 ? matched / terms.length : 0;
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

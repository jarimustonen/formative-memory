import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { appendChunk, formatChunkFile, parseChunks } from "./chunks.ts";
import { MemoryDatabase } from "./db.ts";
import { contentHash } from "./hash.ts";
import { appendRecallEvent, appendSearchEvent, appendStoreEvent } from "./retrieval-log.ts";
import type { LayoutManifest, Memory, MemorySource, TemporalState } from "./types.ts";

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
  private workingPath: string;
  private consolidatedPath: string;
  private logPath: string;
  private layoutPath: string;
  private embedder: EmbeddingProvider;

  constructor(memoryDir: string, embedder: EmbeddingProvider) {
    this.memoryDir = memoryDir;
    this.workingPath = join(memoryDir, "working.md");
    this.consolidatedPath = join(memoryDir, "consolidated.md");
    this.logPath = join(memoryDir, "retrieval.log");
    this.layoutPath = join(memoryDir, ".layout.json");
    this.embedder = embedder;

    mkdirSync(memoryDir, { recursive: true });

    this.db = new MemoryDatabase(join(memoryDir, "associations.db"));
    this.ensureFiles();
    this.ensureLayout();
  }

  private ensureFiles(): void {
    if (!existsSync(this.workingPath)) {
      writeFileSync(this.workingPath, formatChunkFile("Working Memory", []));
    }
    if (!existsSync(this.consolidatedPath)) {
      writeFileSync(this.consolidatedPath, formatChunkFile("Consolidated Memory", []));
    }
  }

  private ensureLayout(): void {
    const manifest = this.db.getLayoutManifest();
    if (!manifest) {
      const layout: LayoutManifest = {
        layout: "associative-memory-v1",
        schema_version: 1,
        created_at: new Date().toISOString(),
      };
      this.db.setLayoutManifest(layout);
      writeFileSync(this.layoutPath, JSON.stringify(layout, null, 2) + "\n");
    }
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

    // Generate embedding
    const embedding = await this.embedder.embed(params.content);

    // Write to DB
    this.db.transaction(() => {
      this.db.insertMemory({
        id,
        type: params.type,
        temporal_state: params.temporal_state ?? "none",
        temporal_anchor: params.temporal_anchor ?? null,
        created_at: now,
        strength: 1.0,
        source: params.source,
        consolidated: false,
        file_path: "working.md",
      });
      this.db.setEmbedding(id, embedding);
      this.db.insertFts(id, params.content, params.type);
    });

    // Append to working.md
    const fileContent = readFileSync(this.workingPath, "utf8");
    writeFileSync(
      this.workingPath,
      appendChunk(fileContent, {
        id: id.slice(0, 8),
        type: params.type,
        created: now,
        content: params.content,
      }),
    );

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
    } catch {
      // Embedding unavailable — continue with BM25-only
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
    const scored: Array<{ id: string; score: number }> = [];

    for (const id of allIds) {
      const embScore = embeddingScores.get(id) ?? 0;
      const bm25Score = bm25Scores.get(id) ?? 0;
      const hybridScore = ALPHA * embScore + (1 - ALPHA) * bm25Score;

      // Weight by strength
      const mem = this.db.getMemory(id);
      if (!mem) continue;
      const finalScore = hybridScore * mem.strength;
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
      row = all.find((m) => m.id.startsWith(id)) ?? null;
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

  private rowToMemory(row: {
    id: string;
    type: string;
    temporal_state: string;
    temporal_anchor: string | null;
    created_at: string;
    strength: number;
    source: string;
    consolidated: number;
  }): Memory {
    const content = this.getContentFromFile(row.id, row.consolidated === 1);
    return {
      id: row.id,
      content: content ?? "(content not found)",
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

  private getContentFromFile(id: string, consolidated: boolean): string | null {
    const filePath = consolidated ? this.consolidatedPath : this.workingPath;
    try {
      const content = readFileSync(filePath, "utf8");
      const chunks = parseChunks(content);
      // Match by full id or short prefix (chunk files use 8-char prefix)
      const chunk = chunks.find((c) => id.startsWith(c.id) || c.id.startsWith(id.slice(0, 8)));
      return chunk?.content ?? null;
    } catch {
      return null;
    }
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

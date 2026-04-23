/**
 * SQLite database layer for associative memory.
 *
 * **Timestamp convention:** All TEXT timestamp columns (created_at, updated_at,
 * last_updated_at, temporal_anchor) MUST be UTC ISO-8601 strings in the format
 * "YYYY-MM-DDTHH:mm:ss.sssZ" or "YYYY-MM-DDTHH:mm:ssZ". This is required
 * because SQL MIN()/MAX() and range queries (WHERE created_at < ?) rely on
 * lexicographic ordering matching chronological ordering.
 */

import { DatabaseSync } from "node:sqlite";
import type {
  Association,
  AttributionEvidence,
  ExposureMode,
  MemorySource,
  RetrievalMode,
  TemporalState,
} from "./types.ts";
import {
  assertIsoUtcTimestamp,
  AttributionEvidenceGuard,
  ExposureModeGuard,
  RetrievalModeGuard,
} from "./types.ts";

const SCHEMA_VERSION = 5;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  temporal_state TEXT NOT NULL DEFAULT 'past',
  temporal_anchor TEXT,
  created_at TEXT NOT NULL,
  strength REAL NOT NULL DEFAULT 1.0,
  source TEXT NOT NULL,
  consolidated INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS associations (
  memory_a TEXT NOT NULL,
  memory_b TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 0.0,
  created_at TEXT NOT NULL,
  last_updated_at TEXT,
  PRIMARY KEY (memory_a, memory_b),
  CHECK (memory_a < memory_b)
);

CREATE TABLE IF NOT EXISTS memory_embeddings (
  id TEXT PRIMARY KEY,
  embedding BLOB NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
  id UNINDEXED,
  content,
  type,
  tokenize='unicode61 remove_diacritics 2',
  prefix='2,3,4'
);

CREATE TABLE IF NOT EXISTS state (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- Provenance: what was offered to the model (Phase 3.6)
CREATE TABLE IF NOT EXISTS turn_memory_exposure (
  session_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  memory_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  score REAL,
  retrieval_mode TEXT,
  message_index INTEGER,
  created_at TEXT NOT NULL,
  PRIMARY KEY (session_id, turn_id, memory_id, mode)
);

-- Provenance: what influenced the response (Phase 3.6)
-- INTENTIONALLY NO FOREIGN KEY on memory_id: attributions are durable and
-- outlive memories. deleteMemory() preserves attribution rows as historical
-- reinforcement data. Do NOT add FK constraints here.
CREATE TABLE IF NOT EXISTS message_memory_attribution (
  message_id TEXT NOT NULL,
  memory_id TEXT NOT NULL,
  evidence TEXT NOT NULL,
  confidence REAL NOT NULL CHECK (confidence >= -1.0 AND confidence <= 1.0),
  turn_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  reinforcement_applied INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (message_id, memory_id)
);

-- Provenance indexes for non-PK query paths
CREATE INDEX IF NOT EXISTS idx_exposure_memory_id ON turn_memory_exposure(memory_id);
CREATE INDEX IF NOT EXISTS idx_exposure_created_at ON turn_memory_exposure(created_at);
CREATE INDEX IF NOT EXISTS idx_attribution_memory_id ON message_memory_attribution(memory_id);
CREATE INDEX IF NOT EXISTS idx_attribution_turn_id ON message_memory_attribution(turn_id);

-- Merge candidate query indexes
CREATE INDEX IF NOT EXISTS idx_memories_strength ON memories(strength);
CREATE INDEX IF NOT EXISTS idx_memories_created_at ON memories(created_at);

-- Association lookup indexes (PK covers memory_a but not memory_b)
CREATE INDEX IF NOT EXISTS idx_associations_memory_b ON associations(memory_b);

-- Alias table: maps deleted/merged memory IDs to their replacement
CREATE TABLE IF NOT EXISTS memory_aliases (
  old_id TEXT PRIMARY KEY,
  new_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;

export type MemoryRow = {
  id: string;
  type: string;
  content: string;
  temporal_state: string;
  temporal_anchor: string | null;
  created_at: string;
  strength: number;
  source: string;
  consolidated: number;
};

export type ExposureRow = {
  session_id: string;
  turn_id: string;
  memory_id: string;
  mode: string;
  score: number | null;
  retrieval_mode: string | null;
  message_index: number | null;
  created_at: string;
};

export type AttributionRow = {
  message_id: string;
  memory_id: string;
  evidence: string;
  confidence: number;
  turn_id: string;
  created_at: string;
  updated_at: string | null;
  reinforcement_applied: number;
};

export class MemoryDatabase {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec("PRAGMA busy_timeout = 5000");
    this.init();
  }

  private init() {
    this.db.exec(SCHEMA_SQL);
    const version = Number(this.getState("schema_version") ?? 0);
    if (version < SCHEMA_VERSION) {
      this.migrate(version);
      this.setState("schema_version", String(SCHEMA_VERSION));
    }
  }

  private migrate(fromVersion: number): void {
    // v4: drop file_path column (markdown files removed, DB is canonical).
    // Schema-driven: check actual table structure regardless of version metadata.
    const cols = this.db.prepare("PRAGMA table_info(memories)").all() as Array<{ name: string }>;
    if (cols.some((c) => c.name === "file_path")) {
      this.db.exec("ALTER TABLE memories DROP COLUMN file_path");
    }

    // v5: rebuild FTS table with UNINDEXED id, remove_diacritics, prefix indexes.
    if (fromVersion < 5) {
      this.rebuildFts();
    }
  }

  /** Drop and recreate the FTS virtual table, reindexing all memories. */
  private rebuildFts(): void {
    this.db.exec("DROP TABLE IF EXISTS memory_fts");
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
        id UNINDEXED,
        content,
        type,
        tokenize='unicode61 remove_diacritics 2',
        prefix='2,3,4'
      )
    `);
    const rows = this.db.prepare("SELECT id, content, type FROM memories").all() as Array<{
      id: string;
      content: string;
      type: string;
    }>;
    if (rows.length > 0) {
      const stmt = this.db.prepare("INSERT INTO memory_fts (id, content, type) VALUES (?, ?, ?)");
      for (const row of rows) {
        stmt.run(row.id, row.content, row.type);
      }
    }
  }

  // -- State --

  getState(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM state WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  }

  getAllState(): Array<{ key: string; value: string }> {
    return this.db.prepare("SELECT key, value FROM state").all() as Array<{ key: string; value: string }>;
  }

  setState(key: string, value: string): void {
    this.db.prepare("INSERT OR REPLACE INTO state (key, value) VALUES (?, ?)").run(key, value);
  }

  // -- Memories --

  insertMemory(mem: {
    id: string;
    type: string;
    content: string;
    temporal_state: TemporalState;
    temporal_anchor: string | null;
    created_at: string;
    strength: number;
    source: MemorySource;
    consolidated: boolean;
  }): void {
    if (!Number.isFinite(mem.strength) || mem.strength < 0) {
      throw new Error(`Invalid strength for ${mem.id}: ${mem.strength}`);
    }
    this.db
      .prepare(
        `INSERT INTO memories (id, type, content, temporal_state, temporal_anchor, created_at, strength, source, consolidated)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        mem.id,
        mem.type,
        mem.content,
        mem.temporal_state,
        mem.temporal_anchor,
        mem.created_at,
        mem.strength,
        mem.source,
        mem.consolidated ? 1 : 0,
      );
  }

  getMemory(id: string): MemoryRow | null {
    return (
      (this.db.prepare("SELECT * FROM memories WHERE id = ?").get(id) as MemoryRow | undefined) ??
      null
    );
  }

  getAllMemories(): MemoryRow[] {
    return this.db.prepare("SELECT * FROM memories ORDER BY created_at DESC").all() as MemoryRow[];
  }

  getWorkingMemories(): MemoryRow[] {
    return this.db
      .prepare("SELECT * FROM memories WHERE consolidated = 0 ORDER BY created_at DESC")
      .all() as MemoryRow[];
  }

  getConsolidatedMemories(): MemoryRow[] {
    return this.db
      .prepare("SELECT * FROM memories WHERE consolidated = 1 ORDER BY created_at DESC")
      .all() as MemoryRow[];
  }

  /**
   * Get the strongest memories, ordered by strength descending.
   * Used by broadRecall() for overview/browse queries.
   * Excludes near-dead memories (strength ≤ 0.05).
   */
  getTopByStrength(limit: number): MemoryRow[] {
    return this.db
      .prepare(
        `SELECT * FROM memories
         WHERE strength > 0.05
         ORDER BY strength DESC, created_at DESC
         LIMIT ?`,
      )
      .all(limit) as MemoryRow[];
  }

  /**
   * Get memories with temporal_anchor within a date range.
   * Used by assemble() to inject upcoming events regardless of query relevance.
   * Only returns memories with strength > pruning threshold.
   */
  getUpcomingMemories(from: string, to: string, limit = 10): MemoryRow[] {
    return this.db
      .prepare(
        `SELECT * FROM memories
         WHERE temporal_state IN ('future', 'present')
           AND temporal_anchor IS NOT NULL
           AND temporal_anchor >= ?
           AND temporal_anchor <= ?
           AND strength > 0.05
         ORDER BY temporal_anchor ASC
         LIMIT ?`,
      )
      .all(from, to, limit) as MemoryRow[];
  }

  /**
   * Get merge sources: memories that changed since the last consolidation.
   * A memory is a source if it meets the strength threshold AND:
   * - created after lastConsolidationAt (new memory)
   * - exposed/retrieved after lastConsolidationAt (recently used)
   *
   * On first run (lastConsolidationAt is null), returns strongest memories
   * capped at maxCount to prevent N² explosion on large imports.
   */
  getMergeSources(minStrength: number, lastConsolidationAt: string | null, maxCount = 500): MemoryRow[] {
    if (!lastConsolidationAt) {
      return this.db
        .prepare(
          `SELECT * FROM memories
           WHERE strength >= ?
           ORDER BY strength DESC, created_at DESC
           LIMIT ?`,
        )
        .all(minStrength, maxCount) as MemoryRow[];
    }
    return this.db
      .prepare(
        `SELECT * FROM memories
         WHERE strength >= ? AND id IN (
           SELECT id FROM memories WHERE created_at > ?
           UNION
           SELECT memory_id FROM turn_memory_exposure WHERE created_at > ?
         )
         ORDER BY strength DESC, created_at DESC
         LIMIT ?`,
      )
      .all(minStrength, lastConsolidationAt, lastConsolidationAt, maxCount) as MemoryRow[];
  }

  /**
   * Get merge targets: the broader corpus of memories to merge into.
   * Filtered by minimum strength threshold, capped at maxCount.
   */
  getMergeTargets(minStrength: number, maxCount = 1000): MemoryRow[] {
    return this.db
      .prepare(
        `SELECT * FROM memories
         WHERE strength >= ?
         ORDER BY strength DESC, created_at DESC
         LIMIT ?`,
      )
      .all(minStrength, maxCount) as MemoryRow[];
  }

  updateStrength(id: string, strength: number): void {
    if (!Number.isFinite(strength) || strength < 0) {
      throw new Error(`Invalid strength for ${id}: ${strength}`);
    }
    this.db.prepare("UPDATE memories SET strength = ? WHERE id = ?").run(strength, id);
  }

  updateConsolidated(id: string, consolidated: boolean): void {
    this.db
      .prepare("UPDATE memories SET consolidated = ? WHERE id = ?")
      .run(consolidated ? 1 : 0, id);
  }

  updateTemporalState(id: string, state: TemporalState): void {
    this.db.prepare("UPDATE memories SET temporal_state = ? WHERE id = ?").run(state, id);
  }

  deleteMemory(id: string): void {
    this.transaction(() => {
      this.db.prepare("DELETE FROM memories WHERE id = ?").run(id);
      this.db.prepare("DELETE FROM memory_embeddings WHERE id = ?").run(id);
      this.db.prepare("DELETE FROM memory_fts WHERE id = ?").run(id);
      this.db.prepare("DELETE FROM associations WHERE memory_a = ? OR memory_b = ?").run(id, id);
      // Exposure is ephemeral — delete on memory removal.
      // Attribution is durable — intentionally kept for historical reinforcement data.
      this.db.prepare("DELETE FROM turn_memory_exposure WHERE memory_id = ?").run(id);
    });
  }

  replaceMemoryId(oldId: string, newId: string, newContent: string): void {
    this.transaction(() => {
      // Fail fast if target already exists — this is a rename, not a merge.
      // Full memory merge (consolidation) requires different semantics.
      if (this.getMemory(newId)) {
        throw new Error(`replaceMemoryId: target memory already exists: ${newId}`);
      }

      // Update memory row (id + content)
      this.db.prepare("UPDATE memories SET id = ?, content = ? WHERE id = ?").run(newId, newContent, oldId);

      // Update FTS
      this.db.prepare("DELETE FROM memory_fts WHERE id = ?").run(oldId);
      const mem = this.getMemory(newId);
      if (mem) {
        this.db
          .prepare("INSERT INTO memory_fts (id, content, type) VALUES (?, ?, ?)")
          .run(newId, newContent, mem.type);
      }

      // Update embedding
      this.db.prepare("UPDATE memory_embeddings SET id = ? WHERE id = ?").run(newId, oldId);

      // Merge exposure provenance: INSERT OR IGNORE handles PK collisions
      this.db
        .prepare(
          `INSERT OR IGNORE INTO turn_memory_exposure
           (session_id, turn_id, memory_id, mode, score, retrieval_mode, message_index, created_at)
           SELECT session_id, turn_id, ?, mode, score, retrieval_mode, message_index, created_at
           FROM turn_memory_exposure WHERE memory_id = ?`,
        )
        .run(newId, oldId);
      this.db.prepare("DELETE FROM turn_memory_exposure WHERE memory_id = ?").run(oldId);

      // Merge attribution provenance: keep higher confidence on PK collision.
      // SQLite doesn't support CTE+UPSERT, so we read rows in JS and upsert individually.
      // Uses mergeAttributionRow() to preserve updated_at from source rows.
      const oldAttrs = this.db
        .prepare("SELECT * FROM message_memory_attribution WHERE memory_id = ?")
        .all(oldId) as AttributionRow[];
      for (const attr of oldAttrs) {
        this.mergeAttributionRow({
          ...attr,
          memory_id: newId,
        });
      }
      this.db.prepare("DELETE FROM message_memory_attribution WHERE memory_id = ?").run(oldId);

      // Update associations - need to handle the CHECK constraint (memory_a < memory_b)
      const assocs = this.db
        .prepare("SELECT * FROM associations WHERE memory_a = ? OR memory_b = ?")
        .all(oldId, oldId) as Association[];

      for (const assoc of assocs) {
        this.db
          .prepare("DELETE FROM associations WHERE memory_a = ? AND memory_b = ?")
          .run(assoc.memory_a, assoc.memory_b);

        const a = assoc.memory_a === oldId ? newId : assoc.memory_a;
        const b = assoc.memory_b === oldId ? newId : assoc.memory_b;

        // Skip self-edges (old_id linked to new_id → both become new_id)
        if (a === b) continue;

        const [sortedA, sortedB] = a < b ? [a, b] : [b, a];

        // Merge: keep max weight and earliest created_at if association already exists
        const existing = this.db
          .prepare("SELECT weight, created_at, last_updated_at FROM associations WHERE memory_a = ? AND memory_b = ?")
          .get(sortedA, sortedB) as { weight: number; created_at: string; last_updated_at: string | null } | undefined;

        const mergedWeight = Math.max(assoc.weight, existing?.weight ?? 0);
        const mergedCreatedAt = existing && existing.created_at < assoc.created_at
          ? existing.created_at : assoc.created_at;
        const mergedLastUpdated = [existing?.last_updated_at, assoc.last_updated_at]
          .filter((v): v is string => v != null)
          .sort()
          .at(-1) ?? null;

        this.db
          .prepare(
            `INSERT OR REPLACE INTO associations (memory_a, memory_b, weight, created_at, last_updated_at)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .run(sortedA, sortedB, mergedWeight, mergedCreatedAt, mergedLastUpdated);
      }
    });
  }

  // -- Embeddings --

  setEmbedding(id: string, embedding: number[]): void {
    if (embedding.length === 0) {
      throw new Error(`Empty embedding for ${id}`);
    }
    const f32 = new Float32Array(embedding);
    for (let i = 0; i < f32.length; i++) {
      if (!Number.isFinite(f32[i])) {
        throw new Error(`Non-finite value in embedding for ${id} at index ${i} (after Float32 conversion)`);
      }
    }
    const buf = Buffer.from(f32.buffer);
    this.db
      .prepare("INSERT OR REPLACE INTO memory_embeddings (id, embedding) VALUES (?, ?)")
      .run(id, buf);
  }

  getEmbedding(id: string): number[] | null {
    const row = this.db.prepare("SELECT embedding FROM memory_embeddings WHERE id = ?").get(id) as
      | { embedding: Buffer }
      | undefined;
    if (!row) return null;
    if (row.embedding.byteLength === 0 || row.embedding.byteLength % 4 !== 0) return null;
    return Array.from(
      new Float32Array(
        row.embedding.buffer,
        row.embedding.byteOffset,
        row.embedding.byteLength / 4,
      ),
    );
  }

  getAllEmbeddings(): Array<{ id: string; embedding: number[] }> {
    const rows = this.db.prepare("SELECT id, embedding FROM memory_embeddings").all() as Array<{
      id: string;
      embedding: Buffer;
    }>;
    return rows
      .filter((row) => row.embedding.byteLength > 0 && row.embedding.byteLength % 4 === 0)
      .map((row) => ({
      id: row.id,
      embedding: Array.from(
        new Float32Array(
          row.embedding.buffer,
          row.embedding.byteOffset,
          row.embedding.byteLength / 4,
        ),
      ),
    }));
  }

  /** Bulk fetch embeddings for specific memory IDs. Single query instead of per-id lookups. */
  getEmbeddingsByIds(ids: string[]): Map<string, number[]> {
    if (ids.length === 0) return new Map();
    const placeholders = ids.map(() => "?").join(",");
    const rows = this.db
      .prepare(`SELECT id, embedding FROM memory_embeddings WHERE id IN (${placeholders})`)
      .all(...ids) as Array<{ id: string; embedding: Buffer }>;
    const map = new Map<string, number[]>();
    for (const row of rows) {
      if (row.embedding.byteLength === 0 || row.embedding.byteLength % 4 !== 0) continue;
      map.set(
        row.id,
        Array.from(
          new Float32Array(
            row.embedding.buffer,
            row.embedding.byteOffset,
            row.embedding.byteLength / 4,
          ),
        ),
      );
    }
    return map;
  }

  /** Bulk fetch id→strength map for scoring. Single query instead of per-id lookups. */
  getStrengthMap(): Map<string, number> {
    const rows = this.db
      .prepare("SELECT id, strength FROM memories")
      .all() as Array<{ id: string; strength: number }>;
    const map = new Map<string, number>();
    for (const row of rows) {
      map.set(row.id, row.strength);
    }
    return map;
  }

  // -- FTS --

  insertFts(id: string, content: string, type: string): void {
    this.db
      .prepare("INSERT INTO memory_fts (id, content, type) VALUES (?, ?, ?)")
      .run(id, content, type);
  }

  searchFts(query: string, limit = 20): Array<{ id: string; rank: number }> {
    return this.db
      .prepare(`SELECT id, rank FROM memory_fts WHERE memory_fts MATCH ? ORDER BY rank LIMIT ?`)
      .all(query, limit) as Array<{ id: string; rank: number }>;
  }

  /**
   * FTS search with JOIN to memories table. Returns ranking inputs and full
   * memory data in a single query, eliminating separate getStrengthMap() and
   * getMemory() lookups.
   */
  searchFtsJoined(query: string, limit = 20): Array<MemoryRow & { rank: number }> {
    return this.db
      .prepare(
        `SELECT m.*, bm25(memory_fts, 0.0, 1.0, 0.5) as rank
         FROM memory_fts f
         JOIN memories m ON f.id = m.id
         WHERE memory_fts MATCH ?
         ORDER BY rank
         LIMIT ?`,
      )
      .all(query, limit) as Array<MemoryRow & { rank: number }>;
  }

  // -- Bulk lookups --

  /**
   * Bulk fetch memories by IDs. Single query instead of per-id lookups.
   * Note: SQLite limits variables per query (often 999). Current callers
   * pass small arrays (~40 IDs). Chunk if used with larger inputs.
   */
  getMemoriesByIds(ids: string[]): Map<string, MemoryRow> {
    if (ids.length === 0) return new Map();
    const placeholders = ids.map(() => "?").join(",");
    const rows = this.db
      .prepare(`SELECT * FROM memories WHERE id IN (${placeholders})`)
      .all(...ids) as MemoryRow[];
    const map = new Map<string, MemoryRow>();
    for (const row of rows) {
      map.set(row.id, row);
    }
    return map;
  }

  // -- Associations --

  getAssociations(memoryId: string): Association[] {
    return this.db
      .prepare("SELECT * FROM associations WHERE memory_a = ? OR memory_b = ?")
      .all(memoryId, memoryId) as Association[];
  }

  /**
   * Bulk fetch associations for multiple memory IDs. Single query with IN clause.
   * Note: binds 2×memoryIds.length variables (OR on both columns).
   * SQLite limits variables per query (often 999). Current callers pass
   * small arrays (~8 IDs). Chunk if used with larger inputs.
   */
  getAssociationsBatch(memoryIds: string[]): Map<string, Association[]> {
    if (memoryIds.length === 0) return new Map();
    const placeholders = memoryIds.map(() => "?").join(",");
    const rows = this.db
      .prepare(
        `SELECT * FROM associations
         WHERE memory_a IN (${placeholders}) OR memory_b IN (${placeholders})`,
      )
      .all(...memoryIds, ...memoryIds) as Association[];
    const map = new Map<string, Association[]>();
    for (const id of memoryIds) {
      map.set(id, []);
    }
    for (const row of rows) {
      map.get(row.memory_a)?.push(row);
      map.get(row.memory_b)?.push(row);
    }
    return map;
  }

  upsertAssociation(a: string, b: string, weight: number, now: string): void {
    const [sortedA, sortedB] = a < b ? [a, b] : [b, a];
    this.db
      .prepare(
        `INSERT INTO associations (memory_a, memory_b, weight, created_at, last_updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(memory_a, memory_b)
         DO UPDATE SET weight = ?, last_updated_at = ?`,
      )
      .run(sortedA, sortedB, weight, now, now, weight, now);
  }

  /**
   * Upsert association using probabilistic OR: new = old + delta - old*delta.
   * Single SQL statement — no pre-read needed.
   */
  upsertAssociationProbOr(a: string, b: string, delta: number, now: string): void {
    const [sortedA, sortedB] = a < b ? [a, b] : [b, a];
    this.db
      .prepare(
        `INSERT INTO associations (memory_a, memory_b, weight, created_at, last_updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(memory_a, memory_b)
         DO UPDATE SET
           weight = associations.weight + excluded.weight - associations.weight * excluded.weight,
           last_updated_at = excluded.last_updated_at`,
      )
      .run(sortedA, sortedB, delta, now, now);
  }

  getAssociationWeight(a: string, b: string): number {
    const [sortedA, sortedB] = a < b ? [a, b] : [b, a];
    const row = this.db
      .prepare("SELECT weight FROM associations WHERE memory_a = ? AND memory_b = ?")
      .get(sortedA, sortedB) as { weight: number } | undefined;
    return row?.weight ?? 0;
  }

  deleteAssociation(a: string, b: string): void {
    const [sortedA, sortedB] = a < b ? [a, b] : [b, a];
    this.db
      .prepare("DELETE FROM associations WHERE memory_a = ? AND memory_b = ?")
      .run(sortedA, sortedB);
  }

  getAllAssociations(): Association[] {
    return this.db
      .prepare("SELECT * FROM associations ORDER BY memory_a, memory_b")
      .all() as Association[];
  }

  /** Multiply all association weights by a decay factor. */
  decayAllAssociationWeights(factor: number): void {
    this.db.prepare("UPDATE associations SET weight = weight * ?").run(factor);
  }

  /** Delete associations with weight below threshold. Returns count deleted. */
  pruneWeakAssociations(threshold: number): number {
    this.db.prepare("DELETE FROM associations WHERE weight < ?").run(threshold);
    return (this.db.prepare("SELECT changes() as c").get() as { c: number }).c;
  }

  // -- Stats --

  stats(): {
    total: number;
    working: number;
    consolidated: number;
    associations: number;
  } {
    const total = (this.db.prepare("SELECT COUNT(*) as c FROM memories").get() as { c: number }).c;
    const working = (
      this.db.prepare("SELECT COUNT(*) as c FROM memories WHERE consolidated = 0").get() as {
        c: number;
      }
    ).c;
    const consolidated = (
      this.db.prepare("SELECT COUNT(*) as c FROM memories WHERE consolidated = 1").get() as {
        c: number;
      }
    ).c;
    const associations = (
      this.db.prepare("SELECT COUNT(*) as c FROM associations").get() as { c: number }
    ).c;
    return { total, working, consolidated, associations };
  }

  // -- Provenance: Exposure --

  insertExposure(params: {
    sessionId: string;
    turnId: string;
    memoryId: string;
    mode: ExposureMode;
    score: number | null;
    retrievalMode: RetrievalMode | null;
    messageIndex?: number | null;
    createdAt: string;
  }): void {
    if (params.score != null && !Number.isFinite(params.score)) {
      throw new Error(`Invalid exposure score: ${params.score}`);
    }
    this.db
      .prepare(
        `INSERT INTO turn_memory_exposure
         (session_id, turn_id, memory_id, mode, score, retrieval_mode, message_index, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id, turn_id, memory_id, mode) DO NOTHING`,
      )
      .run(
        params.sessionId,
        params.turnId,
        params.memoryId,
        params.mode,
        params.score,
        params.retrievalMode,
        params.messageIndex ?? null,
        params.createdAt,
      );
  }

  getExposures(sessionId: string, turnId: string): ExposureRow[] {
    return this.db
      .prepare("SELECT * FROM turn_memory_exposure WHERE session_id = ? AND turn_id = ?")
      .all(sessionId, turnId) as ExposureRow[];
  }

  getExposuresByMemory(memoryId: string): ExposureRow[] {
    return this.db
      .prepare("SELECT * FROM turn_memory_exposure WHERE memory_id = ?")
      .all(memoryId) as ExposureRow[];
  }

  deleteExposuresForSession(sessionId: string): void {
    this.db.prepare("DELETE FROM turn_memory_exposure WHERE session_id = ?").run(sessionId);
  }

  deleteExposuresOlderThan(cutoffDate: string): number {
    this.db.prepare("DELETE FROM turn_memory_exposure WHERE created_at < ?").run(cutoffDate);
    return (this.db.prepare("SELECT changes() as c").get() as { c: number }).c;
  }

  /** Raw insert for import — validates enum/timestamp fields before insert. */
  insertExposureRaw(row: ExposureRow): void {
    if (!ExposureModeGuard.is(row.mode)) throw new Error(`Invalid exposure mode: ${row.mode}`);
    if (row.retrieval_mode != null && !RetrievalModeGuard.is(row.retrieval_mode)) {
      throw new Error(`Invalid retrieval_mode: ${row.retrieval_mode}`);
    }
    assertIsoUtcTimestamp(row.created_at, "exposure created_at");
    this.db
      .prepare(
        `INSERT OR IGNORE INTO turn_memory_exposure
         (session_id, turn_id, memory_id, mode, score, retrieval_mode, message_index, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.session_id, row.turn_id, row.memory_id, row.mode,
        row.score, row.retrieval_mode, row.message_index, row.created_at,
      );
  }

  getAllExposures(): ExposureRow[] {
    return this.db
      .prepare("SELECT * FROM turn_memory_exposure ORDER BY created_at ASC")
      .all() as ExposureRow[];
  }

  // -- Provenance: Attribution --

  upsertAttribution(params: {
    messageId: string;
    memoryId: string;
    evidence: AttributionEvidence;
    confidence: number;
    turnId: string;
    createdAt: string;
  }): void {
    if (!Number.isFinite(params.confidence) || params.confidence < -1 || params.confidence > 1) {
      throw new Error(`Invalid attribution confidence: ${params.confidence}`);
    }
    this.mergeAttributionRow({
      message_id: params.messageId,
      memory_id: params.memoryId,
      evidence: params.evidence,
      confidence: params.confidence,
      turn_id: params.turnId,
      created_at: params.createdAt,
      updated_at: null,
    });
  }

  /**
   * Merge a full attribution row preserving timestamps. Used by replaceMemoryId()
   * where source rows may have existing updated_at that should be preserved.
   *
   * Merge policy:
   * - Explicit feedback (agent_feedback_*) ALWAYS overwrites implicit attribution
   *   (auto_injected, tool_search_returned, tool_get), regardless of numeric
   *   confidence. This ensures negative feedback (-0.5) can demote a prior
   *   positive implicit attribution (0.6).
   * - Between two implicit attributions: higher confidence wins (promotion only).
   * - Between two explicit feedbacks: higher confidence wins.
   * - turn_id is NEVER updated: it represents the original message's turn,
   *   not the most recent update event. updated_at tracks mutation time.
   */
  private mergeAttributionRow(row: Omit<AttributionRow, "reinforcement_applied">): void {
    this.db
      .prepare(
        `INSERT INTO message_memory_attribution
         (message_id, memory_id, evidence, confidence, turn_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(message_id, memory_id) DO UPDATE SET
           evidence = CASE
             -- New is explicit feedback, existing is implicit → new wins
             WHEN excluded.evidence LIKE 'agent_feedback_%'
                  AND message_memory_attribution.evidence NOT LIKE 'agent_feedback_%'
             THEN excluded.evidence
             -- Existing is explicit feedback, new is implicit → existing wins
             WHEN message_memory_attribution.evidence LIKE 'agent_feedback_%'
                  AND excluded.evidence NOT LIKE 'agent_feedback_%'
             THEN message_memory_attribution.evidence
             -- Same category: higher confidence wins
             WHEN excluded.confidence > message_memory_attribution.confidence
             THEN excluded.evidence
             ELSE message_memory_attribution.evidence END,
           confidence = CASE
             WHEN excluded.evidence LIKE 'agent_feedback_%'
                  AND message_memory_attribution.evidence NOT LIKE 'agent_feedback_%'
             THEN excluded.confidence
             WHEN message_memory_attribution.evidence LIKE 'agent_feedback_%'
                  AND excluded.evidence NOT LIKE 'agent_feedback_%'
             THEN message_memory_attribution.confidence
             ELSE MAX(message_memory_attribution.confidence, excluded.confidence) END,
           -- turn_id always preserved: it represents when the original
           -- message occurred, not when the attribution was last updated.
           -- updated_at tracks when evidence/confidence last changed.
           turn_id = message_memory_attribution.turn_id,
           created_at = MIN(message_memory_attribution.created_at, excluded.created_at),
           updated_at = CASE
             WHEN excluded.evidence LIKE 'agent_feedback_%'
                  AND message_memory_attribution.evidence NOT LIKE 'agent_feedback_%'
             THEN COALESCE(excluded.updated_at, excluded.created_at)
             WHEN message_memory_attribution.evidence LIKE 'agent_feedback_%'
                  AND excluded.evidence NOT LIKE 'agent_feedback_%'
             THEN message_memory_attribution.updated_at
             WHEN excluded.confidence > message_memory_attribution.confidence
             THEN COALESCE(excluded.updated_at, excluded.created_at)
             ELSE message_memory_attribution.updated_at END`,
      )
      .run(
        row.message_id,
        row.memory_id,
        row.evidence,
        row.confidence,
        row.turn_id,
        row.created_at,
        row.updated_at,
      );
  }

  getAttributionsByMemory(memoryId: string): AttributionRow[] {
    return this.db
      .prepare(
        "SELECT * FROM message_memory_attribution WHERE memory_id = ? ORDER BY created_at ASC",
      )
      .all(memoryId) as AttributionRow[];
  }

  /** Return the most recent attribution row for a memory, or null. */
  getLatestAttributionByMemory(memoryId: string): AttributionRow | null {
    return (
      this.db
        .prepare(
          "SELECT * FROM message_memory_attribution WHERE memory_id = ? ORDER BY created_at DESC LIMIT 1",
        )
        .get(memoryId) as AttributionRow | undefined
    ) ?? null;
  }

  getAttributionsForTurn(turnId: string): AttributionRow[] {
    return this.db
      .prepare("SELECT * FROM message_memory_attribution WHERE turn_id = ?")
      .all(turnId) as AttributionRow[];
  }

  /** Raw insert for import — validates enum/timestamp fields before insert. */
  insertAttributionRaw(row: AttributionRow): void {
    if (!AttributionEvidenceGuard.is(row.evidence)) throw new Error(`Invalid evidence: ${row.evidence}`);
    assertIsoUtcTimestamp(row.created_at, "attribution created_at");
    if (row.updated_at != null) assertIsoUtcTimestamp(row.updated_at, "attribution updated_at");
    this.db
      .prepare(
        `INSERT OR IGNORE INTO message_memory_attribution
         (message_id, memory_id, evidence, confidence, turn_id, created_at, updated_at, reinforcement_applied)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.message_id, row.memory_id, row.evidence, row.confidence,
        row.turn_id, row.created_at, row.updated_at, row.reinforcement_applied,
      );
  }

  getAllAttributions(): AttributionRow[] {
    return this.db
      .prepare("SELECT * FROM message_memory_attribution")
      .all() as AttributionRow[];
  }

  /** Get attribution rows not yet processed by consolidation reinforcement. */
  getUnreinforcedAttributions(): AttributionRow[] {
    return this.db
      .prepare("SELECT * FROM message_memory_attribution WHERE reinforcement_applied = 0")
      .all() as AttributionRow[];
  }

  /** Mark attribution rows as reinforced (within a transaction). */
  markAttributionsReinforced(messageId: string, memoryId: string): void {
    this.db
      .prepare(
        "UPDATE message_memory_attribution SET reinforcement_applied = 1 WHERE message_id = ? AND memory_id = ?",
      )
      .run(messageId, memoryId);
  }

  /** Get retrieval mode for a specific memory+turn exposure, or null. */
  getExposureRetrievalMode(memoryId: string, turnId: string): string | null {
    const row = this.db
      .prepare(
        "SELECT retrieval_mode FROM turn_memory_exposure WHERE memory_id = ? AND turn_id = ? LIMIT 1",
      )
      .get(memoryId, turnId) as { retrieval_mode: string | null } | undefined;
    return row?.retrieval_mode ?? null;
  }

  /** Get all distinct (turn_id, memory_id) pairs from exposure for co-retrieval. */
  getCoRetrievalGroups(): Array<{ turn_id: string; memory_ids: string[] }> {
    const rows = this.db
      .prepare(
        `SELECT turn_id, GROUP_CONCAT(DISTINCT memory_id) as memory_ids
         FROM turn_memory_exposure
         GROUP BY turn_id
         HAVING COUNT(DISTINCT memory_id) >= 2`,
      )
      .all() as Array<{ turn_id: string; memory_ids: string }>;
    return rows.map((r) => ({
      turn_id: r.turn_id,
      memory_ids: r.memory_ids.split(","),
    }));
  }

  /**
   * Get co-retrieval groups with all exposure modes per memory.
   * Used for channel-aware association weighting: memories arriving through
   * different channels (e.g. search + temporal) form stronger associations
   * than memories arriving through the same channel.
   *
   * @param since Only include exposures created after this timestamp.
   *   Pass `last_consolidation_at` to avoid replaying already-processed
   *   co-retrieval events. If null, processes all rows (first run).
   */
  getCoRetrievalGroupsWithModes(since: string | null): Array<{
    turn_id: string;
    entries: Array<{ memory_id: string; modes: string[] }>;
  }> {
    const sinceClause = since ? "AND created_at > ?" : "";
    const params = since ? [since, since] : [];

    const rows = this.db
      .prepare(
        `SELECT turn_id, memory_id, mode
         FROM turn_memory_exposure
         WHERE turn_id IN (
           SELECT turn_id FROM turn_memory_exposure
           WHERE 1=1 ${sinceClause.replace("AND", "AND")}
           GROUP BY turn_id
           HAVING COUNT(DISTINCT memory_id) >= 2
         )
         ${sinceClause}
         ORDER BY turn_id, memory_id, mode`,
      )
      .all(...params) as Array<{ turn_id: string; memory_id: string; mode: string }>;

    // Aggregate all modes per memory per turn
    const groups = new Map<string, Map<string, Set<string>>>();
    for (const row of rows) {
      let byMemory = groups.get(row.turn_id);
      if (!byMemory) {
        byMemory = new Map();
        groups.set(row.turn_id, byMemory);
      }
      let modes = byMemory.get(row.memory_id);
      if (!modes) {
        modes = new Set();
        byMemory.set(row.memory_id, modes);
      }
      modes.add(row.mode);
    }

    return Array.from(groups, ([turn_id, byMemory]) => ({
      turn_id,
      entries: Array.from(byMemory, ([memory_id, modes]) => ({
        memory_id,
        modes: [...modes].sort(),
      })),
    }));
  }

  deleteAttributionsForMemory(memoryId: string): void {
    this.db.prepare("DELETE FROM message_memory_attribution WHERE memory_id = ?").run(memoryId);
  }

  deleteAttributionsForMessages(messageIds: string[]): void {
    if (messageIds.length === 0) return;
    const stmt = this.db.prepare("DELETE FROM message_memory_attribution WHERE message_id = ?");
    this.transaction(() => {
      for (const id of messageIds) {
        stmt.run(id);
      }
    });
  }

  // -- Aliases --

  insertAlias(oldId: string, newId: string, reason: string, createdAt: string): void {
    this.db
      .prepare("INSERT OR REPLACE INTO memory_aliases (old_id, new_id, reason, created_at) VALUES (?, ?, ?, ?)")
      .run(oldId, newId, reason, createdAt);
  }

  /**
   * Resolve a memory ID through the alias chain.
   * Returns the canonical ID (following aliases), or the original ID if no alias exists.
   * Detects cycles and limits traversal depth.
   */
  resolveAlias(id: string, maxDepth = 10): string {
    let current = id;
    const visited = new Set<string>();
    for (let i = 0; i < maxDepth; i++) {
      if (visited.has(current)) {
        // Cycle detected — return current rather than looping forever.
        // Caller or integrity scan can diagnose further.
        return current;
      }
      visited.add(current);
      const row = this.db
        .prepare("SELECT new_id FROM memory_aliases WHERE old_id = ?")
        .get(current) as { new_id: string } | undefined;
      if (!row) return current;
      current = row.new_id;
    }
    return current; // max depth reached
  }

  getAlias(oldId: string): string | null {
    const row = this.db
      .prepare("SELECT new_id FROM memory_aliases WHERE old_id = ?")
      .get(oldId) as { new_id: string } | undefined;
    return row?.new_id ?? null;
  }

  getAllAliases(): Array<{ old_id: string; new_id: string; reason: string; created_at: string }> {
    return this.db
      .prepare("SELECT * FROM memory_aliases ORDER BY created_at ASC")
      .all() as Array<{ old_id: string; new_id: string; reason: string; created_at: string }>;
  }

  /** Get all old IDs that were aliased to this new ID (reverse lookup). */
  getAliasedIdsPointingTo(newId: string): string[] {
    const rows = this.db
      .prepare("SELECT old_id FROM memory_aliases WHERE new_id = ?")
      .all(newId) as Array<{ old_id: string }>;
    return rows.map((r) => r.old_id);
  }

  // -- Transaction helper --

  private txDepth = 0;

  transaction<T>(fn: () => T): T {
    if (this.txDepth > 0) {
      // Nested: use savepoint
      const sp = `sp_${this.txDepth}`;
      this.db.exec(`SAVEPOINT ${sp}`);
      this.txDepth++;
      try {
        const result = fn();
        this.db.exec(`RELEASE ${sp}`);
        this.txDepth--;
        return result;
      } catch (err) {
        this.txDepth--;
        try {
          this.db.exec(`ROLLBACK TO ${sp}`);
          this.db.exec(`RELEASE ${sp}`);
        } catch {}
        throw err;
      }
    }
    // Top-level transaction
    this.db.exec("BEGIN IMMEDIATE");
    this.txDepth++;
    try {
      const result = fn();
      this.db.exec("COMMIT");
      this.txDepth--;
      return result;
    } catch (err) {
      this.txDepth--;
      try { this.db.exec("ROLLBACK"); } catch {}
      throw err;
    }
  }

  close(): void {
    this.db.close();
  }
}

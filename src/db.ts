/**
 * SQLite database layer for associative memory.
 *
 * **Timestamp convention:** All TEXT timestamp columns (created_at, updated_at,
 * last_updated_at, temporal_anchor) MUST be UTC ISO-8601 strings in the format
 * "YYYY-MM-DDTHH:mm:ss.sssZ" or "YYYY-MM-DDTHH:mm:ssZ". This is required
 * because SQL MIN()/MAX() and range queries (WHERE created_at < ?) rely on
 * lexicographic ordering matching chronological ordering.
 */

import Database from "better-sqlite3";
import type { Association, LayoutManifest, MemorySource, TemporalState } from "./types.ts";

const SCHEMA_VERSION = 3;

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
  consolidated INTEGER NOT NULL DEFAULT 0,
  file_path TEXT NOT NULL
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
  id,
  content,
  type
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
  PRIMARY KEY (message_id, memory_id)
);

-- Provenance indexes for non-PK query paths
CREATE INDEX IF NOT EXISTS idx_exposure_memory_id ON turn_memory_exposure(memory_id);
CREATE INDEX IF NOT EXISTS idx_exposure_created_at ON turn_memory_exposure(created_at);
CREATE INDEX IF NOT EXISTS idx_attribution_memory_id ON message_memory_attribution(memory_id);
CREATE INDEX IF NOT EXISTS idx_attribution_turn_id ON message_memory_attribution(turn_id);
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
  file_path: string;
};

export type ExposureRow = {
  session_id: string;
  turn_id: string;
  memory_id: string;
  mode: string;
  score: number | null;
  retrieval_mode: string | null;
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
};

export class MemoryDatabase {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.init();
  }

  private init() {
    this.db.exec(SCHEMA_SQL);
    const version = Number(this.getState("schema_version") ?? 0);
    if (version < SCHEMA_VERSION) {
      this.setState("schema_version", String(SCHEMA_VERSION));
    }
  }

  // -- State --

  getState(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM state WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
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
    file_path: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO memories (id, type, content, temporal_state, temporal_anchor, created_at, strength, source, consolidated, file_path)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        mem.file_path,
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

  updateStrength(id: string, strength: number): void {
    this.db.prepare("UPDATE memories SET strength = ? WHERE id = ?").run(strength, id);
  }

  updateConsolidated(id: string, consolidated: boolean, filePath: string): void {
    this.db
      .prepare("UPDATE memories SET consolidated = ?, file_path = ? WHERE id = ?")
      .run(consolidated ? 1 : 0, filePath, id);
  }

  updateTemporalState(id: string, state: TemporalState): void {
    this.db.prepare("UPDATE memories SET temporal_state = ? WHERE id = ?").run(state, id);
  }

  deleteMemory(id: string): void {
    const del = this.db.transaction(() => {
      this.db.prepare("DELETE FROM memories WHERE id = ?").run(id);
      this.db.prepare("DELETE FROM memory_embeddings WHERE id = ?").run(id);
      this.db.prepare("DELETE FROM memory_fts WHERE id = ?").run(id);
      this.db.prepare("DELETE FROM associations WHERE memory_a = ? OR memory_b = ?").run(id, id);
      // Exposure is ephemeral — delete on memory removal.
      // Attribution is durable — intentionally kept for historical reinforcement data.
      this.db.prepare("DELETE FROM turn_memory_exposure WHERE memory_id = ?").run(id);
    });
    del();
  }

  replaceMemoryId(oldId: string, newId: string, newContent: string): void {
    const replace = this.db.transaction(() => {
      // Fail fast if target already exists — this is a rename, not a merge.
      // Full memory merge (consolidation) requires different semantics.
      if (this.getMemory(newId)) {
        throw new Error(`replaceMemoryId: target memory already exists: ${newId}`);
      }

      // Update memory row
      this.db.prepare("UPDATE memories SET id = ? WHERE id = ?").run(newId, oldId);

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
           (session_id, turn_id, memory_id, mode, score, retrieval_mode, created_at)
           SELECT session_id, turn_id, ?, mode, score, retrieval_mode, created_at
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
    replace();
  }

  // -- Embeddings --

  setEmbedding(id: string, embedding: number[]): void {
    const buf = Buffer.from(new Float32Array(embedding).buffer);
    this.db
      .prepare("INSERT OR REPLACE INTO memory_embeddings (id, embedding) VALUES (?, ?)")
      .run(id, buf);
  }

  getEmbedding(id: string): number[] | null {
    const row = this.db.prepare("SELECT embedding FROM memory_embeddings WHERE id = ?").get(id) as
      | { embedding: Buffer }
      | undefined;
    if (!row) return null;
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
    return rows.map((row) => ({
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

  // -- Associations --

  getAssociations(memoryId: string): Association[] {
    return this.db
      .prepare("SELECT * FROM associations WHERE memory_a = ? OR memory_b = ?")
      .all(memoryId, memoryId) as Association[];
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

  deleteAssociation(a: string, b: string): void {
    const [sortedA, sortedB] = a < b ? [a, b] : [b, a];
    this.db
      .prepare("DELETE FROM associations WHERE memory_a = ? AND memory_b = ?")
      .run(sortedA, sortedB);
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
    mode: string;
    score: number | null;
    retrievalMode: string | null;
    createdAt: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO turn_memory_exposure
         (session_id, turn_id, memory_id, mode, score, retrieval_mode, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id, turn_id, memory_id, mode) DO NOTHING`,
      )
      .run(
        params.sessionId,
        params.turnId,
        params.memoryId,
        params.mode,
        params.score,
        params.retrievalMode,
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

  deleteExposuresOlderThan(cutoffDate: string): void {
    this.db.prepare("DELETE FROM turn_memory_exposure WHERE created_at < ?").run(cutoffDate);
  }

  // -- Provenance: Attribution --

  upsertAttribution(params: {
    messageId: string;
    memoryId: string;
    evidence: string;
    confidence: number;
    turnId: string;
    createdAt: string;
  }): void {
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
  private mergeAttributionRow(row: AttributionRow): void {
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

  deleteAttributionsForMessages(messageIds: string[]): void {
    if (messageIds.length === 0) return;
    const stmt = this.db.prepare("DELETE FROM message_memory_attribution WHERE message_id = ?");
    this.db.transaction(() => {
      for (const id of messageIds) {
        stmt.run(id);
      }
    })();
  }

  // -- Layout --

  getLayoutManifest(): LayoutManifest | null {
    const raw = this.getState("layout_manifest");
    if (!raw) return null;
    return JSON.parse(raw) as LayoutManifest;
  }

  setLayoutManifest(manifest: LayoutManifest): void {
    this.setState("layout_manifest", JSON.stringify(manifest));
  }

  // -- Transaction helper --

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  close(): void {
    this.db.close();
  }
}

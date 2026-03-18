import Database from "better-sqlite3";
import type { Association, LayoutManifest, MemorySource, TemporalState } from "./types.ts";

const SCHEMA_VERSION = 1;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
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
`;

export type MemoryRow = {
  id: string;
  type: string;
  temporal_state: string;
  temporal_anchor: string | null;
  created_at: string;
  strength: number;
  source: string;
  consolidated: number;
  file_path: string;
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
    const version = this.getState("schema_version");
    if (!version) {
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
        `INSERT INTO memories (id, type, temporal_state, temporal_anchor, created_at, strength, source, consolidated, file_path)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        mem.id,
        mem.type,
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
      this.db
        .prepare("DELETE FROM associations WHERE memory_a = ? OR memory_b = ?")
        .run(id, id);
    });
    del();
  }

  replaceMemoryId(oldId: string, newId: string, newContent: string): void {
    const replace = this.db.transaction(() => {
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
        const [sortedA, sortedB] = a < b ? [a, b] : [b, a];

        this.db
          .prepare(
            `INSERT OR REPLACE INTO associations (memory_a, memory_b, weight, created_at, last_updated_at)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .run(sortedA, sortedB, assoc.weight, assoc.created_at, assoc.last_updated_at);
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
    return Array.from(new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4));
  }

  getAllEmbeddings(): Array<{ id: string; embedding: number[] }> {
    const rows = this.db.prepare("SELECT id, embedding FROM memory_embeddings").all() as Array<{
      id: string;
      embedding: Buffer;
    }>;
    return rows.map((row) => ({
      id: row.id,
      embedding: Array.from(new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4)),
    }));
  }

  // -- FTS --

  insertFts(id: string, content: string, type: string): void {
    this.db
      .prepare("INSERT INTO memory_fts (id, content, type) VALUES (?, ?, ?)")
      .run(id, content, type);
  }

  searchFts(query: string, limit = 20): Array<{ id: string; rank: number }> {
    return this.db
      .prepare(
        `SELECT id, rank FROM memory_fts WHERE memory_fts MATCH ? ORDER BY rank LIMIT ?`,
      )
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
    const total = (
      this.db.prepare("SELECT COUNT(*) as c FROM memories").get() as { c: number }
    ).c;
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

#!/usr/bin/env node
/**
 * Associative Memory CLI
 *
 * Diagnostic tool for inspecting and managing the memory database.
 * Operates directly on SQLite — does not require the OpenClaw runtime.
 *
 * Usage: memory <command> <memory-dir> [options]
 *
 * Commands:
 *   stats    — Overview of memory database
 *   list     — List memories (filterable)
 *   inspect  — Detailed view of a single memory
 *   search   — Search memories by content
 *   export   — Export database to JSON
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MemoryDatabase } from "./db.ts";
import {
  MemorySourceGuard,
  TemporalStateGuard,
  type MemorySource,
  type TemporalState,
} from "./types.ts";

// -- Types --

type OutputFormat = "json" | "text";

type CliContext = {
  db: MemoryDatabase;
  format: OutputFormat;
};

// -- Helpers: validation --

function fail(message: string): never {
  throw new CliError(message);
}

class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliError";
  }
}

function parsePositiveInt(value: string, name: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) {
    fail(`Invalid value for ${name}: '${value}'. Expected a positive integer.`);
  }
  return n;
}

function parseNonNegativeNumber(value: string, name: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    fail(`Invalid value for ${name}: '${value}'. Expected a non-negative number.`);
  }
  return n;
}

function validateFormat(value: string): OutputFormat {
  if (value === "json" || value === "text") return value;
  fail(`Invalid format: '${value}'. Expected 'json' or 'text'.`);
}

// -- Main --

function main(): void {
  const args = process.argv.slice(2);

  // Parse global flags
  let format: OutputFormat = "json";
  const filteredArgs: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--format" && args[i + 1]) {
      format = validateFormat(args[++i]);
    } else if (args[i] === "--text") {
      format = "text";
    } else {
      filteredArgs.push(args[i]);
    }
  }

  const [command, memoryDir, ...rest] = filteredArgs;

  if (!command || command === "--help" || command === "-h") {
    printUsage();
    process.exit(0);
  }

  if (!memoryDir) {
    fail("Memory directory path required. Usage: memory <command> <memory-dir> [options]");
  }

  // Import is allowed to create a new DB; other commands require existing DB
  const dbPath = join(memoryDir, "associations.db");
  if (command !== "import" && !existsSync(dbPath)) {
    fail(`Database not found at ${dbPath}`);
  }

  const db = new MemoryDatabase(dbPath);

  try {
    const ctx: CliContext = { db, format };

    switch (command) {
      case "stats":
        cmdStats(ctx);
        break;
      case "list":
        cmdList(ctx, rest);
        break;
      case "inspect":
        cmdInspect(ctx, rest);
        break;
      case "search":
        cmdSearch(ctx, rest);
        break;
      case "export":
        cmdExport(ctx);
        break;
      case "history":
        cmdHistory(ctx, rest);
        break;
      case "graph":
        cmdGraph(ctx);
        break;
      case "import":
        cmdImport(ctx, rest);
        break;
      default:
        fail(`Unknown command: ${command}`);
    }
  } finally {
    db.close();
  }
}

// Top-level error boundary
try {
  main();
} catch (err) {
  if (err instanceof CliError) {
    console.error(`Error: ${err.message}`);
  } else {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  }
  process.exit(1);
}

// -- Commands --

function cmdStats(ctx: CliContext): void {
  const { db } = ctx;
  const stats = db.stats();
  const lastConsolidation = db.getState("last_consolidation_at");

  const result = {
    ...stats,
    lastConsolidation,
  };

  output(ctx, result, () => {
    console.log(`Memories: ${stats.total} (${stats.working} working, ${stats.consolidated} consolidated)`);
    console.log(`Associations: ${stats.associations}`);
    console.log(`Last consolidation: ${lastConsolidation ?? "never"}`);
  });
}

function cmdList(ctx: CliContext, args: string[]): void {
  const { db } = ctx;

  // Parse filters
  let type: string | null = null;
  let state: string | null = null;
  let minStrength = 0;
  let limit = 50;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--type") { type = args[++i] ?? fail("Missing value for --type"); }
    else if (arg === "--state") { state = args[++i] ?? fail("Missing value for --state"); }
    else if (arg === "--min-strength") { minStrength = parseNonNegativeNumber(args[++i] ?? "", "--min-strength"); }
    else if (arg === "--limit") { limit = parsePositiveInt(args[++i] ?? "", "--limit"); }
    else if (arg.startsWith("--")) { fail(`Unknown option for list: ${arg}`); }
  }

  let memories = db.getAllMemories();

  if (type) memories = memories.filter((m) => m.type === type);
  if (state) memories = memories.filter((m) => m.temporal_state === state);
  if (minStrength > 0) memories = memories.filter((m) => m.strength >= minStrength);
  memories = memories.slice(0, limit);

  const result = memories.map((m) => ({
    id: m.id,
    id_short: m.id.slice(0, 8),
    type: m.type,
    content: m.content.length > 100 ? m.content.slice(0, 97) + "..." : m.content,
    strength: Math.round(m.strength * 1000) / 1000,
    temporal_state: m.temporal_state,
    consolidated: m.consolidated === 1,
    source: m.source,
    created_at: m.created_at,
  }));

  output(ctx, result, () => {
    if (result.length === 0) {
      console.log("No memories found.");
      return;
    }
    for (const m of result) {
      const flag = m.consolidated ? "C" : "W";
      console.log(`[${m.id_short}] [${flag}] str=${m.strength} type=${m.type} ${m.content}`);
    }
    console.log(`\n${result.length} memories shown.`);
  });
}

/** Resolve a memory by exact ID or unique prefix. Fails on ambiguous or missing. */
function resolveMemory(db: MemoryDatabase, idOrPrefix: string) {
  const exact = db.getMemory(idOrPrefix);
  if (exact) return exact;

  const all = db.getAllMemories();
  const matches = all.filter((m) => m.id.startsWith(idOrPrefix));
  if (matches.length === 0) fail(`Memory not found: ${idOrPrefix}`);
  if (matches.length > 1) {
    const ids = matches.slice(0, 5).map((m) => m.id.slice(0, 12)).join(", ");
    fail(`Ambiguous prefix '${idOrPrefix}'. Matches: ${ids}${matches.length > 5 ? `, ... (${matches.length} total)` : ""}`);
  }
  return matches[0];
}

function cmdInspect(ctx: CliContext, args: string[]): void {
  const { db } = ctx;
  const id = args[0];

  if (!id) fail("Memory ID required for inspect");

  const row = resolveMemory(db, id);

  const associations = db.getAssociations(row.id).map((a) => ({
    neighbor: a.memory_a === row!.id ? a.memory_b : a.memory_a,
    weight: Math.round(a.weight * 1000) / 1000,
  }));

  const attributions = db.getAttributionsByMemory(row.id).map((a) => ({
    message_id: a.message_id,
    evidence: a.evidence,
    confidence: a.confidence,
    turn_id: a.turn_id,
    reinforcement_applied: a.reinforcement_applied === 1,
  }));

  const exposures = db.getExposuresByMemory(row.id).map((e) => ({
    turn_id: e.turn_id,
    mode: e.mode,
    score: e.score,
    retrieval_mode: e.retrieval_mode,
  }));

  const alias = db.getAlias(row.id);
  const canonical = alias ? db.resolveAlias(row.id) : null;

  const result = {
    id: row.id,
    id_short: row.id.slice(0, 8),
    type: row.type,
    content: row.content,
    strength: row.strength,
    temporal_state: row.temporal_state,
    temporal_anchor: row.temporal_anchor,
    consolidated: row.consolidated === 1,
    source: row.source,
    created_at: row.created_at,
    alias: alias ? { points_to: alias, canonical: canonical } : null,
    associations,
    attributions,
    exposures,
  };

  output(ctx, result, () => {
    console.log(`ID: ${result.id}`);
    console.log(`Type: ${result.type}`);
    console.log(`Strength: ${result.strength}`);
    console.log(`State: ${result.temporal_state}${result.temporal_anchor ? ` (anchor: ${result.temporal_anchor})` : ""}`);
    console.log(`Source: ${result.source} | ${result.consolidated ? "Consolidated" : "Working"}`);
    console.log(`Created: ${result.created_at}`);
    if (result.alias) {
      console.log(`Alias: → ${result.alias.canonical}`);
    }
    console.log(`\nContent:\n${result.content}`);
    if (associations.length > 0) {
      console.log(`\nAssociations (${associations.length}):`);
      for (const a of associations) {
        console.log(`  ${a.neighbor.slice(0, 8)} weight=${a.weight}`);
      }
    }
    if (attributions.length > 0) {
      console.log(`\nAttributions (${attributions.length}):`);
      for (const a of attributions) {
        console.log(`  ${a.evidence} conf=${a.confidence} turn=${a.turn_id.slice(0, 20)} reinforced=${a.reinforcement_applied}`);
      }
    }
    if (exposures.length > 0) {
      console.log(`\nExposures (${exposures.length}):`);
      for (const e of exposures) {
        console.log(`  ${e.mode} score=${e.score} mode=${e.retrieval_mode}`);
      }
    }
  });
}

function cmdSearch(ctx: CliContext, args: string[]): void {
  const { db } = ctx;
  const query = args.join(" ");

  if (!query) {
    console.error("Error: search query required");
    process.exit(1);
  }

  // FTS search
  const ftsResults = db.searchFts(query, 20);

  const result = ftsResults.map((r) => {
    const mem = db.getMemory(r.id);
    return {
      id: r.id,
      id_short: r.id.slice(0, 8),
      type: mem?.type ?? "unknown",
      content: mem?.content ?? "(not found)",
      strength: mem?.strength ?? 0,
      fts_rank: r.rank,
    };
  });

  output(ctx, result, () => {
    if (result.length === 0) {
      console.log("No results found.");
      return;
    }
    for (const r of result) {
      const content = r.content.length > 80 ? r.content.slice(0, 77) + "..." : r.content;
      console.log(`[${r.id_short}] str=${r.strength} rank=${Math.round(r.fts_rank * 100) / 100} ${content}`);
    }
  });
}

function cmdExport(ctx: CliContext): void {
  const { db } = ctx;

  const memories = db.getAllMemories().map((m) => ({
    id: m.id,
    type: m.type,
    content: m.content,
    strength: m.strength,
    temporal_state: m.temporal_state,
    temporal_anchor: m.temporal_anchor,
    consolidated: m.consolidated === 1,
    source: m.source,
    created_at: m.created_at,
  }));

  const associations = db.getAllAssociations().map((a) => ({
    memory_a: a.memory_a,
    memory_b: a.memory_b,
    weight: a.weight,
    created_at: a.created_at,
    last_updated_at: a.last_updated_at,
  }));

  const attributions = db.getAllAttributions();
  const exposures = db.getAllExposures();
  const aliases = db.getAllAliases();
  const state = db.getAllState();

  const exportData = {
    version: 2,
    exported_at: new Date().toISOString(),
    memories,
    associations,
    attributions,
    exposures,
    aliases,
    state,
  };

  // Export always uses JSON regardless of --format
  console.log(JSON.stringify(exportData, null, 2));
}

function cmdHistory(ctx: CliContext, args: string[]): void {
  const { db } = ctx;
  const id = args[0];

  if (!id) fail("Memory ID required for history");

  const row = resolveMemory(db, id);

  // Trace alias chain forward (what did this become?)
  const canonical = db.resolveAlias(row.id);
  const isAliased = canonical !== row.id;

  // Trace alias chain backward (what was merged into this?)
  const predecessors = db.getAliasedIdsPointingTo(row.id);

  // Attribution history
  const attributions = db.getAttributionsByMemory(row.id);

  // Exposure history
  const exposures = db.getExposuresByMemory(row.id);

  const result = {
    id: row.id,
    id_short: row.id.slice(0, 8),
    source: row.source,
    created_at: row.created_at,
    current_strength: row.strength,
    consolidated: row.consolidated === 1,
    alias: isAliased ? { canonical, note: "This memory was merged into another" } : null,
    predecessors: predecessors.length > 0 ? predecessors : null,
    attribution_count: attributions.length,
    exposure_count: exposures.length,
    timeline: [
      { event: "created", at: row.created_at, detail: `source=${row.source}, type=${row.type}` },
      ...attributions.map((a) => ({
        event: "attributed",
        at: a.created_at,
        detail: `${a.evidence} conf=${a.confidence} msg=${a.message_id.slice(0, 20)}`,
      })),
      ...exposures.map((e) => ({
        event: "exposed",
        at: e.created_at,
        detail: `${e.mode} turn=${e.turn_id.slice(0, 20)}`,
      })),
    ].sort((a, b) => a.at.localeCompare(b.at)),
  };

  output(ctx, result, () => {
    console.log(`History for ${result.id_short} (${row!.type})`);
    console.log(`Source: ${result.source} | Created: ${result.created_at}`);
    console.log(`Current strength: ${result.current_strength}`);
    if (result.alias) {
      console.log(`Merged into: ${result.alias.canonical.slice(0, 8)}`);
    }
    if (result.predecessors) {
      console.log(`Predecessors: ${result.predecessors.map((p: string) => p.slice(0, 8)).join(", ")}`);
    }
    console.log(`\nTimeline (${result.timeline.length} events):`);
    for (const ev of result.timeline) {
      console.log(`  ${ev.at} ${ev.event}: ${ev.detail}`);
    }
  });
}

function cmdGraph(ctx: CliContext): void {
  const { db } = ctx;
  const memories = db.getAllMemories();

  // Collect all unique associations
  const edges: Array<{ a: string; b: string; weight: number }> = [];
  const seen = new Set<string>();

  for (const mem of memories) {
    for (const assoc of db.getAssociations(mem.id)) {
      const key = `${assoc.memory_a}:${assoc.memory_b}`;
      if (!seen.has(key)) {
        seen.add(key);
        edges.push({ a: assoc.memory_a, b: assoc.memory_b, weight: assoc.weight });
      }
    }
  }

  if (ctx.format === "text") {
    // Output Graphviz DOT format
    console.log("graph associations {");
    console.log("  node [shape=box, style=rounded];");
    for (const mem of memories) {
      const label = mem.content.length > 30 ? mem.content.slice(0, 27) + "..." : mem.content;
      const flag = mem.consolidated === 1 ? "C" : "W";
      console.log(`  "${mem.id.slice(0, 8)}" [label="${mem.id.slice(0, 8)}\\n${flag} str=${mem.strength.toFixed(2)}\\n${escapeDot(label)}"];`);
    }
    for (const e of edges) {
      console.log(`  "${e.a.slice(0, 8)}" -- "${e.b.slice(0, 8)}" [label="${e.weight.toFixed(2)}"];`);
    }
    console.log("}");
  } else {
    const result = {
      nodes: memories.map((m) => ({
        id: m.id,
        id_short: m.id.slice(0, 8),
        type: m.type,
        strength: m.strength,
        consolidated: m.consolidated === 1,
      })),
      edges: edges.map((e) => ({
        a: e.a.slice(0, 8),
        b: e.b.slice(0, 8),
        weight: Math.round(e.weight * 1000) / 1000,
      })),
    };
    console.log(JSON.stringify(result, null, 2));
  }
}

function cmdImport(ctx: CliContext, args: string[]): void {
  const { db } = ctx;
  const filePath = args[0];

  if (!filePath) fail("Import file path required");
  if (!existsSync(filePath)) fail(`File not found: ${filePath}`);

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (err) {
    fail(`Failed to parse import file: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (typeof data !== "object" || data === null) fail("Import file must contain a JSON object");
  const version = (data as any).version;
  if (version !== 1 && version !== 2) {
    fail(`Unsupported export version: ${version}. Expected 1 or 2.`);
  }

  const counts = {
    memories: 0,
    memoriesSkipped: 0,
    associations: 0,
    attributions: 0,
    exposures: 0,
    aliases: 0,
    state: 0,
  };

  db.transaction(() => {
    // Memories
    const memories = (data as any).memories as any[] | undefined;
    if (memories) {
      for (const m of memories) {
        if (db.getMemory(m.id)) {
          counts.memoriesSkipped++;
          continue;
        }
        db.insertMemory({
          id: m.id,
          type: m.type,
          content: m.content,
          strength: m.strength,
          temporal_state: TemporalStateGuard.is(m.temporal_state) ? m.temporal_state : "none",
          temporal_anchor: m.temporal_anchor ?? null,
          consolidated: m.consolidated ?? false,
          source: MemorySourceGuard.is(m.source) ? m.source : "agent_tool",
          created_at: m.created_at,
        });
        db.insertFts(m.id, m.content, m.type);
        counts.memories++;
      }
    }

    // Associations (v1: {a, b, weight}, v2: {memory_a, memory_b, weight, ...})
    const associations = (data as any).associations as any[] | undefined;
    if (associations) {
      for (const a of associations) {
        const memA = a.memory_a ?? a.a;
        const memB = a.memory_b ?? a.b;
        const createdAt = a.created_at ?? new Date().toISOString();
        db.upsertAssociation(memA, memB, a.weight, createdAt);
        counts.associations++;
      }
    }

    // Attributions (v2 only)
    const attributions = (data as any).attributions as any[] | undefined;
    if (attributions) {
      for (const a of attributions) {
        db.insertAttributionRaw({
          message_id: a.message_id,
          memory_id: a.memory_id,
          evidence: a.evidence,
          confidence: a.confidence,
          turn_id: a.turn_id,
          created_at: a.created_at,
          updated_at: a.updated_at ?? null,
          reinforcement_applied: a.reinforcement_applied ?? 0,
        });
        counts.attributions++;
      }
    }

    // Exposures (v2 only)
    const exposures = (data as any).exposures as any[] | undefined;
    if (exposures) {
      for (const e of exposures) {
        db.insertExposureRaw(e);
        counts.exposures++;
      }
    }

    // Aliases (v2 only)
    const aliases = (data as any).aliases as any[] | undefined;
    if (aliases) {
      for (const a of aliases) {
        db.insertAlias(a.old_id, a.new_id, a.reason, a.created_at);
        counts.aliases++;
      }
    }

    // State (v2 only)
    const stateEntries = (data as any).state as any[] | undefined;
    if (stateEntries) {
      for (const s of stateEntries) {
        db.setState(s.key, s.value);
        counts.state++;
      }
    }
  });

  output(ctx, counts, () => {
    console.log(`Imported: ${counts.memories} memories, ${counts.associations} associations`);
    if (counts.attributions > 0) console.log(`  ${counts.attributions} attributions`);
    if (counts.exposures > 0) console.log(`  ${counts.exposures} exposures`);
    if (counts.aliases > 0) console.log(`  ${counts.aliases} aliases`);
    if (counts.state > 0) console.log(`  ${counts.state} state entries`);
    if (counts.memoriesSkipped > 0) console.log(`Skipped: ${counts.memoriesSkipped} memories (already exist)`);
  });
}

// -- Helpers --

function escapeDot(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/\r/g, "").replace(/"/g, '\\"');
}

function output(ctx: CliContext, data: unknown, textFn: () => void): void {
  if (ctx.format === "text") {
    textFn();
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
}

function printUsage(): void {
  console.log(`
Associative Memory CLI

Usage: memory <command> <memory-dir> [options]

Commands:
  stats                Overview of memory database
  list                 List memories
  inspect <id>         Detailed view of a single memory
  search <query>       Search memories by content
  history <id>         Timeline of a memory's lifecycle
  graph                Association graph (DOT format in text mode)
  export               Export database to JSON
  import <file>        Import memories from JSON export file

Options:
  --format json|text   Output format (default: json)
  --text               Shorthand for --format text

List filters:
  --type <type>        Filter by memory type
  --state <state>      Filter by temporal state
  --min-strength <n>   Minimum strength threshold
  --limit <n>          Max results (default: 50)
`.trim());
}


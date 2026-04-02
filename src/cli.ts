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

import { existsSync } from "node:fs";
import { join } from "node:path";
import { MemoryDatabase } from "./db.ts";

// -- Types --

type OutputFormat = "json" | "text";

type CliContext = {
  db: MemoryDatabase;
  format: OutputFormat;
};

// -- Main --

function main(): void {
  const args = process.argv.slice(2);

  // Parse global flags
  let format: OutputFormat = "json";
  const filteredArgs: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--format" && args[i + 1]) {
      format = args[++i] as OutputFormat;
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
    console.error("Error: memory directory path required");
    console.error("Usage: memory <command> <memory-dir> [options]");
    process.exit(1);
  }

  const dbPath = join(memoryDir, "associations.db");
  if (!existsSync(dbPath)) {
    console.error(`Error: database not found at ${dbPath}`);
    process.exit(1);
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
      default:
        console.error(`Unknown command: ${command}`);
        printUsage();
        process.exit(1);
    }
  } finally {
    db.close();
  }
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
    if (args[i] === "--type" && args[i + 1]) type = args[++i];
    else if (args[i] === "--state" && args[i + 1]) state = args[++i];
    else if (args[i] === "--min-strength" && args[i + 1]) minStrength = Number(args[++i]);
    else if (args[i] === "--limit" && args[i + 1]) limit = Number(args[++i]);
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

function cmdInspect(ctx: CliContext, args: string[]): void {
  const { db } = ctx;
  const id = args[0];

  if (!id) {
    console.error("Error: memory ID required");
    process.exit(1);
  }

  // Support short prefix lookup
  let row = db.getMemory(id);
  if (!row) {
    const all = db.getAllMemories();
    row = all.find((m) => m.id.startsWith(id)) ?? null;
  }

  if (!row) {
    console.error(`Memory not found: ${id}`);
    process.exit(1);
  }

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

  const associations = (() => {
    // Get all unique associations
    const seen = new Set<string>();
    const result: Array<{ a: string; b: string; weight: number }> = [];
    for (const mem of memories) {
      for (const assoc of db.getAssociations(mem.id)) {
        const key = `${assoc.memory_a}:${assoc.memory_b}`;
        if (!seen.has(key)) {
          seen.add(key);
          result.push({ a: assoc.memory_a, b: assoc.memory_b, weight: assoc.weight });
        }
      }
    }
    return result;
  })();

  const stats = db.stats();
  const lastConsolidation = db.getState("last_consolidation_at");

  const exportData = {
    version: 1,
    exported_at: new Date().toISOString(),
    stats: { ...stats, lastConsolidation },
    memories,
    associations,
  };

  // Export always uses JSON regardless of --format
  console.log(JSON.stringify(exportData, null, 2));
}

// -- Helpers --

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
  export               Export database to JSON

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

// -- FTS helper (need to check if db exposes searchFts) --

main();

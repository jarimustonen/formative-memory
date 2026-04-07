import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryDatabase } from "./db.ts";

let tmpDir: string;
let db: MemoryDatabase;

function cli(args: string[]): string {
  return execFileSync("npx", ["tsx", join(__dirname, "cli.ts"), ...args], {
    encoding: "utf8",
    timeout: 10000,
  }).trim();
}

function cliJson(args: string[]): unknown {
  return JSON.parse(cli(args));
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "cli-test-"));
  db = new MemoryDatabase(join(tmpDir, "associations.db"));

  // Seed test data
  db.insertMemory({
    id: "aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111",
    type: "fact",
    content: "Team chose PostgreSQL for the database",
    temporal_state: "none",
    temporal_anchor: null,
    created_at: "2026-03-01T00:00:00Z",
    strength: 0.8,
    source: "agent_tool",
    consolidated: false,
  });
  db.insertFts(
    "aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111",
    "Team chose PostgreSQL for the database",
    "fact",
  );

  db.insertMemory({
    id: "bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222",
    type: "decision",
    content: "Deploy to AWS eu-west-1",
    temporal_state: "past",
    temporal_anchor: "2026-02-15T00:00:00Z",
    created_at: "2026-02-15T00:00:00Z",
    strength: 0.5,
    source: "agent_tool",
    consolidated: true,
  });
  db.insertFts(
    "bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222",
    "Deploy to AWS eu-west-1",
    "decision",
  );

  db.upsertAssociation(
    "aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111",
    "bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222",
    0.4,
    "2026-03-01T00:00:00Z",
  );

  db.upsertAttribution({
    messageId: "t1:msg:1",
    memoryId: "aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111",
    evidence: "tool_search_returned",
    confidence: 0.3,
    turnId: "t1",
    createdAt: "2026-03-01T00:00:00Z",
  });

  db.close();
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

const MEM_A = "aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111";
const MEM_B = "bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222";

// -- stats --

describe("stats", () => {
  it("returns memory counts as JSON", () => {
    const result = cliJson(["stats", tmpDir]) as any;
    expect(result.total).toBe(2);
    expect(result.working).toBe(1);
    expect(result.consolidated).toBe(1);
    expect(result.associations).toBe(1);
  });

  it("returns text format", () => {
    const result = cli(["stats", tmpDir, "--text"]);
    expect(result).toContain("Memories: 2");
    expect(result).toContain("Associations: 1");
  });
});

// -- list --

describe("list", () => {
  it("lists all memories as JSON", () => {
    const result = cliJson(["list", tmpDir]) as any[];
    expect(result).toHaveLength(2);
    expect(result[0].id_short).toBe("aaaa1111");
  });

  it("filters by type", () => {
    const result = cliJson(["list", tmpDir, "--type", "fact"]) as any[];
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("fact");
  });

  it("filters by min-strength", () => {
    const result = cliJson(["list", tmpDir, "--min-strength", "0.6"]) as any[];
    expect(result).toHaveLength(1);
    expect(result[0].strength).toBeGreaterThanOrEqual(0.6);
  });

  it("respects limit", () => {
    const result = cliJson(["list", tmpDir, "--limit", "1"]) as any[];
    expect(result).toHaveLength(1);
  });

  it("text format shows short IDs", () => {
    const result = cli(["list", tmpDir, "--text"]);
    expect(result).toContain("[aaaa1111]");
    expect(result).toContain("[bbbb2222]");
  });
});

// -- inspect --

describe("inspect", () => {
  it("shows full memory details as JSON", () => {
    const result = cliJson(["inspect", tmpDir, "aaaa1111"]) as any;
    expect(result.id).toBe(MEM_A);
    expect(result.content).toBe("Team chose PostgreSQL for the database");
    expect(result.strength).toBe(0.8);
    expect(result.associations).toHaveLength(1);
    expect(result.associations[0].weight).toBe(0.4);
    expect(result.attributions).toHaveLength(1);
    expect(result.attributions[0].evidence).toBe("tool_search_returned");
  });

  it("supports short prefix lookup", () => {
    const result = cliJson(["inspect", tmpDir, "aaaa"]) as any;
    expect(result.id).toBe(MEM_A);
  });

  it("text format shows structured output", () => {
    const result = cli(["inspect", tmpDir, "aaaa1111", "--text"]);
    expect(result).toContain("ID:");
    expect(result).toContain("PostgreSQL");
    expect(result).toContain("Associations (1)");
    expect(result).toContain("Attributions (1)");
  });

  it("exits with error for unknown ID", () => {
    expect(() => cli(["inspect", tmpDir, "nonexistent"])).toThrow();
  });
});

// -- search --

describe("search", () => {
  it("finds memories by content", () => {
    const result = cliJson(["search", tmpDir, "PostgreSQL"]) as any[];
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].id).toBe(MEM_A);
  });

  it("returns empty array for no matches", () => {
    const result = cliJson(["search", tmpDir, "xyznonexistent"]) as any[];
    expect(result).toHaveLength(0);
  });

  it("text format shows results", () => {
    const result = cli(["search", tmpDir, "AWS", "--text"]);
    expect(result).toContain("bbbb2222");
  });
});

// -- export --

describe("export", () => {
  it("exports full database as JSON", () => {
    const result = cliJson(["export", tmpDir]) as any;
    expect(result.version).toBe(2);
    expect(result.memories).toHaveLength(2);
    expect(result.associations).toHaveLength(1);
    expect(result.attributions).toHaveLength(1);
    expect(result.state).toBeInstanceOf(Array);
  });

  it("includes memory content in export", () => {
    const result = cliJson(["export", tmpDir]) as any;
    const mem = result.memories.find((m: any) => m.id === MEM_A);
    expect(mem.content).toBe("Team chose PostgreSQL for the database");
  });
});

// -- history --

describe("history", () => {
  it("shows memory timeline as JSON", () => {
    const result = cliJson(["history", tmpDir, "aaaa1111"]) as any;
    expect(result.id).toBe(MEM_A);
    expect(result.source).toBe("agent_tool");
    expect(result.timeline.length).toBeGreaterThanOrEqual(1);
    // Should have at least: created + 1 attribution
    const events = result.timeline.map((e: any) => e.event);
    expect(events).toContain("created");
    expect(events).toContain("attributed");
  });

  it("text format shows timeline", () => {
    const result = cli(["history", tmpDir, "aaaa1111", "--text"]);
    expect(result).toContain("History for aaaa1111");
    expect(result).toContain("Timeline");
    expect(result).toContain("created");
  });

  it("exits with error for unknown ID", () => {
    expect(() => cli(["history", tmpDir, "nonexistent"])).toThrow();
  });
});

// -- graph --

describe("graph", () => {
  it("returns nodes and edges as JSON", () => {
    const result = cliJson(["graph", tmpDir]) as any;
    expect(result.nodes).toHaveLength(2);
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].weight).toBe(0.4);
  });

  it("text format outputs Graphviz DOT", () => {
    const result = cli(["graph", tmpDir, "--text"]);
    expect(result).toContain("graph associations {");
    expect(result).toContain("aaaa1111");
    expect(result).toContain("bbbb2222");
    expect(result).toContain("0.40");
  });
});

// -- import --

describe("import", () => {
  it("imports full export to new directory (creates DB)", () => {
    const exportData = cli(["export", tmpDir]);
    const exportPath = join(tmpDir, "export.json");
    writeFileSync(exportPath, exportData);

    // Import to a new directory — no pre-existing DB
    const importDir = join(tmpDir, "import-target");
    mkdirSync(importDir, { recursive: true });

    const result = cliJson(["import", importDir, exportPath]) as any;
    expect(result.memories).toBe(2);
    expect(result.associations).toBe(1);
    expect(result.attributions).toBe(1);

    // Verify imported data
    const stats = cliJson(["stats", importDir]) as any;
    expect(stats.total).toBe(2);
  });

  it("skips existing memories on import", () => {
    const exportData = cli(["export", tmpDir]);
    const exportPath = join(tmpDir, "export.json");
    writeFileSync(exportPath, exportData);

    const result = cliJson(["import", tmpDir, exportPath]) as any;
    expect(result.memories).toBe(0);
    expect(result.memoriesSkipped).toBe(2);
  });
});

// -- error handling --

describe("error handling", () => {
  it("exits with error for missing directory", () => {
    expect(() => cli(["stats", "/nonexistent/path"])).toThrow();
  });

  it("shows help with no arguments", () => {
    const result = cli(["--help"]);
    expect(result).toContain("Usage:");
    expect(result).toContain("stats");
  });
});

import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryDatabase } from "./db.ts";
import { MemoryManager } from "./memory-manager.ts";
import plugin from "./index.ts";

// Capture registered tools
let registeredTools: Array<{ factory?: Function; opts?: Record<string, unknown>; tool?: unknown }> =
  [];
let tmpDir: string;

const fakeApi = () => ({
  id: "memory-associative",
  name: "Memory (Associative)",
  pluginConfig: {
    embedding: { apiKey: "test-key-123", model: "text-embedding-3-small" },
    dbPath: join(tmpDir, "memory"),
  },
  config: {},
  runtime: {},
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  registerTool: vi.fn((toolOrFactory: unknown, opts?: Record<string, unknown>) => {
    registeredTools.push({
      factory: typeof toolOrFactory === "function" ? toolOrFactory : undefined,
      tool: typeof toolOrFactory !== "function" ? toolOrFactory : undefined,
      opts,
    });
  }),
  registerHook: vi.fn(),
  registerHttpRoute: vi.fn(),
  registerChannel: vi.fn(),
  registerGatewayMethod: vi.fn(),
  registerCli: vi.fn(),
  registerService: vi.fn(),
  registerProvider: vi.fn(),
  registerCommand: vi.fn(),
  registerContextEngine: vi.fn(),
  registerMemoryPromptSection: vi.fn(),
  resolvePath: vi.fn((p: string) => p),
  on: vi.fn(),
});

beforeEach(() => {
  registeredTools = [];
  tmpDir = join(tmpdir(), `amem-idx-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("plugin registration", () => {
  it("has correct metadata", () => {
    expect(plugin.id).toBe("memory-associative");
    expect(plugin.kind).toBe("memory");
  });

  it("registers a context engine", () => {
    const api = fakeApi();
    plugin.register(api as any);

    expect(api.registerContextEngine).toHaveBeenCalledOnce();
    const [id, factory] = api.registerContextEngine.mock.calls[0];
    expect(id).toBe("associative-memory");
    expect(typeof factory).toBe("function");
  });

  it("context engine factory returns a valid engine", () => {
    const api = fakeApi();
    plugin.register(api as any);

    const factory = api.registerContextEngine.mock.calls[0][1] as Function;
    const engine = factory();
    expect(engine.info.id).toBe("associative-memory");
    expect(engine.info.ownsCompaction).toBe(false);
    expect(engine.assemble).toBeTypeOf("function");
    expect(engine.afterTurn).toBeTypeOf("function");
    expect(engine.ingest).toBeTypeOf("function");
    expect(engine.compact).toBeTypeOf("function");
    expect(engine.dispose).toBeTypeOf("function");
  });

  it("registers a memory prompt section builder", () => {
    const api = fakeApi();
    plugin.register(api as any);

    expect(api.registerMemoryPromptSection).toHaveBeenCalledOnce();
    const builder = api.registerMemoryPromptSection.mock.calls[0][0] as Function;

    // With all tools available
    const allTools = new Set(["memory_store", "memory_search", "memory_get", "memory_feedback"]);
    const lines = builder({ availableTools: allTools });
    expect(lines).toBeInstanceOf(Array);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join("\n")).toContain("Associative Memory");
    expect(lines.join("\n")).toContain("memory_store");
    expect(lines.join("\n")).toContain("memory_feedback");

    // With no tools available
    const noTools = new Set<string>();
    const emptyLines = builder({ availableTools: noTools });
    expect(emptyLines).toEqual([]);
  });

  it("registers a tool factory with all four tool names", () => {
    const api = fakeApi();
    plugin.register(api as any);

    expect(api.registerTool).toHaveBeenCalledOnce();
    const call = api.registerTool.mock.calls[0];
    expect(typeof call[0]).toBe("function");
    expect(call[1]).toEqual({
      names: ["memory_store", "memory_search", "memory_get", "memory_feedback"],
    });
  });

  it("factory returns four tools with correct names", () => {
    const api = fakeApi();
    plugin.register(api as any);

    const factory = api.registerTool.mock.calls[0][0] as Function;
    const tools = factory({ workspaceDir: tmpDir }) as any[];

    expect(tools).toHaveLength(4);
    const names = tools.map((t) => t.name);
    expect(names).toEqual(["memory_store", "memory_search", "memory_get", "memory_feedback"]);
  });

  it("all tools have required fields", () => {
    const api = fakeApi();
    plugin.register(api as any);

    const factory = api.registerTool.mock.calls[0][0] as Function;
    const tools = factory({ workspaceDir: tmpDir }) as any[];

    for (const tool of tools) {
      expect(tool.name).toBeTypeOf("string");
      expect(tool.description).toBeTypeOf("string");
      expect(tool.label).toBeTypeOf("string");
      expect(tool.parameters).toBeDefined();
      expect(tool.execute).toBeTypeOf("function");
    }
  });

  it("memory_get returns error for nonexistent memory", async () => {
    const api = fakeApi();
    plugin.register(api as any);

    const factory = api.registerTool.mock.calls[0][0] as Function;
    const tools = factory({ workspaceDir: tmpDir }) as any[];
    const getTool = tools.find((t) => t.name === "memory_get")!;

    const result = await getTool.execute("call-1", { id: "nonexistent" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toContain("not found");
  });

  it("memory_store and memory_get round-trip", async () => {
    // Mock the embedding API
    const mockResponse = {
      data: [{ embedding: Array.from({ length: 1536 }, () => Math.random()) }],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      }),
    );

    const api = fakeApi();
    plugin.register(api as any);

    const factory = api.registerTool.mock.calls[0][0] as Function;
    const tools = factory({ workspaceDir: tmpDir }) as any[];
    const storeTool = tools.find((t) => t.name === "memory_store")!;
    const getTool = tools.find((t) => t.name === "memory_get")!;

    const storeResult = await storeTool.execute("call-1", {
      content: "TypeScript is great for type safety",
      type: "fact",
    });
    const stored = JSON.parse(storeResult.content[0].text);
    expect(stored.id).toBeTypeOf("string");
    expect(stored.type).toBe("fact");

    const getResult = await getTool.execute("call-2", { id: stored.id_short });
    const retrieved = JSON.parse(getResult.content[0].text);
    expect(retrieved.content).toBe("TypeScript is great for type safety");

    vi.unstubAllGlobals();
  });

  it("memory_feedback writes to retrieval log", async () => {
    const api = fakeApi();
    plugin.register(api as any);

    const factory = api.registerTool.mock.calls[0][0] as Function;
    const tools = factory({ workspaceDir: tmpDir }) as any[];
    const feedbackTool = tools.find((t) => t.name === "memory_feedback")!;

    // Initialize MemoryManager first (creates the memory dir and files)
    const storeTool = tools.find((t) => t.name === "memory_store")!;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ data: [{ embedding: Array.from({ length: 1536 }, () => 0) }] }),
      }),
    );
    await storeTool.execute("call-0", { content: "bootstrap", type: "fact" });

    const result = await feedbackTool.execute("call-1", {
      memory_id: "abc12345",
      rating: 4,
      comment: "Very helpful",
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.ok).toBe(true);
    expect(parsed.rating).toBe(4);

    vi.unstubAllGlobals();
  });
});

describe("turn cycle integration: assemble → tool calls → afterTurn", () => {
  const mockEmbedding = () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ data: [{ embedding: Array.from({ length: 1536 }, () => Math.random()) }] }),
      }),
    );
  };

  it("full turn: store → search → afterTurn writes provenance", async () => {
    mockEmbedding();
    const api = fakeApi();
    plugin.register(api as any);

    // Get tools and engine
    const toolFactory = api.registerTool.mock.calls[0][0] as Function;
    const tools = toolFactory({ workspaceDir: tmpDir }) as any[];
    const storeTool = tools.find((t) => t.name === "memory_store")!;
    const searchTool = tools.find((t) => t.name === "memory_search")!;

    const engineFactory = api.registerContextEngine.mock.calls[0][1] as Function;
    const engine = engineFactory();

    // 1. Store a memory (creates workspace, DB, etc.)
    const storeResult = await storeTool.execute("call-1", {
      content: "PostgreSQL is our primary database",
      type: "fact",
    });
    const stored = JSON.parse(storeResult.content[0].text);

    // 2. Search — updates ledger with search results
    await searchTool.execute("call-2", { query: "PostgreSQL" });

    // 3. afterTurn — writes provenance from ledger state
    const messages = [
      { role: "user", content: "What database do we use?" },
      { role: "assistant", content: "We use PostgreSQL." },
    ];
    await engine.afterTurn({
      sessionId: "sess-1",
      sessionFile: "/tmp/session.md",
      messages,
      prePromptMessageCount: 0,
    });

    // 4. Verify provenance was written
    const memoryDir = join(tmpDir, "memory");
    const db = new MemoryDatabase(join(memoryDir, "associations.db"));

    try {
      // Stored memory should have exposure (tool_store from ledger)
      const exposures = db.getExposuresByMemory(stored.id);
      expect(exposures.length).toBeGreaterThanOrEqual(1);

      // Search results should have attribution
      const attrs = db.getAttributionsByMemory(stored.id);
      expect(attrs.length).toBeGreaterThanOrEqual(1);
    } finally {
      db.close();
    }

    vi.unstubAllGlobals();
  });
});

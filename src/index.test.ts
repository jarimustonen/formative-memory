import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryDatabase } from "./db.ts";
import plugin from "./index.ts";

// Mock the OpenClaw embedding provider registry
const mockEmbedQuery = vi.fn(async (_text: string) => {
  return Array.from({ length: 1536 }, () => Math.random());
});

const mockCreate = vi.fn(async () => ({
  provider: {
    id: "openai",
    model: "text-embedding-3-small",
    embedQuery: mockEmbedQuery,
    embedBatch: vi.fn(async (texts: string[]) =>
      texts.map(() => Array.from({ length: 1536 }, () => Math.random())),
    ),
  },
}));

const mockGetProvider = vi.fn(() => ({
  id: "openai",
  defaultModel: "text-embedding-3-small",
  create: mockCreate,
}));

const mockListProviders = vi.fn(() => [
  {
    id: "local",
    defaultModel: "local-model",
    autoSelectPriority: 10,
    create: vi.fn(async () => { throw new Error("local unavailable"); }),
  },
  {
    id: "openai",
    defaultModel: "text-embedding-3-small",
    autoSelectPriority: 20,
    create: mockCreate,
  },
]);

vi.mock("openclaw/plugin-sdk/memory-core-host-engine-embeddings", () => ({
  getMemoryEmbeddingProvider: (...args: unknown[]) => mockGetProvider(...args as []),
  listMemoryEmbeddingProviders: (...args: unknown[]) => mockListProviders(...args as []),
}));

// Capture registered tools
let registeredTools: Array<{ factory?: Function; opts?: Record<string, unknown>; tool?: unknown }> =
  [];
let tmpDir: string;

const fakeApi = (pluginConfig?: Record<string, unknown>) => ({
  id: "memory-associative",
  name: "Memory (Associative)",
  pluginConfig: {
    dbPath: join(tmpDir, "memory"),
    ...pluginConfig,
  },
  config: { testKey: "global-config" },
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
  mockEmbedQuery.mockClear();
  mockCreate.mockClear();
  mockGetProvider.mockClear();
  mockListProviders.mockClear();
  // Restore default implementations
  mockGetProvider.mockImplementation(() => ({
    id: "openai",
    defaultModel: "text-embedding-3-small",
    create: mockCreate,
  }));
  mockCreate.mockImplementation(async () => ({
    provider: {
      id: "openai",
      model: "text-embedding-3-small",
      embedQuery: mockEmbedQuery,
      embedBatch: vi.fn(),
    },
  }));
  mockListProviders.mockImplementation(() => [
    {
      id: "local",
      defaultModel: "local-model",
      autoSelectPriority: 10,
      create: vi.fn(async () => { throw new Error("local unavailable"); }),
    },
    {
      id: "openai",
      defaultModel: "text-embedding-3-small",
      autoSelectPriority: 20,
      create: mockCreate,
    },
  ]);
  tmpDir = join(tmpdir(), `amem-idx-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// -- Helper --

function getTools(api: ReturnType<typeof fakeApi>, ctx?: Record<string, unknown>) {
  const factory = api.registerTool.mock.calls[0][0] as Function;
  return factory({ workspaceDir: tmpDir, config: {}, ...ctx }) as any[];
}

// ===========================================================================
// Plugin registration
// ===========================================================================

describe("plugin registration", () => {
  it("has correct metadata", () => {
    expect(plugin.id).toBe("memory-associative");
    expect(plugin.kind).toBe("memory");
  });

  it("registers /memory sleep command", () => {
    const api = fakeApi();
    plugin.register(api as any);

    expect(api.registerCommand).toHaveBeenCalledOnce();
    const cmd = api.registerCommand.mock.calls[0][0];
    expect(cmd.name).toBe("memory sleep");
    expect(cmd.handler).toBeTypeOf("function");
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

    const allTools = new Set(["memory_store", "memory_search", "memory_get", "memory_feedback"]);
    const lines = builder({ availableTools: allTools });
    expect(lines).toBeInstanceOf(Array);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join("\n")).toContain("Associative Memory");
    expect(lines.join("\n")).toContain("memory_store");
    expect(lines.join("\n")).toContain("memory_feedback");

    const noTools = new Set<string>();
    expect(builder({ availableTools: noTools })).toEqual([]);
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
    const tools = getTools(api);

    expect(tools).toHaveLength(4);
    expect(tools.map((t: any) => t.name)).toEqual([
      "memory_store", "memory_search", "memory_get", "memory_feedback",
    ]);
  });

  it("all tools have required fields", () => {
    const api = fakeApi();
    plugin.register(api as any);
    const tools = getTools(api);

    for (const tool of tools) {
      expect(tool.name).toBeTypeOf("string");
      expect(tool.description).toBeTypeOf("string");
      expect(tool.label).toBeTypeOf("string");
      expect(tool.parameters).toBeDefined();
      expect(tool.execute).toBeTypeOf("function");
    }
  });
});

// ===========================================================================
// Tool operations
// ===========================================================================

describe("tool operations", () => {
  it("memory_get returns error for nonexistent memory", async () => {
    const api = fakeApi();
    plugin.register(api as any);
    const tools = getTools(api);
    const getTool = tools.find((t: any) => t.name === "memory_get")!;

    const result = await getTool.execute("call-1", { id: "nonexistent" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toContain("not found");
  });

  it("memory_store and memory_get round-trip", async () => {
    const api = fakeApi();
    plugin.register(api as any);
    const tools = getTools(api);
    const storeTool = tools.find((t: any) => t.name === "memory_store")!;
    const getTool = tools.find((t: any) => t.name === "memory_get")!;

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
  });

  it("memory_feedback writes to retrieval log", async () => {
    const api = fakeApi();
    plugin.register(api as any);
    const tools = getTools(api);
    const feedbackTool = tools.find((t: any) => t.name === "memory_feedback")!;
    const storeTool = tools.find((t: any) => t.name === "memory_store")!;

    await storeTool.execute("call-0", { content: "bootstrap", type: "fact" });

    const result = await feedbackTool.execute("call-1", {
      memory_id: "abc12345",
      rating: 4,
      comment: "Very helpful",
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.ok).toBe(true);
    expect(parsed.rating).toBe(4);
  });
});

// ===========================================================================
// Provider resolution
// ===========================================================================

describe("provider resolution", () => {
  it("auto mode selects provider by priority order (lower = higher priority)", async () => {
    const api = fakeApi();
    plugin.register(api as any);
    const tools = getTools(api);
    const storeTool = tools.find((t: any) => t.name === "memory_store")!;

    await storeTool.execute("call-1", { content: "test", type: "fact" });

    // local (priority 10) fails, openai (priority 20) succeeds
    expect(mockCreate).toHaveBeenCalledOnce();
  });

  it("auto mode throws when no adapters succeed", async () => {
    mockListProviders.mockReturnValue([
      {
        id: "local",
        defaultModel: "m",
        autoSelectPriority: 10,
        create: vi.fn(async () => { throw new Error("no local"); }),
      },
      {
        id: "openai",
        defaultModel: "m",
        autoSelectPriority: 20,
        create: vi.fn(async () => { throw new Error("no key"); }),
      },
    ]);

    const api = fakeApi();
    plugin.register(api as any);
    const tools = getTools(api);
    const storeTool = tools.find((t: any) => t.name === "memory_store")!;

    await expect(
      storeTool.execute("call-1", { content: "test", type: "fact" }),
    ).rejects.toThrow("No embedding provider available");
  });

  it("explicit provider uses getMemoryEmbeddingProvider()", async () => {
    const api = fakeApi({ embedding: { provider: "openai" } });
    plugin.register(api as any);
    const tools = getTools(api);
    const storeTool = tools.find((t: any) => t.name === "memory_store")!;

    await storeTool.execute("call-1", { content: "test", type: "fact" });

    expect(mockGetProvider).toHaveBeenCalledWith("openai");
  });

  it("explicit provider throws on unknown provider ID", async () => {
    mockGetProvider.mockReturnValue(undefined as any);

    const api = fakeApi({ embedding: { provider: "nonexistent" } });
    plugin.register(api as any);
    const tools = getTools(api);
    const storeTool = tools.find((t: any) => t.name === "memory_store")!;

    await expect(
      storeTool.execute("call-1", { content: "test", type: "fact" }),
    ).rejects.toThrow('Unknown embedding provider: "nonexistent"');
  });

  it("explicit provider throws when adapter.create() fails", async () => {
    mockCreate.mockRejectedValue(new Error("No API key found for provider openai"));

    const api = fakeApi({ embedding: { provider: "openai" } });
    plugin.register(api as any);
    const tools = getTools(api);
    const storeTool = tools.find((t: any) => t.name === "memory_store")!;

    await expect(
      storeTool.execute("call-1", { content: "test", type: "fact" }),
    ).rejects.toThrow("No API key found");
  });

  it("forwards explicit model to adapter.create()", async () => {
    const api = fakeApi({ embedding: { provider: "openai", model: "text-embedding-3-large" } });
    plugin.register(api as any);
    const tools = getTools(api);
    const storeTool = tools.find((t: any) => t.name === "memory_store")!;

    await storeTool.execute("call-1", { content: "test", type: "fact" });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: "text-embedding-3-large" }),
    );
  });

  it("uses adapter default model when model is not configured", async () => {
    const api = fakeApi({ embedding: { provider: "openai" } });
    plugin.register(api as any);
    const tools = getTools(api);
    const storeTool = tools.find((t: any) => t.name === "memory_store")!;

    await storeTool.execute("call-1", { content: "test", type: "fact" });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: "text-embedding-3-small" }),
    );
  });
});

// ===========================================================================
// Lazy initialization
// ===========================================================================

describe("lazy initialization", () => {
  it("resolves provider lazily on first embedding request", async () => {
    const api = fakeApi({ embedding: { provider: "openai" } });
    plugin.register(api as any);

    // Provider not created yet during registration
    expect(mockCreate).not.toHaveBeenCalled();

    const tools = getTools(api);
    const storeTool = tools.find((t: any) => t.name === "memory_store")!;

    await storeTool.execute("call-1", { content: "test", type: "fact" });

    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("creates provider only once across multiple store/search calls", async () => {
    const api = fakeApi({ embedding: { provider: "openai" } });
    plugin.register(api as any);
    const tools = getTools(api);
    const storeTool = tools.find((t: any) => t.name === "memory_store")!;
    const searchTool = tools.find((t: any) => t.name === "memory_search")!;

    await storeTool.execute("call-1", { content: "hello world", type: "fact" });
    await searchTool.execute("call-2", { query: "hello" });
    await storeTool.execute("call-3", { content: "second memory", type: "fact" });

    expect(mockCreate).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// Turn cycle integration
// ===========================================================================

describe("turn cycle integration: assemble → tool calls → afterTurn", () => {
  it("full turn: store → search → afterTurn writes provenance", async () => {
    const api = fakeApi();
    plugin.register(api as any);

    const toolFactory = api.registerTool.mock.calls[0][0] as Function;
    const tools = toolFactory({ workspaceDir: tmpDir, config: {} }) as any[];
    const storeTool = tools.find((t: any) => t.name === "memory_store")!;
    const searchTool = tools.find((t: any) => t.name === "memory_search")!;

    const engineFactory = api.registerContextEngine.mock.calls[0][1] as Function;
    const engine = engineFactory();

    const storeResult = await storeTool.execute("call-1", {
      content: "PostgreSQL is our primary database",
      type: "fact",
    });
    const stored = JSON.parse(storeResult.content[0].text);

    await searchTool.execute("call-2", { query: "PostgreSQL" });

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

    const memoryDir = join(tmpDir, "memory");
    const db = new MemoryDatabase(join(memoryDir, "associations.db"));

    try {
      const exposures = db.getExposuresByMemory(stored.id);
      expect(exposures.length).toBeGreaterThanOrEqual(1);

      const attrs = db.getAttributionsByMemory(stored.id);
      expect(attrs.length).toBeGreaterThanOrEqual(1);
    } finally {
      db.close();
    }
  });
});

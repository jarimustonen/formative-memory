import { mkdirSync, rmSync, writeFileSync } from "node:fs";
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
  id: "formative-memory",
  name: "Formative Memory",
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

/** Write an auth-profiles.json file to the given dir. Used by standalone
 * fallback tests — the SDK's resolveApiKeyForProvider reads auth-profiles.json
 * and expects AuthProfileStore format (type + provider + key). */
function writeAuthProfiles(dir: string, profiles: Record<string, { key?: string; provider?: string }>): void {
  // Convert simple { key, provider } entries to SDK AuthProfileCredential format
  const sdkProfiles: Record<string, { type: string; provider: string; key?: string }> = {};
  for (const [name, entry] of Object.entries(profiles)) {
    const provider = entry.provider ?? name.split(":")[0];
    sdkProfiles[name] = { type: "api_key", provider, key: entry.key };
  }
  writeFileSync(
    join(dir, "auth-profiles.json"),
    JSON.stringify({ version: 1, profiles: sdkProfiles }, null, 2),
  );
}

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
  // agentDir is required for embedding resolution (see createWorkspace's
  // requireEmbedding check). The standalone-fallback tests also write
  // auth-profiles.json into tmpDir, so using tmpDir as agentDir keeps both
  // registry and standalone code paths reachable.
  return factory({ workspaceDir: tmpDir, agentDir: tmpDir, config: {}, ...ctx }) as any[];
}

// ===========================================================================
// Plugin registration
// ===========================================================================

describe("plugin registration", () => {
  it("has correct metadata", () => {
    expect(plugin.id).toBe("formative-memory");
    expect(plugin.kind).toEqual(["memory", "context-engine"]);
  });

  it("registers gateway:startup hook for cron scheduling", () => {
    const api = fakeApi();
    plugin.register(api as any);

    const hookCalls = api.registerHook.mock.calls;
    const startupHook = hookCalls.find(
      (c: any) => c[0] === "gateway:startup",
    );
    expect(startupHook).toBeDefined();
    expect(startupHook![1]).toBeTypeOf("function");
  });

  it("registers before_agent_reply hook for cron trigger handling", () => {
    const api = fakeApi();
    plugin.register(api as any);

    const onCalls = api.on.mock.calls;
    const replyHook = onCalls.find(
      (c: any) => c[0] === "before_agent_reply",
    );
    expect(replyHook).toBeDefined();
    expect(replyHook![1]).toBeTypeOf("function");
  });

  it("registers /memory-sleep command", () => {
    const api = fakeApi();
    plugin.register(api as any);

    const cmds = api.registerCommand.mock.calls.map((c: any) => c[0]);
    const sleepCmd = cmds.find((c: any) => c.name === "memory-sleep");
    expect(sleepCmd).toBeDefined();
    expect(sleepCmd.handler).toBeTypeOf("function");
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

    const allTools = new Set(["memory_store", "memory_search", "memory_get", "memory_feedback", "memory_browse"]);
    const lines = builder({ availableTools: allTools });
    expect(lines).toBeInstanceOf(Array);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join("\n")).toContain("Associative Memory");
    expect(lines.join("\n")).toContain("memory_store");
    expect(lines.join("\n")).toContain("memory_feedback");

    const noTools = new Set<string>();
    expect(builder({ availableTools: noTools })).toEqual([]);
  });

  it("registers a tool factory with all five tool names", () => {
    const api = fakeApi();
    plugin.register(api as any);

    expect(api.registerTool).toHaveBeenCalledOnce();
    const call = api.registerTool.mock.calls[0];
    expect(typeof call[0]).toBe("function");
    expect(call[1]).toEqual({
      names: ["memory_store", "memory_search", "memory_get", "memory_feedback", "memory_browse"],
    });
  });

  it("factory returns five tools with correct names", () => {
    const api = fakeApi();
    plugin.register(api as any);
    const tools = getTools(api);

    expect(tools).toHaveLength(5);
    expect(tools.map((t: any) => t.name)).toEqual([
      "memory_store", "memory_search", "memory_get", "memory_feedback", "memory_browse",
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

  it("memory_browse returns stored memories sorted by importance", async () => {
    const api = fakeApi();
    plugin.register(api as any);
    const tools = getTools(api);
    const storeTool = tools.find((t: any) => t.name === "memory_store")!;
    const browseTool = tools.find((t: any) => t.name === "memory_browse")!;

    await storeTool.execute("call-1", { content: "User prefers dark mode", type: "preference" });
    await storeTool.execute("call-2", { content: "Project uses PostgreSQL", type: "decision" });
    await storeTool.execute("call-3", { content: "Team meeting every Monday", type: "event" });

    const result = await browseTool.execute("call-4", {});
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveLength(3);
    // All memories should have required fields
    for (const mem of parsed) {
      expect(mem.id).toBeTypeOf("string");
      expect(mem.type).toBeTypeOf("string");
      expect(mem.content).toBeTypeOf("string");
      expect(mem.strength).toBeTypeOf("number");
      expect(mem.score).toBeTypeOf("number");
    }
  });

  it("memory_browse respects limit parameter", async () => {
    const api = fakeApi();
    plugin.register(api as any);
    const tools = getTools(api);
    const storeTool = tools.find((t: any) => t.name === "memory_store")!;
    const browseTool = tools.find((t: any) => t.name === "memory_browse")!;

    for (let i = 0; i < 5; i++) {
      await storeTool.execute(`call-${i}`, { content: `Memory number ${i}`, type: "fact" });
    }

    const result = await browseTool.execute("call-browse", { limit: 2 });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveLength(2);
  });

  it("memory_browse returns empty for empty database", async () => {
    const api = fakeApi();
    plugin.register(api as any);
    const tools = getTools(api);
    const browseTool = tools.find((t: any) => t.name === "memory_browse")!;

    const result = await browseTool.execute("call-1", {});
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveLength(0);
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
    ).rejects.toThrow();
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
// New bundled adapters (OpenClaw v2026.4.12 / v2026.4.14)
// ===========================================================================

describe("LM Studio adapter (v2026.4.12 #53248)", () => {
  it("auto mode picks LM Studio when it is the highest-priority adapter", async () => {
    // Simulates the bundled LM Studio embedding adapter shape introduced
    // in v2026.4.12. Adapter id "lm-studio" registers with autoSelectPriority,
    // so our generic auto-resolution path picks it up without code changes.
    const lmCreate = vi.fn(async () => ({
      provider: {
        id: "lm-studio",
        model: "text-embedding-nomic-embed-text-v1.5",
        embedQuery: vi.fn(async () => Array.from({ length: 768 }, () => 0.1)),
        embedBatch: vi.fn(async (texts: string[]) =>
          texts.map(() => Array.from({ length: 768 }, () => 0.1)),
        ),
      },
    }));
    mockListProviders.mockReturnValue([
      {
        id: "lm-studio",
        defaultModel: "text-embedding-nomic-embed-text-v1.5",
        autoSelectPriority: 5,
        create: lmCreate,
      },
      {
        id: "openai",
        defaultModel: "text-embedding-3-small",
        autoSelectPriority: 20,
        create: mockCreate,
      },
    ]);

    const api = fakeApi();
    plugin.register(api as any);
    const tools = getTools(api);
    const storeTool = tools.find((t: any) => t.name === "memory_store")!;

    await storeTool.execute("call-1", { content: "local embed", type: "fact" });

    expect(lmCreate).toHaveBeenCalledOnce();
    expect(mockCreate).not.toHaveBeenCalled();
    // Identity persisted under the LM Studio adapter id.
    const db = new MemoryDatabase(join(tmpDir, "memory", "associations.db"));
    try {
      expect(db.getState("embedding_provider_id")).toBe("lm-studio");
    } finally {
      db.close();
    }
  });

  it("explicit selection by 'lm-studio' resolves via registry", async () => {
    const lmProvider = {
      id: "lm-studio",
      model: "text-embedding-nomic-embed-text-v1.5",
      embedQuery: vi.fn(async () => Array.from({ length: 768 }, () => 0.1)),
      embedBatch: vi.fn(),
    };
    const lmCreate = vi.fn(async () => ({ provider: lmProvider }));
    mockGetProvider.mockImplementation((id: any) =>
      id === "lm-studio"
        ? {
            id: "lm-studio",
            defaultModel: "text-embedding-nomic-embed-text-v1.5",
            create: lmCreate,
          }
        : undefined as any,
    );

    const api = fakeApi({ embedding: { provider: "lm-studio" } });
    plugin.register(api as any);
    const tools = getTools(api);
    const storeTool = tools.find((t: any) => t.name === "memory_store")!;

    await storeTool.execute("call-1", { content: "explicit lm-studio", type: "fact" });

    expect(mockGetProvider).toHaveBeenCalledWith("lm-studio");
    expect(lmCreate).toHaveBeenCalledOnce();
  });
});

describe("Ollama adapter (v2026.4.14 #63429/#66078/#66163)", () => {
  it("auto mode picks Ollama when its adapter sets autoSelectPriority", async () => {
    // The restored memory-core Ollama adapter exposes endpoint-aware
    // cacheKeyData via the runtime returned from create(). Our plugin
    // does not consume cacheKeyData directly, but the runtime field
    // must not break our resolution path.
    const ollamaCreate = vi.fn(async () => ({
      provider: {
        id: "ollama",
        model: "nomic-embed-text",
        embedQuery: vi.fn(async () => Array.from({ length: 768 }, () => 0.2)),
        embedBatch: vi.fn(),
      },
      runtime: {
        id: "ollama",
        cacheKeyData: { provider: "ollama", model: "nomic-embed-text", endpoint: "http://localhost:11434" },
      },
    }));
    mockListProviders.mockReturnValue([
      {
        id: "ollama",
        defaultModel: "nomic-embed-text",
        autoSelectPriority: 8,
        create: ollamaCreate,
      },
    ]);

    const api = fakeApi();
    plugin.register(api as any);
    const tools = getTools(api);
    const storeTool = tools.find((t: any) => t.name === "memory_store")!;

    await storeTool.execute("call-1", { content: "ollama embed", type: "fact" });

    expect(ollamaCreate).toHaveBeenCalledOnce();
    const db = new MemoryDatabase(join(tmpDir, "memory", "associations.db"));
    try {
      expect(db.getState("embedding_provider_id")).toBe("ollama");
      expect(db.getState("embedding_model")).toBe("nomic-embed-text");
    } finally {
      db.close();
    }
  });

  it("explicit selection by 'ollama' resolves via registry even without autoSelectPriority", async () => {
    // The current memory-core Ollama adapter source does not advertise
    // autoSelectPriority, so it is invisible to auto-select but must still
    // be reachable through explicit selection.
    const ollamaCreate = vi.fn(async () => ({
      provider: {
        id: "ollama",
        model: "nomic-embed-text",
        embedQuery: vi.fn(async () => Array.from({ length: 768 }, () => 0.2)),
        embedBatch: vi.fn(),
      },
    }));
    mockGetProvider.mockImplementation((id: any) =>
      id === "ollama"
        ? { id: "ollama", defaultModel: "nomic-embed-text", create: ollamaCreate }
        : undefined as any,
    );

    const api = fakeApi({ embedding: { provider: "ollama" } });
    plugin.register(api as any);
    const tools = getTools(api);
    const storeTool = tools.find((t: any) => t.name === "memory_store")!;

    await storeTool.execute("call-1", { content: "explicit ollama", type: "fact" });

    expect(mockGetProvider).toHaveBeenCalledWith("ollama");
    expect(ollamaCreate).toHaveBeenCalledOnce();
  });

  it("forwards a custom Ollama model through the registry adapter", async () => {
    // Endpoint-aware caching upstream relies on the model being passed
    // through verbatim — our plugin must not normalize or strip it.
    const ollamaCreate = vi.fn(async () => ({
      provider: {
        id: "ollama",
        model: "mxbai-embed-large",
        embedQuery: vi.fn(async () => Array.from({ length: 1024 }, () => 0.3)),
        embedBatch: vi.fn(),
      },
    }));
    mockGetProvider.mockImplementation((id: any) =>
      id === "ollama"
        ? { id: "ollama", defaultModel: "nomic-embed-text", create: ollamaCreate }
        : undefined as any,
    );

    const api = fakeApi({
      embedding: { provider: "ollama", model: "mxbai-embed-large" },
    });
    plugin.register(api as any);
    const tools = getTools(api);
    const storeTool = tools.find((t: any) => t.name === "memory_store")!;

    await storeTool.execute("call-1", { content: "custom ollama model", type: "fact" });

    expect(ollamaCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: "mxbai-embed-large" }),
    );
  });
});

// ===========================================================================
// Standalone fallback (memory-core unavailable or auth broken)
// ===========================================================================

describe("standalone fallback", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("auto mode falls back to standalone when registry is empty", async () => {
    mockListProviders.mockReturnValue([]);
    writeAuthProfiles(tmpDir, { "openai:default": { key: "sk-test" } });
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({
        data: [{ embedding: Array.from({ length: 1536 }, () => 0.1), index: 0 }],
      })),
    );

    const api = fakeApi();
    plugin.register(api as any);
    const tools = getTools(api);
    const storeTool = tools.find((t: any) => t.name === "memory_store")!;

    await storeTool.execute("call-1", { content: "test", type: "fact" });

    expect(globalThis.fetch).toHaveBeenCalled();
    const [url] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/embeddings");
  });

  it("auto mode falls back to standalone when all registry adapters fail", async () => {
    // Key scenario: memory-core installed but auth wiring broken.
    mockListProviders.mockReturnValue([
      {
        id: "openai",
        defaultModel: "m",
        autoSelectPriority: 20,
        create: vi.fn(async () => { throw new Error("memory-core: no auth"); }),
      },
    ]);
    writeAuthProfiles(tmpDir, { "openai:default": { key: "sk-test" } });
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({
        data: [{ embedding: Array.from({ length: 1536 }, () => 0.1), index: 0 }],
      })),
    );

    const api = fakeApi();
    plugin.register(api as any);
    const tools = getTools(api);
    const storeTool = tools.find((t: any) => t.name === "memory_store")!;

    // Should succeed via standalone fallback, not throw
    await storeTool.execute("call-1", { content: "test", type: "fact" });

    expect(globalThis.fetch).toHaveBeenCalled();
  });

  it("explicit provider falls back to standalone when registry adapter fails", async () => {
    mockCreate.mockRejectedValue(new Error("memory-core: no auth wiring"));
    writeAuthProfiles(tmpDir, { "openai:default": { key: "sk-test" } });
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({
        data: [{ embedding: Array.from({ length: 1536 }, () => 0.1), index: 0 }],
      })),
    );

    const api = fakeApi({ embedding: { provider: "openai" } });
    plugin.register(api as any);
    const tools = getTools(api);
    const storeTool = tools.find((t: any) => t.name === "memory_store")!;

    // Should succeed via standalone fallback despite adapter failure
    await storeTool.execute("call-1", { content: "test", type: "fact" });

    expect(globalThis.fetch).toHaveBeenCalled();
  });

  it("auto mode throws including both registry and standalone errors", async () => {
    mockListProviders.mockReturnValue([
      {
        id: "openai",
        defaultModel: "m",
        autoSelectPriority: 20,
        create: vi.fn(async () => { throw new Error("registry fail"); }),
      },
    ]);
    // No auth-profiles.json written — standalone also fails.

    const api = fakeApi();
    plugin.register(api as any);
    const tools = getTools(api);
    const storeTool = tools.find((t: any) => t.name === "memory_store")!;

    await expect(
      storeTool.execute("call-1", { content: "test", type: "fact" }),
    ).rejects.toThrow(/registry fail[\s\S]*standalone/);
  });

  it("explicit provider throws with combined error context when both fail", async () => {
    mockCreate.mockRejectedValue(new Error("registry auth error"));
    // No auth-profiles.json written — standalone also fails.

    const api = fakeApi({ embedding: { provider: "openai" } });
    plugin.register(api as any);
    const tools = getTools(api);
    const storeTool = tools.find((t: any) => t.name === "memory_store")!;

    await expect(
      storeTool.execute("call-1", { content: "test", type: "fact" }),
    ).rejects.toThrow(/registry auth error/);
  });
});

// ===========================================================================
// Embedding identity persistence (drift prevention)
// ===========================================================================

describe("embedding identity persistence", () => {
  it("persists provider and model to DB on first successful resolution", async () => {
    const api = fakeApi({ embedding: { provider: "openai" } });
    plugin.register(api as any);
    const tools = getTools(api);
    const storeTool = tools.find((t: any) => t.name === "memory_store")!;

    await storeTool.execute("call-1", { content: "test", type: "fact" });

    // Check DB state was written
    const db = new MemoryDatabase(join(tmpDir, "memory", "associations.db"));
    try {
      expect(db.getState("embedding_provider_id")).toBe("openai");
      expect(db.getState("embedding_model")).toBe("text-embedding-3-small");
    } finally {
      db.close();
    }
  });

  it("refuses to switch providers when DB already has persisted identity", async () => {
    // Pre-seed DB with Gemini identity
    mkdirSync(join(tmpDir, "memory"), { recursive: true });
    const preDb = new MemoryDatabase(join(tmpDir, "memory", "associations.db"));
    preDb.setState("embedding_provider_id", "gemini");
    preDb.setState("embedding_model", "text-embedding-004");
    preDb.close();

    // Config requests openai — should throw
    const api = fakeApi({ embedding: { provider: "openai" } });
    plugin.register(api as any);
    const tools = getTools(api);
    const storeTool = tools.find((t: any) => t.name === "memory_store")!;

    await expect(
      storeTool.execute("call-1", { content: "test", type: "fact" }),
    ).rejects.toThrow(/provider mismatch.*gemini.*openai/i);
  });

  it("refuses to switch models within same provider when persisted differs", async () => {
    // Pre-seed DB with openai/small
    mkdirSync(join(tmpDir, "memory"), { recursive: true });
    const preDb = new MemoryDatabase(join(tmpDir, "memory", "associations.db"));
    preDb.setState("embedding_provider_id", "openai");
    preDb.setState("embedding_model", "text-embedding-3-small");
    preDb.close();

    // Config requests openai/large — different dimensions → should throw
    const api = fakeApi({
      embedding: { provider: "openai", model: "text-embedding-3-large" },
    });
    plugin.register(api as any);
    const tools = getTools(api);
    const storeTool = tools.find((t: any) => t.name === "memory_store")!;

    await expect(
      storeTool.execute("call-1", { content: "test", type: "fact" }),
    ).rejects.toThrow(/model mismatch/i);
  });

  it("auto mode uses persisted identity instead of re-selecting", async () => {
    // Pre-seed DB with openai identity. Auto mode should use persisted
    // values even if registry would prefer something else.
    mkdirSync(join(tmpDir, "memory"), { recursive: true });
    const preDb = new MemoryDatabase(join(tmpDir, "memory", "associations.db"));
    preDb.setState("embedding_provider_id", "openai");
    preDb.setState("embedding_model", "text-embedding-3-small");
    preDb.close();

    const api = fakeApi(); // auto mode
    plugin.register(api as any);
    const tools = getTools(api);
    const storeTool = tools.find((t: any) => t.name === "memory_store")!;

    await storeTool.execute("call-1", { content: "test", type: "fact" });

    // Should have gone through explicit openai path (mockGetProvider called)
    expect(mockGetProvider).toHaveBeenCalledWith("openai");
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
// Provider init vs circuit breaker separation
// ===========================================================================

describe("provider init errors are not circuit breaker failures", () => {
  it("adapter.create() failure does not open the circuit breaker", async () => {
    let callCount = 0;
    mockCreate.mockImplementation(async () => {
      callCount++;
      if (callCount <= 2) throw new Error("transient init failure");
      return {
        provider: {
          id: "openai",
          model: "m",
          embedQuery: mockEmbedQuery,
          embedBatch: vi.fn(),
        },
      };
    });

    const api = fakeApi({ embedding: { provider: "openai" } });
    plugin.register(api as any);
    const tools = getTools(api);
    const storeTool = tools.find((t: any) => t.name === "memory_store")!;

    // First two calls fail with init error (not circuit breaker error)
    await expect(
      storeTool.execute("c1", { content: "a", type: "fact" }),
    ).rejects.toThrow("transient init failure");
    await expect(
      storeTool.execute("c2", { content: "b", type: "fact" }),
    ).rejects.toThrow("transient init failure");

    // Third call succeeds — breaker is NOT open, init retried
    const result = await storeTool.execute("c3", { content: "c", type: "fact" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.type).toBe("fact");
  });
});

// ===========================================================================
// Provider promise retry after failure
// ===========================================================================

describe("provider promise retry after failure", () => {
  it("retries provider resolution after transient failure", async () => {
    let callCount = 0;
    mockCreate.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) throw new Error("first attempt fails");
      return {
        provider: {
          id: "openai",
          model: "m",
          embedQuery: mockEmbedQuery,
          embedBatch: vi.fn(),
        },
      };
    });

    const api = fakeApi({ embedding: { provider: "openai" } });
    plugin.register(api as any);
    const tools = getTools(api);
    const storeTool = tools.find((t: any) => t.name === "memory_store")!;

    // First call fails
    await expect(
      storeTool.execute("c1", { content: "a", type: "fact" }),
    ).rejects.toThrow("first attempt fails");

    // Second call retries and succeeds
    const result = await storeTool.execute("c2", { content: "b", type: "fact" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.type).toBe("fact");
    expect(mockCreate).toHaveBeenCalledTimes(2);
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
    const tools = toolFactory({ workspaceDir: tmpDir, agentDir: tmpDir, config: {} }) as any[];
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

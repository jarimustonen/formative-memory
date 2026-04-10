/**
 * OpenClaw Associative Memory Plugin
 *
 * Biologically-inspired memory system with:
 * - Weighted associations between memories
 * - Retrieval-based strengthening
 * - Consolidation ("sleep") phase
 * - Temporal awareness (future/present/past)
 * - Internal tick-based time perception
 */

import { isAbsolute, join } from "node:path";
import { readFileSync } from "node:fs";
import { Type } from "@sinclair/typebox";
import type { AnyAgentTool, OpenClawPluginApi } from "openclaw/plugin-sdk";
import {
  createGeminiEmbeddingProvider,
  createOpenAiEmbeddingProvider,
  getMemoryEmbeddingProvider,
  listMemoryEmbeddingProviders,
  type MemoryEmbeddingProvider,
} from "openclaw/plugin-sdk/memory-core-host-engine-embeddings";
import type { OpenClawConfig } from "openclaw/plugin-sdk";
import type { AssociativeMemoryConfig } from "./config.ts";
import { memoryConfigSchema } from "./config.ts";
import { applyTemporalTransitions } from "./consolidation-steps.ts";
import { runConsolidation } from "./consolidation.ts";
import { CONTEXT_ENGINE_ID, createAssociativeMemoryContextEngine } from "./context-engine.ts";
import { EmbeddingCircuitBreaker } from "./embedding-circuit-breaker.ts";
import { callLlm, resolveApiKey, type LlmCallerConfig } from "./llm-caller.ts";
import { MemoryManager } from "./memory-manager.ts";
import {
  cleanupWorkspaceFiles,
  runMigration,
  buildEnrichmentPrompt,
  parseEnrichmentResponse,
  type EnrichFn,
} from "./migration-service.ts";
import { appendFeedbackEvent } from "./retrieval-log.ts";
import { TurnMemoryLedger } from "./turn-memory-ledger.ts";

// -- Auth profile resolution --

const AUTH_PROFILE_FILENAME = "auth-profiles.json";

/**
 * Read API keys from auth-profiles.json.
 * Tries agentDir first, then stateDir/agents/main/agent/ as fallback
 * (hardcoded "main" — works for single-agent setups which is the common case).
 */
function readAuthProfiles(
  stateDir?: string,
  agentDir?: string,
  logger?: { warn: (msg: string) => void },
): Record<string, { provider?: string; key?: string }> | null {
  const candidates = [
    agentDir ? join(agentDir, AUTH_PROFILE_FILENAME) : undefined,
    stateDir ? join(stateDir, "agents", "main", "agent", AUTH_PROFILE_FILENAME) : undefined,
  ].filter((p): p is string => Boolean(p));

  for (const filePath of candidates) {
    try {
      const raw = readFileSync(filePath, "utf-8");
      const data = JSON.parse(raw);
      if (!data || typeof data !== "object" || typeof data.profiles !== "object") {
        logger?.warn(`Invalid auth profile format: ${filePath}`);
        continue;
      }
      return data.profiles;
    } catch (err: any) {
      if (err?.code !== "ENOENT") {
        logger?.warn(`Failed to read auth profiles from ${filePath}: ${err.message}`);
      }
    }
  }
  return null;
}

/**
 * Resolve LLM caller config from auth profiles.
 * Returns null if no suitable API key is found.
 */
function resolveLlmConfig(
  stateDir?: string,
  agentDir?: string,
  logger?: { warn: (msg: string) => void },
): LlmCallerConfig | null {
  const profiles = readAuthProfiles(stateDir, agentDir, logger);
  const resolved = resolveApiKey(profiles ?? undefined, "anthropic");
  if (!resolved) return null;
  return { provider: resolved.provider, apiKey: resolved.apiKey };
}

/**
 * Create an EnrichFn for migration that uses direct LLM calls.
 */
function createDirectLlmEnrichFn(llmConfig: LlmCallerConfig, language?: string): EnrichFn {
  return async (segments) => {
    const prompt = buildEnrichmentPrompt(segments, language);
    const response = await callLlm(prompt, llmConfig);
    return parseEnrichmentResponse(response);
  };
}

/**
 * Detect user's preferred language from USER.md in the workspace.
 * Looks for "Kielet:" or "Languages:" line and returns the first (native) language.
 */
function detectUserLanguage(workspaceDir: string): string | undefined {
  try {
    const content = readFileSync(join(workspaceDir, "USER.md"), "utf-8");
    // Match "Kielet: suomi (äidinkieli)" or "Languages: Finnish (native)"
    const match = content.match(/(?:Kielet|Languages?)\s*[:：]\s*(\S+)/i);
    return match?.[1]?.replace(/[,;]$/, "");
  } catch {
    return undefined;
  }
}

function jsonResult(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    details: payload,
  };
}

/**
 * Resolve the memory database directory from plugin config.
 * Uses api.resolvePath for ~ expansion (cross-platform) when available,
 * falls back to manual resolution.
 */
function resolveMemoryDir(
  config: AssociativeMemoryConfig,
  workspaceDir: string,
  pathResolver?: (input: string) => string,
): string {
  const dbPath = config.dbPath;

  // Use OpenClaw's path resolver if available (handles ~, ~user, cross-platform)
  if (pathResolver) {
    const resolved = pathResolver(dbPath);
    return isAbsolute(resolved) ? resolved : join(workspaceDir, resolved);
  }

  // Manual fallback
  if (dbPath === "~" || dbPath.startsWith("~/")) {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
    return join(home, dbPath.slice(dbPath.startsWith("~/") ? 2 : 1));
  }
  if (isAbsolute(dbPath)) {
    return dbPath;
  }
  return join(workspaceDir, dbPath);
}

// -- Embedding provider resolution --

/**
 * Try to create an embedding provider directly via SDK factory functions.
 * Used when the memory-core plugin is disabled and the global registry is empty.
 * Factory returns { provider, client } — we extract the provider.
 */
async function tryDirectProviderFactory(
  providerId: string,
  openclawConfig: OpenClawConfig,
  agentDir?: string,
  model?: string,
): Promise<MemoryEmbeddingProvider | null> {
  const factories: Record<string, (opts: any) => Promise<any>> = {
    openai: createOpenAiEmbeddingProvider,
    gemini: createGeminiEmbeddingProvider,
  };
  const factory = factories[providerId];
  if (!factory) return null;

  const result = await factory({ config: openclawConfig, agentDir, model: model ?? "" });
  const provider = result?.provider ?? result;
  return provider?.embedQuery ? provider : null;
}

/**
 * Resolve an embedding provider from the OpenClaw provider registry.
 *
 * For "auto": tries each registered adapter in priority order.
 * For explicit IDs: creates the specific provider or throws.
 *
 * Throws on failure — the plugin requires a working embedding provider.
 */
async function resolveEmbeddingProvider(
  providerId: string,
  openclawConfig: OpenClawConfig,
  agentDir?: string,
  model?: string,
): Promise<MemoryEmbeddingProvider> {
  const errors: string[] = [];

  if (providerId === "auto") {
    const adapters = listMemoryEmbeddingProviders()
      .filter((a) => typeof a.autoSelectPriority === "number")
      .toSorted((a, b) => (a.autoSelectPriority ?? Infinity) - (b.autoSelectPriority ?? Infinity));

    for (const adapter of adapters) {
      try {
        const result = await adapter.create({
          config: openclawConfig,
          agentDir,
          model: model ?? adapter.defaultModel ?? "",
        });
        if (result.provider) return result.provider;
      } catch (err) {
        errors.push(`${adapter.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Fallback: registry empty (memory-core disabled) — try direct factories
    if (adapters.length === 0) {
      for (const id of ["gemini", "openai"] as const) {
        try {
          const provider = await tryDirectProviderFactory(id, openclawConfig, agentDir, model);
          if (provider) return provider;
        } catch (err) {
          errors.push(`${id} (direct): ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    throw new Error(
      `No embedding provider available (tried auto-selection).\n${errors.join("\n") || "No adapters registered."}`,
    );
  }

  // Explicit provider ID — try registry first, then direct factory
  const adapter = getMemoryEmbeddingProvider(providerId);
  if (adapter) {
    const result = await adapter.create({
      config: openclawConfig,
      agentDir,
      model: model ?? adapter.defaultModel ?? "",
    });
    if (result.provider) return result.provider;
    throw new Error(`Embedding provider "${providerId}" returned no provider instance`);
  }

  const directProvider = await tryDirectProviderFactory(providerId, openclawConfig, agentDir, model);
  if (directProvider) return directProvider;

  throw new Error(`Unknown embedding provider: "${providerId}"`);
}

// -- Workspace --

type ManagedWorkspace = {
  manager: MemoryManager;
  circuitBreaker: EmbeddingCircuitBreaker;
  memoryDir: string;
};

/**
 * Create the single workspace instance for this plugin registration.
 * Provider resolution is lazy — deferred to first embed call via a cached promise.
 *
 * When `initDeps` is provided, one-time startup tasks (migration, workspace
 * cleanup) are run asynchronously after workspace creation. This happens on
 * the first tool call which provides the real workspace context.
 */
function createWorkspace(
  config: AssociativeMemoryConfig,
  workspaceDir: string,
  openclawConfig: OpenClawConfig,
  agentDir?: string,
  logger?: { warn: (...args: unknown[]) => void; info?: (msg: string) => void },
  pathResolver?: (input: string) => string,
  initDeps?: {
    stateDir?: string;
    llmConfig: LlmCallerConfig | null;
  },
): ManagedWorkspace {
  const memoryDir = resolveMemoryDir(config, workspaceDir, pathResolver);
  const circuitBreaker = new EmbeddingCircuitBreaker({
    onLateSettlement: (outcome, err) => {
      logger?.warn(
        `Embedding call settled after timeout (${outcome}) — consider increasing timeoutMs`,
        err,
      );
    },
  });

  // Lazy provider: resolved on first embed call, cached as promise for
  // concurrency safety — concurrent callers await the same resolution.
  // On rejection the cache is cleared so subsequent calls can retry.
  let providerPromise: Promise<MemoryEmbeddingProvider> | null = null;

  const getProvider = (): Promise<MemoryEmbeddingProvider> => {
    if (!providerPromise) {
      providerPromise = resolveEmbeddingProvider(
        config.embedding.provider,
        openclawConfig,
        agentDir,
        config.embedding.model,
      ).catch((err) => {
        providerPromise = null;
        throw err;
      });
    }
    return providerPromise;
  };

  // Provider init is outside the circuit breaker — config/auth errors
  // are hard failures, not transient network issues. Only the actual
  // embedQuery() call is protected by the breaker.
  const embedder = {
    async embed(text: string): Promise<number[]> {
      const provider = await getProvider();
      return circuitBreaker.call(() => provider.embedQuery(text));
    },
  };

  const ws: ManagedWorkspace = { manager: new MemoryManager(memoryDir, embedder), circuitBreaker, memoryDir };

  // One-time startup tasks (migration + workspace cleanup).
  // Runs asynchronously on first workspace creation — does not block tool calls.
  // Guarded by DB state keys so each task runs at most once.
  if (initDeps) {
    const log = logger as { warn: (msg: string) => void; info?: (msg: string) => void } | undefined;
    void (async () => {
      const db = ws.manager.getDatabase();
      const dbState = {
        get: (key: string) => db.getState(key),
        set: (key: string, value: string) => db.setState(key, value),
      };

      // 1. Workspace file cleanup (remove file-based memory instructions)
      if (initDeps.llmConfig) {
        try {
          const result = await cleanupWorkspaceFiles({
            workspaceDir,
            dbState,
            llm: (prompt) => callLlm(prompt, initDeps.llmConfig!),
            logger: log ?? { info: () => {}, warn: () => {} },
          });
          if (result.status === "cleaned") {
            log?.info?.(`Workspace cleanup: modified ${result.filesModified?.join(", ")}`);
          }
        } catch (err) {
          log?.warn(`Workspace cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // 2. Memory-core migration (import old memories)
      try {
        const userLanguage = detectUserLanguage(workspaceDir);
        const enrichFn: EnrichFn = initDeps.llmConfig
          ? createDirectLlmEnrichFn(initDeps.llmConfig, userLanguage)
          : async (segments) =>
              segments.map((seg) => ({
                id: seg.id,
                type: seg.evergreen ? "fact" : "observation",
                temporal_state: seg.date ? "past" : "none",
                temporal_anchor: seg.date,
              }));

        const migrationResult = await runMigration({
          workspaceDir,
          stateDir: initDeps.stateDir ?? workspaceDir,
          store: (params) => ws.manager.store(params),
          updateStrength: (id, strength) => ws.manager.getDatabase().updateStrength(id, strength),
          dbState,
          enrich: enrichFn,
          logger: log ?? { info: () => {}, warn: () => {}, error: () => {} },
        });

        if (migrationResult.status === "completed") {
          log?.info?.(
            `Migration: imported ${migrationResult.segmentsImported} memories from ${migrationResult.filesFound} files`,
          );
        }
      } catch (err) {
        log?.warn(`Migration failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    })();
  }

  return ws;
}

// -- Tools --

function createMemoryTools(
  getManager: () => MemoryManager,
  getLogPath: () => string,
  ledger?: TurnMemoryLedger,
): AnyAgentTool[] {
  const storeTool: AnyAgentTool = {
    name: "memory_store",
    description:
      "Store a new memory. Use this to persist important information, decisions, facts, or plans that should be remembered across sessions.",
    label: "Store Memory",
    parameters: Type.Object({
      content: Type.String({ description: "The memory content to store" }),
      type: Type.String({
        description: 'Memory type, e.g. "fact", "decision", "plan", "observation", "preference"',
      }),
      temporal_state: Type.Optional(
        Type.Union(
          [
            Type.Literal("future"),
            Type.Literal("present"),
            Type.Literal("past"),
            Type.Literal("none"),
          ],
          {
            description:
              'Temporal state: "future" for upcoming events, "present" for current, "past" for historical, "none" for atemporal',
          },
        ),
      ),
      temporal_anchor: Type.Optional(
        Type.String({
          description: "ISO date for temporal memories, e.g. a deadline or event date",
        }),
      ),
      context_ids: Type.Optional(
        Type.Array(Type.String(), {
          description: "IDs of related memories for co-retrieval tracking",
        }),
      ),
    }),
    async execute(_toolCallId, params) {
      const memory = await getManager().store({
        content: params.content,
        type: params.type,
        source: "agent_tool",
        temporal_state: params.temporal_state,
        temporal_anchor: params.temporal_anchor,
        context_ids: params.context_ids,
      });
      ledger?.addStoredThisTurn(memory.id);
      return jsonResult({
        id: memory.id,
        id_short: memory.id.slice(0, 8),
        type: memory.type,
        temporal_state: memory.temporal_state,
        strength: memory.strength,
      });
    },
  };

  const searchTool: AnyAgentTool = {
    name: "memory_search",
    description:
      "Search memories by semantic similarity and keyword matching. Returns ranked results weighted by memory strength.",
    label: "Search Memories",
    parameters: Type.Object({
      query: Type.String({ description: "Search query (natural language)" }),
      limit: Type.Optional(Type.Number({ description: "Max results to return (default: 5)" })),
    }),
    async execute(_toolCallId, params) {
      const results = await getManager().search(params.query, params.limit);
      ledger?.addSearchResults(
        results.map((r) => ({ id: r.memory.id, score: r.score, query: params.query })),
      );
      return jsonResult(
        results.map((r) => ({
          id: r.memory.id,
          id_short: r.memory.id.slice(0, 8),
          type: r.memory.type,
          content: r.memory.content,
          strength: r.memory.strength,
          score: Math.round(r.score * 1000) / 1000,
          temporal_state: r.memory.temporal_state,
          created_at: r.memory.created_at,
        })),
      );
    },
  };

  const getTool: AnyAgentTool = {
    name: "memory_get",
    description: "Retrieve a specific memory by its ID (full hash or short prefix).",
    label: "Get Memory",
    parameters: Type.Object({
      id: Type.String({ description: "Memory ID (full SHA-256 hash or 8-char prefix)" }),
    }),
    async execute(_toolCallId, params) {
      const memory = getManager().getMemory(params.id);
      if (!memory) {
        return jsonResult({ error: "Memory not found", id: params.id });
      }
      ledger?.addExplicitlyOpened(memory.id);
      return jsonResult({
        id: memory.id,
        id_short: memory.id.slice(0, 8),
        type: memory.type,
        content: memory.content,
        strength: memory.strength,
        temporal_state: memory.temporal_state,
        temporal_anchor: memory.temporal_anchor,
        created_at: memory.created_at,
        consolidated: memory.consolidated,
      });
    },
  };

  const feedbackTool: AnyAgentTool = {
    name: "memory_feedback",
    description:
      "Rate how useful a retrieved memory was. Ratings influence future retrieval strength during consolidation.",
    label: "Memory Feedback",
    parameters: Type.Object({
      memory_id: Type.String({ description: "ID of the memory to rate" }),
      rating: Type.Number({ description: "Usefulness rating: 1 (not useful) to 5 (very useful)" }),
      comment: Type.Optional(
        Type.String({ description: "Optional comment explaining the rating" }),
      ),
    }),
    async execute(_toolCallId, params) {
      appendFeedbackEvent(getLogPath(), { [params.memory_id]: params.rating }, params.comment);
      return jsonResult({ ok: true, memory_id: params.memory_id, rating: params.rating });
    },
  };

  const browseTool: AnyAgentTool = {
    name: "memory_browse",
    description:
      "Browse all memories sorted by importance. Use this for broad/overview questions like 'What do you remember about me?', 'Tell me everything you know', or when injected memories don't cover the topic. Returns many memories at once with type diversity.",
    label: "Browse Memories",
    parameters: Type.Object({
      limit: Type.Optional(
        Type.Number({ description: "Max memories to return (default: 50, max: 200)" }),
      ),
    }),
    async execute(_toolCallId, params) {
      const limit = Math.min(Math.max(1, params.limit ?? 50), 200);
      const results = getManager().broadRecall(limit);
      ledger?.addSearchResults(
        results.map((r) => ({ id: r.memory.id, score: r.score, query: "__browse__" })),
      );
      return jsonResult(
        results.map((r) => ({
          id: r.memory.id,
          id_short: r.memory.id.slice(0, 8),
          type: r.memory.type,
          content: r.memory.content,
          strength: r.memory.strength,
          score: Math.round(r.score * 1000) / 1000,
          temporal_state: r.memory.temporal_state,
          created_at: r.memory.created_at,
        })),
      );
    },
  };

  return [storeTool, searchTool, getTool, feedbackTool, browseTool];
}

// -- Plugin --

const associativeMemoryPlugin = {
  id: "memory-associative",
  name: "Memory (Associative)",
  description: "Biologically-inspired associative memory with consolidation and temporal awareness",
  kind: "memory" as const,
  configSchema: memoryConfigSchema,

  register(api: OpenClawPluginApi) {
    const config = memoryConfigSchema.parse(api.pluginConfig);
    const openclawConfig = api.config;
    const logger = api.logger;
    const ledger = new TurnMemoryLedger();

    // Runtime state captured from tool contexts for use by commands.
    const runtimePaths: { stateDir?: string; agentDir?: string } = {};

    // Single lazy workspace — created on first tool call, shared by all consumers.
    // The first tool call provides the real workspaceDir from OpenClaw runtime context.
    // Context engine and commands use "." which reuses the already-initialized singleton.
    // See history/proposal-context-engine-factory-context.md for the upstream limitation.
    let workspace: ManagedWorkspace | null = null;

    const getWorkspace = (workspaceDir: string, agentDir?: string, triggerInit = false): ManagedWorkspace => {
      if (!workspace) {
        const llmConfig = resolveLlmConfig(runtimePaths.stateDir, agentDir, logger);
        workspace = createWorkspace(
          config, workspaceDir, openclawConfig, agentDir, logger, api.resolvePath,
          triggerInit ? { stateDir: runtimePaths.stateDir, llmConfig } : undefined,
        );
      }
      return workspace;
    };

    api.registerTool(
      (ctx) => {
        const workspaceDir = ctx.workspaceDir ?? ctx.agentDir ?? ".";
        // stateDir is not available in tool context — captured from service start if it runs
        runtimePaths.agentDir ??= ctx.agentDir;
        // First tool call creates workspace with real paths and triggers lazy init
        // (migration + workspace cleanup). Subsequent calls reuse the singleton.
        const ws = getWorkspace(workspaceDir, ctx.agentDir, true);
        return createMemoryTools(
          () => ws.manager,
          () => join(ws.memoryDir, "retrieval.log"),
          ledger,
        );
      },
      { names: ["memory_store", "memory_search", "memory_get", "memory_feedback", "memory_browse"] },
    );

    // Register system prompt section via the pluggable memory API (PR #40126)
    api.registerMemoryPromptSection(({ availableTools }) => {
      const hasStore = availableTools.has("memory_store");
      const hasSearch = availableTools.has("memory_search");
      const hasGet = availableTools.has("memory_get");
      const hasFeedback = availableTools.has("memory_feedback");
      const hasBrowse = availableTools.has("memory_browse");

      if (!hasStore && !hasSearch && !hasGet) return [];

      const tools = [
        hasStore && "`memory_store` (save)",
        hasSearch && "`memory_search` (find by query)",
        hasBrowse && "`memory_browse` (broad overview)",
        hasGet && "`memory_get` (retrieve by ID)",
        hasFeedback && "`memory_feedback` (rate usefulness 1-5)",
      ].filter(Boolean);

      return [
        "## Associative Memory",
        "",
        `You have a persistent associative memory system. Tools: ${tools.join(", ")}.`,
        "",
        hasStore
          ? [
              "**IMPORTANT: Use `memory_store` to save memories.** Do NOT write to workspace files (MEMORY.md, USER.md, etc.) for memory persistence — use the memory tools instead. The associative memory system handles storage, retrieval, and consolidation automatically.",
              "",
              "**One fact per memory.** Each `memory_store` call should contain exactly one atomic piece of information. If you learn multiple things, make multiple calls. For example, if the user says \"I'm traveling to Helsinki next week and Saturday is Lyra's birthday party\", store these as TWO separate memories: one about the trip, one about the party. The system discovers connections between memories automatically through co-retrieval patterns — do not combine them yourself.",
            ].join("\n")
          : "",
        "",
        "**When to store:** key decisions, user preferences, project facts, plans, corrections, anything worth remembering. When the user says \"remember this\" or similar, ALWAYS use `memory_store`.",
        "**When to search:** start of a task, when context seems missing, when the user references past work.",
        hasBrowse
          ? "**When to browse:** when the user asks broad questions like \"What do you remember about me?\", \"Tell me everything you know\", or when auto-recalled memories don't cover the topic. `memory_browse` returns many memories sorted by importance with type diversity — use it for overview, not targeted search."
          : "",
        hasFeedback
          ? "**When to give feedback:** after using a retrieved memory — rate how useful it was."
          : "",
        "",
      ];
    });

    // Context engine and commands use the same workspace as tools.
    // Workspace is created lazily on first access (tool call or engine use).
    api.registerContextEngine(CONTEXT_ENGINE_ID, () =>
      createAssociativeMemoryContextEngine({
        getManager: () => getWorkspace(".").manager,
        isBm25Only: () => getWorkspace(".").circuitBreaker.isBm25Only(),
        ledger,
        getDb: () => getWorkspace(".").manager.getDatabase(),
        getLogPath: () => join(getWorkspace(".").memoryDir, "retrieval.log"),
      }),
    );

    api.registerCommand({
      name: "memory-sleep",
      description: "Run memory consolidation (strengthens associations, merges duplicates, cleans up)",
      async handler() {
        const ws = getWorkspace(".");

        const llmConfig = resolveLlmConfig(runtimePaths.stateDir, runtimePaths.agentDir, logger);
        if (!llmConfig) {
          return {
            text: "Memory consolidation failed: no LLM API key found.\n" +
              "Consolidation requires an Anthropic or OpenAI API key in auth-profiles.json " +
              "to merge duplicate memories. Other consolidation steps (decay, pruning) were not run.",
          };
        }

        const mergeContentProducer = async (
          a: { id: string; content: string; type: string },
          b: { id: string; content: string; type: string },
        ) => {
          const prompt = `Merge these two memory notes into a single, concise note that preserves all information. Return ONLY the merged content text, nothing else.\n\nMemory A (${a.type}):\n${a.content}\n\nMemory B (${b.type}):\n${b.content}`;
          const content = await callLlm(prompt, llmConfig);
          return { content: content.trim(), type: a.type };
        };

        const result = await runConsolidation({
          db: ws.manager.getDatabase(),
          mergeContentProducer,
        });

        const s = result.summary;
        const catchUpInfo = s.catchUpDecayed > 0 ? `Catch-up decayed: ${s.catchUpDecayed}, ` : "";
        return {
          text: `Memory consolidation complete (${result.durationMs}ms).\n` +
            catchUpInfo +
            `Reinforced: ${s.reinforced}, Decayed: ${s.decayed}, ` +
            `Pruned: ${s.pruned} memories + ${s.prunedAssociations} associations, ` +
            `Merged: ${s.merged}, Transitioned: ${s.transitioned}, ` +
            `Promoted: ${s.promoted}, Exposure GC: ${s.exposuresGc}`,
        };
      },
    });

    // -- /memory-migrate: re-run memory-core import --
    api.registerCommand({
      name: "memory-migrate",
      description: "Re-import memories from memory-core files (migration normally runs automatically on first use)",
      async handler() {
        const ws = getWorkspace(".");
        const db = ws.manager.getDatabase();
        const llmConfig = resolveLlmConfig(runtimePaths.stateDir, runtimePaths.agentDir, logger);
        const userLanguage = detectUserLanguage(".");
        const enrichFn: EnrichFn = llmConfig
          ? createDirectLlmEnrichFn(llmConfig, userLanguage)
          : async (segments) =>
              segments.map((seg) => ({
                id: seg.id,
                type: seg.evergreen ? "fact" : "observation",
                temporal_state: seg.date ? "past" : "none",
                temporal_anchor: seg.date,
              }));

        // Reset migration state to allow re-run
        db.setState("migration_completed_at", "");

        const result = await runMigration({
          workspaceDir: ".",
          stateDir: runtimePaths.stateDir ?? ".",
          store: (params) => ws.manager.store(params),
          updateStrength: (id, strength) => db.updateStrength(id, strength),
          dbState: {
            get: (key) => db.getState(key),
            set: (key, value) => db.setState(key, value),
          },
          enrich: enrichFn,
          logger,
        });

        if (result.status === "completed") {
          return {
            text: `Migration complete: imported ${result.segmentsImported} memories from ${result.filesFound} files` +
              (result.errors?.length ? ` (${result.errors.length} errors)` : ""),
          };
        }
        return { text: `Migration: ${result.status}` };
      },
    });

    // -- /memory-cleanup: re-run workspace file cleanup --
    api.registerCommand({
      name: "memory-cleanup",
      description: "Remove file-based memory instructions from workspace files (AGENTS.md, SOUL.md)",
      async handler() {
        const ws = getWorkspace(".");
        const db = ws.manager.getDatabase();
        const llmConfig = resolveLlmConfig(runtimePaths.stateDir, runtimePaths.agentDir, logger);
        if (!llmConfig) {
          return { text: "Workspace cleanup failed: no LLM API key found." };
        }

        // Reset cleanup state to allow re-run
        db.setState("workspace_cleanup_completed_at", "");

        const result = await cleanupWorkspaceFiles({
          workspaceDir: ".",
          dbState: {
            get: (key) => db.getState(key),
            set: (key, value) => db.setState(key, value),
          },
          llm: (prompt) => callLlm(prompt, llmConfig),
          logger,
        });

        if (result.status === "cleaned") {
          return { text: `Workspace cleanup: modified ${result.filesModified?.join(", ")}` };
        }
        return { text: `Workspace cleanup: ${result.status}` };
      },
    });

    // -- Scheduled consolidation via cron --

    /** System event token for cron-triggered consolidation. */
    const CONSOLIDATION_CRON_TRIGGER = "__associative_memory_consolidation__";
    /** Cron job name (used to find/update managed jobs). */
    const CONSOLIDATION_CRON_NAME = "Associative Memory Consolidation";
    /** Tag in description to identify managed jobs. */
    const CONSOLIDATION_CRON_TAG = "[managed-by=memory-associative.consolidation]";
    /** Default cron expression: daily at 03:00. */
    const DEFAULT_CONSOLIDATION_CRON = "0 3 * * *";

    /** System event token for cron-triggered temporal transitions. */
    const TEMPORAL_CRON_TRIGGER = "__associative_memory_temporal_transitions__";
    /** Cron job name for temporal transitions. */
    const TEMPORAL_CRON_NAME = "Associative Memory Temporal Transitions";
    /** Tag to identify managed temporal jobs. */
    const TEMPORAL_CRON_TAG = "[managed-by=memory-associative.temporal]";
    /** Cron expression: daily at 15:00 (03:00 is covered by full consolidation). */
    const DEFAULT_TEMPORAL_CRON = "0 15 * * *";

    // Register cron job on gateway startup (same pattern as memory-core dreaming).
    api.registerHook("gateway:startup", async (event: any) => {
      try {
        // Extract cron service (dual-path: context.cron or context.deps.cron)
        const context = event?.context;
        const cron = context?.cron ?? context?.deps?.cron;
        if (!cron || typeof cron.list !== "function" || typeof cron.add !== "function") {
          logger.warn("Cron service not available — scheduled consolidation disabled");
          return;
        }

        // Capture stateDir from startup context if available
        if (context?.stateDir) runtimePaths.stateDir = context.stateDir;

        // Reconcile: find existing managed job or create one
        const allJobs = await cron.list({ includeDisabled: true });
        const managed = (allJobs as any[]).filter(
          (j: any) => j.description?.includes(CONSOLIDATION_CRON_TAG),
        );

        const desired = {
          name: CONSOLIDATION_CRON_NAME,
          description: `${CONSOLIDATION_CRON_TAG} Full consolidation: decay, reinforce, merge, prune, promote.`,
          enabled: true,
          schedule: { kind: "cron" as const, expr: DEFAULT_CONSOLIDATION_CRON },
          sessionTarget: "main" as const,
          wakeMode: "next-heartbeat" as const,
          payload: { kind: "systemEvent" as const, text: CONSOLIDATION_CRON_TRIGGER },
        };

        if (managed.length === 0) {
          await cron.add(desired);
          logger.info?.("Registered consolidation cron job");
        } else {
          // Update existing job if schedule changed
          const existing = managed[0];
          if (existing.schedule?.expr !== desired.schedule.expr) {
            await cron.update(existing.id, { schedule: desired.schedule });
            logger.info?.("Updated consolidation cron schedule");
          }
          // Remove duplicates
          for (let i = 1; i < managed.length; i++) {
            await cron.remove(managed[i].id);
          }
        }

        // -- Temporal transitions cron (every 12h) --
        const temporalManaged = (allJobs as any[]).filter(
          (j: any) => j.description?.includes(TEMPORAL_CRON_TAG),
        );
        const desiredTemporal = {
          name: TEMPORAL_CRON_NAME,
          description: `${TEMPORAL_CRON_TAG} Transition temporal states: future→present→past.`,
          enabled: true,
          schedule: { kind: "cron" as const, expr: DEFAULT_TEMPORAL_CRON },
          sessionTarget: "main" as const,
          wakeMode: "next-heartbeat" as const,
          payload: { kind: "systemEvent" as const, text: TEMPORAL_CRON_TRIGGER },
        };

        if (temporalManaged.length === 0) {
          await cron.add(desiredTemporal);
          logger.info?.("Registered temporal transitions cron job");
        } else {
          const existing = temporalManaged[0];
          if (existing.schedule?.expr !== desiredTemporal.schedule.expr) {
            await cron.update(existing.id, { schedule: desiredTemporal.schedule });
            logger.info?.("Updated temporal transitions cron schedule");
          }
          for (let i = 1; i < temporalManaged.length; i++) {
            await cron.remove(temporalManaged[i].id);
          }
        }
      } catch (err) {
        logger.warn(
          `Failed to register consolidation cron: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }, { name: "memory-associative-consolidation-cron" } as any);

    // Handle cron-triggered consolidation and temporal transitions via before_agent_reply hook.
    // When cron fires, OpenClaw sends a systemEvent with our trigger text.
    // We intercept it, run the appropriate operation, and return handled=true to skip the LLM.
    api.on("before_agent_reply", async (event: any, ctx: any) => {
      const body = event?.cleanedBody;
      if (!body) return;

      // Temporal transitions only (idempotent — harmless if consolidation also runs at 03:00)
      if (body.includes(TEMPORAL_CRON_TRIGGER) && !body.includes(CONSOLIDATION_CRON_TRIGGER)) {
        try {
          const ws = getWorkspace(ctx?.workspaceDir ?? ".");
          const db = ws.manager.getDatabase();
          const count = db.transaction(() => applyTemporalTransitions(db));
          if (count > 0) {
            logger.info?.(`Scheduled temporal transitions: ${count} transitioned`);
          }
          return {
            handled: true,
            reply: { text: count > 0 ? `Temporal transitions: ${count} updated.` : "No temporal transitions needed." },
            reason: "associative-memory-temporal",
          };
        } catch (err) {
          logger.warn(`Scheduled temporal transitions failed: ${err instanceof Error ? err.message : String(err)}`);
          return { handled: true, reply: { text: "Temporal transitions failed." }, reason: "associative-memory-temporal-error" };
        }
      }

      // Full consolidation
      if (!body.includes(CONSOLIDATION_CRON_TRIGGER)) return;

      try {
        const ws = getWorkspace(ctx?.workspaceDir ?? ".");
        const llmConfig = resolveLlmConfig(runtimePaths.stateDir, runtimePaths.agentDir, logger);
        const mergeContentProducer = llmConfig
          ? async (
              a: { id: string; content: string; type: string },
              b: { id: string; content: string; type: string },
            ) => {
              const prompt = `Merge these two memory notes into a single, concise note that preserves all information. Return ONLY the merged content text, nothing else.\n\nMemory A (${a.type}):\n${a.content}\n\nMemory B (${b.type}):\n${b.content}`;
              const content = await callLlm(prompt, llmConfig);
              return { content: content.trim(), type: a.type };
            }
          : undefined;

        // Also run temporal transitions as part of full consolidation
        const db = ws.manager.getDatabase();
        const temporalCount = db.transaction(() => applyTemporalTransitions(db));

        const result = await runConsolidation({
          db,
          mergeContentProducer,
        });

        const s = result.summary;
        const catchUpInfo = s.catchUpDecayed > 0 ? `Catch-up decayed: ${s.catchUpDecayed}, ` : "";
        const temporalInfo = temporalCount > 0 ? `, Temporal transitions (extra): ${temporalCount}` : "";
        logger.info?.(
          `Scheduled consolidation complete (${result.durationMs}ms): ${catchUpInfo}` +
          `Reinforced: ${s.reinforced}, Decayed: ${s.decayed}, ` +
          `Pruned: ${s.pruned}+${s.prunedAssociations}, Merged: ${s.merged}, ` +
          `Promoted: ${s.promoted}${temporalInfo}`,
        );

        return {
          handled: true,
          reply: {
            text: `Memory consolidation complete (${result.durationMs}ms).`,
          },
          reason: "associative-memory-consolidation",
        };
      } catch (err) {
        logger.warn(
          `Scheduled consolidation failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        return {
          handled: true,
          reply: { text: "Memory consolidation failed." },
          reason: "associative-memory-consolidation-error",
        };
      }
    });

    // -- Startup service --
    // Captures stateDir for auth-profile resolution in commands.
    api.registerService({
      id: "memory-associative-startup",
      async start(ctx) {
        runtimePaths.stateDir = ctx.stateDir;
      },
    });
  },
};

export default associativeMemoryPlugin;

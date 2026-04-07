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

import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
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
 * Tries agentDir first, then stateDir/agents/main/agent/.
 */
function readAuthProfiles(
  stateDir?: string,
  agentDir?: string,
): Record<string, { provider?: string; key?: string }> | null {
  const candidates = [
    agentDir && join(agentDir, AUTH_PROFILE_FILENAME),
    stateDir && join(stateDir, "agents", "main", "agent", AUTH_PROFILE_FILENAME),
  ].filter(Boolean) as string[];

  for (const path of candidates) {
    try {
      if (existsSync(path)) {
        const data = JSON.parse(readFileSync(path, "utf-8"));
        return data.profiles ?? null;
      }
    } catch {
      // Continue to next candidate
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
): LlmCallerConfig | null {
  const profiles = readAuthProfiles(stateDir, agentDir);
  const resolved = resolveApiKey(profiles ?? undefined, "anthropic");
  if (!resolved) return null;
  return { provider: resolved.provider, apiKey: resolved.apiKey };
}

/**
 * Create an EnrichFn for migration that uses direct LLM calls.
 */
function createDirectLlmEnrichFn(llmConfig: LlmCallerConfig): EnrichFn {
  return async (segments) => {
    const prompt = buildEnrichmentPrompt(segments);
    const response = await callLlm(prompt, llmConfig);
    return parseEnrichmentResponse(response);
  };
}

function jsonResult(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    details: payload,
  };
}

function resolveMemoryDir(config: AssociativeMemoryConfig, workspaceDir: string): string {
  const dbPath = config.dbPath;
  if (dbPath.startsWith("~")) {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
    return dbPath.replace("~", home);
  }
  if (dbPath.startsWith("/")) {
    return dbPath;
  }
  return join(workspaceDir, dbPath);
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
  if (providerId === "auto") {
    const adapters = listMemoryEmbeddingProviders()
      .filter((a) => typeof a.autoSelectPriority === "number")
      .toSorted((a, b) => (a.autoSelectPriority ?? Infinity) - (b.autoSelectPriority ?? Infinity));

    const errors: string[] = [];
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
        continue;
      }
    }
    // Fallback: when no adapters are registered (memory-core disabled),
    // try creating providers directly via SDK factory functions.
    if (adapters.length === 0) {
      const directProviders = [
        { id: "gemini", create: createGeminiEmbeddingProvider },
        { id: "openai", create: createOpenAiEmbeddingProvider },
      ];
      for (const dp of directProviders) {
        try {
          const result = await dp.create({
            config: openclawConfig,
            agentDir,
            model: model ?? "",
          });
          // Factory returns { provider, client } — extract the provider.
          const provider = result?.provider ?? result;
          if (provider?.embedQuery) return provider;
        } catch (err) {
          errors.push(`${dp.id} (direct): ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    throw new Error(
      `No embedding provider available (tried auto-selection).\n${errors.join("\n") || "No adapters registered."}`,
    );
  }

  // Try registry first, then fall back to direct factory creation.
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

  // Registry empty (memory-core disabled) — create directly via SDK factories.
  const factories: Record<string, (opts: any) => Promise<any>> = {
    openai: createOpenAiEmbeddingProvider,
    gemini: createGeminiEmbeddingProvider,
  };
  const factory = factories[providerId];
  if (!factory) {
    throw new Error(`Unknown embedding provider: "${providerId}"`);
  }
  const result = await factory({ config: openclawConfig, agentDir, model: model ?? "" });
  const provider = result?.provider ?? result;
  if (!provider?.embedQuery) {
    throw new Error(`Embedding provider "${providerId}" returned no usable provider`);
  }
  return provider;
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
 */
function createWorkspace(
  config: AssociativeMemoryConfig,
  workspaceDir: string,
  openclawConfig: OpenClawConfig,
  agentDir?: string,
  logger?: { warn: (...args: unknown[]) => void },
): ManagedWorkspace {
  const memoryDir = resolveMemoryDir(config, workspaceDir);
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

  return { manager: new MemoryManager(memoryDir, embedder), circuitBreaker, memoryDir };
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

  return [storeTool, searchTool, getTool, feedbackTool];
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

    // Single lazy workspace — created on first tool call, shared by all
    // consumers (tools, context engine, commands) within this registration.
    let workspace: ManagedWorkspace | null = null;

    const getWorkspace = (workspaceDir: string, agentDir?: string): ManagedWorkspace => {
      if (!workspace) {
        workspace = createWorkspace(config, workspaceDir, openclawConfig, agentDir, logger);
      }
      return workspace;
    };

    api.registerTool(
      (ctx) => {
        const workspaceDir = ctx.workspaceDir ?? ctx.agentDir ?? ".";
        const ws = getWorkspace(workspaceDir, ctx.agentDir);
        return createMemoryTools(
          () => ws.manager,
          () => join(ws.memoryDir, "retrieval.log"),
          ledger,
        );
      },
      { names: ["memory_store", "memory_search", "memory_get", "memory_feedback"] },
    );

    // Register system prompt section via the pluggable memory API (PR #40126)
    api.registerMemoryPromptSection(({ availableTools }) => {
      const hasStore = availableTools.has("memory_store");
      const hasSearch = availableTools.has("memory_search");
      const hasGet = availableTools.has("memory_get");
      const hasFeedback = availableTools.has("memory_feedback");

      if (!hasStore && !hasSearch && !hasGet) return [];

      const tools = [
        hasStore && "`memory_store` (save)",
        hasSearch && "`memory_search` (find)",
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

        // Resolve LLM for merge content production
        const llmConfig = resolveLlmConfig(undefined, undefined);
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

        const result = await runConsolidation({
          db: ws.manager.getDatabase(),
          workingPath: join(ws.memoryDir, "working.md"),
          consolidatedPath: join(ws.memoryDir, "consolidated.md"),
          mergeContentProducer,
        });

        const s = result.summary;
        return {
          text: `Memory consolidation complete (${result.durationMs}ms).\n` +
            `Reinforced: ${s.reinforced}, Decayed: ${s.decayed}, ` +
            `Pruned: ${s.pruned} memories + ${s.prunedAssociations} associations, ` +
            `Merged: ${s.merged}, Transitioned: ${s.transitioned}, ` +
            `Promoted: ${s.promoted}, Exposure GC: ${s.exposuresGc}`,
        };
      },
    });

    // -- Startup service: migration + workspace cleanup --

    api.registerService({
      id: "memory-associative-migration",
      async start(ctx) {
        const llmConfig = resolveLlmConfig(ctx.stateDir);
        const ws = getWorkspace(ctx.workspaceDir ?? ".");

        // 1. Workspace file cleanup (remove file-based memory instructions)
        if (llmConfig && ctx.workspaceDir) {
          try {
            const cleanupResult = await cleanupWorkspaceFiles({
              workspaceDir: ctx.workspaceDir,
              dbState: {
                get: (key) => ws.manager.getDatabase().getState(key),
                set: (key, value) => ws.manager.getDatabase().setState(key, value),
              },
              llm: (prompt) => callLlm(prompt, llmConfig),
              logger: ctx.logger,
            });
            if (cleanupResult.status === "cleaned") {
              ctx.logger.info(
                `Workspace cleanup: modified ${cleanupResult.filesModified?.join(", ")}`,
              );
            }
          } catch (err) {
            ctx.logger.warn(
              `Workspace cleanup failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }

        // 2. Memory-core migration (import old memories)
        if (ctx.workspaceDir) {
          try {
            const enrichFn: EnrichFn = llmConfig
              ? createDirectLlmEnrichFn(llmConfig)
              : async (segments) =>
                  segments.map((seg) => ({
                    id: seg.id,
                    type: seg.evergreen ? "fact" : "observation",
                    temporal_state: seg.date ? "past" : "none",
                    temporal_anchor: seg.date,
                  }));

            const migrationResult = await runMigration({
              workspaceDir: ctx.workspaceDir,
              stateDir: ctx.stateDir,
              store: (params) => ws.manager.store(params),
              dbState: {
                get: (key) => ws.manager.getDatabase().getState(key),
                set: (key, value) => ws.manager.getDatabase().setState(key, value),
              },
              enrich: enrichFn,
              logger: ctx.logger,
            });

            if (migrationResult.status === "completed") {
              ctx.logger.info(
                `Migration: imported ${migrationResult.segmentsImported} memories from ${migrationResult.filesFound} files`,
              );
            }
          } catch (err) {
            ctx.logger.warn(
              `Migration failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      },
    });
  },
};

export default associativeMemoryPlugin;

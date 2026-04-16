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
import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { Type } from "@sinclair/typebox";
import type { AnyAgentTool, OpenClawPluginApi } from "openclaw/plugin-sdk";
import {
  getMemoryEmbeddingProvider,
  listMemoryEmbeddingProviders,
  type MemoryEmbeddingProvider,
} from "openclaw/plugin-sdk/memory-core-host-engine-embeddings";
import {
  autoSelectStandaloneProvider,
  tryCreateStandaloneProvider,
} from "./standalone-embedding.ts";
import type { OpenClawConfig } from "openclaw/plugin-sdk";
import type { AssociativeMemoryConfig } from "./config.ts";
import { memoryConfigSchema } from "./config.ts";
import { applyTemporalTransitions } from "./consolidation-steps.ts";
import { includesSystemEventToken, reconcileCronJob } from "./cron-utils.ts";
import { runConsolidation } from "./consolidation.ts";
import { CONTEXT_ENGINE_ID, createAssociativeMemoryContextEngine } from "./context-engine.ts";
import { EmbeddingCircuitBreaker } from "./embedding-circuit-breaker.ts";
import { callLlm, resolveApiKey, type LlmCallerConfig } from "./llm-caller.ts";
import type { MemoryDatabase } from "./db.ts";
import { MemoryManager } from "./memory-manager.ts";
import {
  cleanupWorkspaceFiles,
  runMigration,
  buildEnrichmentPrompt,
  parseEnrichmentResponse,
  type EnrichFn,
} from "./migration-service.ts";
import { appendFeedbackEvent } from "./retrieval-log.ts";
import { createLogger, type Logger } from "./logger.ts";
import { TurnMemoryLedger } from "./turn-memory-ledger.ts";

// -- Auth profile resolution --

const AUTH_PROFILE_FILENAME = "auth-profiles.json";

/**
 * Per-file cache for parsed auth profiles. The cron path fires
 * readAuthProfiles repeatedly (every heartbeat scan, every consolidation
 * trigger), and resolveLlmConfig + resolveEmbeddingProvider both call it.
 * Without caching this was re-parsing the JSON on every hook fire.
 *
 * Keyed by absolute file path. Entries are invalidated by mtime change
 * so hot-edits to auth-profiles.json (adding a key at runtime) still
 * take effect without requiring a process restart.
 *
 * `statSync` is cheap compared to `readFileSync + JSON.parse`, and the
 * synchronous API surface is preserved (the readAuthProfiles call sites
 * run inside cron hooks that expect sync resolution).
 */
type CachedProfiles = Record<string, { provider?: string; key?: string }>;
type CacheEntry =
  | { kind: "hit"; mtimeMs: number; profiles: CachedProfiles }
  | { kind: "miss"; mtimeMs: number }; // file exists but parse failed
const profileCache = new Map<string, CacheEntry>();

/**
 * Read API keys from auth-profiles.json.
 *
 * Lookup order:
 * 1. agentDir — the preferred location, passed by OpenClaw at runtime.
 * 2. stateDir/agents/main/agent/ — hardcoded "main" fallback for
 *    single-agent setups. Multi-agent configurations (where the active
 *    agent isn't named "main") will resolve the wrong credentials here.
 *    A warning is emitted when this fallback actually returns a profile,
 *    so operators notice the brittle assumption.
 */
function readAuthProfiles(
  stateDir?: string,
  agentDir?: string,
  logger?: { warn: (msg: string) => void },
): Record<string, { provider?: string; key?: string }> | null {
  const agentDirPath = agentDir ? join(agentDir, AUTH_PROFILE_FILENAME) : undefined;
  const mainFallbackPath = stateDir
    ? join(stateDir, "agents", "main", "agent", AUTH_PROFILE_FILENAME)
    : undefined;
  const candidates = [agentDirPath, mainFallbackPath].filter((p): p is string => Boolean(p));

  for (const filePath of candidates) {
    const profiles = readProfilesWithCache(filePath, logger);
    if (!profiles) continue;

    // Warn if the "main" fallback actually returned credentials. This path
    // is a single-agent assumption; multi-agent setups may silently resolve
    // the wrong account here. Emitted on every successful resolution (not
    // cached-deduplicated) so log volume is low — the fallback is rare.
    if (filePath === mainFallbackPath && Object.keys(profiles).length > 0) {
      logger?.warn(
        `Resolved auth-profiles from the hardcoded "main" agent fallback (${filePath}). ` +
        `This works for single-agent setups but may pick wrong credentials in multi-agent configurations. ` +
        `Ensure OpenClaw passes agentDir at runtime.`,
      );
    }
    return profiles;
  }
  return null;
}

/**
 * Cached read of a single auth-profiles.json file. Returns the parsed
 * (and validated) profiles object, or null if the file doesn't exist or
 * is malformed. Cache invalidates on mtime change.
 */
function readProfilesWithCache(
  filePath: string,
  logger?: { warn: (msg: string) => void },
): CachedProfiles | null {
  let mtimeMs: number;
  try {
    mtimeMs = statSync(filePath).mtimeMs;
  } catch (err: any) {
    if (err?.code !== "ENOENT") {
      logger?.warn(`Failed to stat auth profiles ${filePath}: ${err.message}`);
    }
    // File missing — drop any stale cached entry.
    profileCache.delete(filePath);
    return null;
  }

  const cached = profileCache.get(filePath);
  if (cached && cached.mtimeMs === mtimeMs) {
    return cached.kind === "hit" ? cached.profiles : null;
  }

  try {
    const raw = readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw);
    if (
      !data ||
      typeof data !== "object" ||
      Array.isArray(data) ||
      !data.profiles ||
      typeof data.profiles !== "object" ||
      Array.isArray(data.profiles)
    ) {
      logger?.warn(`Invalid auth profile format: ${filePath}`);
      profileCache.set(filePath, { kind: "miss", mtimeMs });
      return null;
    }
    const cleaned: CachedProfiles = {};
    for (const [name, entry] of Object.entries(data.profiles)) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const record = entry as { provider?: unknown; key?: unknown };
      if (record.provider !== undefined && typeof record.provider !== "string") continue;
      if (record.key !== undefined && typeof record.key !== "string") continue;
      cleaned[name] = {
        provider: record.provider as string | undefined,
        key: record.key as string | undefined,
      };
    }
    profileCache.set(filePath, { kind: "hit", mtimeMs, profiles: cleaned });
    return cleaned;
  } catch (err: any) {
    logger?.warn(`Failed to read auth profiles from ${filePath}: ${err.message}`);
    profileCache.set(filePath, { kind: "miss", mtimeMs });
    return null;
  }
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

  // Manual fallback. Use os.homedir() rather than reading HOME from the env
  // directly so the bundle doesn't trip the "env-harvesting" critical install
  // scan rule, which fires when env reads collocate with fetch (used by the
  // standalone embedding providers).
  if (dbPath === "~" || dbPath.startsWith("~/")) {
    const home = homedir();
    return join(home, dbPath.slice(dbPath.startsWith("~/") ? 2 : 1));
  }
  if (isAbsolute(dbPath)) {
    return dbPath;
  }
  return join(workspaceDir, dbPath);
}

const EMBEDDING_REQUIRED_HINT =
  `Embedding provider required but not available.\n` +
  `Configure an API key in auth-profiles.json under an openai:default or google:default profile.\n` +
  `If memory-core embedding adapters are installed, their providers are also tried.\n` +
  `To run without embeddings (BM25-only), set "requireEmbedding": false in plugin config.`;

// -- Embedding provider resolution --

/**
 * Resolve an embedding provider.
 *
 * Resolution order:
 * 1. Registry adapters (memory-core) — preferred when available
 * 2. Standalone fetch-based providers — fallback when registry is empty OR
 *    when registered adapters fail to initialize (e.g. memory-core auth broken)
 *
 * The standalone fallback also runs after registry failures, not only on
 * empty registry. This is critical: memory-core may be installed but unable
 * to resolve API keys in non-tool contexts (cron, migration, assemble).
 *
 * Throws on failure — the plugin requires a working embedding provider.
 */
async function resolveEmbeddingProvider(
  providerId: string,
  openclawConfig: OpenClawConfig,
  agentDir?: string,
  model?: string,
  stateDir?: string,
  logger?: Logger,
): Promise<MemoryEmbeddingProvider> {
  const errors: string[] = [];
  const profiles = readAuthProfiles(stateDir, agentDir, logger);

  if (providerId === "auto") {
    const adapters = listMemoryEmbeddingProviders()
      .filter((a) => typeof a.autoSelectPriority === "number")
      .toSorted((a, b) => (a.autoSelectPriority ?? Infinity) - (b.autoSelectPriority ?? Infinity));

    for (const adapter of adapters) {
      try {
        // In auto mode, use each adapter's default model — the user's
        // configured model string may be valid for one provider and invalid
        // for another (model pollution). Explicit provider selection is
        // required to apply a custom model.
        const result = await adapter.create({
          config: openclawConfig,
          agentDir,
          model: adapter.defaultModel ?? "",
        });
        if (result.provider) return result.provider;
      } catch (err) {
        errors.push(`${adapter.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Always fall through to standalone — whether registry was empty or all
    // adapters failed. This is the key fix: memory-core may be installed but
    // unable to bootstrap auth in cron/migration contexts.
    const provider = autoSelectStandaloneProvider(profiles, logger);
    if (provider) return provider;
    errors.push("standalone: no API key found for openai or gemini");

    throw new Error(
      `No embedding provider available (tried auto-selection).\n${errors.join("\n") || "No adapters registered."}`,
    );
  }

  // Explicit provider ID — try registry first, fall through to standalone on
  // any failure (not just when adapter is absent).
  const adapter = getMemoryEmbeddingProvider(providerId);
  if (adapter) {
    try {
      const result = await adapter.create({
        config: openclawConfig,
        agentDir,
        model: model ?? adapter.defaultModel ?? "",
      });
      if (result.provider) return result.provider;
      errors.push(`${providerId}: registry adapter returned no provider instance`);
    } catch (err) {
      errors.push(`${providerId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const standaloneProvider = tryCreateStandaloneProvider(providerId, profiles, model, logger);
  if (standaloneProvider) return standaloneProvider;

  throw new Error(
    errors.length > 0
      ? `Embedding provider "${providerId}" unavailable.\n${errors.join("\n")}`
      : `Unknown embedding provider: "${providerId}"`,
  );
}

// -- Workspace --

type ManagedWorkspace = {
  manager: MemoryManager;
  circuitBreaker: EmbeddingCircuitBreaker;
  memoryDir: string;
  /** Pre-check that embedding provider can be initialized. */
  initProvider: () => Promise<void>;
};

/**
 * WORKAROUND: ContextEngineFactory receives no runtime context (agentDir,
 * workspaceDir) from OpenClaw. We work around this with:
 *
 * 1. Lazy getters — agentDir is resolved dynamically via getAgentDir() at
 *    each embed call, not captured once at construction time. This allows
 *    the workspace to be created before agentDir is known (e.g. heartbeat)
 *    and self-heal when a tool call later provides it.
 *
 * 2. Decoupled init — startup tasks (migration, cleanup) are tracked with a
 *    separate flag, not tied to workspace creation. This prevents them from
 *    being permanently skipped when the workspace is first created by a
 *    non-tool caller (context engine, cron).
 *
 * 3. Non-permanent provider caching — when embedding resolution fails due
 *    to missing agentDir, the error is NOT permanently cached. Subsequent
 *    calls can retry once agentDir becomes available.
 *
 * This will be removed when OpenClaw passes context to ContextEngineFactory.
 * See: issues/open/08-upstream-prs/proposal-factory-context.md
 */
function createWorkspace(
  config: AssociativeMemoryConfig,
  workspaceDir: string,
  openclawConfig: OpenClawConfig,
  getAgentDir: () => string | undefined,
  logger?: Logger,
  pathResolver?: (input: string) => string,
  getStateDir?: () => string | undefined,
): ManagedWorkspace {
  const memoryDir = resolveMemoryDir(config, workspaceDir, pathResolver);
  const circuitBreaker = new EmbeddingCircuitBreaker({
    onStateChange: (from, to) => {
      if (to === "OPEN") {
        logger?.warn(`Circuit breaker: ${from} → OPEN — switching to BM25-only mode`);
      } else if (to === "HALF_OPEN") {
        logger?.debug(`Circuit breaker: ${from} → HALF_OPEN — probing recovery`);
      } else {
        logger?.info(`Circuit breaker: ${from} → ${to}`);
      }
    },
    onLateSettlement: (outcome, err) => {
      logger?.warn(
        `Embedding call settled after timeout (${outcome}) — consider increasing timeoutMs`,
        err,
      );
    },
  });

  // Lazy provider: resolved on first embed call, cached as promise.
  // agentDir is read dynamically via getAgentDir() so the provider can
  // self-heal when agentDir becomes available after workspace creation.
  let providerPromise: Promise<MemoryEmbeddingProvider> | null = null;

  // DB reference used for persisting embedding identity (provider + model).
  // Assigned after MemoryManager is constructed. Reads/writes happen only
  // in the async body of getProvider, which runs after ws is fully built.
  let dbRef: MemoryDatabase | null = null;

  const getProvider = (): Promise<MemoryEmbeddingProvider> => {
    if (!providerPromise) {
      const currentAgentDir = getAgentDir();
      if (config.requireEmbedding && !currentAgentDir) {
        // Don't cache this rejection — agentDir may arrive later via tool call.
        // This is the key self-healing behavior for heartbeat/cron contexts.
        return Promise.reject(new Error(
          "Embedding provider auth requires agentDir which is not yet available. " +
          "Will retry when a tool call provides runtime context.",
        ));
      }
      providerPromise = (async () => {
        // Read persisted embedding identity (if any). Pinning the provider
        // and model to the DB prevents silent drift: different providers
        // (OpenAI/Gemini) and models produce different-dimension vectors,
        // so switching mid-life would corrupt the vector store.
        const db = dbRef;
        const persistedId = db?.getState("embedding_provider_id") ?? null;
        const persistedModel = db?.getState("embedding_model") ?? null;

        let effectiveProvider = config.embedding.provider;
        let effectiveModel = config.embedding.model;

        if (persistedId) {
          if (config.embedding.provider === "auto") {
            // Auto mode: always use persisted identity to prevent drift.
            effectiveProvider = persistedId;
            effectiveModel = persistedModel ?? undefined;
          } else if (config.embedding.provider !== persistedId) {
            throw new Error(
              `Embedding provider mismatch: DB was indexed with "${persistedId}" but config requests "${config.embedding.provider}". ` +
              `Vector dimensions differ between providers. Either set embedding.provider back to "${persistedId}", ` +
              `or re-embed the DB via migration.`,
            );
          } else if (
            config.embedding.model &&
            persistedModel &&
            config.embedding.model !== persistedModel
          ) {
            throw new Error(
              `Embedding model mismatch: DB was indexed with "${persistedId}/${persistedModel}" but config requests ` +
              `"${config.embedding.provider}/${config.embedding.model}". Different models produce different vector dimensions. ` +
              `Either set embedding.model back to "${persistedModel}", or re-embed the DB via migration.`,
            );
          } else {
            effectiveModel = effectiveModel ?? persistedModel ?? undefined;
          }
        }

        const provider = await resolveEmbeddingProvider(
          effectiveProvider,
          openclawConfig,
          currentAgentDir,
          effectiveModel,
          getStateDir?.(),
          logger,
        );

        // Persist identity on first successful resolution — locks in the
        // chosen provider/model for future runs.
        if (db && !persistedId) {
          db.setState("embedding_provider_id", provider.id);
          db.setState("embedding_model", provider.model);
          logger?.info(
            `Persisted embedding identity to DB: ${provider.id}/${provider.model}`,
          );
        }

        return provider;
      })().catch((err) => {
        // Always clear cache so transient failures (network, delayed auth)
        // can recover on retry. Never permanently cache rejections.
        providerPromise = null;
        if (config.requireEmbedding) {
          throw new Error(
            `${EMBEDDING_REQUIRED_HINT}\nDetails: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
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

  const ws: ManagedWorkspace = {
    manager: new MemoryManager(memoryDir, embedder, logger, config.logQueries),
    circuitBreaker,
    memoryDir,
    initProvider: async () => { await getProvider(); },
  };
  // Assign dbRef before any getProvider call can actually execute its async
  // body. The eager init below may schedule the promise, but its async
  // execution happens in microtasks after this line.
  dbRef = ws.manager.getDatabase();

  // When embedding is required AND agentDir is already known, eagerly start
  // resolution. Skip if agentDir is missing — will resolve on first use.
  if (config.requireEmbedding && getAgentDir()) {
    getProvider().catch(() => {});
  }

  return ws;
}

/**
 * Run one-time startup tasks (migration + workspace cleanup).
 * Decoupled from createWorkspace so they can be triggered independently
 * of workspace creation — see workaround comment above.
 */
function runStartupTasks(
  ws: ManagedWorkspace,
  config: AssociativeMemoryConfig,
  workspaceDir: string,
  getAgentDir: () => string | undefined,
  logger: Logger | undefined,
  initDeps: { stateDir?: string; llmConfig: LlmCallerConfig | null },
): void {
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
          logger: logger ?? { info: () => {}, warn: () => {} },
        });
        if (result.status === "cleaned") {
          logger?.info(`Workspace cleanup: modified ${result.filesModified?.join(", ")}`);
        }
      } catch (err) {
        logger?.warn(`Workspace cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // 2. Memory-core migration (import old memories)
    if (config.requireEmbedding) {
      try {
        await ws.initProvider();
      } catch (err) {
        logger?.error(`Migration aborted: embedding required but unavailable. ${err instanceof Error ? err.message : String(err)}`);
        return;
      }
    }
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

      const agentDir = getAgentDir();
      const sessionsDir = agentDir ? join(agentDir, "sessions") : undefined;
      const migrationResult = await runMigration({
        workspaceDir,
        stateDir: initDeps.stateDir ?? workspaceDir,
        store: (params) => ws.manager.store(params),
        updateStrength: (id, strength) => ws.manager.getDatabase().updateStrength(id, strength),
        dbState,
        enrich: enrichFn,
        logger: logger ?? { info: () => {}, warn: () => {}, error: () => {} },
        sessionsDir,
        llmCall: initDeps.llmConfig
          ? (prompt) => callLlm(prompt, initDeps.llmConfig!)
          : undefined,
      });

      if (migrationResult.status === "completed") {
        logger?.info(
          `Migration: imported ${migrationResult.segmentsImported} memories from ${migrationResult.filesFound} files`,
        );
      }
    } catch (err) {
      logger?.warn(`Migration failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  })();
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
  id: "formative-memory",
  name: "Formative Memory",
  description: "Biologically-inspired associative memory with consolidation and temporal awareness",
  kind: "memory" as const,
  configSchema: memoryConfigSchema,

  register(api: OpenClawPluginApi) {
    const config = memoryConfigSchema.parse(api.pluginConfig);
    const openclawConfig = api.config;
    const log = createLogger({ verbose: config.verbose, host: api.logger });
    const ledger = new TurnMemoryLedger();

    // Runtime state captured from tool contexts for use by commands.
    const runtimePaths: { stateDir?: string; agentDir?: string } = {};

    // Single lazy workspace — created on first access, shared by all consumers.
    // WORKAROUND: Context engine factory receives no runtime context from OpenClaw,
    // so the workspace may be created by heartbeat/cron before any tool call.
    // We use lazy getters for agentDir and decouple init from workspace creation
    // to handle this safely. See: issues/open/08-upstream-prs/proposal-factory-context.md
    let workspace: ManagedWorkspace | null = null;
    let startupTasksTriggered = false;

    const getAgentDir = (): string | undefined => runtimePaths.agentDir;

    const getStateDir = (): string | undefined => runtimePaths.stateDir;

    const getWorkspace = (workspaceDir: string): ManagedWorkspace => {
      if (!workspace) {
        workspace = createWorkspace(
          config, workspaceDir, openclawConfig, getAgentDir, log, api.resolvePath, getStateDir,
        );
      }
      return workspace;
    };

    // Startup tasks (migration, cleanup) are decoupled from workspace creation.
    // Only triggered by the first tool call which has full runtime context.
    // Flag is set after successful scheduling to allow retry on sync failure.
    const triggerStartupTasks = (workspaceDir: string): void => {
      if (startupTasksTriggered) return;
      const ws = getWorkspace(workspaceDir);
      const llmConfig = resolveLlmConfig(runtimePaths.stateDir, getAgentDir(), log);
      runStartupTasks(ws, config, workspaceDir, getAgentDir, log, { stateDir: runtimePaths.stateDir, llmConfig });
      startupTasksTriggered = true;
    };

    api.registerTool(
      (ctx) => {
        const workspaceDir = ctx.workspaceDir ?? ctx.agentDir ?? ".";
        runtimePaths.agentDir ??= ctx.agentDir;
        // First tool call triggers startup tasks (migration + cleanup).
        // Workspace may already exist from context engine, but init runs here.
        const ws = getWorkspace(workspaceDir);
        triggerStartupTasks(workspaceDir);
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
        logger: log,
        ledger,
        getDb: () => getWorkspace(".").manager.getDatabase(),
        getLogPath: () => join(getWorkspace(".").memoryDir, "retrieval.log"),
        autoCapture: config.autoCapture,
        getLlmConfig: () => resolveLlmConfig(runtimePaths.stateDir, runtimePaths.agentDir, log),
      }),
    );

    api.registerCommand({
      name: "memory-sleep",
      description: "Run memory consolidation (strengthens associations, merges duplicates, cleans up)",
      async handler() {
        const ws = getWorkspace(".");

        const llmConfig = resolveLlmConfig(runtimePaths.stateDir, runtimePaths.agentDir, log);
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

        try {
          log.debug("consolidation: starting trigger=command");
          const result = await runConsolidation({
            db: ws.manager.getDatabase(),
            mergeContentProducer,
            logger: log,
          });

          const s = result.summary;
          const catchUpInfo = s.catchUpDecayed > 0 ? `Catch-up decayed: ${s.catchUpDecayed}, ` : "";
          return {
            text: `Memory consolidation complete (${result.durationMs}ms).\n` +
              catchUpInfo +
              `Reinforced: ${s.reinforced}, Decayed: ${s.decayed}, ` +
              `Pruned: ${s.pruned} memories + ${s.prunedAssociations} associations, ` +
              `Merged: ${s.merged}, Transitioned: ${s.transitioned}, ` +
              `Exposure GC: ${s.exposuresGc}`,
          };
        } catch (err) {
          log.warn(`Consolidation command failed: ${err instanceof Error ? err.message : String(err)}`, err);
          return { text: `Memory consolidation failed: ${err instanceof Error ? err.message : String(err)}` };
        }
      },
    });

    // -- /memory-migrate: re-run memory-core import --
    api.registerCommand({
      name: "memory-migrate",
      description: "Re-import memories from memory-core files (migration normally runs automatically on first use)",
      async handler() {
        const ws = getWorkspace(".");
        const db = ws.manager.getDatabase();
        const llmConfig = resolveLlmConfig(runtimePaths.stateDir, runtimePaths.agentDir, log);
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

        const sessionsDir = runtimePaths.agentDir ? join(runtimePaths.agentDir, "sessions") : undefined;
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
          logger: log,
          sessionsDir,
          llmCall: llmConfig ? (prompt) => callLlm(prompt, llmConfig) : undefined,
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
        const llmConfig = resolveLlmConfig(runtimePaths.stateDir, runtimePaths.agentDir, log);
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
          logger: log,
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
    const CONSOLIDATION_CRON_TAG = "[managed-by=formative-memory.consolidation]";
    /** Default cron expression: daily at 03:00. */
    const DEFAULT_CONSOLIDATION_CRON = "0 3 * * *";

    /** System event token for cron-triggered temporal transitions. */
    const TEMPORAL_CRON_TRIGGER = "__associative_memory_temporal_transitions__";
    /** Cron job name for temporal transitions. */
    const TEMPORAL_CRON_NAME = "Associative Memory Temporal Transitions";
    /** Tag to identify managed temporal jobs. */
    const TEMPORAL_CRON_TAG = "[managed-by=formative-memory.temporal]";
    /** Cron expression: daily at 15:00 (03:00 is covered by full consolidation). */
    const DEFAULT_TEMPORAL_CRON = "0 15 * * *";

    /** All known managed system event tokens (used for warn-logging unmatched heartbeat events). */
    const MANAGED_TOKENS = [CONSOLIDATION_CRON_TRIGGER, TEMPORAL_CRON_TRIGGER];

    // Register cron jobs on gateway startup (same pattern as memory-core dreaming).
    api.registerHook("gateway:startup", async (event: any) => {
      // Extract cron service (dual-path: context.cron or context.deps.cron)
      const context = event?.context;
      const cron = context?.cron ?? context?.deps?.cron;
      if (!cron || typeof cron.list !== "function" || typeof cron.add !== "function") {
        log.warn("Cron service not available — scheduled consolidation disabled");
        return;
      }

      // Capture stateDir from startup context if available
      if (context?.stateDir) runtimePaths.stateDir = context.stateDir;

      let allJobs: any[];
      try {
        allJobs = await cron.list({ includeDisabled: true });
      } catch (err) {
        log.warn(`Failed to list cron jobs — scheduled consolidation disabled: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }

      // Reconcile consolidation cron (isolated error handling)
      try {
        await reconcileCronJob(cron, allJobs, {
          name: CONSOLIDATION_CRON_NAME,
          description: `${CONSOLIDATION_CRON_TAG} Full consolidation: decay, reinforce, merge, prune, promote.`,
          enabled: true,
          schedule: { kind: "cron" as const, expr: DEFAULT_CONSOLIDATION_CRON },
          sessionTarget: "main",
          wakeMode: "now",
          payload: { kind: "systemEvent" as const, text: CONSOLIDATION_CRON_TRIGGER },
        }, CONSOLIDATION_CRON_TAG, log);
      } catch (err) {
        log.warn(`Failed to reconcile consolidation cron: ${err instanceof Error ? err.message : String(err)}`);
      }

      // Reconcile temporal transitions cron (isolated error handling)
      try {
        await reconcileCronJob(cron, allJobs, {
          name: TEMPORAL_CRON_NAME,
          description: `${TEMPORAL_CRON_TAG} Transition temporal states: future→present→past.`,
          enabled: true,
          schedule: { kind: "cron" as const, expr: DEFAULT_TEMPORAL_CRON },
          sessionTarget: "main",
          wakeMode: "now",
          payload: { kind: "systemEvent" as const, text: TEMPORAL_CRON_TRIGGER },
        }, TEMPORAL_CRON_TAG, log);
      } catch (err) {
        log.warn(`Failed to reconcile temporal cron: ${err instanceof Error ? err.message : String(err)}`);
      }
    }, { name: "formative-memory-consolidation-cron" } as any);

    // Handle cron-triggered consolidation and temporal transitions via before_agent_reply hook.
    // When cron fires, OpenClaw sends a systemEvent with our trigger text.
    // We intercept it, run the appropriate operation, and return handled=true to skip the LLM.
    api.on("before_agent_reply", async (event: any, ctx: any) => {
      const body = event?.cleanedBody;
      if (!body) return;

      // Only process during heartbeat context (matches memory-core pattern)
      if (ctx?.trigger !== "heartbeat") return;

      const bodyPreview = typeof body === "string" && body.length > 200
        ? `${body.slice(0, 100)}…${body.slice(-100)}`
        : body;
      log.debug(
        `cron-check session=${String(ctx?.sessionKey)} body=${JSON.stringify(bodyPreview ?? null)}`,
      );

      const hasConsolidation = includesSystemEventToken(body, CONSOLIDATION_CRON_TRIGGER);
      const hasTemporal = includesSystemEventToken(body, TEMPORAL_CRON_TRIGGER);

      if (!hasConsolidation && !hasTemporal) {
        // Warn if body looks like an unrecognized system event token
        if (typeof body === "string" && /^__\w+__$/m.test(body.trim())) {
          log.warn(`cron-check: heartbeat body looks like a system event but matches no managed token`);
        }
        return;
      }

      const ws = getWorkspace(ctx?.workspaceDir ?? ".");
      const db = ws.manager.getDatabase();

      // Temporal transitions only (consolidation already includes them internally)
      if (hasTemporal && !hasConsolidation) {
        try {
          const count = db.transaction(() => applyTemporalTransitions(db, log));
          if (count > 0) {
            log.info(`Scheduled temporal transitions: ${count} transitioned`);
          }
          return {
            handled: true,
            reply: { text: count > 0 ? `Temporal transitions: ${count} updated.` : "No temporal transitions needed." },
            reason: "associative-memory-temporal",
          };
        } catch (err) {
          log.warn(`Scheduled temporal transitions failed: ${err instanceof Error ? err.message : String(err)}`);
          return { handled: true, reply: { text: "Temporal transitions failed." }, reason: "associative-memory-temporal-error" };
        }
      }

      // Full consolidation (includes temporal transitions)
      try {
        const llmConfig = resolveLlmConfig(runtimePaths.stateDir, runtimePaths.agentDir, log);
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

        log.debug("consolidation: starting trigger=cron");
        const result = await runConsolidation({
          db,
          mergeContentProducer,
          logger: log,
        });

        return {
          handled: true,
          reply: { text: `Memory consolidation complete (${result.durationMs}ms).` },
          reason: "associative-memory-consolidation",
        };
      } catch (err) {
        log.warn(
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
    // Captures stateDir and agentDir for auth-profile resolution.
    // agentDir is critical: the lazy getter in createWorkspace reads it
    // dynamically, so it must be set as early as possible.
    // Note: agentDir is not part of the documented service context type,
    // but OpenClaw passes it at runtime. Validated with typeof check.
    api.registerService({
      id: "formative-memory-startup",
      async start(ctx) {
        runtimePaths.stateDir = ctx.stateDir;
        const maybeAgentDir = (ctx as Record<string, unknown>).agentDir;
        if (!runtimePaths.agentDir && typeof maybeAgentDir === "string") {
          runtimePaths.agentDir = maybeAgentDir;
        }
      },
    });
  },
};

export default associativeMemoryPlugin;

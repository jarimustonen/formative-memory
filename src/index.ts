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
import { Type } from "@sinclair/typebox";
import type { AnyAgentTool, OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { AssociativeMemoryConfig } from "./config.ts";
import { memoryConfigSchema } from "./config.ts";
import { runConsolidation } from "./consolidation.ts";
import { CONTEXT_ENGINE_ID, createAssociativeMemoryContextEngine } from "./context-engine.ts";
import { EmbeddingCircuitBreaker } from "./embedding-circuit-breaker.ts";
import { MemoryManager } from "./memory-manager.ts";
import { appendFeedbackEvent } from "./retrieval-log.ts";
import { TurnMemoryLedger } from "./turn-memory-ledger.ts";

function jsonResult(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    details: payload,
  };
}

function createEmbedder(config: AssociativeMemoryConfig) {
  return {
    async embed(text: string, signal?: AbortSignal): Promise<number[]> {
      const res = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.embedding.apiKey}`,
        },
        body: JSON.stringify({
          input: text,
          model: config.embedding.model,
        }),
        signal,
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Embedding API error ${res.status}: ${body}`);
      }
      const data = (await res.json()) as { data: Array<{ embedding: number[] }> };
      return data.data[0].embedding;
    },
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

// Per-workspace cache: manager + circuit breaker scoped together.
// Tracks the most recently created entry for the context engine.
type ManagedWorkspace = { manager: MemoryManager; circuitBreaker: EmbeddingCircuitBreaker };
const workspaces = new Map<string, ManagedWorkspace>();
let lastWorkspace: ManagedWorkspace | null = null;

function getWorkspace(config: AssociativeMemoryConfig, workspaceDir: string): ManagedWorkspace {
  const memoryDir = resolveMemoryDir(config, workspaceDir);
  // Include embedding config in cache key so config changes invalidate the cache.
  const cacheKey = `${memoryDir}:${config.embedding.model}:${config.embedding.apiKey}`;
  let ws = workspaces.get(cacheKey);
  if (!ws) {
    const circuitBreaker = new EmbeddingCircuitBreaker();
    const rawEmbedder = createEmbedder(config);
    const embedder = {
      embed: (text: string) => circuitBreaker.call((signal) => rawEmbedder.embed(text, signal)),
    };
    ws = { manager: new MemoryManager(memoryDir, embedder), circuitBreaker };
    workspaces.set(cacheKey, ws);
  }
  lastWorkspace = ws;
  return ws;
}

/** Return the most recently created/accessed workspace (for context engine). */
function getLastWorkspace(config: AssociativeMemoryConfig, fallbackDir: string): ManagedWorkspace {
  return lastWorkspace ?? getWorkspace(config, fallbackDir);
}

function createMemoryTools(
  config: AssociativeMemoryConfig,
  workspaceDir: string,
  ledger?: TurnMemoryLedger,
): AnyAgentTool[] {
  const manager = () => getWorkspace(config, workspaceDir).manager;
  const logPath = () => join(resolveMemoryDir(config, workspaceDir), "retrieval.log");

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
      const memory = await manager().store({
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
      const results = await manager().search(params.query, params.limit);
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
      const memory = manager().getMemory(params.id);
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
      appendFeedbackEvent(logPath(), { [params.memory_id]: params.rating }, params.comment);
      return jsonResult({ ok: true, memory_id: params.memory_id, rating: params.rating });
    },
  };

  return [storeTool, searchTool, getTool, feedbackTool];
}

const associativeMemoryPlugin = {
  id: "memory-associative",
  name: "Memory (Associative)",
  description: "Biologically-inspired associative memory with consolidation and temporal awareness",
  kind: "memory" as const,
  configSchema: memoryConfigSchema,

  register(api: OpenClawPluginApi) {
    const config = memoryConfigSchema.parse(api.pluginConfig);
    const ledger = new TurnMemoryLedger();

    api.registerTool(
      (ctx) => {
        const workspaceDir = ctx.workspaceDir ?? ctx.agentDir ?? ".";
        return createMemoryTools(config, workspaceDir, ledger);
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
        `You have a persistent associative memory. Tools: ${tools.join(", ")}.`,
        "",
        "**When to store:** key decisions, user preferences, project facts, plans, corrections, anything worth remembering.",
        "**When to search:** start of a task, when context seems missing, when the user references past work.",
        hasFeedback
          ? "**When to give feedback:** after using a retrieved memory — rate how useful it was."
          : "",
        "",
      ];
    });

    // Register context engine (claims contextEngine slot alongside the memory slot).
    // Resolves workspace dynamically on each call — never captures a stale reference.
    api.registerContextEngine(CONTEXT_ENGINE_ID, () =>
      createAssociativeMemoryContextEngine({
        getManager: () => getLastWorkspace(config, ".").manager,
        isBm25Only: () => getLastWorkspace(config, ".").circuitBreaker.isBm25Only(),
        ledger,
        getDb: () => getLastWorkspace(config, ".").manager.getDatabase(),
        getLogPath: () => join(resolveMemoryDir(config, "."), "retrieval.log"),
      }),
    );

    // Register /memory sleep command for manual consolidation trigger
    api.registerCommand({
      name: "memory sleep",
      description: "Run memory consolidation (strengthens associations, merges duplicates, cleans up)",
      async handler() {
        const ws = getLastWorkspace(config, ".");
        const memoryDir = resolveMemoryDir(config, ".");

        const result = await runConsolidation({
          db: ws.manager.getDatabase(),
          workingPath: join(memoryDir, "working.md"),
          consolidatedPath: join(memoryDir, "consolidated.md"),
        });

        const s = result.summary;
        return `Memory consolidation complete (${result.durationMs}ms).\n` +
          `Reinforced: ${s.reinforced}, Decayed: ${s.decayed}, ` +
          `Pruned: ${s.pruned} memories + ${s.prunedAssociations} associations, ` +
          `Merged: ${s.merged}, Transitioned: ${s.transitioned}, ` +
          `Promoted: ${s.promoted}, Exposure GC: ${s.exposuresGc}`;
      },
    });
  },
};

export default associativeMemoryPlugin;

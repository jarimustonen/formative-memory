/**
 * Standalone fetch-based embedding providers.
 *
 * Uses OpenClaw SDK's resolveApiKeyForProvider for credential resolution.
 * Removes the dependency on memory-core's internal auth wiring — works
 * in all contexts (assemble, cron, migration) without requiring a
 * tool-call bootstrap.
 */

import type { MemoryEmbeddingProvider } from "openclaw/plugin-sdk/memory-core-host-engine-embeddings";
import { resolveApiKeyForProvider } from "openclaw/plugin-sdk/provider-auth-runtime";
import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { fetchWithTimeout } from "./http.ts";

// -- Types --

type EmbeddingProviderName = "openai" | "gemini";

type Logger = { warn: (msg: string) => void };

// -- API key resolution --

/**
 * Resolve an API key for an embedding provider via the OpenClaw SDK.
 *
 * Delegates to the SDK's resolveApiKeyForProvider which handles auth
 * profiles, env vars, profile precedence, cooldowns, and multi-agent
 * resolution internally.
 */
async function resolveEmbeddingApiKey(
  cfg: OpenClawConfig,
  provider: EmbeddingProviderName,
  agentDir?: string,
): Promise<string | null> {
  try {
    const sdkProvider = provider === "gemini" ? "google" : provider;
    const auth = await resolveApiKeyForProvider({ provider: sdkProvider, cfg, agentDir });
    return auth.apiKey ?? null;
  } catch {
    // SDK throws when no credentials are found — return null to let
    // callers handle the missing-key case uniformly.
    return null;
  }
}

// -- Response validation helpers --

/**
 * Validate that a value is an array of numbers, throwing a clear error if not.
 * Used to catch malformed API responses early (e.g. proxy error pages returning
 * 200, rate-limit bodies in a 200 response, schema changes by the provider).
 */
function assertNumberArray(value: unknown, context: string): number[] {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid embedding response: ${context} is not an array`);
  }
  for (let i = 0; i < value.length; i++) {
    if (typeof value[i] !== "number") {
      throw new Error(`Invalid embedding response: ${context}[${i}] is not a number`);
    }
  }
  return value as number[];
}

// -- OpenAI embedding provider --

const OPENAI_DEFAULT_MODEL = "text-embedding-3-small";
const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";

async function openAiEmbed(
  texts: string[],
  apiKey: string,
  model: string,
  timeoutMs: number,
): Promise<number[][]> {
  if (texts.length === 0) return [];

  const response = await fetchWithTimeout(
    OPENAI_EMBEDDINGS_URL,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, input: texts }),
    },
    timeoutMs,
    "OpenAI Embeddings API call",
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`OpenAI Embeddings API error ${response.status}: ${body.slice(0, 200)}`);
  }

  // Expected shape: { data: [{ embedding: number[], index: number }, ...] }
  const data = await response.json();
  if (!data || !Array.isArray(data.data)) {
    throw new Error(
      `OpenAI Embeddings API returned invalid response: missing "data" array`,
    );
  }

  const items = data.data.map((item: unknown, i: number) => {
    if (!item || typeof item !== "object") {
      throw new Error(`OpenAI Embeddings API returned invalid item at index ${i}`);
    }
    const record = item as { embedding?: unknown; index?: unknown };
    if (typeof record.index !== "number") {
      throw new Error(
        `OpenAI Embeddings API returned invalid item at index ${i}: missing numeric "index"`,
      );
    }
    return {
      index: record.index,
      embedding: assertNumberArray(record.embedding, `data[${i}].embedding`),
    };
  });

  items.sort((a: { index: number }, b: { index: number }) => a.index - b.index);
  return items.map((item: { embedding: number[] }) => item.embedding);
}

function createOpenAiProvider(apiKey: string, model?: string): MemoryEmbeddingProvider {
  const resolvedModel = model || OPENAI_DEFAULT_MODEL;
  return {
    id: "openai",
    model: resolvedModel,
    async embedQuery(text: string): Promise<number[]> {
      const [result] = await openAiEmbed([text], apiKey, resolvedModel, 30_000);
      return result;
    },
    async embedBatch(texts: string[]): Promise<number[][]> {
      return openAiEmbed(texts, apiKey, resolvedModel, 60_000);
    },
  };
}

// -- Gemini embedding provider --

const GEMINI_DEFAULT_MODEL = "text-embedding-004";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
/** Gemini's batchEmbedContents endpoint enforces a hard limit of 100 items per request. */
const GEMINI_BATCH_LIMIT = 100;

/**
 * Gemini auth goes in the `x-goog-api-key` header, not the URL query string.
 * Keys in URLs leak into proxy logs, APM traces, and error reports.
 */
function geminiHeaders(apiKey: string): HeadersInit {
  return {
    "Content-Type": "application/json",
    "x-goog-api-key": apiKey,
  };
}

async function geminiEmbedSingle(
  text: string,
  apiKey: string,
  model: string,
  timeoutMs: number,
): Promise<number[]> {
  const url = `${GEMINI_BASE_URL}/${encodeURIComponent(model)}:embedContent`;
  const response = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: geminiHeaders(apiKey),
      body: JSON.stringify({
        model: `models/${model}`,
        content: { parts: [{ text }] },
      }),
    },
    timeoutMs,
    "Gemini embedContent call",
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Gemini Embeddings API error ${response.status}: ${body.slice(0, 200)}`);
  }

  // Expected shape: { embedding: { values: number[] } }
  const data = await response.json();
  if (!data || !data.embedding || typeof data.embedding !== "object") {
    throw new Error(
      `Gemini Embeddings API returned invalid response: missing "embedding" object`,
    );
  }
  return assertNumberArray(
    (data.embedding as { values?: unknown }).values,
    "embedding.values",
  );
}

async function geminiEmbedBatchChunk(
  texts: string[],
  apiKey: string,
  model: string,
  timeoutMs: number,
): Promise<number[][]> {
  const url = `${GEMINI_BASE_URL}/${encodeURIComponent(model)}:batchEmbedContents`;
  const response = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: geminiHeaders(apiKey),
      body: JSON.stringify({
        requests: texts.map((text) => ({
          model: `models/${model}`,
          content: { parts: [{ text }] },
        })),
      }),
    },
    timeoutMs,
    "Gemini batchEmbedContents call",
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Gemini Embeddings API error ${response.status}: ${body.slice(0, 200)}`);
  }

  // Expected shape: { embeddings: [{ values: number[] }, ...] }
  const data = await response.json();
  if (!data || !Array.isArray(data.embeddings)) {
    throw new Error(
      `Gemini Embeddings API returned invalid response: missing "embeddings" array`,
    );
  }
  return data.embeddings.map((e: unknown, i: number) => {
    if (!e || typeof e !== "object") {
      throw new Error(`Gemini Embeddings API returned invalid item at index ${i}`);
    }
    return assertNumberArray(
      (e as { values?: unknown }).values,
      `embeddings[${i}].values`,
    );
  });
}

async function geminiEmbed(
  texts: string[],
  apiKey: string,
  model: string,
  timeoutMs: number,
): Promise<number[][]> {
  if (texts.length === 0) return [];

  if (texts.length === 1) {
    const result = await geminiEmbedSingle(texts[0], apiKey, model, timeoutMs);
    return [result];
  }

  // Chunk to the API's 100-item batch limit. Exceeding it returns 400.
  const results: number[][] = [];
  for (let i = 0; i < texts.length; i += GEMINI_BATCH_LIMIT) {
    const chunk = texts.slice(i, i + GEMINI_BATCH_LIMIT);
    const chunkResults = await geminiEmbedBatchChunk(chunk, apiKey, model, timeoutMs);
    results.push(...chunkResults);
  }
  return results;
}

/**
 * Strip a `gemini:` provider prefix if present.
 *
 * Upstream OpenClaw v2026.4.14 (#66452) preserves non-OpenAI provider prefixes
 * during model-ref normalization, so users who configure
 * `embedding.model: "gemini:text-embedding-004"` (the canonical post-fix form)
 * would pass that string through to our standalone Gemini fallback unchanged.
 * The Gemini API expects bare model names (`text-embedding-004`); a prefixed
 * value would produce a 404. Strip defensively so the standalone path stays
 * compatible with both shapes.
 */
function stripGeminiPrefix(model: string): string {
  return model.startsWith("gemini:") ? model.slice("gemini:".length) : model;
}

function createGeminiProvider(apiKey: string, model?: string): MemoryEmbeddingProvider {
  const resolvedModel = stripGeminiPrefix(model || GEMINI_DEFAULT_MODEL);
  return {
    id: "gemini",
    model: resolvedModel,
    async embedQuery(text: string): Promise<number[]> {
      const [result] = await geminiEmbed([text], apiKey, resolvedModel, 30_000);
      return result;
    },
    async embedBatch(texts: string[]): Promise<number[][]> {
      return geminiEmbed(texts, apiKey, resolvedModel, 60_000);
    },
  };
}

// -- Main entry point --

/**
 * Try to create a standalone embedding provider for the given provider ID.
 *
 * Uses the OpenClaw SDK for credential resolution (auth profiles, env
 * vars, profile precedence). Returns null if no API key is found.
 */
export async function tryCreateStandaloneProvider(
  providerId: string,
  cfg: OpenClawConfig,
  agentDir?: string,
  model?: string,
  logger?: Logger,
): Promise<MemoryEmbeddingProvider | null> {
  if (providerId !== "openai" && providerId !== "gemini") return null;

  const apiKey = await resolveEmbeddingApiKey(cfg, providerId, agentDir);
  if (!apiKey) {
    logger?.warn(`Standalone embedding: no API key found for ${providerId}`);
    return null;
  }

  if (providerId === "openai") {
    return createOpenAiProvider(apiKey, model);
  }
  return createGeminiProvider(apiKey, model);
}

/**
 * Auto-select a standalone embedding provider by trying each in priority order.
 * Returns the first provider for which an API key is available.
 *
 * Intentionally does NOT accept a `model` parameter: the user's configured
 * model string may be valid for one provider and invalid for another
 * (e.g. "text-embedding-3-small" for OpenAI vs. "text-embedding-004" for
 * Gemini). Each provider uses its own default model. Callers wanting a
 * specific model must use explicit provider selection.
 *
 * Priority order: OpenAI first, then Gemini. OpenAI is the common
 * default from the memory-core era (1536-dim vectors); defaulting to
 * Gemini (768-dim) would silently break existing vector stores.
 * Provider identity is persisted to DB state on first successful
 * resolution to prevent future drift (see createWorkspace).
 *
 * Probing is silent — missing API keys for individual providers are not
 * warned about here because at least one is expected to succeed. The
 * caller warns only if the entire auto-select returns null.
 */
export async function autoSelectStandaloneProvider(
  cfg: OpenClawConfig,
  agentDir?: string,
  logger?: Logger,
): Promise<MemoryEmbeddingProvider | null> {
  for (const id of ["openai", "gemini"] as const) {
    const apiKey = await resolveEmbeddingApiKey(cfg, id, agentDir);
    if (!apiKey) continue;
    return id === "openai" ? createOpenAiProvider(apiKey) : createGeminiProvider(apiKey);
  }
  logger?.warn(
    `Standalone embedding auto-select: no API key found for openai or gemini`,
  );
  return null;
}

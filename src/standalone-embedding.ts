/**
 * Standalone fetch-based embedding providers.
 *
 * Reads API keys directly from auth-profiles.json (via readAuthProfiles)
 * or falls back to environment variables. Removes the dependency on
 * memory-core's internal auth wiring — works in all contexts (assemble,
 * cron, migration) without requiring a tool-call bootstrap.
 */

import type { MemoryEmbeddingProvider } from "openclaw/plugin-sdk/memory-core-host-engine-embeddings";

// -- Types --

type EmbeddingProviderName = "openai" | "gemini";

type AuthProfiles = Record<string, { provider?: string; key?: string }> | null;

type Logger = { warn: (msg: string) => void };

// -- API key resolution --

/**
 * Resolve an API key for an embedding provider from auth profiles.
 *
 * Matching strategy (first match wins):
 * 1. Profile key prefix: "openai:*" for openai, "google:*" for gemini
 * 2. Profile value `provider` field: "openai" or "google"
 * 3. Environment variable fallback: OPENAI_API_KEY or GEMINI_API_KEY / GOOGLE_API_KEY
 */
export function resolveEmbeddingApiKey(
  profiles: AuthProfiles,
  provider: EmbeddingProviderName,
): string | null {
  const keyPrefix = provider === "gemini" ? "google:" : "openai:";
  const providerField = provider === "gemini" ? "google" : "openai";

  if (profiles) {
    // Match by key prefix first (most explicit)
    for (const [key, value] of Object.entries(profiles)) {
      if (key.startsWith(keyPrefix) && value?.key) {
        return value.key;
      }
    }
    // Match by provider field
    for (const value of Object.values(profiles)) {
      if (value?.provider === providerField && value?.key) {
        return value.key;
      }
    }
  }

  // Environment variable fallback
  if (provider === "openai") {
    return process.env.OPENAI_API_KEY ?? null;
  }
  return process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? null;
}

// -- Fetch helpers --

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`Embedding API call timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
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

function createGeminiProvider(apiKey: string, model?: string): MemoryEmbeddingProvider {
  const resolvedModel = model || GEMINI_DEFAULT_MODEL;
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
 * Resolution order:
 * 1. Auth profiles (auth-profiles.json) — matched by key prefix or provider field
 * 2. Environment variables (OPENAI_API_KEY, GEMINI_API_KEY, GOOGLE_API_KEY)
 *
 * Returns null if no API key is found (does not throw).
 */
export function tryCreateStandaloneProvider(
  providerId: string,
  profiles: AuthProfiles,
  model?: string,
  logger?: Logger,
): MemoryEmbeddingProvider | null {
  if (providerId !== "openai" && providerId !== "gemini") return null;

  const apiKey = resolveEmbeddingApiKey(profiles, providerId);
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
export function autoSelectStandaloneProvider(
  profiles: AuthProfiles,
  logger?: Logger,
): MemoryEmbeddingProvider | null {
  for (const id of ["openai", "gemini"] as const) {
    // Pass undefined logger to suppress per-provider "no key" warnings.
    const provider = tryCreateStandaloneProvider(id, profiles, undefined, undefined);
    if (provider) return provider;
  }
  logger?.warn(
    `Standalone embedding auto-select: no API key found for openai or gemini`,
  );
  return null;
}

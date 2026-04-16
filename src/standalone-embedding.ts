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

// -- OpenAI embedding provider --

const OPENAI_DEFAULT_MODEL = "text-embedding-3-small";
const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";

async function openAiEmbed(
  texts: string[],
  apiKey: string,
  model: string,
  timeoutMs: number,
): Promise<number[][]> {
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

  const data = await response.json();
  // Response: { data: [{ embedding: number[], index: number }, ...] }
  const sorted = (data.data as { embedding: number[]; index: number }[])
    .sort((a, b) => a.index - b.index);
  return sorted.map((d) => d.embedding);
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

async function geminiEmbed(
  texts: string[],
  apiKey: string,
  model: string,
  timeoutMs: number,
): Promise<number[][]> {
  if (texts.length === 1) {
    // Single text — use embedContent
    const url = `${GEMINI_BASE_URL}/${model}:embedContent?key=${apiKey}`;
    const response = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: `models/${model}`,
          content: { parts: [{ text: texts[0] }] },
        }),
      },
      timeoutMs,
    );

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Gemini Embeddings API error ${response.status}: ${body.slice(0, 200)}`);
    }

    const data = await response.json();
    return [data.embedding.values];
  }

  // Batch — use batchEmbedContents
  const url = `${GEMINI_BASE_URL}/${model}:batchEmbedContents?key=${apiKey}`;
  const response = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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

  const data = await response.json();
  return (data.embeddings as { values: number[] }[]).map((e) => e.values);
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
 */
export function autoSelectStandaloneProvider(
  profiles: AuthProfiles,
  model?: string,
  logger?: Logger,
): MemoryEmbeddingProvider | null {
  // Prefer Gemini (free tier available), then OpenAI
  for (const id of ["gemini", "openai"] as const) {
    const provider = tryCreateStandaloneProvider(id, profiles, model, logger);
    if (provider) return provider;
  }
  return null;
}

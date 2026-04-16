/**
 * Lightweight LLM caller for plugin-internal tasks.
 *
 * Direct fetch to Anthropic or OpenAI API. Used for:
 * - Memory merge (consolidation)
 * - Migration enrichment
 * - Workspace file cleanup
 *
 * Not exposed to the agent — these are background operations.
 */

import { fetchWithTimeout } from "./http.ts";

// -- Types --

export type LlmProvider = "anthropic" | "openai";

export type LlmCallerConfig = {
  provider: LlmProvider;
  apiKey: string;
  model?: string;
  maxTokens?: number;
  timeoutMs?: number;
};

const DEFAULTS = {
  anthropic: { model: "claude-haiku-4-5-20251001", maxTokens: 2048 },
  openai: { model: "gpt-4o-mini", maxTokens: 2048 },
} as const;

// -- Main --

/**
 * Call an LLM with a simple prompt → text response.
 * Throws on failure (network, auth, rate limit, timeout).
 */
export async function callLlm(prompt: string, config: LlmCallerConfig): Promise<string> {
  const { provider, apiKey } = config;
  const model = config.model ?? DEFAULTS[provider].model;
  const maxTokens = config.maxTokens ?? DEFAULTS[provider].maxTokens;
  const timeoutMs = config.timeoutMs ?? 30_000;

  if (provider === "anthropic") {
    return callAnthropic(prompt, apiKey, model, maxTokens, timeoutMs);
  }
  return callOpenAi(prompt, apiKey, model, maxTokens, timeoutMs);
}

// -- Anthropic --

async function callAnthropic(
  prompt: string,
  apiKey: string,
  model: string,
  maxTokens: number,
  timeoutMs: number,
): Promise<string> {
  const response = await fetchWithTimeout(
    "https://api.anthropic.com/v1/messages",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages: [{ role: "user", content: prompt }],
      }),
    },
    timeoutMs,
    "Anthropic LLM call",
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Anthropic API error ${response.status}: ${body.slice(0, 200)}`);
  }

  const data = await response.json();
  const text = data.content
    ?.filter((b: any) => b.type === "text")
    ?.map((b: any) => b.text)
    ?.join("") ?? "";

  if (!text) {
    throw new Error("Anthropic returned empty response");
  }
  return text;
}

// -- OpenAI --

async function callOpenAi(
  prompt: string,
  apiKey: string,
  model: string,
  maxTokens: number,
  timeoutMs: number,
): Promise<string> {
  const response = await fetchWithTimeout(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages: [{ role: "user", content: prompt }],
      }),
    },
    timeoutMs,
    "OpenAI LLM call",
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`OpenAI API error ${response.status}: ${body.slice(0, 200)}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content ?? "";

  if (!text) {
    throw new Error("OpenAI returned empty response");
  }
  return text;
}

// fetchWithTimeout moved to ./http.ts — shared between LLM and embedding callers.

// -- Auth profile resolution --

/**
 * Extract an API key from OpenClaw auth profiles.
 * Tries the specified provider, falls back to the other.
 */
export function resolveApiKey(
  authProfiles: Record<string, { provider?: string; key?: string }> | undefined,
  preferredProvider: LlmProvider,
): { provider: LlmProvider; apiKey: string } | null {
  if (!authProfiles) return null;

  // Try preferred provider first
  for (const profile of Object.values(authProfiles)) {
    if (profile.provider === preferredProvider && profile.key) {
      return { provider: preferredProvider, apiKey: profile.key };
    }
  }

  // Fallback: try the other provider
  const fallback: LlmProvider = preferredProvider === "anthropic" ? "openai" : "anthropic";
  for (const profile of Object.values(authProfiles)) {
    if (profile.provider === fallback && profile.key) {
      return { provider: fallback, apiKey: profile.key };
    }
  }

  return null;
}

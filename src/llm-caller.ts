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

export type LlmProvider = "anthropic" | "openai" | "google";

export type LlmCallerConfig = {
  provider: LlmProvider;
  apiKey: string;
  model?: string;
  maxTokens?: number;
  timeoutMs?: number;
  /** Override base URL for OpenAI-compatible endpoints (e.g. DeepSeek). */
  baseUrl?: string;
};

const DEFAULTS = {
  anthropic: { model: "claude-haiku-4-5-20251001", maxTokens: 2048 },
  openai: { model: "gpt-4o-mini", maxTokens: 2048 },
  google: { model: "gemini-2.0-flash", maxTokens: 2048 },
} as const;

// -- Main --

/**
 * Call an LLM with a simple prompt → text response.
 * Throws on failure (network, auth, rate limit, timeout).
 *
 * An optional `signal` enables caller-driven cancellation (e.g. on dispose).
 */
export async function callLlm(
  prompt: string,
  config: LlmCallerConfig,
  signal?: AbortSignal,
): Promise<string> {
  const { provider, apiKey } = config;
  const model = config.model ?? DEFAULTS[provider].model;
  const maxTokens = config.maxTokens ?? DEFAULTS[provider].maxTokens;
  const timeoutMs = config.timeoutMs ?? 30_000;

  if (provider === "anthropic") {
    return callAnthropic(prompt, apiKey, model, maxTokens, timeoutMs, signal);
  }
  if (provider === "google") {
    return callGoogle(prompt, apiKey, model, maxTokens, timeoutMs, signal);
  }
  return callOpenAi(prompt, apiKey, model, maxTokens, timeoutMs, signal, config.baseUrl);
}

// -- Anthropic --

async function callAnthropic(
  prompt: string,
  apiKey: string,
  model: string,
  maxTokens: number,
  timeoutMs: number,
  signal?: AbortSignal,
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
    signal,
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
  signal?: AbortSignal,
  baseUrl?: string,
): Promise<string> {
  const url = baseUrl
    ? `${baseUrl.replace(/\/+$/, "")}/chat/completions`
    : "https://api.openai.com/v1/chat/completions";
  const response = await fetchWithTimeout(
    url,
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
    signal,
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

// -- Google (Gemini) --

async function callGoogle(
  prompt: string,
  apiKey: string,
  model: string,
  maxTokens: number,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const response = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: maxTokens },
      }),
    },
    timeoutMs,
    "Google Gemini LLM call",
    signal,
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Google Gemini API error ${response.status}: ${body.slice(0, 200)}`);
  }

  const data: any = await response.json();
  const text = data.candidates?.[0]?.content?.parts
    ?.filter((p: any) => typeof p.text === "string")
    ?.map((p: any) => p.text)
    ?.join("") ?? "";

  if (!text) {
    throw new Error("Google Gemini returned empty response");
  }
  return text;
}

// fetchWithTimeout moved to ./http.ts — shared between LLM and embedding callers.


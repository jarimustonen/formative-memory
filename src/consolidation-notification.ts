/**
 * Consolidation notification formatting.
 *
 * Routes consolidation results to the appropriate notification format
 * based on the configured level: off, summary (LLM-generated), or detailed.
 */

import type { ConsolidationNotificationLevel } from "./config.ts";
import type { ConsolidationResult, ConsolidationSummary } from "./consolidation.ts";
import { callLlm, type LlmCallerConfig } from "./llm-caller.ts";
import type { Logger } from "./logger.ts";
import { nullLogger } from "./logger.ts";

export type NotificationContext = {
  /** Notification level from config. */
  level: ConsolidationNotificationLevel;
  /** LLM config for summary generation. Null = no LLM available. */
  llmConfig: LlmCallerConfig | null;
  /** User's preferred language (e.g. "suomi", "Finnish"). */
  language?: string;
  /** Bot persona hint for the LLM summary (e.g. "friendly assistant named Kisu"). */
  personaHint?: string;
  logger?: Logger;
};

/**
 * Format the detailed technical report (current behavior).
 */
export function formatDetailedReport(result: ConsolidationResult): string {
  const s = result.summary;
  const catchUpInfo = s.catchUpDecayed > 0 ? `Catch-up decayed: ${s.catchUpDecayed}, ` : "";
  return (
    `Memory consolidation complete (${result.durationMs}ms).\n` +
    catchUpInfo +
    `Reinforced: ${s.reinforced}, Decayed: ${s.decayed}, ` +
    `Pruned: ${s.pruned} memories + ${s.prunedAssociations} associations, ` +
    `Merged: ${s.merged}, Transitioned: ${s.transitioned}, ` +
    `Exposure GC: ${s.exposuresGc}`
  );
}

/**
 * Build the LLM prompt for generating a natural-language summary.
 */
export function buildSummaryPrompt(summary: ConsolidationSummary, language?: string, personaHint?: string): string {
  const parts: string[] = [];

  parts.push("You are generating a short notification about a memory maintenance cycle that just completed.");
  parts.push("Write 1–3 sentences summarizing what happened in a natural, conversational tone.");
  parts.push("Focus on what matters to the user — skip zeros and uninteresting details.");
  parts.push("Do NOT mention technical terms like 'reinforcement', 'decay', 'pruning', 'GC', or 'associations'.");
  parts.push("Use metaphors related to memory, sleep, or organizing thoughts.");

  if (personaHint) {
    parts.push(`\nPersona: ${personaHint}. Match this voice and style.`);
  }

  if (language) {
    parts.push(`\nIMPORTANT: Write the response in ${language}.`);
  }

  parts.push("\nRaw consolidation data:");
  parts.push(`- Memories strengthened: ${summary.reinforced}`);
  parts.push(`- Memories faded: ${summary.decayed}`);
  parts.push(`- Memories removed: ${summary.pruned}`);
  parts.push(`- Duplicate memories merged: ${summary.merged}`);
  parts.push(`- Temporal transitions: ${summary.transitioned}`);
  if (summary.catchUpDecayed > 0) {
    parts.push(`- Catch-up fading (missed cycles): ${summary.catchUpDecayed}`);
  }

  parts.push("\nRespond with ONLY the notification text, nothing else.");

  return parts.join("\n");
}

// -- Temporal transition notifications --

/**
 * Format the detailed temporal transitions report.
 */
export function formatTemporalDetailedReport(count: number): string {
  return count > 0
    ? `Temporal transitions: ${count} updated.`
    : "No temporal transitions needed.";
}

/**
 * Build the LLM prompt for a temporal transition summary.
 */
export function buildTemporalSummaryPrompt(count: number, language?: string, personaHint?: string): string {
  const parts: string[] = [];

  parts.push("You are generating a short notification about a scheduled temporal memory review.");
  parts.push("Write 1–2 sentences summarizing what happened in a natural, conversational tone.");
  parts.push("Temporal transitions mean some memories about future events became present or past, based on their dates.");
  parts.push("Do NOT use technical terms. Use natural language about time passing, events arriving, or dates changing.");

  if (personaHint) {
    parts.push(`\nPersona: ${personaHint}. Match this voice and style.`);
  }

  if (language) {
    parts.push(`\nIMPORTANT: Write the response in ${language}.`);
  }

  if (count > 0) {
    parts.push(`\n${count} memories had their time perspective updated (e.g. a future event is now happening, or a present event is now in the past).`);
  } else {
    parts.push("\nNo memories needed time updates right now — everything is current.");
  }

  parts.push("\nRespond with ONLY the notification text, nothing else.");

  return parts.join("\n");
}

/**
 * Generate a notification for temporal transitions.
 *
 * Returns the notification text, or null if level is "off".
 */
export async function formatTemporalNotification(
  count: number,
  ctx: NotificationContext,
): Promise<string | null> {
  const log = ctx.logger ?? nullLogger;

  if (ctx.level === "off") {
    return null;
  }

  if (ctx.level === "detailed") {
    return formatTemporalDetailedReport(count);
  }

  // level === "summary"
  if (!ctx.llmConfig) {
    log.debug("temporal-notification: no LLM config, falling back to short message");
    return count > 0 ? TEMPORAL_FALLBACK_MESSAGE : null;
  }

  // Skip LLM call when nothing happened — not worth the cost
  if (count === 0) {
    return null;
  }

  try {
    const prompt = buildTemporalSummaryPrompt(count, ctx.language, ctx.personaHint);
    const text = await callLlm(prompt, { ...ctx.llmConfig, maxTokens: 256, timeoutMs: 15_000 });
    return text.trim();
  } catch (err) {
    log.warn(
      `temporal-notification: LLM summary failed, using fallback: ${err instanceof Error ? err.message : String(err)}`,
    );
    return TEMPORAL_FALLBACK_MESSAGE;
  }
}

const TEMPORAL_FALLBACK_MESSAGE = "Temporal memory review complete.";
const FALLBACK_MESSAGE = "Memory maintenance complete.";

/**
 * Generate a notification for a consolidation result.
 *
 * Returns the notification text, or null if level is "off".
 * Never throws — LLM failures degrade gracefully to a short fallback.
 */
export async function formatConsolidationNotification(
  result: ConsolidationResult,
  ctx: NotificationContext,
): Promise<string | null> {
  const log = ctx.logger ?? nullLogger;

  if (ctx.level === "off") {
    return null;
  }

  if (ctx.level === "detailed") {
    return formatDetailedReport(result);
  }

  // level === "summary"
  if (!ctx.llmConfig) {
    log.debug("consolidation-notification: no LLM config, falling back to short message");
    return FALLBACK_MESSAGE;
  }

  try {
    const prompt = buildSummaryPrompt(result.summary, ctx.language, ctx.personaHint);
    const text = await callLlm(prompt, { ...ctx.llmConfig, maxTokens: 256, timeoutMs: 15_000 });
    return text.trim();
  } catch (err) {
    log.warn(
      `consolidation-notification: LLM summary failed, using fallback: ${err instanceof Error ? err.message : String(err)}`,
    );
    return FALLBACK_MESSAGE;
  }
}

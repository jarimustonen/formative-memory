/**
 * Retrieval log — append-only file for co-retrieval events.
 *
 * Format:
 * 2026-03-05T14:30:00Z search   a1b2c3d4 e5f6a7b8 c9d0e1f2
 * 2026-03-05T14:30:00Z recall   a1b2c3d4 c9d0e1f2
 * 2026-03-05T14:31:00Z feedback a1b2c3d4:3 e5f6a7b8:2 c9d0e1f2:1 "comment"
 * 2026-03-05T14:35:12Z store    f3a4b5c6 context:a1b2c3d4,e5f6a7b8
 */

import { appendFileSync, readFileSync } from "node:fs";
import type { RetrievalLogEntry } from "./types.ts";

export function appendSearchEvent(logPath: string, ids: string[]): void {
  if (ids.length === 0) return;
  const ts = new Date().toISOString();
  const line = `${ts} search   ${ids.join(" ")}\n`;
  appendFileSync(logPath, line);
}

export function appendRecallEvent(logPath: string, ids: string[]): void {
  if (ids.length === 0) return;
  const ts = new Date().toISOString();
  const line = `${ts} recall   ${ids.join(" ")}\n`;
  appendFileSync(logPath, line);
}

export function appendFeedbackEvent(
  logPath: string,
  ratings: Record<string, number>,
  comment?: string,
): void {
  const entries = Object.entries(ratings);
  if (entries.length === 0) return;
  const ts = new Date().toISOString();
  const pairs = entries.map(([id, rating]) => `${id}:${rating}`).join(" ");
  const commentPart = comment ? ` "${comment.replace(/"/g, '\\"')}"` : "";
  const line = `${ts} feedback ${pairs}${commentPart}\n`;
  appendFileSync(logPath, line);
}

export function appendStoreEvent(logPath: string, newId: string, contextIds: string[]): void {
  const ts = new Date().toISOString();
  const contextPart = contextIds.length > 0 ? ` context:${contextIds.join(",")}` : "";
  const line = `${ts} store    ${newId}${contextPart}\n`;
  appendFileSync(logPath, line);
}

export function parseRetrievalLog(logPath: string): RetrievalLogEntry[] {
  let content: string;
  try {
    content = readFileSync(logPath, "utf8");
  } catch {
    return [];
  }

  const entries: RetrievalLogEntry[] = [];
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;

    const match = line.match(/^(\S+)\s+(search|recall|feedback|store)\s+(.+)$/);
    if (!match) continue;

    const [, timestamp, event, rest] = match;
    const entry: RetrievalLogEntry = {
      timestamp,
      event: event as RetrievalLogEntry["event"],
      ids: [],
    };

    if (event === "feedback") {
      entry.ratings = {};
      const commentMatch = rest.match(/"([^"\\]*(?:\\.[^"\\]*)*)"$/);
      const ratingPart = commentMatch ? rest.slice(0, rest.lastIndexOf('"')).trim() : rest;
      if (commentMatch) {
        entry.comment = commentMatch[1].replace(/\\"/g, '"');
      }
      // Remove trailing quote-related chars from ratingPart
      const cleanRatingPart = ratingPart.replace(/\s*"[^"]*"?\s*$/, "").trim();
      for (const pair of cleanRatingPart.split(/\s+/)) {
        const [id, rating] = pair.split(":");
        if (id && rating) {
          entry.ratings[id] = parseInt(rating, 10);
          entry.ids.push(id);
        }
      }
    } else if (event === "store") {
      const parts = rest.split(/\s+/);
      entry.ids = [parts[0]];
      const ctxPart = parts.find((p) => p.startsWith("context:"));
      if (ctxPart) {
        entry.context_ids = ctxPart.slice("context:".length).split(",");
      }
    } else {
      entry.ids = rest.split(/\s+/).filter(Boolean);
    }

    entries.push(entry);
  }

  return entries;
}

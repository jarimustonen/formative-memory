/**
 * Memory-core → Associative Memory import preprocessor.
 *
 * Discovers memory-core markdown files, segments them by heading level,
 * and extracts metadata for the migration service.
 *
 * Heading detection is done with a small ATX-only scanner that respects
 * fenced code blocks. Setext headings (=== / ---) are not recognized;
 * memory files are expected to use ATX (#, ##, ###) style.
 */

import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";

// -- Types --

export type ImportSegment = {
  id: number;
  source_file: string;
  heading: string | null;
  heading_level: number | null;
  date: string | null;
  evergreen: boolean;
  /** True for segments parsed from JSONL session transcripts. */
  session: boolean;
  content: string;
  char_count: number;
};

export type FileError = {
  path: string;
  error: string;
};

export type PrepareResult = {
  segments: ImportSegment[];
  files: Array<{ path: string; segmentCount: number; evergreen: boolean; date: string | null }>;
  errors: FileError[];
  totalSegments: number;
};

// -- Constants --

const DATE_FILENAME_RE = /^(\d{4}-\d{2}-\d{2})\.md$/;
const DATE_ISO_RE = /^\d{4}-\d{2}-\d{2}/;
const FRONTMATTER_RE = /^\uFEFF?---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n/;
const MAX_SEGMENT_CHARS = 2000;
const MIN_SEGMENT_CHARS = 200;

const ATX_HEADING_RE = /^ {0,3}(#{1,3})\s+(.*?)\s*#*\s*$/;
const FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})/;

// -- Discovery --

/**
 * Discover memory-core markdown files in a workspace.
 * Follows the same logic as memory-core: MEMORY.md, memory.md, memory/*.md + extra paths.
 * Returns files in deterministic order: root files first, then lexical path order.
 */
export function discoverMemoryFiles(workspaceDir: string, extraPaths?: string[]): string[] {
  const found: string[] = [];

  // 1. Check MEMORY.md and memory.md at workspace root
  for (const name of ["MEMORY.md", "memory.md"]) {
    const p = join(workspaceDir, name);
    if (existsSync(p) && statSync(p).isFile()) {
      found.push(p);
    }
  }

  // 2. Walk memory/ directory recursively (only .md files, skip symlinks)
  const memoryDir = join(workspaceDir, "memory");
  if (existsSync(memoryDir) && statSync(memoryDir).isDirectory()) {
    walkMarkdownFiles(memoryDir, found);
  }

  // 3. Add extra paths from config
  if (extraPaths) {
    for (const extra of extraPaths) {
      const resolved = isAbsolute(extra) ? extra : join(workspaceDir, extra);
      if (existsSync(resolved)) {
        const stat = statSync(resolved);
        if (stat.isFile() && resolved.endsWith(".md")) {
          found.push(resolved);
        } else if (stat.isDirectory()) {
          walkMarkdownFiles(resolved, found);
        }
      }
    }
  }

  // 4. Deduplicate by canonical path (handles case-insensitive filesystems)
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const p of found) {
    const canonical = realpathSync(p);
    if (!seen.has(canonical)) {
      seen.add(canonical);
      deduped.push(p);
    }
  }

  // 5. Sort deterministically: root files first, then lexical path order
  const rootNames = new Set(["memory.md"]);
  deduped.sort((a, b) => {
    const aIsRoot = rootNames.has(basename(a).toLowerCase());
    const bIsRoot = rootNames.has(basename(b).toLowerCase());
    if (aIsRoot && !bIsRoot) return -1;
    if (!aIsRoot && bIsRoot) return 1;
    return a.localeCompare(b);
  });

  return deduped;
}

function walkMarkdownFiles(dir: string, result: string[]): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // Skip unreadable directories
  }

  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue; // Skip symlinks to avoid loops
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkMarkdownFiles(full, result);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      result.push(full);
    }
  }
}

// -- Path helpers --

/** Convert a platform-specific relative path to POSIX format for stable storage. */
function toPosixRelative(workspaceDir: string, filePath: string): string {
  const rel = relative(workspaceDir, filePath);
  return sep === "/" ? rel : rel.split(sep).join("/");
}

// -- Segmentation --

type RawSection = {
  heading: string | null;
  headingLevel: number | null;
  content: string;
};

/**
 * Segment a markdown file by heading boundaries (H1/H2/H3).
 * Large segments are split by paragraph; small segments are merged with previous.
 */
export function segmentMarkdown(content: string, filePath: string, workspaceDir: string): ImportSegment[] {
  // Normalize line endings and strip frontmatter
  const normalized = content.replace(/\r\n/g, "\n");
  const stripped = normalized.replace(FRONTMATTER_RE, "");

  if (!stripped.trim()) return [];

  const relPath = toPosixRelative(workspaceDir, filePath);
  const isEvergreen = isEvergreenFile(filePath, workspaceDir);
  const fileDate = extractDateFromFilename(basename(filePath));

  // Parse with markdown-it and extract sections by heading boundaries
  const rawSections = extractSections(stripped);

  // Apply split/merge rules
  const protoSegments: Array<{ heading: string | null; headingLevel: number | null; content: string }> = [];

  for (const section of rawSections) {
    if (!section.content.trim() && !section.heading) continue;

    const fullContent = section.heading
      ? `${section.heading}\n\n${section.content.trim()}`
      : section.content.trim();

    if (fullContent.length > MAX_SEGMENT_CHARS) {
      const parts = splitByParagraph(fullContent, section.heading, section.headingLevel);
      protoSegments.push(...parts);
    } else {
      protoSegments.push({ heading: section.heading, headingLevel: section.headingLevel, content: fullContent });
    }
  }

  // Merge small segments using accumulator pattern
  const merged = mergeSmallSegments(protoSegments);

  return merged.map((seg, i) => ({
    id: i,
    source_file: relPath,
    heading: seg.heading,
    heading_level: seg.headingLevel,
    date: fileDate,
    evergreen: isEvergreen,
    session: false,
    content: seg.content,
    char_count: seg.content.length,
  }));
}

/**
 * Extract sections from markdown content.
 * Splits on H1/H2/H3 ATX headings, ignoring lines inside fenced code blocks.
 */
function extractSections(content: string): RawSection[] {
  const lines = content.split("\n");
  const sections: RawSection[] = [];

  const headings: Array<{ line: number; level: number; text: string }> = [];
  let fence: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (fence) {
      if (line.trimStart().startsWith(fence)) fence = null;
      continue;
    }
    const fenceMatch = FENCE_OPEN_RE.exec(line);
    if (fenceMatch) {
      fence = fenceMatch[1].slice(0, 3);
      continue;
    }
    const m = ATX_HEADING_RE.exec(line);
    if (m) {
      headings.push({ line: i, level: m[1].length, text: m[2] });
    }
  }

  if (headings.length === 0) {
    // No headings — entire content is one section
    return [{ heading: null, headingLevel: null, content: content.trim() }];
  }

  // Content before first heading
  if (headings[0].line > 0) {
    const preContent = lines.slice(0, headings[0].line).join("\n").trim();
    if (preContent) {
      sections.push({ heading: null, headingLevel: null, content: preContent });
    }
  }

  // Each heading starts a section that extends to the next heading
  for (let i = 0; i < headings.length; i++) {
    const h = headings[i];
    const startLine = h.line + 1; // Line after heading
    const endLine = i < headings.length - 1 ? headings[i + 1].line : lines.length;
    const sectionContent = lines.slice(startLine, endLine).join("\n").trim();
    const headingPrefix = "#".repeat(h.level);
    sections.push({
      heading: `${headingPrefix} ${h.text}`,
      headingLevel: h.level,
      content: sectionContent,
    });
  }

  return sections;
}

function splitByParagraph(
  text: string,
  heading: string | null,
  headingLevel: number | null,
): Array<{ heading: string | null; headingLevel: number | null; content: string }> {
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim());

  if (paragraphs.length <= 1) {
    // Single paragraph — use word-boundary fallback if too large
    if (text.length > MAX_SEGMENT_CHARS) {
      return splitByWordBoundary(text, heading, headingLevel);
    }
    return [{ heading, headingLevel, content: text }];
  }

  const result: Array<{ heading: string | null; headingLevel: number | null; content: string }> = [];
  let current = "";

  for (const para of paragraphs) {
    // If a single paragraph exceeds max, split it first
    if (para.length > MAX_SEGMENT_CHARS) {
      if (current) {
        result.push({ heading: result.length === 0 ? heading : null, headingLevel: result.length === 0 ? headingLevel : null, content: current });
        current = "";
      }
      const subParts = splitByWordBoundary(para, result.length === 0 ? heading : null, result.length === 0 ? headingLevel : null);
      result.push(...subParts);
      continue;
    }

    const candidate = current ? `${current}\n\n${para}` : para;
    if (candidate.length > MAX_SEGMENT_CHARS && current) {
      result.push({ heading: result.length === 0 ? heading : null, headingLevel: result.length === 0 ? headingLevel : null, content: current });
      current = para;
    } else {
      current = candidate;
    }
  }

  if (current) {
    result.push({ heading: result.length === 0 ? heading : null, headingLevel: result.length === 0 ? headingLevel : null, content: current });
  }

  return result;
}

/** Fallback splitter for oversized single paragraphs: split at word boundaries. */
function splitByWordBoundary(
  text: string,
  heading: string | null,
  headingLevel: number | null,
): Array<{ heading: string | null; headingLevel: number | null; content: string }> {
  const result: Array<{ heading: string | null; headingLevel: number | null; content: string }> = [];
  let rest = text;

  while (rest.length > MAX_SEGMENT_CHARS) {
    let splitAt = rest.lastIndexOf(" ", MAX_SEGMENT_CHARS);
    if (splitAt <= 0) splitAt = MAX_SEGMENT_CHARS; // No space found — hard split
    result.push({
      heading: result.length === 0 ? heading : null,
      headingLevel: result.length === 0 ? headingLevel : null,
      content: rest.slice(0, splitAt).trim(),
    });
    rest = rest.slice(splitAt).trim();
  }

  if (rest) {
    result.push({
      heading: result.length === 0 ? heading : null,
      headingLevel: result.length === 0 ? headingLevel : null,
      content: rest,
    });
  }

  return result;
}

/**
 * Merge small segments into the previous segment using accumulator pattern.
 * Does not mutate input array.
 */
function mergeSmallSegments(
  segments: Array<{ heading: string | null; headingLevel: number | null; content: string }>,
): Array<{ heading: string | null; headingLevel: number | null; content: string }> {
  if (segments.length === 0) return [];

  const result: Array<{ heading: string | null; headingLevel: number | null; content: string }> = [];

  for (const seg of segments) {
    const last = result[result.length - 1];
    if (last && last.content.length < MIN_SEGMENT_CHARS) {
      // Merge into previous (accumulator pattern)
      result[result.length - 1] = {
        heading: last.heading ?? seg.heading,
        headingLevel: last.headingLevel ?? seg.headingLevel,
        content: `${last.content}\n\n${seg.content}`,
      };
    } else {
      result.push({ ...seg });
    }
  }

  return result;
}

// -- JSONL session discovery & parsing --

/**
 * Discover JSONL session files in the agent's sessions directory.
 * Only imports canonical live session files (*.jsonl).
 * Excludes archive variants (.reset.*, .deleted.*), backups (.bak.*),
 * and lock files to avoid duplicate extraction from the same session.
 */
export function discoverSessionFiles(sessionsDir: string): string[] {
  if (!existsSync(sessionsDir) || !statSync(sessionsDir).isDirectory()) {
    return [];
  }

  const found: string[] = [];

  let entries;
  try {
    entries = readdirSync(sessionsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const name = entry.name;

    // Only include canonical *.jsonl files — not archive/backup/lock variants
    if (name.endsWith(".jsonl") && name !== "sessions.json") {
      found.push(join(sessionsDir, name));
    }
  }

  found.sort((a, b) => a.localeCompare(b));
  return found;
}

/**
 * Content block in an OpenClaw JSONL message.
 * We only extract text blocks; tool calls, thinking, etc. are skipped.
 */
type JsonlContentBlock = {
  type: string;
  text?: string;
  name?: string;
};

type JsonlMessage = {
  role: string;
  content?: JsonlContentBlock[] | string;
};

type JsonlEntry = {
  type?: string;
  timestamp?: string;
  message?: JsonlMessage;
  id?: string;
  cwd?: string;
  parentSession?: string;
};

/**
 * Parse a JSONL session file and extract conversation turns as ImportSegments.
 *
 * Strategy:
 * - Extract user and assistant text messages (skip tool calls, thinking, system)
 * - Group consecutive messages into conversation chunks
 * - Apply the same size limits as markdown segmentation
 * - Use the session timestamp for dating
 */
export function parseSessionJsonl(
  content: string,
  filePath: string,
  sessionsDir: string,
): ImportSegment[] {
  const lines = content.split("\n").filter((l) => l.trim());
  if (lines.length === 0) return [];

  const relPath = toPosixRelative(dirname(sessionsDir), filePath);
  let sessionDate: string | null = null;

  // Collect text turns
  const turns: Array<{ role: string; text: string; timestamp: string | null }> = [];

  for (const line of lines) {
    let entry: JsonlEntry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue; // Skip malformed lines
    }

    // Extract session date from session header or first entry timestamp
    if (!sessionDate && entry.timestamp) {
      const match = DATE_ISO_RE.exec(entry.timestamp);
      if (match) sessionDate = match[0];
    }

    // Skip non-message entries (session headers, compaction, custom, etc.)
    if (entry.type !== "message" || !entry.message) continue;

    const { role, content: msgContent } = entry.message;

    // Only extract user and assistant text
    if (role !== "user" && role !== "assistant") continue;

    const text = extractTextFromContent(msgContent);
    if (!text.trim()) continue;

    turns.push({ role, text: text.trim(), timestamp: entry.timestamp ?? null });
  }

  if (turns.length === 0) return [];

  // Group turns into exchanges (user message + assistant reply)
  const segments = groupTurnsIntoExchanges(turns, relPath, sessionDate);
  return segments;
}

function extractTextFromContent(content: JsonlContentBlock[] | string | undefined): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .filter((block) => block.type === "text" && block.text)
    .map((block) => block.text!)
    .join("\n\n");
}

/**
 * A conversation exchange: one user message + following assistant reply(ies).
 * This is the natural semantic unit for fact extraction from session histories.
 */
type Exchange = {
  userText: string;
  assistantText: string;
  timestamp: string | null;
};

/**
 * Group parsed turns into exchanges and produce one ImportSegment per exchange.
 *
 * An exchange starts at each user turn and collects all following assistant turns
 * until the next user turn. Consecutive user turns without an assistant reply
 * are merged into a single exchange with the next assistant response.
 *
 * Each exchange becomes one segment formatted as "User: ...\n\nAssistant: ..."
 * — preserving the natural conversational boundary for LLM fact extraction.
 */
function groupTurnsIntoExchanges(
  turns: Array<{ role: string; text: string; timestamp: string | null }>,
  relPath: string,
  sessionDate: string | null,
): ImportSegment[] {
  // Build exchanges: user message(s) + assistant reply(ies)
  const exchanges: Exchange[] = [];
  let currentUserParts: string[] = [];
  let currentAssistantParts: string[] = [];
  let exchangeTimestamp: string | null = null;

  const flushExchange = () => {
    if (currentUserParts.length > 0 && currentAssistantParts.length > 0) {
      exchanges.push({
        userText: currentUserParts.join("\n\n"),
        assistantText: currentAssistantParts.join("\n\n"),
        timestamp: exchangeTimestamp,
      });
    }
    // Orphan user messages without assistant reply are dropped —
    // they contain no completed exchange for fact extraction.
    currentUserParts = [];
    currentAssistantParts = [];
    exchangeTimestamp = null;
  };

  for (const turn of turns) {
    if (turn.role === "user") {
      // New user turn: flush previous exchange if we had an assistant reply
      if (currentAssistantParts.length > 0) {
        flushExchange();
      }
      currentUserParts.push(turn.text);
      if (!exchangeTimestamp) exchangeTimestamp = turn.timestamp;
    } else {
      // Assistant reply: accumulate
      currentAssistantParts.push(turn.text);
    }
  }
  flushExchange();

  // Convert exchanges to segments
  return exchanges.map((ex, i) => {
    const content = `User: ${ex.userText}\n\nAssistant: ${ex.assistantText}`;
    return {
      id: i,
      source_file: relPath,
      heading: null,
      heading_level: null,
      date: extractDateFromTimestamp(ex.timestamp) ?? sessionDate,
      evergreen: false,
      session: true,
      content,
      char_count: content.length,
    };
  });
}

function extractDateFromTimestamp(timestamp: string | null): string | null {
  if (!timestamp) return null;
  const match = DATE_ISO_RE.exec(timestamp);
  return match ? match[0] : null;
}

// -- Metadata helpers --

export function isEvergreenFile(filePath: string, workspaceDir: string): boolean {
  const rel = relative(workspaceDir, filePath);
  const name = basename(filePath).toLowerCase();
  // Root-level MEMORY.md or memory.md are evergreen (dirname is "." for root files)
  return name === "memory.md" && dirname(rel) === ".";
}

export function extractDateFromFilename(filename: string): string | null {
  const match = DATE_FILENAME_RE.exec(filename);
  return match ? match[1] : null;
}

// -- Pipeline --

/**
 * Preprocess memory-core files: discover, segment, extract metadata.
 * Returns segments ready for LLM enrichment and storage.
 * Continues processing on per-file errors; collects errors in result.
 *
 * @param sessionsDir - Optional path to OpenClaw sessions directory
 *   (e.g. ~/.openclaw/agents/<agentId>/sessions/) for JSONL import.
 */
export function prepareImport(
  workspaceDir: string,
  extraPaths?: string[],
  sessionsDir?: string,
): PrepareResult {
  const files = discoverMemoryFiles(workspaceDir, extraPaths);

  const allSegments: ImportSegment[] = [];
  const fileInfos: PrepareResult["files"] = [];
  const errors: FileError[] = [];
  let globalId = 0;

  for (const filePath of files) {
    try {
      const content = readFileSync(filePath, "utf8");
      const segments = segmentMarkdown(content, filePath, workspaceDir);

      const renumbered = segments.map((seg) => ({
        ...seg,
        id: globalId++,
      }));

      allSegments.push(...renumbered);
      fileInfos.push({
        path: toPosixRelative(workspaceDir, filePath),
        segmentCount: renumbered.length,
        evergreen: renumbered[0]?.evergreen ?? isEvergreenFile(filePath, workspaceDir),
        date: extractDateFromFilename(basename(filePath)),
      });
    } catch (err) {
      errors.push({
        path: toPosixRelative(workspaceDir, filePath),
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Discover and process JSONL session files
  if (sessionsDir) {
    const sessionFiles = discoverSessionFiles(sessionsDir);

    for (const filePath of sessionFiles) {
      try {
        const content = readFileSync(filePath, "utf8");
        const segments = parseSessionJsonl(content, filePath, sessionsDir);

        const renumbered = segments.map((seg) => ({
          ...seg,
          id: globalId++,
        }));

        allSegments.push(...renumbered);
        fileInfos.push({
          path: toPosixRelative(dirname(sessionsDir), filePath),
          segmentCount: renumbered.length,
          evergreen: false,
          date: renumbered[0]?.date ?? null,
        });
      } catch (err) {
        errors.push({
          path: toPosixRelative(dirname(sessionsDir), filePath),
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return {
    segments: allSegments,
    files: fileInfos,
    errors,
    totalSegments: allSegments.length,
  };
}

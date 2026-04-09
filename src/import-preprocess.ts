/**
 * Memory-core → Associative Memory import preprocessor.
 *
 * Discovers memory-core markdown files, segments them by heading level,
 * and extracts metadata for the migration service.
 *
 * Uses markdown-it for reliable parsing (handles code blocks, frontmatter, CRLF).
 */

import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import MarkdownIt from "markdown-it";

// -- Types --

export type ImportSegment = {
  id: number;
  source_file: string;
  heading: string | null;
  heading_level: number | null;
  date: string | null;
  evergreen: boolean;
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
const FRONTMATTER_RE = /^\uFEFF?---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n/;
const MAX_SEGMENT_CHARS = 2000;
const MIN_SEGMENT_CHARS = 200;

const md = new MarkdownIt();

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
 * Uses markdown-it for reliable parsing — code blocks and other contexts
 * are handled correctly.
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
    content: seg.content,
    char_count: seg.content.length,
  }));
}

/**
 * Extract sections from markdown content using markdown-it tokens.
 * Splits on H1/H2/H3 headings while respecting code blocks and other contexts.
 */
function extractSections(content: string): RawSection[] {
  const tokens = md.parse(content, {});
  const lines = content.split("\n");
  const sections: RawSection[] = [];

  // Find heading positions from tokens
  const headings: Array<{ line: number; level: number; text: string }> = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type === "heading_open" && token.map) {
      const level = parseInt(token.tag.slice(1), 10);
      if (level <= 3) {
        // Get heading text from the inline token that follows
        const inlineToken = tokens[i + 1];
        const text = inlineToken?.type === "inline" ? (inlineToken.content ?? "") : "";
        headings.push({ line: token.map[0], level, text });
      }
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
 */
export function prepareImport(
  workspaceDir: string,
  extraPaths?: string[],
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

  return {
    segments: allSegments,
    files: fileInfos,
    errors,
    totalSegments: allSegments.length,
  };
}

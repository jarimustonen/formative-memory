/**
 * Memory-core → Associative Memory import preprocessor.
 *
 * Discovers memory-core markdown files, segments them by heading level,
 * and extracts metadata for the migration service.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";

// -- Types --

export type ImportSegment = {
  id: number;
  source_file: string;
  heading: string | null;
  date: string | null;
  evergreen: boolean;
  content: string;
  char_count: number;
};

export type PrepareResult = {
  segments: ImportSegment[];
  files: Array<{ path: string; segmentCount: number; evergreen: boolean; date: string | null }>;
  totalSegments: number;
};

// -- Constants --

const HEADING_RE = /^(#{1,3})\s+(.+)$/;
const DATE_FILENAME_RE = /^(\d{4}-\d{2}-\d{2})\.md$/;
const FRONTMATTER_RE = /^---\s*\n[\s\S]*?\n---\s*\n/;
const MAX_SEGMENT_CHARS = 2000;
const MIN_SEGMENT_CHARS = 200;

// -- Discovery --

/**
 * Discover memory-core markdown files in a workspace.
 * Follows the same logic as memory-core: MEMORY.md, memory.md, memory/*.md + extra paths.
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

  // 2. Walk memory/ directory recursively (only .md files)
  const memoryDir = join(workspaceDir, "memory");
  if (existsSync(memoryDir) && statSync(memoryDir).isDirectory()) {
    walkMarkdownFiles(memoryDir, found);
  }

  // 3. Add extra paths from config
  if (extraPaths) {
    for (const extra of extraPaths) {
      const resolved = extra.startsWith("/") ? extra : join(workspaceDir, extra);
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

  // 4. Deduplicate by inode (handles case-insensitive filesystems like macOS APFS)
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const p of found) {
    const stat = statSync(p);
    const key = `${stat.dev}:${stat.ino}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(p);
    }
  }

  return deduped;
}

function walkMarkdownFiles(dir: string, result: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkMarkdownFiles(full, result);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      result.push(full);
    }
  }
}

// -- Segmentation --

/**
 * Segment a markdown file by heading boundaries (H1/H2/H3).
 * Large segments are split by paragraph; small segments are merged with the next.
 */
export function segmentMarkdown(content: string, filePath: string, workspaceDir: string): ImportSegment[] {
  // Strip frontmatter
  const stripped = content.replace(FRONTMATTER_RE, "");
  const lines = stripped.split("\n");

  const relPath = relative(workspaceDir, filePath);
  const isEvergreen = isEvergreenFile(filePath, workspaceDir);
  const fileDate = extractDateFromFilename(basename(filePath));

  // Collect raw sections by heading boundaries
  const rawSections: Array<{ heading: string | null; lines: string[] }> = [];
  let currentSection: { heading: string | null; lines: string[] } = { heading: null, lines: [] };

  for (const line of lines) {
    const match = HEADING_RE.exec(line);
    if (match) {
      // Flush current section if it has content
      if (currentSection.lines.length > 0 || currentSection.heading !== null) {
        rawSections.push(currentSection);
      }
      currentSection = { heading: line, lines: [] };
    } else {
      currentSection.lines.push(line);
    }
  }
  // Flush last section
  if (currentSection.lines.length > 0 || currentSection.heading !== null) {
    rawSections.push(currentSection);
  }

  // Convert raw sections to segments, applying split/merge rules
  const protoSegments: Array<{ heading: string | null; content: string }> = [];

  for (const section of rawSections) {
    const text = section.lines.join("\n").trim();
    if (!text && !section.heading) continue;

    const fullContent = section.heading ? `${section.heading}\n\n${text}` : text;

    if (fullContent.length > MAX_SEGMENT_CHARS) {
      // Split large segments by paragraph
      const parts = splitByParagraph(fullContent, section.heading);
      protoSegments.push(...parts);
    } else {
      protoSegments.push({ heading: section.heading, content: fullContent });
    }
  }

  // Merge small segments with the next
  const merged = mergeSmallSegments(protoSegments);

  // Assign IDs (placeholder, will be re-numbered at prepareImport level)
  return merged.map((seg, i) => ({
    id: i,
    source_file: relPath,
    heading: seg.heading,
    date: fileDate,
    evergreen: isEvergreen,
    content: seg.content,
    char_count: seg.content.length,
  }));
}

function splitByParagraph(
  text: string,
  heading: string | null,
): Array<{ heading: string | null; content: string }> {
  // Split on blank lines (paragraph boundaries)
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim());

  if (paragraphs.length <= 1) {
    // Can't split further — return as-is
    return [{ heading, content: text }];
  }

  const result: Array<{ heading: string | null; content: string }> = [];
  let current = "";

  for (const para of paragraphs) {
    const candidate = current ? `${current}\n\n${para}` : para;
    if (candidate.length > MAX_SEGMENT_CHARS && current) {
      result.push({ heading: result.length === 0 ? heading : null, content: current });
      current = para;
    } else {
      current = candidate;
    }
  }

  if (current) {
    result.push({ heading: result.length === 0 ? heading : null, content: current });
  }

  return result;
}

function mergeSmallSegments(
  segments: Array<{ heading: string | null; content: string }>,
): Array<{ heading: string | null; content: string }> {
  if (segments.length === 0) return [];

  const result: Array<{ heading: string | null; content: string }> = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.content.length < MIN_SEGMENT_CHARS && i < segments.length - 1) {
      // Merge with next segment
      const next = segments[i + 1];
      segments[i + 1] = {
        heading: seg.heading ?? next.heading,
        content: `${seg.content}\n\n${next.content}`,
      };
    } else {
      result.push(seg);
    }
  }

  return result;
}

// -- Metadata helpers --

export function isEvergreenFile(filePath: string, workspaceDir: string): boolean {
  const rel = relative(workspaceDir, filePath);
  const name = basename(filePath).toLowerCase();
  // Root-level MEMORY.md or memory.md are evergreen (no directory separator in relative path)
  return name === "memory.md" && !rel.includes("/");
}

export function extractDateFromFilename(filename: string): string | null {
  const match = DATE_FILENAME_RE.exec(filename);
  return match ? match[1] : null;
}

// -- Pipeline --

/**
 * Preprocess memory-core files: discover, segment, extract metadata.
 * Returns segments ready for LLM enrichment and storage.
 */
export function prepareImport(
  workspaceDir: string,
  extraPaths?: string[],
): PrepareResult {
  const files = discoverMemoryFiles(workspaceDir, extraPaths);

  if (files.length === 0) {
    return {
      segments: [],
      files: [],
      totalSegments: 0,
    };
  }

  const allSegments: ImportSegment[] = [];
  const fileInfos: PrepareResult["files"] = [];
  let globalId = 0;

  for (const filePath of files) {
    const content = readFileSync(filePath, "utf8");
    const segments = segmentMarkdown(content, filePath, workspaceDir);

    const renumbered = segments.map((seg) => ({
      ...seg,
      id: globalId++,
    }));

    allSegments.push(...renumbered);
    fileInfos.push({
      path: relative(workspaceDir, filePath),
      segmentCount: renumbered.length,
      evergreen: renumbered[0]?.evergreen ?? isEvergreenFile(filePath, workspaceDir),
      date: extractDateFromFilename(basename(filePath)),
    });
  }

  return {
    segments: allSegments,
    files: fileInfos,
    totalSegments: allSegments.length,
  };
}

/**
 * Chunk file format parser/writer for working.md and consolidated.md.
 *
 * Format:
 * <!-- chunk:<id> type:<type> created:<iso> [strength:<float>] -->
 * Content here (multiline)
 * <!-- /chunk -->
 */

export type ChunkEntry = {
  id: string;
  type: string;
  created: string;
  strength?: number;
  content: string;
};

const CHUNK_OPEN_RE = /^<!-- chunk:(\S+)((?:\s+\w+:\S+)*)\s*-->$/;
const CHUNK_CLOSE_RE = /^<!-- \/chunk -->$/;

function parseAttrs(attrString: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /(\w+):(\S+)/g;
  let match;
  while ((match = re.exec(attrString)) !== null) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

export function parseChunks(text: string): ChunkEntry[] {
  const lines = text.split("\n");
  const chunks: ChunkEntry[] = [];
  let current: { id: string; attrs: Record<string, string>; lines: string[] } | null = null;

  for (const line of lines) {
    if (current) {
      if (CHUNK_CLOSE_RE.test(line.trim())) {
        const content = current.lines.join("\n").trim();
        chunks.push({
          id: current.id,
          type: current.attrs.type ?? "unknown",
          created: current.attrs.created ?? "",
          strength: current.attrs.strength ? parseFloat(current.attrs.strength) : undefined,
          content,
        });
        current = null;
      } else {
        current.lines.push(line);
      }
      continue;
    }

    const match = CHUNK_OPEN_RE.exec(line.trim());
    if (match) {
      current = {
        id: match[1],
        attrs: parseAttrs(match[2]),
        lines: [],
      };
    }
  }

  return chunks;
}

export function formatChunk(entry: ChunkEntry): string {
  let attrs = `type:${entry.type} created:${entry.created}`;
  if (entry.strength !== undefined) {
    attrs += ` strength:${entry.strength.toFixed(2)}`;
  }
  return `<!-- chunk:${entry.id} ${attrs} -->\n${entry.content}\n<!-- /chunk -->`;
}

export function formatChunkFile(title: string, entries: ChunkEntry[]): string {
  const header = `# ${title}\n`;
  if (entries.length === 0) return header;
  return header + "\n" + entries.map(formatChunk).join("\n\n") + "\n";
}

export function appendChunk(existingContent: string, entry: ChunkEntry): string {
  const trimmed = existingContent.trimEnd();
  return trimmed + "\n\n" + formatChunk(entry) + "\n";
}

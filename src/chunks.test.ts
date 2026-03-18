import { describe, expect, it } from "vitest";
import { appendChunk, formatChunk, formatChunkFile, parseChunks } from "./chunks.ts";

const SAMPLE = `# Working Memory

<!-- chunk:a1b2c3d4 type:narrative created:2026-02-28T14:30:00Z -->
Jari kertoi projektipalaverin menneen hyvin. Keskusteltiin muisti-pluginin
arkkitehtuurista ja päätettiin käyttää flat-tiedostoja tietokannan rinnalla.
<!-- /chunk -->

<!-- chunk:e5f6a7b8 type:fact created:2026-02-28T15:00:00Z -->
Jarin koiran nimi on Namu.
<!-- /chunk -->
`;

describe("parseChunks", () => {
  it("parses multiple chunks", () => {
    const chunks = parseChunks(SAMPLE);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].id).toBe("a1b2c3d4");
    expect(chunks[0].type).toBe("narrative");
    expect(chunks[0].created).toBe("2026-02-28T14:30:00Z");
    expect(chunks[0].content).toContain("projektipalaverin");
    expect(chunks[1].id).toBe("e5f6a7b8");
    expect(chunks[1].type).toBe("fact");
    expect(chunks[1].content).toBe("Jarin koiran nimi on Namu.");
  });

  it("parses strength attribute", () => {
    const text = `<!-- chunk:abc123 type:fact created:2026-01-01 strength:0.85 -->
Content here.
<!-- /chunk -->`;
    const chunks = parseChunks(text);
    expect(chunks[0].strength).toBe(0.85);
  });

  it("returns empty for empty file", () => {
    expect(parseChunks("# Empty\n")).toEqual([]);
  });
});

describe("formatChunk", () => {
  it("formats a chunk without strength", () => {
    const result = formatChunk({
      id: "abc123",
      type: "fact",
      created: "2026-03-01T10:00:00Z",
      content: "Test content.",
    });
    expect(result).toBe(
      "<!-- chunk:abc123 type:fact created:2026-03-01T10:00:00Z -->\nTest content.\n<!-- /chunk -->",
    );
  });

  it("formats a chunk with strength", () => {
    const result = formatChunk({
      id: "abc123",
      type: "fact",
      created: "2026-03-01",
      strength: 0.85,
      content: "Test.",
    });
    expect(result).toContain("strength:0.85");
  });
});

describe("formatChunkFile", () => {
  it("creates file with header", () => {
    const result = formatChunkFile("Working Memory", []);
    expect(result).toBe("# Working Memory\n");
  });

  it("creates file with entries", () => {
    const result = formatChunkFile("Working Memory", [
      { id: "a", type: "fact", created: "2026-01-01", content: "A" },
      { id: "b", type: "fact", created: "2026-01-02", content: "B" },
    ]);
    expect(result).toContain("# Working Memory");
    expect(result).toContain("chunk:a");
    expect(result).toContain("chunk:b");
  });
});

describe("appendChunk", () => {
  it("appends to existing content", () => {
    const existing = "# Working Memory\n";
    const result = appendChunk(existing, {
      id: "new123",
      type: "fact",
      created: "2026-03-01",
      content: "New fact.",
    });
    expect(result).toContain("# Working Memory");
    expect(result).toContain("chunk:new123");
    expect(result).toContain("New fact.");
  });
});

import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  discoverMemoryFiles,
  extractDateFromFilename,
  isEvergreenFile,
  prepareImport,
  segmentMarkdown,
} from "./import-preprocess.ts";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "import-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// -- discoverMemoryFiles --

describe("discoverMemoryFiles", () => {
  it("finds MEMORY.md at workspace root", () => {
    writeFileSync(join(tmpDir, "MEMORY.md"), "# Memories");
    const files = discoverMemoryFiles(tmpDir);
    expect(files.length).toBeGreaterThanOrEqual(1);
    expect(files.some((f) => f.toLowerCase().includes("memory.md"))).toBe(true);
  });

  it("finds memory.md at workspace root", () => {
    writeFileSync(join(tmpDir, "memory.md"), "# Memories");
    const files = discoverMemoryFiles(tmpDir);
    expect(files.length).toBeGreaterThanOrEqual(1);
    expect(files.some((f) => f.toLowerCase().includes("memory.md"))).toBe(true);
  });

  it("finds files in memory/ directory", () => {
    mkdirSync(join(tmpDir, "memory"));
    writeFileSync(join(tmpDir, "memory", "2026-03-15.md"), "# Day notes");
    writeFileSync(join(tmpDir, "memory", "2026-03-20.md"), "# More notes");
    const files = discoverMemoryFiles(tmpDir);
    expect(files).toHaveLength(2);
  });

  it("finds files in nested memory/ subdirectories", () => {
    mkdirSync(join(tmpDir, "memory", "sub"), { recursive: true });
    writeFileSync(join(tmpDir, "memory", "sub", "note.md"), "# Nested");
    const files = discoverMemoryFiles(tmpDir);
    expect(files).toHaveLength(1);
  });

  it("ignores non-md files in memory/", () => {
    mkdirSync(join(tmpDir, "memory"));
    writeFileSync(join(tmpDir, "memory", "note.txt"), "not markdown");
    writeFileSync(join(tmpDir, "memory", "2026-03-15.md"), "# Markdown");
    const files = discoverMemoryFiles(tmpDir);
    expect(files).toHaveLength(1);
  });

  it("includes extra paths (file)", () => {
    mkdirSync(join(tmpDir, "docs"));
    writeFileSync(join(tmpDir, "docs", "extra.md"), "# Extra");
    const files = discoverMemoryFiles(tmpDir, ["docs/extra.md"]);
    expect(files).toHaveLength(1);
  });

  it("includes extra paths (directory)", () => {
    mkdirSync(join(tmpDir, "docs"));
    writeFileSync(join(tmpDir, "docs", "a.md"), "# A");
    writeFileSync(join(tmpDir, "docs", "b.md"), "# B");
    const files = discoverMemoryFiles(tmpDir, ["docs"]);
    expect(files).toHaveLength(2);
  });

  it("deduplicates files found via multiple paths", () => {
    mkdirSync(join(tmpDir, "memory"));
    writeFileSync(join(tmpDir, "memory", "note.md"), "# Note");
    const files = discoverMemoryFiles(tmpDir, ["memory"]);
    expect(files).toHaveLength(1);
  });

  it("returns empty array when no memory files exist", () => {
    const files = discoverMemoryFiles(tmpDir);
    expect(files).toHaveLength(0);
  });

  it("ignores non-existent extra paths", () => {
    const files = discoverMemoryFiles(tmpDir, ["nonexistent/path.md"]);
    expect(files).toHaveLength(0);
  });

  it("handles absolute extra paths", () => {
    mkdirSync(join(tmpDir, "external"));
    writeFileSync(join(tmpDir, "external", "note.md"), "# Note");
    const files = discoverMemoryFiles(tmpDir, [join(tmpDir, "external", "note.md")]);
    expect(files).toHaveLength(1);
  });

  it("returns files in deterministic order (root first, then lexical)", () => {
    writeFileSync(join(tmpDir, "MEMORY.md"), "# Root");
    mkdirSync(join(tmpDir, "memory"));
    writeFileSync(join(tmpDir, "memory", "b.md"), "# B");
    writeFileSync(join(tmpDir, "memory", "a.md"), "# A");
    const files = discoverMemoryFiles(tmpDir);

    // Root memory file should be first
    expect(files[0].toLowerCase()).toContain("memory.md");
    expect(files[0]).not.toContain("memory/");
    // Then lexical order for non-root files
    const nonRoot = files.filter((f) => f.includes("memory/") || f.includes("memory\\"));
    expect(nonRoot[0]).toContain("a.md");
    expect(nonRoot[1]).toContain("b.md");
  });

  it("skips symlinks in memory/ directory", () => {
    mkdirSync(join(tmpDir, "memory"));
    mkdirSync(join(tmpDir, "other"));
    writeFileSync(join(tmpDir, "other", "note.md"), "# Other");
    writeFileSync(join(tmpDir, "memory", "real.md"), "# Real");
    symlinkSync(join(tmpDir, "other", "note.md"), join(tmpDir, "memory", "linked.md"));

    const files = discoverMemoryFiles(tmpDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toContain("real.md");
  });
});

// -- segmentMarkdown --

describe("segmentMarkdown", () => {
  const pad = " This is additional text to ensure the segment exceeds the minimum character threshold of two hundred characters for standalone segments in the import preprocessor.";

  it("segments by H1/H2/H3 headings", () => {
    const content = `# Section One

Content of section one.${pad}

## Section Two

Content of section two.${pad}

### Section Three

Content of section three.${pad}`;

    const segments = segmentMarkdown(content, join(tmpDir, "MEMORY.md"), tmpDir);
    expect(segments).toHaveLength(3);
    expect(segments[0].heading).toBe("# Section One");
    expect(segments[0].heading_level).toBe(1);
    expect(segments[0].content).toContain("Content of section one");
    expect(segments[1].heading).toBe("## Section Two");
    expect(segments[1].heading_level).toBe(2);
    expect(segments[2].heading).toBe("### Section Three");
    expect(segments[2].heading_level).toBe(3);
  });

  it("handles content before any heading", () => {
    const content = `Some introductory text here that is long enough to not be merged.

This is a second paragraph with enough content to stand on its own as a segment that exceeds the minimum size threshold for standalone segments.

# First Section

Section content here.`;

    const segments = segmentMarkdown(content, join(tmpDir, "MEMORY.md"), tmpDir);
    expect(segments.length).toBeGreaterThanOrEqual(1);
    expect(segments[0].heading).toBeNull();
    expect(segments[0].heading_level).toBeNull();
  });

  it("splits large segments by paragraph", () => {
    const paragraphs = Array.from({ length: 10 }, (_, i) =>
      `Paragraph ${i + 1}: ${"Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(5)}`,
    );
    const content = `# Big Section\n\n${paragraphs.join("\n\n")}`;

    const segments = segmentMarkdown(content, join(tmpDir, "MEMORY.md"), tmpDir);
    expect(segments.length).toBeGreaterThan(1);
    for (const seg of segments) {
      expect(seg.char_count).toBeLessThanOrEqual(2500);
    }
  });

  it("splits oversized single paragraphs at word boundaries", () => {
    // Single paragraph with no blank lines, > 2000 chars
    const longParagraph = "word ".repeat(500); // ~2500 chars
    const content = `# Big\n\n${longParagraph}`;

    const segments = segmentMarkdown(content, join(tmpDir, "MEMORY.md"), tmpDir);
    expect(segments.length).toBeGreaterThan(1);
    // All segments should respect max size
    for (const seg of segments) {
      expect(seg.char_count).toBeLessThanOrEqual(2100); // Small tolerance for heading
    }
  });

  it("merges small segments with previous (accumulator pattern)", () => {
    const content = `# Tiny

Hi.

# Normal Section

This is a normal section with enough content to meet the minimum size requirement and avoid being merged itself. It contains multiple sentences and provides meaningful information.`;

    const segments = segmentMarkdown(content, join(tmpDir, "MEMORY.md"), tmpDir);
    expect(segments).toHaveLength(1);
    expect(segments[0].content).toContain("Hi.");
    expect(segments[0].content).toContain("Normal Section");
  });

  it("handles empty content", () => {
    const segments = segmentMarkdown("", join(tmpDir, "MEMORY.md"), tmpDir);
    expect(segments).toHaveLength(0);
  });

  it("handles content with only headings", () => {
    const content = `# Heading One

# Heading Two

# Heading Three`;

    const segments = segmentMarkdown(content, join(tmpDir, "MEMORY.md"), tmpDir);
    expect(segments.length).toBeGreaterThanOrEqual(1);
  });

  it("strips YAML frontmatter", () => {
    const content = `---
name: test
type: user
---

# Actual Content

This is the real content after frontmatter, and it should be parsed correctly without the YAML block.`;

    const segments = segmentMarkdown(content, join(tmpDir, "MEMORY.md"), tmpDir);
    expect(segments.length).toBeGreaterThanOrEqual(1);
    expect(segments[0].content).not.toContain("name: test");
    expect(segments[0].content).toContain("Actual Content");
  });

  it("strips frontmatter with CRLF line endings", () => {
    const content = "---\r\nname: test\r\n---\r\n\r\n# Content\r\n\r\nBody text after CRLF frontmatter that is long enough to be a standalone segment.";

    const segments = segmentMarkdown(content, join(tmpDir, "MEMORY.md"), tmpDir);
    expect(segments.length).toBeGreaterThanOrEqual(1);
    expect(segments[0].content).not.toContain("name: test");
    expect(segments[0].content).toContain("Content");
  });

  it("strips frontmatter with BOM", () => {
    const content = "\uFEFF---\nname: test\n---\n\n# Content\n\nBody text after BOM frontmatter that is long enough to be a standalone segment.";

    const segments = segmentMarkdown(content, join(tmpDir, "MEMORY.md"), tmpDir);
    expect(segments.length).toBeGreaterThanOrEqual(1);
    expect(segments[0].content).not.toContain("name: test");
  });

  it("does not split on headings inside fenced code blocks", () => {
    const content = `# Real Section

Here is a code example:${pad}

\`\`\`markdown
## This is not a real heading

Some code content here.
\`\`\`

More text after the code block.`;

    const segments = segmentMarkdown(content, join(tmpDir, "MEMORY.md"), tmpDir);
    // Should be ONE section — the ## inside the code block is not a heading
    expect(segments).toHaveLength(1);
    expect(segments[0].content).toContain("## This is not a real heading");
    expect(segments[0].content).toContain("More text after");
  });

  it("does not split on headings inside tilde code blocks", () => {
    const content = `# Main Section

Some content before:${pad}

~~~
# Comment in code
## Another comment
~~~

Text after code.`;

    const segments = segmentMarkdown(content, join(tmpDir, "MEMORY.md"), tmpDir);
    expect(segments).toHaveLength(1);
    expect(segments[0].content).toContain("# Comment in code");
  });

  it("preserves code blocks within segments", () => {
    const content = `# Code Example

Here is some code:

\`\`\`typescript
function hello() {
  console.log("world");
}
\`\`\`

This section has enough text to stand on its own as a meaningful segment worth preserving in the migration.`;

    const segments = segmentMarkdown(content, join(tmpDir, "MEMORY.md"), tmpDir);
    expect(segments.length).toBeGreaterThanOrEqual(1);
    const codeSegment = segments.find((s) => s.content.includes("console.log"));
    expect(codeSegment).toBeDefined();
  });

  it("preserves lists within segments", () => {
    const content = `# Todo Items

Things to remember about this project that are important enough to keep:

- Item one is about the database
- Item two is about the API
- Item three is about testing
- Item four is about deployment`;

    const segments = segmentMarkdown(content, join(tmpDir, "MEMORY.md"), tmpDir);
    expect(segments.length).toBeGreaterThanOrEqual(1);
    const listSegment = segments.find((s) => s.content.includes("Item one"));
    expect(listSegment).toBeDefined();
    expect(listSegment!.content).toContain("- Item one");
  });

  it("handles unicode content", () => {
    const content = `# Muistiinpanot

Tämä on suomenkielinen muistiinpano joka sisältää ääkkösiä: ä, ö, å. Myös erikoismerkkejä kuten € ja ™ toimivat oikein tässä segmentoinnissa.`;

    const segments = segmentMarkdown(content, join(tmpDir, "MEMORY.md"), tmpDir);
    expect(segments).toHaveLength(1);
    expect(segments[0].content).toContain("ääkkösiä");
    expect(segments[0].content).toContain("€");
  });

  it("sets evergreen=true for MEMORY.md", () => {
    const content = `# Memory\n\nSome evergreen content here that is long enough to not be merged with anything.`;
    const segments = segmentMarkdown(content, join(tmpDir, "MEMORY.md"), tmpDir);
    expect(segments[0].evergreen).toBe(true);
  });

  it("sets evergreen=true for memory.md", () => {
    const content = `# Memory\n\nSome evergreen content here that is long enough to not be merged with anything.`;
    const segments = segmentMarkdown(content, join(tmpDir, "memory.md"), tmpDir);
    expect(segments[0].evergreen).toBe(true);
  });

  it("sets evergreen=false for memory/*.md files", () => {
    mkdirSync(join(tmpDir, "memory"));
    const filePath = join(tmpDir, "memory", "2026-03-15.md");
    const content = `# Day Notes\n\nThese are daily notes that should not be marked as evergreen content in the import.`;
    const segments = segmentMarkdown(content, filePath, tmpDir);
    expect(segments[0].evergreen).toBe(false);
  });

  it("extracts date from filename", () => {
    mkdirSync(join(tmpDir, "memory"));
    const filePath = join(tmpDir, "memory", "2026-03-15.md");
    const content = `# Day Notes\n\nContent for this day that is long enough to not be merged with another segment.`;
    const segments = segmentMarkdown(content, filePath, tmpDir);
    expect(segments[0].date).toBe("2026-03-15");
  });

  it("sets date=null for non-date filenames", () => {
    const content = `# Notes\n\nContent here that is long enough to not be merged with another segment.`;
    const segments = segmentMarkdown(content, join(tmpDir, "MEMORY.md"), tmpDir);
    expect(segments[0].date).toBeNull();
  });

  it("uses POSIX-style source_file path", () => {
    mkdirSync(join(tmpDir, "memory"));
    const filePath = join(tmpDir, "memory", "note.md");
    const content = `# Note\n\nContent that is long enough to not be merged with another segment in this test.`;
    const segments = segmentMarkdown(content, filePath, tmpDir);
    // Should always use forward slashes regardless of platform
    expect(segments[0].source_file).toBe("memory/note.md");
    expect(segments[0].source_file).not.toContain("\\");
  });

  it("computes char_count correctly", () => {
    const content = `# Test\n\nHello world, this is a test of the character counting functionality in the segmentation module.`;
    const segments = segmentMarkdown(content, join(tmpDir, "MEMORY.md"), tmpDir);
    expect(segments[0].char_count).toBe(segments[0].content.length);
  });

  it("handles mixed heading levels", () => {
    const content = `# H1 Top Level

Top level content that is sufficient in length to avoid merging behavior.${pad}

### H3 Skipped H2

This skips H2 and goes directly to H3 with enough content to be standalone.${pad}

## H2 After H3

Now back to H2 with sufficient content to remain as its own segment.${pad}`;

    const segments = segmentMarkdown(content, join(tmpDir, "MEMORY.md"), tmpDir);
    expect(segments.length).toBeGreaterThanOrEqual(2);
  });

  it("does not split on H4+ headings", () => {
    const content = `# Main Section

Some content here.

#### Sub-sub heading

More content after a deep heading that should not cause a split because we only split on H1-H3 level headings in the segmentation logic.`;

    const segments = segmentMarkdown(content, join(tmpDir, "MEMORY.md"), tmpDir);
    const allContent = segments.map((s) => s.content).join("\n");
    expect(allContent).toContain("#### Sub-sub heading");
  });
});

// -- extractDateFromFilename --

describe("extractDateFromFilename", () => {
  it("extracts YYYY-MM-DD from filename", () => {
    expect(extractDateFromFilename("2026-03-15.md")).toBe("2026-03-15");
  });

  it("returns null for non-date filenames", () => {
    expect(extractDateFromFilename("notes.md")).toBeNull();
    expect(extractDateFromFilename("MEMORY.md")).toBeNull();
  });

  it("returns null for partial date formats", () => {
    expect(extractDateFromFilename("2026-03.md")).toBeNull();
    expect(extractDateFromFilename("03-15.md")).toBeNull();
  });
});

// -- isEvergreenFile --

describe("isEvergreenFile", () => {
  it("returns true for root MEMORY.md", () => {
    expect(isEvergreenFile(join(tmpDir, "MEMORY.md"), tmpDir)).toBe(true);
  });

  it("returns true for root memory.md", () => {
    expect(isEvergreenFile(join(tmpDir, "memory.md"), tmpDir)).toBe(true);
  });

  it("returns false for memory/ subdirectory files", () => {
    expect(isEvergreenFile(join(tmpDir, "memory", "2026-03-15.md"), tmpDir)).toBe(false);
  });

  it("returns false for memory.md inside memory/ directory", () => {
    expect(isEvergreenFile(join(tmpDir, "memory", "memory.md"), tmpDir)).toBe(false);
  });
});

// -- prepareImport --

describe("prepareImport", () => {
  it("processes full workspace", () => {
    writeFileSync(
      join(tmpDir, "MEMORY.md"),
      `# Project Facts

The project uses SQLite with WAL mode for optimal concurrent reads. This is an important architectural decision that affects how we handle database connections and write-ahead logging.

## Team Preferences

The team prefers TypeScript and functional programming patterns whenever possible. We also use vitest for testing and pnpm for package management across all projects.`,
    );

    mkdirSync(join(tmpDir, "memory"));
    writeFileSync(
      join(tmpDir, "memory", "2026-03-15.md"),
      `# Daily Notes

Today we discussed the migration plan and decided to use a two-phase approach for moving memories from memory-core to the associative memory system.`,
    );

    const result = prepareImport(tmpDir);

    expect(result.totalSegments).toBeGreaterThan(0);
    expect(result.files.length).toBeGreaterThanOrEqual(2);
    expect(result.errors).toHaveLength(0);
  });

  it("assigns globally unique segment IDs", () => {
    writeFileSync(join(tmpDir, "MEMORY.md"), "# A\n\nContent for section A that is long enough.\n\n# B\n\nContent for section B that is long enough.");
    mkdirSync(join(tmpDir, "memory"));
    writeFileSync(join(tmpDir, "memory", "note.md"), "# C\n\nContent for section C that is long enough.");

    const result = prepareImport(tmpDir);

    const ids = result.segments.map((s) => s.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
    for (let i = 0; i < ids.length; i++) {
      expect(ids[i]).toBe(i);
    }
  });

  it("returns empty result when no files found", () => {
    const result = prepareImport(tmpDir);

    expect(result.totalSegments).toBe(0);
    expect(result.files).toHaveLength(0);
    expect(result.segments).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it("includes correct file metadata", () => {
    writeFileSync(join(tmpDir, "MEMORY.md"), "# Facts\n\nSome important project facts that should be remembered across sessions.");
    mkdirSync(join(tmpDir, "memory"));
    writeFileSync(join(tmpDir, "memory", "2026-04-01.md"), "# Notes\n\nDaily notes from this particular day with enough content.");

    const result = prepareImport(tmpDir);

    const evergreenFile = result.files.find((f) => f.path === "MEMORY.md");
    expect(evergreenFile).toBeDefined();
    expect(evergreenFile!.evergreen).toBe(true);
    expect(evergreenFile!.date).toBeNull();

    const datedFile = result.files.find((f) => f.path.includes("2026-04-01"));
    expect(datedFile).toBeDefined();
    expect(datedFile!.evergreen).toBe(false);
    expect(datedFile!.date).toBe("2026-04-01");
  });

  it("continues on unreadable files and collects errors", () => {
    writeFileSync(join(tmpDir, "MEMORY.md"), "# Good\n\nThis file is readable and should be processed successfully.");
    mkdirSync(join(tmpDir, "memory"));
    const badFile = join(tmpDir, "memory", "bad.md");
    writeFileSync(badFile, "# Bad");
    chmodSync(badFile, 0o000);

    const result = prepareImport(tmpDir);

    // Good file should still be processed
    expect(result.totalSegments).toBeGreaterThan(0);
    // Bad file should be in errors
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].path).toContain("bad.md");

    // Restore permissions for cleanup
    chmodSync(badFile, 0o644);
  });

  it("uses POSIX paths in file metadata", () => {
    mkdirSync(join(tmpDir, "memory"));
    writeFileSync(join(tmpDir, "memory", "note.md"), "# Note\n\nContent here.");

    const result = prepareImport(tmpDir);

    for (const f of result.files) {
      expect(f.path).not.toContain("\\");
    }
  });
});

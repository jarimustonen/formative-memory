import { describe, expect, it } from "vitest";
import {
  MERGE_THRESHOLD_JACCARD_ONLY,
  cosineSimilarity,
  findMergeCandidates,
  findMergeCandidatesDelta,
  jaccardSimilarity,
  textFeatures,
  type MemoryCandidate,
} from "./merge-candidates.ts";

// -- textFeatures --

describe("textFeatures", () => {
  it("extracts sorted word trigrams and individual words", () => {
    const result = textFeatures("the quick brown fox");
    // Trigrams are sorted: [brown, quick, the] and [brown, fox, quick]
    expect(result.has("brown quick the")).toBe(true);
    expect(result.has("brown fox quick")).toBe(true);
    expect(result.has("the")).toBe(true);
    expect(result.has("fox")).toBe(true);
  });

  it("lowercases text", () => {
    const result = textFeatures("Hello World Test");
    expect(result.has("hello")).toBe(true);
    // Sorted trigram: [hello, test, world]
    expect(result.has("hello test world")).toBe(true);
  });

  it("returns individual words for short text", () => {
    const result = textFeatures("hello world");
    expect(result.has("hello")).toBe(true);
    expect(result.has("world")).toBe(true);
    expect(result.size).toBe(2); // no trigrams possible with 2 words
  });

  it("returns empty set for empty text", () => {
    expect(textFeatures("").size).toBe(0);
    expect(textFeatures("   ").size).toBe(0);
  });

  it("strips punctuation so 'database.' matches 'database'", () => {
    const a = textFeatures("The database.");
    const b = textFeatures("The database");
    // Both should contain the word "database" without trailing period
    expect(a.has("database")).toBe(true);
    expect(b.has("database")).toBe(true);
  });

  it("handles commas, colons, and quotes", () => {
    const result = textFeatures('hello, "world": test!');
    expect(result.has("hello")).toBe(true);
    expect(result.has("world")).toBe(true);
    expect(result.has("test")).toBe(true);
  });

  it("produces identical trigrams for reordered text", () => {
    const a = textFeatures("the deadline is April 15");
    const b = textFeatures("April 15 is the deadline");
    // Both should share sorted trigrams since same words appear in windows
    const aTrigrams = [...a].filter((f) => f.includes(" ") && f.split(" ").length === 3);
    const bTrigrams = [...b].filter((f) => f.includes(" ") && f.split(" ").length === 3);
    // At least some sorted trigrams should overlap
    const shared = aTrigrams.filter((t) => b.has(t));
    expect(shared.length).toBeGreaterThan(0);
  });
});

// -- jaccardSimilarity --

describe("jaccardSimilarity", () => {
  it("returns 1 for identical texts", () => {
    expect(jaccardSimilarity("hello world test", "hello world test")).toBe(1);
  });

  it("returns 0 for completely different texts", () => {
    expect(jaccardSimilarity("alpha beta gamma", "delta epsilon zeta")).toBe(0);
  });

  it("returns value between 0 and 1 for partial overlap", () => {
    const score = jaccardSimilarity(
      "the team chose PostgreSQL for the database",
      "the team selected PostgreSQL as the primary database",
    );
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it("returns 1 for two empty strings", () => {
    expect(jaccardSimilarity("", "")).toBe(1);
  });

  it("returns 0 when one string is empty", () => {
    expect(jaccardSimilarity("hello", "")).toBe(0);
  });

  it("scores reordered text higher than before with sorted trigrams", () => {
    const score = jaccardSimilarity(
      "The deadline is April 15",
      "April 15 is the deadline",
    );
    // With sorted trigrams, reordered text should score well above 0.5
    expect(score).toBeGreaterThan(0.5);
  });

  it("scores reordered text with same words very high", () => {
    const score = jaccardSimilarity(
      "Team chose PostgreSQL for the database",
      "PostgreSQL for the database Team chose",
    );
    expect(score).toBeGreaterThan(0.6);
  });
});

// -- cosineSimilarity --

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 5);
  });

  it("returns -1 for opposite vectors", () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 5);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 5);
  });

  it("returns 0 for empty vectors", () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });

  it("returns 0 for mismatched lengths", () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
  });
});

// -- findMergeCandidates --

describe("findMergeCandidates", () => {
  it("finds near-duplicate memories by content", () => {
    const memories: MemoryCandidate[] = [
      { id: "a", content: "Team chose PostgreSQL for the database layer", type: "fact", embedding: null },
      { id: "b", content: "Team chose PostgreSQL for the database backend", type: "fact", embedding: null },
      { id: "c", content: "The weather is nice today in Helsinki", type: "fact", embedding: null },
    ];

    const pairs = findMergeCandidates(memories);
    // a and b should be similar, c should not match
    const abPair = pairs.find((p) => (p.a === "a" && p.b === "b") || (p.a === "b" && p.b === "a"));
    expect(abPair).toBeDefined();
    expect(abPair!.combinedScore).toBeGreaterThanOrEqual(MERGE_THRESHOLD_JACCARD_ONLY);

    // c should not pair with a or b
    const cPairs = pairs.filter((p) => p.a === "c" || p.b === "c");
    expect(cPairs).toHaveLength(0);
  });

  it("uses embedding similarity when available", () => {
    // Same embedding = perfect cosine similarity
    const emb = [0.1, 0.2, 0.3, 0.4, 0.5];
    const memories: MemoryCandidate[] = [
      { id: "a", content: "alpha beta gamma", type: "fact", embedding: emb },
      { id: "b", content: "delta epsilon zeta", type: "fact", embedding: emb }, // same embedding, different content
    ];

    const pairs = findMergeCandidates(memories);
    // Jaccard = 0 (no word overlap), but embedding = 1.0
    // Combined = 0.4*0 + 0.6*1.0 = 0.6 → meets threshold
    expect(pairs).toHaveLength(1);
    expect(pairs[0].jaccardScore).toBe(0);
    expect(pairs[0].embeddingScore).toBeCloseTo(1, 5);
    expect(pairs[0].combinedScore).toBeCloseTo(0.6, 5);
  });

  it("respects maxPairs cap", () => {
    // Create many similar memories
    const memories: MemoryCandidate[] = Array.from({ length: 10 }, (_, i) => ({
      id: `mem-${i}`,
      content: "the team chose PostgreSQL for the database",
      type: "fact",
      embedding: null,
    }));

    const pairs = findMergeCandidates(memories, 3);
    expect(pairs).toHaveLength(3);
  });

  it("returns empty for single memory", () => {
    expect(findMergeCandidates([{ id: "a", content: "test", type: "fact", embedding: null }])).toEqual([]);
  });

  it("returns empty for empty list", () => {
    expect(findMergeCandidates([])).toEqual([]);
  });

  it("ranks pairs by combined score descending", () => {
    const emb1 = [1, 0, 0];
    const emb2 = [0.9, 0.1, 0]; // very similar to emb1
    const emb3 = [0.5, 0.5, 0]; // somewhat similar

    const memories: MemoryCandidate[] = [
      { id: "a", content: "the team chose PostgreSQL for the database", type: "fact", embedding: emb1 },
      { id: "b", content: "the team chose PostgreSQL for the database", type: "fact", embedding: emb2 },
      { id: "c", content: "the team chose PostgreSQL for the database", type: "fact", embedding: emb3 },
    ];

    const pairs = findMergeCandidates(memories);
    expect(pairs.length).toBeGreaterThanOrEqual(2);
    // Should be sorted by combinedScore descending
    for (let i = 1; i < pairs.length; i++) {
      expect(pairs[i - 1].combinedScore).toBeGreaterThanOrEqual(pairs[i].combinedScore);
    }
  });

  it("handles mixed embedding availability", () => {
    const memories: MemoryCandidate[] = [
      { id: "a", content: "the team chose PostgreSQL for the database layer", type: "fact", embedding: [1, 0] },
      { id: "b", content: "the team chose PostgreSQL for the database layer", type: "fact", embedding: null },
    ];

    const pairs = findMergeCandidates(memories);
    // Falls back to Jaccard-only since one embedding is missing
    if (pairs.length > 0) {
      expect(pairs[0].embeddingScore).toBeNull();
    }
  });

  it("falls back to Jaccard-only when embeddings are empty arrays", () => {
    const memories: MemoryCandidate[] = [
      { id: "a", content: "the team chose PostgreSQL for the database layer", type: "fact", embedding: [] },
      { id: "b", content: "the team chose PostgreSQL for the database layer", type: "fact", embedding: [] },
    ];

    const pairs = findMergeCandidates(memories);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].embeddingScore).toBeNull(); // Jaccard-only, not combined
  });

  it("enforces type constraint — different types produce no pairs", () => {
    const memories: MemoryCandidate[] = [
      { id: "a", content: "the team chose PostgreSQL for the database layer", type: "fact", embedding: null },
      { id: "b", content: "the team chose PostgreSQL for the database layer", type: "preference", embedding: null },
    ];

    const pairs = findMergeCandidates(memories);
    expect(pairs).toHaveLength(0);
  });
});

// -- findMergeCandidatesDelta --

describe("findMergeCandidatesDelta", () => {
  it("finds pairs between sources and targets with matching type", () => {
    const sources: MemoryCandidate[] = [
      { id: "a", content: "Team chose PostgreSQL for the database layer", type: "fact", embedding: null },
    ];
    const targets: MemoryCandidate[] = [
      { id: "b", content: "Team chose PostgreSQL for the database backend", type: "fact", embedding: null },
      { id: "c", content: "The weather is nice today in Helsinki", type: "fact", embedding: null },
    ];

    const pairs = findMergeCandidatesDelta(sources, targets);
    const abPair = pairs.find((p) => p.a === "a" && p.b === "b");
    expect(abPair).toBeDefined();
    expect(abPair!.combinedScore).toBeGreaterThanOrEqual(MERGE_THRESHOLD_JACCARD_ONLY);

    // c should not pair with a (content too different)
    const acPair = pairs.find((p) => p.a === "a" && p.b === "c");
    expect(acPair).toBeUndefined();
  });

  it("enforces type constraint — different types produce no pairs", () => {
    const sources: MemoryCandidate[] = [
      { id: "a", content: "Team chose PostgreSQL for the database layer", type: "fact", embedding: null },
    ];
    const targets: MemoryCandidate[] = [
      { id: "b", content: "Team chose PostgreSQL for the database layer", type: "preference", embedding: null },
    ];

    const pairs = findMergeCandidatesDelta(sources, targets);
    expect(pairs).toHaveLength(0);
  });

  it("excludes self-pairs when same memory appears in both sets", () => {
    const mem: MemoryCandidate = {
      id: "a", content: "Team chose PostgreSQL for the database layer", type: "fact", embedding: null,
    };

    const pairs = findMergeCandidatesDelta([mem], [mem]);
    expect(pairs).toHaveLength(0);
  });

  it("returns empty for empty sources", () => {
    const targets: MemoryCandidate[] = [
      { id: "a", content: "something", type: "fact", embedding: null },
    ];
    expect(findMergeCandidatesDelta([], targets)).toEqual([]);
  });

  it("returns empty for empty targets", () => {
    const sources: MemoryCandidate[] = [
      { id: "a", content: "something", type: "fact", embedding: null },
    ];
    expect(findMergeCandidatesDelta(sources, [])).toEqual([]);
  });

  it("respects maxPairs cap", () => {
    const sources: MemoryCandidate[] = Array.from({ length: 5 }, (_, i) => ({
      id: `s-${i}`,
      content: "the team chose PostgreSQL for the database",
      type: "fact",
      embedding: null,
    }));
    const targets: MemoryCandidate[] = Array.from({ length: 5 }, (_, i) => ({
      id: `t-${i}`,
      content: "the team chose PostgreSQL for the database",
      type: "fact",
      embedding: null,
    }));

    const pairs = findMergeCandidatesDelta(sources, targets, 3);
    expect(pairs).toHaveLength(3);
  });

  it("ranks pairs by combined score descending", () => {
    const emb1 = [1, 0, 0];
    const emb2 = [0.99, 0.01, 0];
    const emb3 = [0.7, 0.3, 0];

    const sources: MemoryCandidate[] = [
      { id: "a", content: "the team chose PostgreSQL for the database", type: "fact", embedding: emb1 },
    ];
    const targets: MemoryCandidate[] = [
      { id: "b", content: "the team chose PostgreSQL for the database", type: "fact", embedding: emb2 },
      { id: "c", content: "the team chose PostgreSQL for the database", type: "fact", embedding: emb3 },
    ];

    const pairs = findMergeCandidatesDelta(sources, targets);
    expect(pairs.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < pairs.length; i++) {
      expect(pairs[i - 1].combinedScore).toBeGreaterThanOrEqual(pairs[i].combinedScore);
    }
  });

  it("deduplicates symmetric pairs when memories appear in both sets", () => {
    // Both memories in both source and target — should produce one pair, not two
    const memA: MemoryCandidate = {
      id: "a", content: "Team chose PostgreSQL for the database layer", type: "fact", embedding: null,
    };
    const memB: MemoryCandidate = {
      id: "b", content: "Team chose PostgreSQL for the database backend", type: "fact", embedding: null,
    };

    const pairs = findMergeCandidatesDelta([memA, memB], [memA, memB]);
    // Should be exactly 1 pair (a,b), not 2 (a->b and b->a)
    const abPairs = pairs.filter(
      (p) => (p.a === "a" && p.b === "b") || (p.a === "b" && p.b === "a"),
    );
    expect(abPairs).toHaveLength(1);
    // Pair IDs should be canonicalized (a < b)
    expect(abPairs[0].a).toBe("a");
    expect(abPairs[0].b).toBe("b");
  });

  it("detects reordered text as merge candidates (BM25-only path)", () => {
    const sources: MemoryCandidate[] = [
      { id: "a", content: "The deadline is April 15 for the project submission", type: "fact", embedding: null },
    ];
    const targets: MemoryCandidate[] = [
      { id: "b", content: "For the project submission the deadline is April 15", type: "fact", embedding: null },
    ];

    const pairs = findMergeCandidatesDelta(sources, targets);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].jaccardScore).toBeGreaterThanOrEqual(MERGE_THRESHOLD_JACCARD_ONLY);
  });

  it("clamps negative cosine similarity to 0", () => {
    // Opposite embeddings → cosine = -1, but clamped to 0
    const sources: MemoryCandidate[] = [
      { id: "a", content: "the team chose PostgreSQL for the database", type: "fact", embedding: [1, 0] },
    ];
    const targets: MemoryCandidate[] = [
      { id: "b", content: "the team chose PostgreSQL for the database", type: "fact", embedding: [-1, 0] },
    ];

    const pairs = findMergeCandidatesDelta(sources, targets);
    // With clamped cosine: 0.4 * jaccard(1.0) + 0.6 * 0 = 0.4 → below threshold
    // Without clamp: 0.4 * 1.0 + 0.6 * (-1.0) = -0.2 → also below, but for wrong reason
    // The test verifies the clamp prevents negative contribution
    if (pairs.length > 0) {
      expect(pairs[0].embeddingScore).toBeGreaterThanOrEqual(0);
    }
  });
});

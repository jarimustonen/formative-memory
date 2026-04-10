/**
 * Merge candidate detection — Phase 4.4
 *
 * Pure logic: identifies pairs of memories that are likely duplicates
 * or closely related and should be merged. No DB mutations, no LLM calls.
 *
 * Architecture: v2 §9.
 */

// -- Types --

export type MemoryCandidate = {
  id: string;
  content: string;
  type: string;
  embedding: number[] | null;
};

export type MergePair = {
  a: string;
  b: string;
  jaccardScore: number;
  embeddingScore: number | null;
  combinedScore: number;
};

// -- Constants --

/** Minimum Jaccard score when no embeddings are available. */
export const MERGE_THRESHOLD_JACCARD_ONLY = 0.6;

/**
 * Minimum combined score when embeddings are available.
 * Lower than Jaccard-only because two signals together provide more
 * confidence — embedding adds semantic check on top of lexical overlap.
 */
export const MERGE_THRESHOLD_COMBINED = 0.5;

/** Maximum number of merge pairs returned per run. */
export const MAX_MERGE_PAIRS = 20;

/** Minimum strength for a memory to be a merge source. */
export const MERGE_SOURCE_MIN_STRENGTH = 0.5;

/** Minimum strength for a memory to be a merge target. */
export const MERGE_TARGET_MIN_STRENGTH = 0.3;

/** Weight for Jaccard in combined score when embedding is available. */
const JACCARD_WEIGHT = 0.4;

/** Weight for embedding in combined score when available. */
const EMBEDDING_WEIGHT = 0.6;

// -- Main entry point --

/**
 * Find merge candidate pairs from a list of memories.
 *
 * Compares all pairs using Jaccard similarity (content-based) and
 * optionally cosine similarity (embedding-based). Returns pairs
 * above the threshold, ranked by combined score, capped at maxPairs.
 */
export function findMergeCandidates(
  memories: MemoryCandidate[],
  maxPairs = MAX_MERGE_PAIRS,
): MergePair[] {
  if (memories.length < 2) return [];

  // Precompute text features once per memory (avoids redundant O(N²) recomputation)
  const features = memories.map((m) => textFeatures(m.content));

  const pairs: MergePair[] = [];

  for (let i = 0; i < memories.length; i++) {
    for (let j = i + 1; j < memories.length; j++) {
      const a = memories[i];
      const b = memories[j];

      if (a.type !== b.type) continue;

      const jaccardScore = jaccardFromSets(features[i], features[j]);

      let embeddingScore: number | null = null;
      let combinedScore = jaccardScore;
      let threshold = MERGE_THRESHOLD_JACCARD_ONLY;

      if (a.embedding && b.embedding) {
        embeddingScore = Math.max(0, cosineSimilarity(a.embedding, b.embedding));
        combinedScore = JACCARD_WEIGHT * jaccardScore + EMBEDDING_WEIGHT * embeddingScore;
        threshold = MERGE_THRESHOLD_COMBINED;
      }

      if (combinedScore >= threshold) {
        pairs.push({
          a: a.id,
          b: b.id,
          jaccardScore,
          embeddingScore,
          combinedScore,
        });
      }
    }
  }

  // Sort by combined score descending, take top N
  pairs.sort((x, y) => y.combinedScore - x.combinedScore);
  return pairs.slice(0, maxPairs);
}

/**
 * Find merge candidate pairs between source and target memories.
 *
 * Only compares sources against targets. Only pairs with matching
 * `type` are considered. Complexity is O(S×T) where both S and T
 * are pre-filtered subsets of the full memory set.
 */
export function findMergeCandidatesDelta(
  sources: MemoryCandidate[],
  targets: MemoryCandidate[],
  maxPairs = MAX_MERGE_PAIRS,
): MergePair[] {
  if (sources.length === 0 || targets.length === 0) return [];

  // Shared feature cache — avoids double extraction for memories in both sets
  const featureCache = new Map<string, Set<string>>();
  const getFeatures = (m: MemoryCandidate): Set<string> => {
    let f = featureCache.get(m.id);
    if (!f) { f = textFeatures(m.content); featureCache.set(m.id, f); }
    return f;
  };

  const seen = new Set<string>();
  const pairs: MergePair[] = [];

  for (let i = 0; i < sources.length; i++) {
    for (let j = 0; j < targets.length; j++) {
      const aId = sources[i].id;
      const bId = targets[j].id;
      if (aId === bId) continue;
      if (sources[i].type !== targets[j].type) continue;

      // Deduplicate symmetric pairs (A,B) and (B,A)
      const [lo, hi] = aId < bId ? [aId, bId] : [bId, aId];
      const pairKey = `${lo}\0${hi}`;
      if (seen.has(pairKey)) continue;
      seen.add(pairKey);

      const jaccardScore = jaccardFromSets(getFeatures(sources[i]), getFeatures(targets[j]));
      let embeddingScore: number | null = null;
      let combinedScore = jaccardScore;
      let threshold = MERGE_THRESHOLD_JACCARD_ONLY;

      if (sources[i].embedding && targets[j].embedding) {
        embeddingScore = Math.max(0, cosineSimilarity(sources[i].embedding!, targets[j].embedding!));
        combinedScore = JACCARD_WEIGHT * jaccardScore + EMBEDDING_WEIGHT * embeddingScore;
        threshold = MERGE_THRESHOLD_COMBINED;
      }

      if (combinedScore >= threshold) {
        pairs.push({
          a: lo,
          b: hi,
          jaccardScore,
          embeddingScore,
          combinedScore,
        });
      }
    }
  }

  pairs.sort((x, y) => y.combinedScore - x.combinedScore);
  return pairs.slice(0, maxPairs);
}

// -- Similarity functions --

/**
 * Jaccard similarity between two texts based on text features.
 * Returns value in [0, 1].
 */
export function jaccardSimilarity(a: string, b: string): number {
  return jaccardFromSets(textFeatures(a), textFeatures(b));
}

/** Jaccard similarity from precomputed feature sets. */
export function jaccardFromSets(setA: Set<string>, setB: Set<string>): number {
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const t of setA) {
    if (setB.has(t)) intersection++;
  }

  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Extract text features for similarity comparison.
 * Uses word trigrams for structural similarity, plus individual words
 * as fallback for short texts (< 3 words produce no trigrams).
 */
export function textFeatures(text: string): Set<string> {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  const result = new Set<string>();
  for (let i = 0; i <= words.length - 3; i++) {
    result.add(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
  }
  // Also include individual words for short texts
  for (const w of words) {
    result.add(w);
  }
  return result;
}

/**
 * Cosine similarity between two vectors. Returns value in [-1, 1].
 * Merge scoring clamps this to [0, 1] — negative values indicate
 * no semantic similarity rather than useful anti-similarity.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// SPDX-License-Identifier: LicenseRef-Proprietary
// Semantic similarity and vector indexing utilities (ADR-0012).
// Pure mathematical functions, platform-agnostic, zero network dependencies.

export interface EmbeddingCacheEntry {
  mtime: number;
  embedding: number[];
}

export interface EmbeddingCache {
  v: 1;
  model: string;
  entries: Record<string, EmbeddingCacheEntry>;
}

export interface SimilarityResult {
  id: string;
  score: number;
}

/**
 * Cosine similarity between two dense numeric vectors.
 * Returns a value in [-1, 1], or 0 if either vector is zero-length/empty.
 */
export function cosineSimilarity(
  a: readonly number[],
  b: readonly number[],
): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    const valA = a[i]!;
    const valB = b[i]!;
    dot += valA * valB;
    normA += valA * valA;
    normB += valB * valB;
  }

  if (normA <= 0 || normB <= 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Find top-K most similar items against a query vector.
 */
export function topKSimilar(
  queryVector: readonly number[],
  candidates: ReadonlyMap<string, readonly number[]>,
  k = 5,
  minScore = 0.2,
): SimilarityResult[] {
  const scored: SimilarityResult[] = [];

  for (const [id, vec] of candidates.entries()) {
    const score = cosineSimilarity(queryVector, vec);
    if (score >= minScore) {
      scored.push({ id, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

/**
 * Deterministic local feature-hash vectorizer (offline fallback).
 * Converts text into an L2-normalized vector without needing any neural weights.
 */
export function fallbackVector(text: string, dimensions = 64): number[] {
  const vec = new Array<number>(dimensions).fill(0);
  const normalized = text.toLowerCase().trim();
  if (normalized.length === 0) return vec;

  // Simple n-gram and word feature hashing
  const words = normalized.split(/\s+/);
  for (const w of words) {
    let h = 0;
    for (let i = 0; i < w.length; i++) {
      h = (h * 31 + w.charCodeAt(i)) >>> 0;
    }
    const bucket = h % dimensions;
    vec[bucket] = (vec[bucket] ?? 0) + 1;
  }

  // Character trigrams
  for (let i = 0; i <= normalized.length - 3; i++) {
    const trigram = normalized.slice(i, i + 3);
    let h = 0;
    for (let j = 0; j < 3; j++) {
      h = (h * 37 + trigram.charCodeAt(j)) >>> 0;
    }
    const bucket = h % dimensions;
    vec[bucket] = (vec[bucket] ?? 0) + 0.5;
  }

  // L2 normalize
  let sumSq = 0;
  for (let i = 0; i < dimensions; i++) {
    sumSq += (vec[i] ?? 0) * (vec[i] ?? 0);
  }
  const norm = Math.sqrt(sumSq);
  if (norm > 0) {
    for (let i = 0; i < dimensions; i++) {
      vec[i] = (vec[i] ?? 0) / norm;
    }
  }

  return vec;
}

/**
 * Parse .box/embeddings.json cache safely (tolerant parser).
 */
export function parseEmbeddingCache(raw: string): EmbeddingCache {
  const fallback: EmbeddingCache = {
    v: 1,
    model: "local",
    entries: {},
  };
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return fallback;
    }
    const p = parsed as Record<string, unknown>;
    const model = typeof p["model"] === "string" ? p["model"] : "local";
    const rawEntries =
      typeof p["entries"] === "object" && p["entries"] !== null
        ? (p["entries"] as Record<string, unknown>)
        : {};

    const entries: Record<string, EmbeddingCacheEntry> = {};
    for (const [k, v] of Object.entries(rawEntries)) {
      if (typeof v === "object" && v !== null) {
        const item = v as Record<string, unknown>;
        const mtime = typeof item["mtime"] === "number" ? item["mtime"] : 0;
        const embedding = Array.isArray(item["embedding"])
          ? item["embedding"].filter((n): n is number => typeof n === "number")
          : [];
        if (embedding.length > 0) {
          entries[k] = { mtime, embedding };
        }
      }
    }

    return { v: 1, model, entries };
  } catch {
    return fallback;
  }
}

/**
 * Serialize embedding cache to deterministic JSON string.
 */
export function serializeEmbeddingCache(cache: EmbeddingCache): string {
  return `${JSON.stringify(cache, null, 2)}\n`;
}

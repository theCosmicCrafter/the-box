import { describe, expect, it } from "vitest";
import {
  cosineSimilarity,
  fallbackVector,
  parseEmbeddingCache,
  serializeEmbeddingCache,
  topKSimilar,
  type EmbeddingCache,
} from "../src/semantic/similarity.js";

describe("semantic similarity and vector indexing", () => {
  describe("cosineSimilarity", () => {
    it("identical vectors have similarity 1", () => {
      const v = [0.5, 0.5, 0.5, 0.5];
      expect(cosineSimilarity(v, v)).toBeCloseTo(1.0);
    });

    it("orthogonal vectors have similarity 0", () => {
      expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0.0);
    });

    it("opposite vectors have similarity -1", () => {
      expect(cosineSimilarity([1, 2], [-1, -2])).toBeCloseTo(-1.0);
    });

    it("handles zero vectors and mismatched lengths safely", () => {
      expect(cosineSimilarity([], [])).toBe(0);
      expect(cosineSimilarity([0, 0], [0, 0])).toBe(0);
      expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
    });
  });

  describe("topKSimilar", () => {
    it("returns items sorted by similarity score", () => {
      const query = [1, 0, 0];
      const candidates = new Map<string, number[]>([
        ["exact", [1, 0, 0]],
        ["half", [0.7071, 0.7071, 0]],
        ["unrelated", [0, 1, 0]],
      ]);
      const results = topKSimilar(query, candidates, 2, 0.5);
      expect(results).toHaveLength(2);
      expect(results[0]!.id).toBe("exact");
      expect(results[0]!.score).toBeCloseTo(1.0);
      expect(results[1]!.id).toBe("half");
      expect(results[1]!.score).toBeCloseTo(0.7071);
    });
  });

  describe("fallbackVector", () => {
    it("produces deterministic normalized vectors", () => {
      const v1 = fallbackVector("Machine Learning and AI Systems");
      const v2 = fallbackVector("Machine Learning and AI Systems");
      expect(v1).toEqual(v2);

      // Verify L2 norm is ~1.0
      const norm = Math.sqrt(v1.reduce((sum, val) => sum + val * val, 0));
      expect(norm).toBeCloseTo(1.0);
    });

    it("related texts have higher similarity than unrelated texts", () => {
      const base = fallbackVector("character animation and rigging");
      const similar = fallbackVector("character rigging 2d animation");
      const different = fallbackVector("baking chocolate chip sourdough cookies");

      const scoreSimilar = cosineSimilarity(base, similar);
      const scoreDifferent = cosineSimilarity(base, different);
      expect(scoreSimilar).toBeGreaterThan(scoreDifferent);
    });
  });

  describe("cache serialization round-trip", () => {
    it("parses and serializes embedding cache without loss", () => {
      const cache: EmbeddingCache = {
        v: 1,
        model: "bge-m3:latest",
        entries: {
          "notes/a.md": {
            mtime: 1729680000000,
            embedding: [0.1, 0.2, 0.3],
          },
        },
      };
      const serialized = serializeEmbeddingCache(cache);
      const parsed = parseEmbeddingCache(serialized);
      expect(parsed).toEqual(cache);
    });

    it("tolerates malformed input gracefully", () => {
      const fallback = parseEmbeddingCache("not json");
      expect(fallback.v).toBe(1);
      expect(fallback.entries).toEqual({});
    });
  });
});

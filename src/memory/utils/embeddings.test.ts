import { describe, test, expect, beforeEach } from "bun:test";
import {
  LocalEmbeddingEngine,
  cosineSimilarity,
  euclideanDistance,
  serializeVector,
  deserializeVector,
  getLocalEmbeddingEngine,
  generateEmbedding,
} from "./embeddings";

describe("LocalEmbeddingEngine", () => {
  let engine: LocalEmbeddingEngine;

  beforeEach(() => {
    engine = new LocalEmbeddingEngine(128);
  });

  test("generates embeddings with correct dimensions", () => {
    engine.addDocument("doc1", "hello world");
    const result = engine.embed("hello world");

    expect(result.dimensions).toBe(128);
    expect(result.vector.length).toBe(128);
    expect(result.model).toBe("tfidf-local");
  });

  test("similar texts produce similar embeddings", () => {
    engine.addDocument("doc1", "machine learning is fascinating");
    engine.addDocument("doc2", "deep learning neural networks");
    engine.addDocument("doc3", "cooking recipes for dinner");

    const mlEmbed = engine.embed("machine learning algorithms");
    const dlEmbed = engine.embed("deep learning models");
    const cookEmbed = engine.embed("best dinner recipes");

    const mlDlSim = cosineSimilarity(mlEmbed.vector, dlEmbed.vector);
    const mlCookSim = cosineSimilarity(mlEmbed.vector, cookEmbed.vector);

    expect(mlDlSim).toBeGreaterThan(mlCookSim);
  });

  test("identical texts have similarity close to 1", () => {
    engine.addDocument("doc1", "typescript programming");
    
    const embed1 = engine.embed("typescript programming");
    const embed2 = engine.embed("typescript programming");

    const similarity = cosineSimilarity(embed1.vector, embed2.vector);
    expect(similarity).toBeCloseTo(1, 5);
  });

  test("removes documents correctly", () => {
    engine.addDocument("doc1", "first document");
    engine.addDocument("doc2", "second document");

    expect(engine.getStats().documents).toBe(2);

    engine.removeDocument("doc1");
    expect(engine.getStats().documents).toBe(1);
  });

  test("tracks vocabulary size", () => {
    engine.addDocument("doc1", "hello world");
    engine.addDocument("doc2", "hello universe");

    const stats = engine.getStats();
    expect(stats.vocabulary).toBeGreaterThanOrEqual(3);
  });
});

describe("cosineSimilarity", () => {
  test("identical vectors have similarity 1", () => {
    const v = new Float32Array([1, 2, 3, 4]);
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 5);
  });

  test("orthogonal vectors have similarity 0", () => {
    const v1 = new Float32Array([1, 0]);
    const v2 = new Float32Array([0, 1]);
    expect(cosineSimilarity(v1, v2)).toBeCloseTo(0, 5);
  });

  test("opposite vectors have similarity -1", () => {
    const v1 = new Float32Array([1, 0]);
    const v2 = new Float32Array([-1, 0]);
    expect(cosineSimilarity(v1, v2)).toBeCloseTo(-1, 5);
  });

  test("throws on dimension mismatch", () => {
    const v1 = new Float32Array([1, 2, 3]);
    const v2 = new Float32Array([1, 2]);
    expect(() => cosineSimilarity(v1, v2)).toThrow();
  });
});

describe("euclideanDistance", () => {
  test("identical vectors have distance 0", () => {
    const v = new Float32Array([1, 2, 3]);
    expect(euclideanDistance(v, v)).toBeCloseTo(0, 5);
  });

  test("calculates correct distance", () => {
    const v1 = new Float32Array([0, 0]);
    const v2 = new Float32Array([3, 4]);
    expect(euclideanDistance(v1, v2)).toBeCloseTo(5, 5);
  });

  test("throws on dimension mismatch", () => {
    const v1 = new Float32Array([1, 2, 3]);
    const v2 = new Float32Array([1, 2]);
    expect(() => euclideanDistance(v1, v2)).toThrow();
  });
});

describe("vector serialization", () => {
  test("round-trips correctly", () => {
    const original = new Float32Array([1.5, -2.3, 0, 4.7]);
    const serialized = serializeVector(original);
    const deserialized = deserializeVector(serialized);

    expect(deserialized.length).toBe(original.length);
    for (let i = 0; i < original.length; i++) {
      expect(deserialized[i]).toBeCloseTo(original[i], 5);
    }
  });

  test("produces base64 string", () => {
    const v = new Float32Array([1, 2, 3]);
    const serialized = serializeVector(v);
    expect(typeof serialized).toBe("string");
    expect(serialized.length).toBeGreaterThan(0);
  });
});

describe("getLocalEmbeddingEngine", () => {
  test("returns singleton instance", () => {
    const engine1 = getLocalEmbeddingEngine(256);
    const engine2 = getLocalEmbeddingEngine(256);
    expect(engine1).toBe(engine2);
  });

  test("creates new instance for different dimensions", () => {
    const engine1 = getLocalEmbeddingEngine(256);
    const engine2 = getLocalEmbeddingEngine(128);
    expect(engine1).not.toBe(engine2);
  });
});

describe("generateEmbedding", () => {
  test("local provider works", async () => {
    const result = await generateEmbedding("test text", { provider: "local", dimensions: 64 });
    expect(result.dimensions).toBe(64);
    expect(result.model).toBe("tfidf-local");
  });

  test("throws for unknown provider", async () => {
    await expect(
      generateEmbedding("test", { provider: "unknown" as "local" })
    ).rejects.toThrow();
  });
});

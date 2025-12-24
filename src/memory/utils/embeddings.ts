/**
 * Vector Embeddings for Semantic Search
 * TF-IDF local fallback with optional OpenAI/Ollama support.
 */

import { createHash } from "crypto";

export type EmbeddingVector = Float32Array;

export interface EmbeddingResult {
  vector: EmbeddingVector;
  dimensions: number;
  model: string;
  tokens?: number;
}

interface TFIDFDocument {
  id: string;
  terms: Map<string, number>;
  magnitude: number;
}

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from",
  "has", "he", "in", "is", "it", "its", "of", "on", "that", "the",
  "to", "was", "were", "will", "with", "the", "this", "but", "they",
  "have", "had", "what", "when", "where", "who", "which", "why", "how",
  "all", "each", "every", "both", "few", "more", "most", "other", "some",
  "such", "no", "nor", "not", "only", "own", "same", "so", "than", "too",
  "very", "just", "can", "should", "now", "i", "you", "we", "your", "my",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")
    .split(/\s+/)
    .filter((term) => term.length > 1 && !STOPWORDS.has(term))
    .map((term) => term.replace(/^-+|-+$/g, ""));
}

function calculateTF(terms: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  const total = terms.length;

  for (const term of terms) {
    tf.set(term, (tf.get(term) || 0) + 1);
  }

  for (const [term, count] of tf) {
    tf.set(term, count / total);
  }

  return tf;
}

export class LocalEmbeddingEngine {
  private documents: Map<string, TFIDFDocument> = new Map();
  private idf: Map<string, number> = new Map();
  private vocabulary: Set<string> = new Set();
  private dimensions: number;
  private dirty = false;

  constructor(dimensions: number = 256) {
    this.dimensions = dimensions;
  }

  addDocument(id: string, text: string): void {
    const terms = tokenize(text);
    const tf = calculateTF(terms);

    const uniqueTerms = new Set(terms);
    for (const term of uniqueTerms) {
      this.vocabulary.add(term);
    }

    this.documents.set(id, {
      id,
      terms: tf,
      magnitude: 0,
    });

    this.dirty = true;
  }

  removeDocument(id: string): void {
    this.documents.delete(id);
    this.dirty = true;
  }

  private updateIDF(): void {
    if (!this.dirty) return;

    const N = this.documents.size;
    if (N === 0) {
      this.idf.clear();
      this.dirty = false;
      return;
    }

    const df = new Map<string, number>();
    for (const doc of this.documents.values()) {
      for (const term of doc.terms.keys()) {
        df.set(term, (df.get(term) || 0) + 1);
      }
    }

    this.idf.clear();
    for (const [term, docFreq] of df) {
      // IDF = log(N / df) - standard TF-IDF formula
      this.idf.set(term, Math.log(N / docFreq));
    }

    for (const doc of this.documents.values()) {
      let magnitude = 0;
      for (const [term, tf] of doc.terms) {
        const idf = this.idf.get(term) || 0;
        const tfidf = tf * idf;
        magnitude += tfidf * tfidf;
      }
      doc.magnitude = Math.sqrt(magnitude);
    }

    this.dirty = false;
  }

  embed(text: string): EmbeddingResult {
    this.updateIDF();

    const terms = tokenize(text);
    const tf = calculateTF(terms);

    const vector = new Float32Array(this.dimensions);

    for (const [term, tfValue] of tf) {
      const idf = this.idf.get(term) || Math.log(this.documents.size + 1);
      const tfidf = tfValue * idf;

      const hash1 = this.hashTerm(term, 0);
      const hash2 = this.hashTerm(term, 1);

      const index = Math.abs(hash1) % this.dimensions;
      const sign = hash2 % 2 === 0 ? 1 : -1;

      vector[index] += sign * tfidf;
    }

    // L2 normalization: ||v|| = sqrt(sum(v_i^2))
    let magnitude = 0;
    for (let i = 0; i < vector.length; i++) {
      magnitude += vector[i] * vector[i];
    }
    magnitude = Math.sqrt(magnitude);

    if (magnitude > 0) {
      for (let i = 0; i < vector.length; i++) {
        vector[i] /= magnitude;
      }
    }

    return {
      vector,
      dimensions: this.dimensions,
      model: "tfidf-local",
      tokens: terms.length,
    };
  }

  private hashTerm(term: string, seed: number): number {
    const hash = createHash("md5")
      .update(`${seed}:${term}`)
      .digest();
    return hash.readInt32LE(0);
  }

  getStats(): { documents: number; vocabulary: number; dimensions: number } {
    return {
      documents: this.documents.size,
      vocabulary: this.vocabulary.size,
      dimensions: this.dimensions,
    };
  }

  export(): { documents: Array<{ id: string; text: string }>; dimensions: number } {
    return {
      documents: Array.from(this.documents.keys()).map((id) => ({
        id,
        text: `[${this.documents.get(id)?.terms.size || 0} terms]`,
      })),
      dimensions: this.dimensions,
    };
  }
}

export function cosineSimilarity(a: EmbeddingVector, b: EmbeddingVector): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
  }

  let dotProduct = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    magnitudeA += a[i] * a[i];
    magnitudeB += b[i] * b[i];
  }

  magnitudeA = Math.sqrt(magnitudeA);
  magnitudeB = Math.sqrt(magnitudeB);

  if (magnitudeA === 0 || magnitudeB === 0) {
    return 0;
  }

  return dotProduct / (magnitudeA * magnitudeB);
}

export function euclideanDistance(a: EmbeddingVector, b: EmbeddingVector): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
  }

  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }

  return Math.sqrt(sum);
}

export function serializeVector(vector: EmbeddingVector): string {
  const buffer = Buffer.from(vector.buffer);
  return buffer.toString("base64");
}

export function deserializeVector(base64: string): EmbeddingVector {
  const buffer = Buffer.from(base64, "base64");
  return new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
}

let localEngineInstance: LocalEmbeddingEngine | null = null;

export function getLocalEmbeddingEngine(dimensions: number = 256): LocalEmbeddingEngine {
  if (!localEngineInstance || localEngineInstance.getStats().dimensions !== dimensions) {
    localEngineInstance = new LocalEmbeddingEngine(dimensions);
  }
  return localEngineInstance;
}

export interface EmbeddingConfig {
  provider: "local" | "openai" | "ollama";
  model?: string;
  dimensions?: number;
  apiKey?: string;
  baseUrl?: string;
}

export const DEFAULT_EMBEDDING_CONFIG: EmbeddingConfig = {
  provider: "local",
  dimensions: 256,
};

export async function generateEmbedding(
  text: string,
  config: EmbeddingConfig = DEFAULT_EMBEDDING_CONFIG
): Promise<EmbeddingResult> {
  switch (config.provider) {
    case "local":
      return getLocalEmbeddingEngine(config.dimensions).embed(text);

    case "openai":
      return generateOpenAIEmbedding(text, config);

    case "ollama":
      return generateOllamaEmbedding(text, config);

    default:
      throw new Error(`Unknown embedding provider: ${config.provider}`);
  }
}

async function generateOpenAIEmbedding(
  text: string,
  config: EmbeddingConfig
): Promise<EmbeddingResult> {
  const apiKey = config.apiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OpenAI API key required for OpenAI embeddings");
  }

  const model = config.model || "text-embedding-3-small";
  const dimensions = config.dimensions || 256;

  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: text,
      dimensions,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.statusText}`);
  }

  const data = (await response.json()) as {
    data: Array<{ embedding: number[] }>;
    usage: { total_tokens: number };
  };

  return {
    vector: new Float32Array(data.data[0].embedding),
    dimensions,
    model,
    tokens: data.usage.total_tokens,
  };
}

async function generateOllamaEmbedding(
  text: string,
  config: EmbeddingConfig
): Promise<EmbeddingResult> {
  const baseUrl = config.baseUrl || "http://localhost:11434";
  const model = config.model || "nomic-embed-text";

  const response = await fetch(`${baseUrl}/api/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      prompt: text,
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama API error: ${response.statusText}`);
  }

  const data = (await response.json()) as { embedding: number[] };

  return {
    vector: new Float32Array(data.embedding),
    dimensions: data.embedding.length,
    model,
  };
}

export async function generateEmbeddings(
  texts: string[],
  config: EmbeddingConfig = DEFAULT_EMBEDDING_CONFIG
): Promise<EmbeddingResult[]> {
  if (config.provider === "local") {
    return texts.map((text) => getLocalEmbeddingEngine(config.dimensions).embed(text));
  }

  const results: EmbeddingResult[] = [];
  for (const text of texts) {
    results.push(await generateEmbedding(text, config));
  }
  return results;
}

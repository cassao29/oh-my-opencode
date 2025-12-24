import { tool } from "@opencode-ai/plugin";
import { getStorage } from "../../memory/storage/sqlite";
import { getMemoryDbPath } from "../../memory/utils/project";
import {
  getLocalEmbeddingEngine,
  cosineSimilarity,
  serializeVector,
  deserializeVector,
  type EmbeddingVector,
} from "../../memory/utils/embeddings";
import { validateScope, MAX_SCOPE_LENGTH, MAX_CONTENT_LENGTH } from "../../memory/utils/limits";

const MAX_QUERY_LENGTH = 1000;

const EMBEDDING_DIMENSIONS = 256;

interface MemoryWithEmbedding {
  id: string;
  type: string;
  scope: string;
  content: string;
  tags?: string;
  timestamp: string;
  embedding?: string;
}

interface SearchResult {
  id: string;
  type: string;
  scope: string;
  content: string;
  tags?: string;
  timestamp: string;
  similarity: number;
}

function ensureEmbeddingsTable(db: unknown): void {
  const database = db as { prepare: (sql: string) => { run: () => void } };
  database.prepare(`
    CREATE TABLE IF NOT EXISTS memory_embeddings (
      memory_id TEXT PRIMARY KEY,
      embedding TEXT NOT NULL,
      model TEXT NOT NULL,
      dimensions INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `).run();
}

function getEmbedding(db: unknown, memoryId: string): EmbeddingVector | null {
  const database = db as { prepare: (sql: string) => { get: (id: string) => { embedding: string } | undefined } };
  const row = database.prepare(
    "SELECT embedding FROM memory_embeddings WHERE memory_id = ?"
  ).get(memoryId);

  return row ? deserializeVector(row.embedding) : null;
}

function saveEmbedding(
  db: unknown,
  memoryId: string,
  embedding: EmbeddingVector,
  model: string
): void {
  const database = db as { prepare: (sql: string) => { run: (...args: unknown[]) => void } };
  database.prepare(`
    INSERT OR REPLACE INTO memory_embeddings (memory_id, embedding, model, dimensions)
    VALUES (?, ?, ?, ?)
  `).run(memoryId, serializeVector(embedding), model, embedding.length);
}

function getOrCreateEmbedding(
  db: unknown,
  memory: MemoryWithEmbedding
): EmbeddingVector {
  let embedding = getEmbedding(db, memory.id);

  if (!embedding) {
    const engine = getLocalEmbeddingEngine(EMBEDDING_DIMENSIONS);
    const text = `${memory.scope} ${memory.content} ${memory.tags || ""}`;
    const result = engine.embed(text);
    embedding = result.vector;
    saveEmbedding(db, memory.id, embedding, result.model);
  }

  return embedding;
}

export const memory_semantic_search = tool({
  description:
    "Semantic search across memories using vector similarity. " +
    "Finds memories by meaning, not just keywords. " +
    "Uses TF-IDF embeddings for lightweight local search.",
  args: {
    query: tool.schema.string().min(1).describe("Natural language search query"),
    limit: tool.schema.number().min(1).max(50).default(10).describe("Max results"),
    minSimilarity: tool.schema
      .number()
      .min(0)
      .max(1)
      .default(0.1)
      .describe("Minimum similarity threshold (0-1)"),
    scope: tool.schema.string().optional().describe("Filter by scope"),
    type: tool.schema
      .enum(["decision", "learning", "preference", "blocker", "context", "pattern"])
      .optional()
      .describe("Filter by memory type"),
    rebuildIndex: tool.schema
      .boolean()
      .default(false)
      .describe("Force rebuild of embedding index"),
  },

  async execute(args) {
    const {
      query,
      limit = 10,
      minSimilarity = 0.1,
      scope,
      type,
      rebuildIndex = false,
    } = args;

    try {
      if (!query || query.length > MAX_QUERY_LENGTH) {
        return `Invalid query: must be 1-${MAX_QUERY_LENGTH} characters`;
      }

      if (scope && !validateScope(scope)) {
        return `Invalid scope: must be ${MAX_SCOPE_LENGTH} chars or less and cannot contain path separators`;
      }
      const dbPath = getMemoryDbPath();
      const storage = getStorage(dbPath);
      const db = (storage as unknown as { db: unknown }).db;

      ensureEmbeddingsTable(db);

      const database = db as {
        prepare: (sql: string) => {
          all: (...args: unknown[]) => MemoryWithEmbedding[];
        };
      };

      let sql = "SELECT * FROM memories WHERE 1=1";
      const sqlParams: unknown[] = [];

      if (scope) {
        sql += " AND scope = ?";
        sqlParams.push(scope);
      }
      if (type) {
        sql += " AND type = ?";
        sqlParams.push(type);
      }

      sql += " ORDER BY timestamp DESC LIMIT 500";

      const memories = database.prepare(sql).all(...sqlParams);

      if (memories.length === 0) {
        return "No memories found matching the filters.";
      }

      const engine = getLocalEmbeddingEngine(EMBEDDING_DIMENSIONS);

      if (rebuildIndex) {
        for (const memory of memories) {
          const text = `${memory.scope} ${memory.content} ${memory.tags || ""}`;
          engine.addDocument(memory.id, text);
        }
      }

      const queryEmbedding = engine.embed(query).vector;

      const results: SearchResult[] = [];

      for (const memory of memories) {
        const memoryEmbedding = getOrCreateEmbedding(db, memory);
        const similarity = cosineSimilarity(queryEmbedding, memoryEmbedding);

        if (similarity >= minSimilarity) {
          results.push({
            id: memory.id,
            type: memory.type,
            scope: memory.scope,
            content: memory.content,
            tags: memory.tags,
            timestamp: memory.timestamp,
            similarity,
          });
        }
      }

      results.sort((a, b) => b.similarity - a.similarity);
      const topResults = results.slice(0, limit);

      if (topResults.length === 0) {
        return `No memories found with similarity >= ${minSimilarity} for query: "${query}"`;
      }

      const output = [
        `## Semantic Search Results`,
        `Query: "${query}"`,
        `Found: ${topResults.length} memories (min similarity: ${minSimilarity})`,
        "",
      ];

      for (const result of topResults) {
        output.push(
          `### [${result.type}] ${result.scope} (${(result.similarity * 100).toFixed(1)}%)`,
          result.content,
          result.tags ? `Tags: ${result.tags}` : "",
          `_${result.timestamp}_`,
          ""
        );
      }

      const stats = engine.getStats();
      output.push(
        "---",
        `Index: ${stats.documents} docs, ${stats.vocabulary} terms, ${stats.dimensions}D`
      );

      return output.filter(Boolean).join("\n");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      return `Semantic search failed: ${msg}`;
    }
  },
});

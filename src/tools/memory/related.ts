import { tool } from "@opencode-ai/plugin";
import { getStorage } from "../../memory/storage/sqlite";
import { tryConnectNeo4j } from "../../memory/sync/neo4j-client";
import { findRelatedMemories } from "../../memory/sync/relation-extractor";

export const memory_related = tool({
  description: `Find memories related to a specific memory through entity connections, semantic similarity, or explicit relationships.

Uses the Neo4j memory graph when available for deep relationship traversal, otherwise falls back to SQLite-based relation detection.

Returns memories that:
- Share common entities (technologies, concepts, files)
- Have explicit relationships (depends_on, supersedes, supports, etc.)
- Are semantically similar based on scope and content`,

  args: {
    memory_id: tool.schema
      .string()
      .describe("The ID of the memory to find relations for"),
    depth: tool.schema
      .number()
      .min(1)
      .max(4)
      .optional()
      .describe("How many relationship hops to traverse (default: 2, max: 4)"),
    limit: tool.schema
      .number()
      .min(1)
      .max(50)
      .optional()
      .describe("Maximum number of related memories to return (default: 10)"),
  },

  async execute(args) {
    const { memory_id, depth = 2, limit = 10 } = args;
    
    try {
      const storage = getStorage();

      const sourceMemory = storage.getMemoryById(memory_id);
      if (!sourceMemory) {
        return JSON.stringify({
          success: false,
          error: `Memory with ID '${memory_id}' not found`,
          related: [],
        }, null, 2);
      }

      const neo4jClient = await tryConnectNeo4j();

      if (neo4jClient) {
        const graphResult = await neo4jClient.getRelatedMemories(memory_id, depth);
        
        const relatedMemories = graphResult.nodes
          .filter(node => node.id !== memory_id)
          .slice(0, limit)
          .map(node => ({
            id: node.id,
            type: node.properties.type as string,
            scope: node.properties.scope as string,
            content: String(node.properties.content || "").substring(0, 200),
            relationship: graphResult.edges
              .find(e => e.source === memory_id && e.target === node.id)?.type ?? "related",
          }));

        return JSON.stringify({
          success: true,
          source: "neo4j",
          source_memory: {
            id: sourceMemory.id,
            type: sourceMemory.type,
            scope: sourceMemory.scope,
          },
          related: relatedMemories,
          graph_stats: {
            nodes_traversed: graphResult.nodes.length,
            edges_found: graphResult.edges.length,
          },
        }, null, 2);
      }

      const allMemories = storage.getMemories({ limit: 500 });
      const relatedResult = findRelatedMemories(sourceMemory, allMemories, limit);

      const relatedMemories = relatedResult.map(({ memory, relation, score }) => ({
        id: memory.id,
        type: memory.type,
        scope: memory.scope,
        content: memory.content.substring(0, 200) + (memory.content.length > 200 ? "..." : ""),
        relationship: relation,
        relevance_score: Math.round(score * 100) / 100,
      }));

      return JSON.stringify({
        success: true,
        source: "sqlite",
        source_memory: {
          id: sourceMemory.id,
          type: sourceMemory.type,
          scope: sourceMemory.scope,
        },
        related: relatedMemories,
        note: relatedMemories.length === 0 
          ? "No related memories found. Try storing more memories with overlapping scopes and content."
          : "Using SQLite fallback. Neo4j memory graph not available for deeper relationship traversal.",
      }, null, 2);

    } catch (err) {
      return JSON.stringify({
        success: false,
        error: err instanceof Error ? err.message : "Unknown error finding related memories",
        related: [],
      }, null, 2);
    }
  },
});

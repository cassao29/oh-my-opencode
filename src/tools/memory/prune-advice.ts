import { tool } from "@opencode-ai/plugin";
import { getStorage } from "../../memory/storage/sqlite";
import { tryConnectNeo4j } from "../../memory/sync/neo4j-client";
import { getProjectPath } from "../../memory/utils/project";

export const memory_prune_advice = tool({
  description: `Get intelligent pruning advice for memory management. Analyzes memories and suggests which can be safely pruned based on:
- Age and staleness
- Redundancy with other memories
- Low importance scores
- Superseded decisions
- Resolved blockers

Uses Neo4j graph analysis when available for deeper relationship-aware pruning, otherwise uses SQLite-based heuristics.`,

  args: {
    context_tokens: tool.schema
      .number()
      .optional()
      .describe("Current context token usage (helps prioritize what to keep)"),
    max_tokens: tool.schema
      .number()
      .optional()
      .describe("Maximum context tokens allowed"),
    scope: tool.schema
      .string()
      .optional()
      .describe("Limit analysis to specific scope"),
    aggressive: tool.schema
      .boolean()
      .optional()
      .describe("If true, suggest more aggressive pruning"),
  },

  async execute(args) {
    try {
      const storage = getStorage();
      const projectPath = getProjectPath();
      
      const memories = storage.getMemories({ 
        scope: args.scope,
        limit: 500 
      });

      if (memories.length === 0) {
        return JSON.stringify({
          success: true,
          message: "No memories to analyze",
          canPrune: [],
          mustKeep: [],
        }, null, 2);
      }

      const neo4jClient = await tryConnectNeo4j();

      if (neo4jClient && args.context_tokens && args.max_tokens) {
        const advice = await neo4jClient.getPruningAdvice({
          project_path: projectPath,
          context_tokens: args.context_tokens,
          max_tokens: args.max_tokens,
        });

        if (advice) {
          return JSON.stringify({
            success: true,
            source: "neo4j",
            ...advice,
          }, null, 2);
        }
      }

      const now = Date.now();
      const ONE_DAY = 24 * 60 * 60 * 1000;
      const ONE_WEEK = 7 * ONE_DAY;
      const ONE_MONTH = 30 * ONE_DAY;

      const canPrune: Array<{ id: string; scope: string; type: string; reason: string }> = [];
      const mustKeep: Array<{ id: string; scope: string; type: string; reason: string }> = [];

      const contentMap = new Map<string, typeof memories>();
      for (const m of memories) {
        const key = m.content.toLowerCase().trim().substring(0, 100);
        const existing = contentMap.get(key) || [];
        existing.push(m);
        contentMap.set(key, existing);
      }

      for (const m of memories) {
        const age = now - new Date(m.timestamp).getTime();
        const key = m.content.toLowerCase().trim().substring(0, 100);
        const duplicates = contentMap.get(key) || [];

        if (m.type === "blocker" && age > ONE_WEEK) {
          canPrune.push({
            id: m.id,
            scope: m.scope,
            type: m.type,
            reason: "Old blocker - likely resolved or stale",
          });
          continue;
        }

        if (m.type === "context" && age > ONE_MONTH) {
          canPrune.push({
            id: m.id,
            scope: m.scope,
            type: m.type,
            reason: "Old context - project state likely changed",
          });
          continue;
        }

        if (duplicates.length > 1) {
          const isNewest = duplicates.every(d => 
            new Date(d.timestamp).getTime() <= new Date(m.timestamp).getTime()
          );
          if (!isNewest) {
            canPrune.push({
              id: m.id,
              scope: m.scope,
              type: m.type,
              reason: "Duplicate - newer version exists",
            });
            continue;
          }
        }

        if (args.aggressive && m.type === "learning" && age > ONE_MONTH) {
          canPrune.push({
            id: m.id,
            scope: m.scope,
            type: m.type,
            reason: "Old learning - may be outdated (aggressive mode)",
          });
          continue;
        }

        if (m.type === "decision") {
          mustKeep.push({
            id: m.id,
            scope: m.scope,
            type: m.type,
            reason: "Active decision - important for consistency",
          });
        } else if (m.type === "pattern") {
          mustKeep.push({
            id: m.id,
            scope: m.scope,
            type: m.type,
            reason: "Code pattern - helps maintain standards",
          });
        } else if (m.type === "preference") {
          mustKeep.push({
            id: m.id,
            scope: m.scope,
            type: m.type,
            reason: "User preference - important for personalization",
          });
        }
      }

      const reasoning = [
        `Analyzed ${memories.length} memories`,
        `Found ${canPrune.length} candidates for pruning`,
        `Identified ${mustKeep.length} memories to keep`,
      ];

      if (args.aggressive) {
        reasoning.push("Aggressive mode enabled - more liberal pruning suggestions");
      }

      return JSON.stringify({
        success: true,
        source: "sqlite",
        canPrune: canPrune.slice(0, 20),
        mustKeep: mustKeep.slice(0, 10),
        reasoning: reasoning.join(". ") + ".",
        summary: {
          total_analyzed: memories.length,
          prune_candidates: canPrune.length,
          keep_candidates: mustKeep.length,
        },
      }, null, 2);

    } catch (err) {
      return JSON.stringify({
        success: false,
        error: err instanceof Error ? err.message : "Unknown error getting pruning advice",
        canPrune: [],
        mustKeep: [],
      }, null, 2);
    }
  },
});

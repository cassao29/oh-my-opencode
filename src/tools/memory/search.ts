import { tool } from "@opencode-ai/plugin";
import { getStorage, type Memory, type MemoryType } from "../../memory/storage/sqlite";
import { getProjectPath } from "../../memory/utils/project";

function calculateRelevanceScore(memory: Memory, query: string): number {
  const queryLower = query.toLowerCase();
  const contentLower = memory.content.toLowerCase();
  const scopeLower = memory.scope.toLowerCase();
  const tagsLower = memory.tags?.toLowerCase() || "";

  let score = 0;

  if (contentLower.includes(queryLower)) score += 0.8;
  if (scopeLower.includes(queryLower)) score += 0.6;
  if (tagsLower.includes(queryLower)) score += 0.4;

  const queryWords = queryLower.split(/\s+/);
  const contentWords = contentLower.split(/\s+/);
  const wordMatches = queryWords.filter(word =>
    contentWords.some((contentWord: string) => contentWord.includes(word))
  ).length;

  score += (wordMatches / queryWords.length) * 0.4;

  const age = Date.now() - new Date(memory.timestamp).getTime();
  const daysOld = age / (1000 * 60 * 60 * 24);
  score += Math.max(0, 0.2 - daysOld * 0.01);

  const typeWeights: Record<string, number> = {
    decision: 1.1,
    blocker: 1.0,
    context: 0.9,
    pattern: 0.8,
    preference: 0.7,
    learning: 0.6
  };
  score *= typeWeights[memory.type] || 0.5;

  return Math.min(1.0, score);
}

function calculateImportanceScore(memory: Memory): number {
  let score = 0.5;

  const age = Date.now() - new Date(memory.timestamp).getTime();
  const daysOld = age / (1000 * 60 * 60 * 24);
  score += Math.max(0, 1 - daysOld / 30);

  const typeWeights: Record<string, number> = { decision: 1.0, blocker: 0.9, context: 0.8, pattern: 0.7, preference: 0.6, learning: 0.5 };
  score *= typeWeights[memory.type] || 0.5;

  const content = memory.content.toLowerCase();
  const importantKeywords = ['error', 'bug', 'fix', 'security', 'performance', 'api', 'database', 'auth'];
  const keywordMatches = importantKeywords.filter(kw => content.includes(kw)).length;
  score += keywordMatches * 0.05;

  if (memory.issue) score += 0.1;
  if (memory.tags) score += 0.05;

  return Math.min(1.0, score);
}

interface ScoredMemory extends Memory {
  relevanceScore: number;
  importanceScore?: number;
}

export const memory_search = tool({
  description: "Advanced full-text search across all memories with relevance ranking",
  args: {
    query: tool.schema
      .string()
      .min(1)
      .describe("Search query (supports full-text search)"),
    scope: tool.schema
      .string()
      .optional()
      .describe("Limit search to specific scope"),
    type: tool.schema
      .enum(["decision", "learning", "preference", "blocker", "context", "pattern"])
      .optional()
      .describe("Limit search to specific memory type"),
    limit: tool.schema
      .number()
      .min(1)
      .max(100)
      .optional()
      .default(20)
      .describe("Maximum results to return"),
    sortBy: tool.schema
      .enum(["relevance", "date", "importance"])
      .optional()
      .default("relevance")
      .describe("Sort results by relevance, date, or importance")
  },
  async execute(args) {
    try {
      const storage = getStorage();
      const projectPath = getProjectPath();

      const memories = storage.getMemories({
        projectPath,
        scope: args.scope,
        type: args.type as MemoryType | undefined,
        query: args.query,
        limit: (args.limit ?? 20) * 2
      });

      if (memories.length === 0) {
        return `No memories found matching "${args.query}". Try different keywords or broader search terms.`;
      }

      let scoredMemories: ScoredMemory[] = memories.map(memory => ({
        ...memory,
        relevanceScore: calculateRelevanceScore(memory, args.query)
      }));

      switch (args.sortBy) {
        case "date":
          scoredMemories.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
          break;
        case "importance":
          scoredMemories = scoredMemories
            .map(m => ({ ...m, importanceScore: calculateImportanceScore(m) }))
            .sort((a, b) => (b.importanceScore ?? 0) - (a.importanceScore ?? 0));
          break;
        case "relevance":
        default:
          scoredMemories.sort((a, b) => b.relevanceScore - a.relevanceScore);
          break;
      }

      const results = scoredMemories.slice(0, args.limit ?? 20);

      const formatted = results.map((m, i) => {
        const tags = m.tags ? ` [${m.tags}]` : "";
        const issue = m.issue ? ` (${m.issue})` : "";
        const score = args.sortBy === "relevance" ? ` (relevance: ${(m.relevanceScore * 100).toFixed(0)}%)` : "";
        return `${i + 1}. [${m.type}] ${m.scope}${tags}${issue}${score}
   ${m.content}
   (${m.timestamp})`;
      });

      const scopeFilter = args.scope ? ` in scope "${args.scope}"` : "";
      const typeFilter = args.type ? ` of type "${args.type}"` : "";

      return `Search Results for "${args.query}"${scopeFilter}${typeFilter}:

Found ${results.length} matches (showing top ${args.limit ?? 20}, sorted by ${args.sortBy ?? 'relevance'}):

${formatted.join("\n\n")}`;

    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      return `Failed to perform search: ${msg}`;
    }
  },
});

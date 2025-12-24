import { tool } from "@opencode-ai/plugin";
import { getStorage, type Memory } from "../../memory/storage/sqlite";
import { getProjectPath } from "../../memory/utils/project";

function calculateImportance(memory: Memory, context: string = ""): number {
  let score = 0.5;

  const age = Date.now() - new Date(memory.timestamp).getTime();
  const daysOld = age / (1000 * 60 * 60 * 24);
  score += Math.max(0, 1 - daysOld / 30);

  const typeWeights: Record<string, number> = { decision: 1.0, blocker: 0.9, context: 0.8, pattern: 0.7, preference: 0.6, learning: 0.5 };
  score *= typeWeights[memory.type] || 0.5;

  const content = memory.content.toLowerCase();
  const importantKeywords = ['error', 'bug', 'fix', 'security', 'performance', 'api', 'database', 'auth'];
  const keywordMatches = importantKeywords.filter(kw => content.includes(kw)).length;
  score += keywordMatches * 0.1;

  if (context) {
    const contextWords = context.toLowerCase().split(/\s+/);
    const memoryWords = content.split(/\s+/);
    const overlap = contextWords.filter(word => memoryWords.includes(word)).length;
    score += (overlap / contextWords.length) * 0.3;
  }

  return Math.min(1.0, score);
}

interface ConsolidatedMemory extends Memory {
  count?: number;
  importance?: number;
}

function consolidateMemories(memories: ConsolidatedMemory[]): ConsolidatedMemory[] {
  const consolidated = new Map<string, ConsolidatedMemory>();

  memories.forEach(memory => {
    const key = `${memory.type}:${memory.scope}`;
    if (!consolidated.has(key)) {
      consolidated.set(key, { ...memory, count: 1 });
    } else {
      const existing = consolidated.get(key)!;
      existing.count = (existing.count || 1) + 1;
      existing.content += `\n\nAdditional: ${memory.content}`;
      existing.timestamp = memory.timestamp > existing.timestamp ? memory.timestamp : existing.timestamp;
    }
  });

  return Array.from(consolidated.values()).map(m => ({
    ...m,
    content: m.count && m.count > 1 ? `[Consolidated ${m.count} memories]\n${m.content}` : m.content
  }));
}

export const memory_smart_recall = tool({
  description: "Intelligent memory recall with context awareness, importance scoring, and consolidation",
  args: {
    context: tool.schema
      .string()
      .optional()
      .describe("Current context or task description for relevance scoring"),
    maxResults: tool.schema
      .number()
      .min(1)
      .max(50)
      .optional()
      .default(20)
      .describe("Maximum number of memories to return"),
    minImportance: tool.schema
      .number()
      .min(0)
      .max(1)
      .optional()
      .default(0.3)
      .describe("Minimum importance score (0-1)"),
    consolidate: tool.schema
      .boolean()
      .optional()
      .default(true)
      .describe("Consolidate similar memories"),
    types: tool.schema
      .array(tool.schema.enum(["decision", "learning", "preference", "blocker", "context", "pattern"]))
      .optional()
      .describe("Filter by memory types")
  },
  async execute(args) {
    try {
      const storage = getStorage();
      const projectPath = getProjectPath();

      const memories = storage.getRecentMemories(projectPath, {
        limit: (args.maxResults ?? 20) * 2,
        types: args.types
      });

      if (memories.length === 0) {
        return "No memories found in project.";
      }

      const scoredMemories = memories
        .map(memory => ({
          ...memory,
          importance: calculateImportance(memory, args.context)
        }))
        .filter(memory => memory.importance >= (args.minImportance ?? 0.3))
        .sort((a, b) => b.importance - a.importance)
        .slice(0, args.maxResults ?? 20);

      if (scoredMemories.length === 0) {
        return `No memories found with importance score >= ${args.minImportance}. Try lowering the threshold.`;
      }

      const finalMemories: ConsolidatedMemory[] = args.consolidate
        ? consolidateMemories(scoredMemories)
        : scoredMemories;

      const formatted = finalMemories.map((m, i) => {
        const tags = m.tags ? ` [${m.tags}]` : "";
        const importance = m.importance ? ` (importance: ${(m.importance * 100).toFixed(0)}%)` : "";
        const count = (m as ConsolidatedMemory).count && (m as ConsolidatedMemory).count! > 1 ? ` [${(m as ConsolidatedMemory).count}x consolidated]` : "";
        return `${i + 1}. [${m.type}] ${m.scope}${tags}${importance}${count}
   ${m.content}
   (${m.timestamp})`;
      });

      const contextNote = args.context ? `\nContext: "${args.context}"` : "";
      const consolidationNote = args.consolidate ? "\n(Memories consolidated by type and scope)" : "";

      return `Smart Recall Results (${finalMemories.length} memories)${contextNote}${consolidationNote}:\n\n${formatted.join("\n\n")}`;

    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      return `Failed to perform smart recall: ${msg}`;
    }
  },
});

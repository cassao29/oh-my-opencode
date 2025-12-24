import { tool } from "@opencode-ai/plugin";
import { getStorage, type MemoryType } from "../../memory/storage/sqlite";
import { getProjectPath } from "../../memory/utils/project";
import { applyLitm } from "../../memory/utils/litm";

export const memory_recall = tool({
  description: "Retrieve memories by scope, type, or search query",
  args: {
    scope: tool.schema
      .string()
      .optional()
      .describe("Filter by scope (e.g., 'auth', 'database')"),
    type: tool.schema
      .enum(["decision", "learning", "preference", "blocker", "context", "pattern"])
      .optional()
      .describe("Filter by memory type"),
    query: tool.schema
      .string()
      .optional()
      .describe("Full-text search query"),
    limit: tool.schema
      .number()
      .min(1)
      .max(100)
      .optional()
      .describe("Maximum number of memories to return (default: 20, max: 100)"),
    litmReorder: tool.schema
      .boolean()
      .optional()
      .default(true)
      .describe("Apply LITM reordering to place important memories at context edges (default: true)"),
  },
  async execute(args) {
    try {
      if (!args.scope && !args.type && !args.query) {
        return "Please specify at least one filter (scope, type, or query) to avoid returning all memories";
      }

      const storage = getStorage();
      const projectPath = getProjectPath();

      const memories = storage.getMemories({
        projectPath,
        scope: args.scope?.trim(),
        type: args.type as MemoryType | undefined,
        query: args.query?.trim(),
        limit: args.limit ?? 20,
      });

      if (memories.length === 0) {
        return "No memories found matching the criteria.";
      }

      const orderedMemories = args.litmReorder !== false 
        ? applyLitm(memories) 
        : memories;

      const formatted = orderedMemories.map((m, i) => {
        const tags = m.tags ? ` [${m.tags}]` : "";
        const issue = m.issue ? ` (${m.issue})` : "";
        return `${i + 1}. [${m.type}] ${m.scope}${tags}${issue}
   ${m.content}
   (${m.timestamp})`;
      });

      const litmNote = args.litmReorder !== false ? " (LITM-reordered for optimal context placement)" : "";
      return `Found ${orderedMemories.length} memories${litmNote}:\n\n${formatted.join("\n\n")}`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      return `Failed to recall memories: ${msg}`;
    }
  },
});

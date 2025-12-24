import { tool } from "@opencode-ai/plugin";
import { getStorage, type MemoryType } from "../../memory/storage/sqlite";

export const memory_forget = tool({
  description: "Delete memories by scope and type (logs deletion for audit)",
  args: {
    scope: tool.schema
      .string()
      .min(1)
      .describe("Scope of memories to delete"),
    type: tool.schema
      .enum(["decision", "learning", "preference", "blocker", "context", "pattern"])
      .describe("Type of memories to delete"),
    reason: tool.schema
      .string()
      .min(1)
      .describe("Reason for deletion (for audit trail)"),
  },
  async execute(args) {
    try {
      const storage = getStorage();
      
      const count = storage.deleteMemory(
        args.scope.trim(),
        args.type as MemoryType,
        args.reason.trim()
      );

      if (count === 0) {
        return `No memories found matching scope="${args.scope}" and type="${args.type}".`;
      }

      return `Deleted ${count} memories.
Scope: ${args.scope}
Type: ${args.type}
Reason: ${args.reason}`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      return `Failed to delete memories: ${msg}`;
    }
  },
});

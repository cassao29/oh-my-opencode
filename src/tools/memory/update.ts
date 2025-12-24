import { tool } from "@opencode-ai/plugin";
import { getStorage, type MemoryType } from "../../memory/storage/sqlite";
import { sanitizeContent } from "../../memory/utils/privacy";

export const memory_update = tool({
  description: "Update an existing memory by scope and type",
  args: {
    scope: tool.schema
      .string()
      .min(1)
      .describe("Scope of the memory to update"),
    type: tool.schema
      .enum(["decision", "learning", "preference", "blocker", "context", "pattern"])
      .describe("Type of the memory to update"),
    query: tool.schema
      .string()
      .optional()
      .describe("Search query to find the specific memory to update"),
    content: tool.schema
      .string()
      .min(1)
      .describe("New content for the memory"),
    tags: tool.schema
      .string()
      .optional()
      .describe("New tags (comma-separated)"),
    issue: tool.schema
      .string()
      .optional()
      .describe("New issue/ticket reference"),
  },
  async execute(args) {
    try {
      const storage = getStorage();
      
      const sanitizedContent = sanitizeContent(args.content);
      
      const success = storage.updateMemory(
        args.query?.trim() ?? "",
        args.scope.trim(),
        args.type as MemoryType,
        {
          content: sanitizedContent,
          tags: args.tags?.trim(),
          issue: args.issue?.trim(),
        }
      );

      if (!success) {
        return `No memory found matching scope="${args.scope}" and type="${args.type}"${args.query ? ` with query "${args.query}"` : ""}.`;
      }

      return `Memory updated successfully.
Scope: ${args.scope}
Type: ${args.type}`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      return `Failed to update memory: ${msg}`;
    }
  },
});

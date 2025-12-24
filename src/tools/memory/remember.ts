import { tool } from "@opencode-ai/plugin";
import { getStorage, type MemoryType } from "../../memory/storage/sqlite";
import { getProjectPath } from "../../memory/utils/project";
import { sanitizeContent } from "../../memory/utils/privacy";
import { checkRateLimit, validateScope, validateContentLength, validateTags } from "../../memory/utils/limits";

export const memory_remember = tool({
  description: "Store a memory (decision, learning, preference, blocker, context, pattern) for future sessions",
  args: {
    type: tool.schema
      .enum(["decision", "learning", "preference", "blocker", "context", "pattern"])
      .describe("Type of memory: decision (architectural choice), learning (discovered behavior), preference (user preference), blocker (current obstacle), context (project state), pattern (code pattern)"),
    scope: tool.schema
      .string()
      .min(1)
      .max(255)
      .describe("Scope/category for the memory (e.g., 'auth', 'database', 'api', 'testing')"),
    content: tool.schema
      .string()
      .min(1)
      .max(10000)
      .describe("The memory content to store"),
    tags: tool.schema
      .string()
      .max(1000)
      .optional()
      .describe("Comma-separated tags for categorization"),
    issue: tool.schema
      .string()
      .max(255)
      .optional()
      .describe("Related issue/ticket number if applicable"),
  },
  async execute(args, context) {
    try {
      if (!checkRateLimit(`remember:${context.sessionID || 'anonymous'}`)) {
        return "Rate limit exceeded. Please wait before making another request.";
      }

      if (!validateScope(args.scope)) {
        return "Invalid scope format: must be 1-255 chars, no path separators";
      }

      if (!validateContentLength(args.content)) {
        return "Content too large (max 10000 characters)";
      }

      if (!validateTags(args.tags || "")) {
        return "Tags too long (max 1000 characters)";
      }

      const storage = getStorage();
      const projectPath = getProjectPath();

      const sanitizedContent = sanitizeContent(args.content);

      const id = storage.saveMemory({
        type: args.type as MemoryType,
        scope: args.scope.trim(),
        content: sanitizedContent,
        project_path: projectPath,
        tags: args.tags?.trim(),
        source: "manual",
        issue: args.issue?.trim(),
      });

      return `Memory saved successfully.
Type: ${args.type}
Scope: ${args.scope}
ID: ${id}`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      const sanitizedMsg = msg.replace(/\/[^\s]+/g, '[PATH REDACTED]');
      return `Failed to save memory: ${sanitizedMsg}`;
    }
  },
});

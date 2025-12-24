import { tool } from "@opencode-ai/plugin";
import type { MemoryType } from "../../memory/storage/sqlite";
import { getProjectPath } from "../../memory/utils/project";
import {
  shareMemories,
  importSharedMemories,
  listAvailableProjects,
  getSharedMemoryStats,
  getGlobalStorage,
  DEFAULT_SHARE_CONFIG,
  type ShareScope,
  type ShareConfig,
} from "../../memory/sync/cross-project";

export const memory_share = tool({
  description: "Share memories across projects using a global storage. Share valuable decisions, patterns, and learnings from one project to use in others.",
  args: {
    action: tool.schema
      .enum(["share", "import", "list", "stats", "unshare"])
      .describe("share: export memories to global storage, import: import from other projects, list: show available shared memories, stats: show sharing statistics, unshare: remove a shared memory"),
    shareScope: tool.schema
      .enum(["global", "organization", "team", "personal"])
      .optional()
      .default("global")
      .describe("Visibility scope for sharing (default: global)"),
    sourceProject: tool.schema
      .string()
      .optional()
      .describe("For import/list: filter by source project name"),
    types: tool.schema
      .array(tool.schema.enum(["decision", "learning", "preference", "blocker", "context", "pattern"]))
      .optional()
      .describe("Filter by memory types (default for share: decision, pattern, learning)"),
    excludeTypes: tool.schema
      .array(tool.schema.enum(["decision", "learning", "preference", "blocker", "context", "pattern"]))
      .optional()
      .describe("Exclude these memory types from sharing"),
    tags: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe("Filter by tags (memories must have at least one of these tags)"),
    excludeTags: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe("Exclude memories with any of these tags"),
    minAgeDays: tool.schema
      .number()
      .min(0)
      .max(365)
      .optional()
      .describe("Only share/import memories older than N days"),
    maxAgeDays: tool.schema
      .number()
      .min(1)
      .max(365)
      .optional()
      .describe("Only share/import memories newer than N days"),
    redactSecrets: tool.schema
      .boolean()
      .optional()
      .default(true)
      .describe("Redact potential secrets (API keys, tokens) before sharing"),
    limit: tool.schema
      .number()
      .min(1)
      .max(500)
      .optional()
      .default(100)
      .describe("Maximum number of memories to process"),
    skipDuplicates: tool.schema
      .boolean()
      .optional()
      .default(true)
      .describe("Skip memories that already exist in target"),
    memoryId: tool.schema
      .string()
      .optional()
      .describe("For unshare: the ID of the shared memory to remove"),
  },
  async execute(args) {
    try {
      const projectPath = getProjectPath();

      switch (args.action) {
        case "share": {
          const config: ShareConfig = {
            shareScope: (args.shareScope as ShareScope) ?? DEFAULT_SHARE_CONFIG.shareScope,
            includeTypes: args.types as MemoryType[] | undefined,
            excludeTypes: args.excludeTypes as MemoryType[] | undefined,
            includeTags: args.tags,
            excludeTags: args.excludeTags,
            minAgeDays: args.minAgeDays,
            maxAgeDays: args.maxAgeDays,
            redactSecrets: args.redactSecrets ?? true,
          };

          // Use defaults if no types specified
          if (!config.includeTypes && !config.excludeTypes) {
            config.includeTypes = DEFAULT_SHARE_CONFIG.includeTypes;
            config.excludeTypes = DEFAULT_SHARE_CONFIG.excludeTypes;
          }

          const result = shareMemories(projectPath, config);

          return `## Share Results

**Shared:** ${result.shared} memories
**Skipped:** ${result.skipped} memories (filtered out or duplicates)
${result.errors.length > 0 ? `**Errors:** ${result.errors.length}` : ""}

### Configuration
- Share Scope: ${config.shareScope}
- Types: ${config.includeTypes?.join(", ") ?? "all"}
- Excluded Types: ${config.excludeTypes?.join(", ") ?? "none"}
- Redact Secrets: ${config.redactSecrets ? "yes" : "no"}

${result.errors.length > 0 ? `### Errors\n${result.errors.slice(0, 5).map(e => `- ${e}`).join("\n")}${result.errors.length > 5 ? `\n... and ${result.errors.length - 5} more` : ""}` : ""}

Shared memories are now available for import in other projects.`;
        }

        case "import": {
          const result = importSharedMemories(projectPath, {
            sourceProject: args.sourceProject,
            shareScope: args.shareScope as ShareScope | undefined,
            types: args.types as MemoryType[] | undefined,
            limit: args.limit ?? 100,
            skipDuplicates: args.skipDuplicates ?? true,
          });

          return `## Import Results

**Imported:** ${result.imported} memories
**Skipped:** ${result.skipped} memories (filtered out)
**Duplicates:** ${result.duplicates} (already exist in this project)
${result.errors.length > 0 ? `**Errors:** ${result.errors.length}` : ""}

${args.sourceProject ? `Source project: ${args.sourceProject}` : "Imported from all available projects"}

${result.errors.length > 0 ? `### Errors\n${result.errors.slice(0, 5).map(e => `- ${e}`).join("\n")}${result.errors.length > 5 ? `\n... and ${result.errors.length - 5} more` : ""}` : ""}

Imported memories have been tagged with "imported" and their source project.`;
        }

        case "list": {
          const globalStorage = getGlobalStorage();
          const memories = globalStorage.listShared({
            sourceProject: args.sourceProject,
            shareScope: args.shareScope as ShareScope | undefined,
            type: args.types?.[0] as MemoryType | undefined,
            limit: args.limit ?? 50,
          });

          if (memories.length === 0) {
            return "No shared memories found matching the criteria.";
          }

          const memoryList = memories.slice(0, 20).map(m => {
            const truncatedContent = m.content.length > 100 
              ? m.content.substring(0, 100) + "..." 
              : m.content;
            return `**[${m.type}] ${m.scope}** (from: ${m.source_project})
ID: \`${m.id}\`
${truncatedContent}`;
          }).join("\n\n---\n\n");

          return `## Shared Memories (${memories.length} found)

${memoryList}

${memories.length > 20 ? `\n... and ${memories.length - 20} more. Use filters to narrow results.` : ""}

Use action="import" to import these memories into your project.
Use action="unshare" with memoryId to remove a shared memory.`;
        }

        case "stats": {
          const stats = getSharedMemoryStats();
          const projects = listAvailableProjects();

          const projectList = Object.entries(stats.byProject)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 10)
            .map(([proj, count]) => `- ${proj}: ${count}`)
            .join("\n");

          const typeList = Object.entries(stats.byType)
            .sort(([, a], [, b]) => b - a)
            .map(([type, count]) => `- ${type}: ${count}`)
            .join("\n");

          return `## Shared Memory Statistics

**Total Shared Memories:** ${stats.total}
**Projects Sharing:** ${projects.length}

### By Project
${projectList || "No projects sharing yet"}

### By Type
${typeList || "No memories shared yet"}

### Available Projects
${projects.length > 0 ? projects.map(p => `- ${p}`).join("\n") : "No projects available"}

Use action="import" with sourceProject to import from a specific project.`;
        }

        case "unshare": {
          if (!args.memoryId) {
            return "Error: memoryId is required for unshare action. Use action=\"list\" to find memory IDs.";
          }

          const globalStorage = getGlobalStorage();
          const memory = globalStorage.getSharedById(args.memoryId);
          
          if (!memory) {
            return `Error: Shared memory with ID "${args.memoryId}" not found.`;
          }

          const success = globalStorage.unshare(args.memoryId);
          
          if (success) {
            return `Successfully unshared memory:
- ID: ${args.memoryId}
- Type: ${memory.type}
- Scope: ${memory.scope}
- Source: ${memory.source_project}

The memory has been removed from global storage.`;
          } else {
            return `Failed to unshare memory with ID "${args.memoryId}".`;
          }
        }

        default:
          return `Unknown action: ${args.action}. Use one of: share, import, list, stats, unshare`;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      return `Failed to execute share action: ${msg}`;
    }
  },
});

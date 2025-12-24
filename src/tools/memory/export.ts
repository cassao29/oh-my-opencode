import { tool } from "@opencode-ai/plugin";
import { getStorage, type Memory, type MemoryType } from "../../memory/storage/sqlite";
import { getProjectPath } from "../../memory/utils/project";

interface ExportStats {
  total: number;
  byType: Record<string, number>;
  byScope: Record<string, number>;
  dateRange: {
    oldest: string;
    newest: string;
  };
}

function generateExportStats(memories: Memory[]): ExportStats {
  const byType = memories.reduce((acc, m) => {
    acc[m.type] = (acc[m.type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const byScope = memories.reduce((acc, m) => {
    acc[m.scope] = (acc[m.scope] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const timestamps = memories.map(m => new Date(m.timestamp));
  const oldest = new Date(Math.min(...timestamps.map(d => d.getTime())));
  const newest = new Date(Math.max(...timestamps.map(d => d.getTime())));

  return {
    total: memories.length,
    byType,
    byScope,
    dateRange: {
      oldest: oldest.toISOString().split('T')[0],
      newest: newest.toISOString().split('T')[0]
    }
  };
}

function exportJson(memories: Memory[], includeStats: boolean): { data: string, filename: string } {
  const exportObj: { exportDate: string; format: string; memories: Memory[]; stats?: ExportStats } = {
    exportDate: new Date().toISOString(),
    format: "memory-pro-v0.1.0",
    memories
  };

  if (includeStats) {
    exportObj.stats = generateExportStats(memories);
  }

  return {
    data: JSON.stringify(exportObj, null, 2),
    filename: `memory-export-${new Date().toISOString().split('T')[0]}.json`
  };
}

function exportMarkdown(memories: Memory[], includeStats: boolean): { data: string, filename: string } {
  let content = `# Memory Export\n\n`;
  content += `Generated: ${new Date().toISOString()}\n\n`;

  if (includeStats) {
    const stats = generateExportStats(memories);
    content += `## Statistics\n\n`;
    content += `- Total Memories: ${stats.total}\n`;
    content += `- Types: ${Object.entries(stats.byType).map(([t, c]) => `${t}: ${c}`).join(', ')}\n`;
    content += `- Date Range: ${stats.dateRange.oldest} to ${stats.dateRange.newest}\n\n`;
  }

  content += `## Memories\n\n`;

  memories.forEach((m, i) => {
    content += `### ${i + 1}. [${m.type}] ${m.scope}\n\n`;
    content += `**Date:** ${m.timestamp}\n`;
    if (m.tags) content += `**Tags:** ${m.tags}\n`;
    if (m.issue) content += `**Issue:** ${m.issue}\n`;
    content += `\n${m.content}\n\n---\n\n`;
  });

  return {
    data: content,
    filename: `memory-export-${new Date().toISOString().split('T')[0]}.md`
  };
}

function exportCsv(memories: Memory[]): { data: string, filename: string } {
  const headers = ["id", "timestamp", "type", "scope", "content", "tags", "issue"];
  const rows = memories.map(m => [
    m.id,
    m.timestamp,
    m.type,
    m.scope,
    `"${m.content.replace(/"/g, '""')}"`,
    m.tags || "",
    m.issue || ""
  ]);

  const csvContent = [headers, ...rows]
    .map(row => row.map(cell => cell.toString()).join(','))
    .join('\n');

  return {
    data: csvContent,
    filename: `memory-export-${new Date().toISOString().split('T')[0]}.csv`
  };
}

function exportSummary(memories: Memory[]): { data: string, filename: string } {
  const stats = generateExportStats(memories);

  let content = `MEMORY EXPORT SUMMARY\n`;
  content += `====================\n\n`;
  content += `Export Date: ${new Date().toISOString()}\n`;
  content += `Total Memories: ${stats.total}\n\n`;

  content += `TYPE BREAKDOWN:\n`;
  Object.entries(stats.byType).forEach(([type, count]) => {
    content += `- ${type}: ${count}\n`;
  });

  content += `\nSCOPE BREAKDOWN:\n`;
  Object.entries(stats.byScope).slice(0, 10).forEach(([scope, count]) => {
    content += `- ${scope}: ${count}\n`;
  });

  content += `\nDATE RANGE: ${stats.dateRange.oldest} to ${stats.dateRange.newest}\n\n`;

  content += `RECENT MEMORIES:\n`;
  memories.slice(0, 5).forEach((m, i) => {
    content += `${i + 1}. [${m.type}] ${m.scope}: ${m.content.substring(0, 100)}...\n`;
  });

  return {
    data: content,
    filename: `memory-summary-${new Date().toISOString().split('T')[0]}.txt`
  };
}

export const memory_export = tool({
  description: "Export memories to various formats for backup, sharing, or analysis",
  args: {
    format: tool.schema
      .enum(["json", "markdown", "csv", "summary"])
      .default("json")
      .describe("Export format"),
    scope: tool.schema
      .string()
      .optional()
      .describe("Export only memories from this scope"),
    type: tool.schema
      .enum(["decision", "learning", "preference", "blocker", "context", "pattern"])
      .optional()
      .describe("Export only memories of this type"),
    since: tool.schema
      .string()
      .optional()
      .describe("Export memories since this date (YYYY-MM-DD)"),
    limit: tool.schema
      .number()
      .min(1)
      .max(10000)
      .optional()
      .default(1000)
      .describe("Maximum number of memories to export"),
    includeStats: tool.schema
      .boolean()
      .optional()
      .default(true)
      .describe("Include statistics in export")
  },
  async execute(args) {
    try {
      const storage = getStorage();
      const projectPath = getProjectPath();

      const options: { projectPath: string; limit: number; scope?: string; type?: MemoryType } = {
        projectPath,
        limit: args.limit ?? 1000
      };

      if (args.scope) options.scope = args.scope;
      if (args.type) options.type = args.type as MemoryType;

      let memories = storage.getMemories(options);
      if (args.since) {
        const sinceDate = new Date(args.since);
        memories = memories.filter(m => new Date(m.timestamp) >= sinceDate);
      }

      if (memories.length === 0) {
        return "No memories found matching the export criteria.";
      }

      let exportData: string;
      let filename: string;

      switch (args.format) {
        case "json":
          ({ data: exportData, filename } = exportJson(memories, args.includeStats ?? true));
          break;
        case "markdown":
          ({ data: exportData, filename } = exportMarkdown(memories, args.includeStats ?? true));
          break;
        case "csv":
          ({ data: exportData, filename } = exportCsv(memories));
          break;
        case "summary":
          ({ data: exportData, filename } = exportSummary(memories));
          break;
        default:
          return "Unknown export format";
      }

      return `Export completed (${args.format} format):

${exportData.length > 2000 ? exportData.substring(0, 2000) + '\n\n... (truncated for display)' : exportData}

To save this data:
1. Copy the content above
2. Save as: ${filename}
3. The export contains ${memories.length} memories

Note: In a production environment, this would automatically save to a file.`;

    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      return `Failed to export memories: ${msg}`;
    }
  },
});

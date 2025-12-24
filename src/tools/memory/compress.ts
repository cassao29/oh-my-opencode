import { tool } from "@opencode-ai/plugin";
import { getStorage, type MemoryType } from "../../memory/storage/sqlite";
import { getProjectPath } from "../../memory/utils/project";
import {
  compressMemories,
  analyzeCompressionPotential,
  incrementalCompress,
  DEFAULT_COMPRESSION_CONFIG,
  type CompressionConfig,
} from "../../memory/utils/compression";

export const memory_compress = tool({
  description: "Compress and summarize old memories to save space while preserving important information. Merges related memories, removes duplicates, and creates condensed summaries.",
  args: {
    mode: tool.schema
      .enum(["analyze", "compress", "incremental"])
      .default("analyze")
      .describe("analyze: preview compression potential, compress: full compression, incremental: compress only old memories"),
    dryRun: tool.schema
      .boolean()
      .default(true)
      .describe("Preview changes without actually modifying memories"),
    maxAgeDays: tool.schema
      .number()
      .min(1)
      .max(365)
      .optional()
      .default(30)
      .describe("Only compress memories older than this many days"),
    keepRecentDays: tool.schema
      .number()
      .min(1)
      .max(90)
      .optional()
      .default(7)
      .describe("For incremental mode: keep memories from the last N days untouched"),
    similarityThreshold: tool.schema
      .number()
      .min(0.1)
      .max(1.0)
      .optional()
      .default(0.7)
      .describe("Minimum similarity (0-1) to consider memories as duplicates"),
    minGroupSize: tool.schema
      .number()
      .min(2)
      .max(20)
      .optional()
      .default(3)
      .describe("Minimum number of memories required to trigger compression"),
    timeWindowHours: tool.schema
      .number()
      .min(1)
      .max(168)
      .optional()
      .default(24)
      .describe("Group memories within this time window (hours) for compression"),
    scope: tool.schema
      .string()
      .optional()
      .describe("Only compress memories with this scope (optional filter)"),
    type: tool.schema
      .enum(["decision", "learning", "preference", "blocker", "context", "pattern"])
      .optional()
      .describe("Only compress memories of this type (optional filter)"),
  },
  async execute(args) {
    try {
      const storage = getStorage();
      const projectPath = getProjectPath();

      const allMemories = storage.getMemories({
        projectPath,
        scope: args.scope,
        type: args.type as MemoryType | undefined,
        limit: 1000,
      });

      if (allMemories.length === 0) {
        return "No memories found to compress.";
      }

      const config: CompressionConfig = {
        timeWindowHours: args.timeWindowHours ?? DEFAULT_COMPRESSION_CONFIG.timeWindowHours,
        similarityThreshold: args.similarityThreshold ?? DEFAULT_COMPRESSION_CONFIG.similarityThreshold,
        minMemoriesForCompression: args.minGroupSize ?? DEFAULT_COMPRESSION_CONFIG.minMemoriesForCompression,
        maxAgeDays: args.maxAgeDays ?? DEFAULT_COMPRESSION_CONFIG.maxAgeDays,
        preserveOriginals: args.dryRun ?? true,
      };

      if (args.mode === "analyze") {
        const analysis = analyzeCompressionPotential(allMemories, config);
        
        return `## Compression Analysis

**Total Memories:** ${allMemories.length}
**Compressible Groups:** ${analysis.groupsFound}
**Can Compress:** ${analysis.canCompress ? "Yes" : "No"}
**Estimated Space Savings:** ${formatBytes(analysis.potentialSavings)}

### Recommendations

${analysis.recommendations.length > 0 
  ? analysis.recommendations.map(r => `- ${r}`).join("\n")
  : "No compression opportunities found. Memories are already well-organized."}

### Configuration Used
- Max Age: ${config.maxAgeDays} days
- Similarity Threshold: ${(config.similarityThreshold * 100).toFixed(0)}%
- Min Group Size: ${config.minMemoriesForCompression}
- Time Window: ${config.timeWindowHours} hours

Run with mode="compress" and dryRun=false to apply compression.`;
      }

      const result = args.mode === "incremental"
        ? incrementalCompress(allMemories, {
            keepRecentDays: args.keepRecentDays ?? 7,
            maxBatchSize: 100,
            config,
          })
        : compressMemories(allMemories, config);

      if (result.compressedMemories.length === 0) {
        return `No memories eligible for compression with current settings.

Try adjusting:
- Reduce maxAgeDays (current: ${config.maxAgeDays})
- Lower similarityThreshold (current: ${config.similarityThreshold})
- Reduce minGroupSize (current: ${config.minMemoriesForCompression})`;
      }

      if (args.dryRun) {
        const preview = result.compressedMemories.slice(0, 3).map(cm => {
          const truncatedContent = cm.content.length > 200 
            ? cm.content.substring(0, 200) + "..." 
            : cm.content;
          return `**[${cm.type}] ${cm.scope}** (${cm.sourceIds.length} memories merged)
${truncatedContent}`;
        }).join("\n\n---\n\n");

        return `## Compression Preview (DRY RUN)

### Statistics
- **Total Memories:** ${result.stats.totalMemories}
- **Memories to Compress:** ${result.stats.memoriesCompressed}
- **Compressed Into:** ${result.stats.compressedTo} summaries
- **Compression Ratio:** ${(result.stats.compressionRatio * 100).toFixed(1)}%
- **Space Saved:** ${formatBytes(result.stats.spaceSavedChars)}
- **Groups Processed:** ${result.stats.groupsProcessed}

### Sample Compressed Memories

${preview}

${result.compressedMemories.length > 3 ? `\n... and ${result.compressedMemories.length - 3} more\n` : ""}

Run with dryRun=false to apply these changes.`;
      }

      let savedCount = 0;
      let deletedCount = 0;

      for (const compressed of result.compressedMemories) {
        storage.saveMemory({
          type: compressed.type,
          scope: compressed.scope,
          content: compressed.content,
          tags: compressed.tags ? `${compressed.tags}, compressed` : "compressed",
          source: "auto",
          project_path: projectPath,
        });
        savedCount++;

        for (const originalId of compressed.sourceIds) {
          const original = storage.getMemoryById(originalId);
          if (original) {
            storage.deleteMemory(original.scope, original.type as MemoryType, "Compressed into summary");
            deletedCount++;
          }
        }
      }

      return `## Compression Complete

### Results
- **Created:** ${savedCount} compressed summaries
- **Deleted:** ${deletedCount} original memories
- **Compression Ratio:** ${(result.stats.compressionRatio * 100).toFixed(1)}%
- **Space Saved:** ${formatBytes(result.stats.spaceSavedChars)}

### Summary
${result.stats.memoriesCompressed} memories were compressed into ${result.stats.compressedTo} summaries.
The compressed memories preserve key information while reducing storage requirements.`;

    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      return `Failed to compress memories: ${msg}`;
    }
  },
});

function formatBytes(chars: number): string {
  if (chars < 1024) return `${chars} chars`;
  if (chars < 1024 * 1024) return `${(chars / 1024).toFixed(1)} KB`;
  return `${(chars / (1024 * 1024)).toFixed(1)} MB`;
}

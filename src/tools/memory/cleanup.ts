import { tool } from "@opencode-ai/plugin";
import { getStorage, type Memory, type MemoryType } from "../../memory/storage/sqlite";
import { getProjectPath } from "../../memory/utils/project";

interface CleanupResult {
  memoriesToDelete: Memory[];
  analysis: string;
}

function cleanupByAge(memories: Memory[], maxAgeDays: number): CleanupResult {
  const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000);
  const oldMemories = memories.filter(m => new Date(m.timestamp) < cutoff);

  return {
    memoriesToDelete: oldMemories,
    analysis: `Age-based cleanup (> ${maxAgeDays} days):
- Found ${oldMemories.length} old memories
- Keeping ${memories.length - oldMemories.length} recent memories`
  };
}

function cleanupByImportance(memories: Memory[], minImportance: number): CleanupResult {
  const lowImportance = memories.filter(m => {
    let score = 0.5;
    const age = Date.now() - new Date(m.timestamp).getTime();
    const daysOld = age / (1000 * 60 * 60 * 24);
    score += Math.max(0, 1 - daysOld / 30);

    const typeWeights: Record<string, number> = { decision: 1.0, blocker: 0.9, context: 0.8, pattern: 0.7, preference: 0.6, learning: 0.5 };
    score *= typeWeights[m.type] || 0.5;

    return score < minImportance;
  });

  return {
    memoriesToDelete: lowImportance,
    analysis: `Importance-based cleanup (< ${minImportance} score):
- Found ${lowImportance.length} low-importance memories
- Keeping ${memories.length - lowImportance.length} important memories`
  };
}

function cleanupRedundant(memories: Memory[]): CleanupResult {
  const seen = new Set();
  const redundant: Memory[] = [];

  memories.forEach(m => {
    const key = `${m.type}:${m.scope}:${m.content}`;
    if (seen.has(key)) {
      redundant.push(m);
    } else {
      seen.add(key);
    }
  });

  return {
    memoriesToDelete: redundant,
    analysis: `Redundancy cleanup:
- Found ${redundant.length} duplicate memories
- Keeping ${memories.length - redundant.length} unique memories`
  };
}

function cleanupSelective(memories: Memory[], maxAgeDays: number, minImportance: number): CleanupResult {
  const byAge = cleanupByAge(memories, maxAgeDays);
  const byImportance = cleanupByImportance(memories, minImportance);
  const byRedundancy = cleanupRedundant(memories);

  const allCandidates = new Set([...byAge.memoriesToDelete, ...byImportance.memoriesToDelete, ...byRedundancy.memoriesToDelete]);
  const memoriesToDelete = Array.from(allCandidates);

  return {
    memoriesToDelete,
    analysis: `Selective cleanup (combined strategy):
- Old memories (> ${maxAgeDays} days): ${byAge.memoriesToDelete.length}
- Low importance (< ${minImportance}): ${byImportance.memoriesToDelete.length}
- Redundant: ${byRedundancy.memoriesToDelete.length}
- Total to clean: ${memoriesToDelete.length} unique memories`
  };
}

export const memory_cleanup = tool({
  description: "Automatically clean up old, low-importance memories to maintain performance and relevance",
  args: {
    strategy: tool.schema
      .enum(["age", "importance", "redundancy", "selective", "full"])
      .default("selective")
      .describe("Cleanup strategy: age (old memories), importance (low score), redundancy (duplicates), selective (smart combo), full (interactive)"),
    dryRun: tool.schema
      .boolean()
      .default(true)
      .describe("Preview changes without actually deleting"),
    maxAge: tool.schema
      .number()
      .min(1)
      .max(365)
      .optional()
      .default(90)
      .describe("Maximum age in days for age-based cleanup"),
    minImportance: tool.schema
      .number()
      .min(0)
      .max(1)
      .optional()
      .default(0.2)
      .describe("Minimum importance score to keep"),
    maxItems: tool.schema
      .number()
      .min(1)
      .max(1000)
      .optional()
      .default(100)
      .describe("Maximum items to process/cleanup")
  },
  async execute(args) {
    try {
      const storage = getStorage();
      const projectPath = getProjectPath();

      const allMemories = storage.getMemories({
        projectPath,
        limit: (args.maxItems ?? 100) * 2
      });

      if (allMemories.length === 0) {
        return "No memories found to clean up.";
      }

      let memoriesToDelete: Memory[] = [];
      let analysis = "";

      switch (args.strategy) {
        case "age":
          ({ memoriesToDelete, analysis } = cleanupByAge(allMemories, args.maxAge ?? 90));
          break;
        case "importance":
          ({ memoriesToDelete, analysis } = cleanupByImportance(allMemories, args.minImportance ?? 0.2));
          break;
        case "redundancy":
          ({ memoriesToDelete, analysis } = cleanupRedundant(allMemories));
          break;
        case "selective":
          ({ memoriesToDelete, analysis } = cleanupSelective(allMemories, args.maxAge ?? 90, args.minImportance ?? 0.2));
          break;
        case "full":
          return "Full cleanup requires manual review. Use selective cleanup instead.";
      }

      if (args.dryRun) {
        return `DRY RUN - No changes made:

${analysis}

Preview of memories to delete (${memoriesToDelete.length}):
${memoriesToDelete.slice(0, 5).map(m =>
  `- [${m.type}] ${m.scope}: ${m.content.substring(0, 100)}...`
).join('\n')}

Run with dryRun=false to actually delete these memories.`;
      }

      let deletedCount = 0;
      for (const memory of memoriesToDelete) {
        if (storage.deleteMemory(memory.scope, memory.type as MemoryType, "Automated cleanup")) {
          deletedCount++;
        }
      }

      return `Cleanup completed:

${analysis}

Deleted: ${deletedCount} memories
Remaining: ${allMemories.length - deletedCount} memories`;

    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      return `Failed to perform cleanup: ${msg}`;
    }
  },
});

import type { Memory, MemoryType } from "../storage/sqlite";

export interface CompressionConfig {
  timeWindowHours: number;
  similarityThreshold: number;
  minMemoriesForCompression: number;
  maxAgeDays: number;
  preserveOriginals: boolean;
}

export const DEFAULT_COMPRESSION_CONFIG: CompressionConfig = {
  timeWindowHours: 24,
  similarityThreshold: 0.7,
  minMemoriesForCompression: 3,
  maxAgeDays: 30,
  preserveOriginals: false,
};

export interface CompressionResult {
  compressedMemories: CompressedMemory[];
  originalIds: string[];
  stats: CompressionStats;
}

export interface CompressedMemory {
  type: MemoryType;
  scope: string;
  content: string;
  tags?: string;
  sourceIds: string[];
}

export interface CompressionStats {
  totalMemories: number;
  memoriesCompressed: number;
  compressedTo: number;
  compressionRatio: number;
  spaceSavedChars: number;
  groupsProcessed: number;
}

export function groupMemoriesForCompression(
  memories: Memory[],
  config: CompressionConfig = DEFAULT_COMPRESSION_CONFIG
): Map<string, Memory[]> {
  const groups = new Map<string, Memory[]>();
  const cutoffDate = new Date(Date.now() - config.maxAgeDays * 24 * 60 * 60 * 1000);

  for (const memory of memories) {
    const memoryDate = new Date(memory.timestamp);
    if (memoryDate > cutoffDate) continue;

    const key = `${memory.scope}:${memory.type}`;
    const existing = groups.get(key) ?? [];
    existing.push(memory);
    groups.set(key, existing);
  }

  for (const [key, group] of groups) {
    if (group.length < config.minMemoriesForCompression) {
      groups.delete(key);
    }
  }

  return groups;
}

export function calculateJaccardSimilarity(text1: string, text2: string): number {
  const words1 = new Set(
    text1.toLowerCase().split(/\s+/).filter(w => w.length > 2)
  );
  const words2 = new Set(
    text2.toLowerCase().split(/\s+/).filter(w => w.length > 2)
  );

  if (words1.size === 0 || words2.size === 0) return 0;

  const intersection = new Set([...words1].filter(w => words2.has(w)));
  const union = new Set([...words1, ...words2]);

  return intersection.size / union.size;
}

export function deduplicateMemories(
  memories: Memory[],
  threshold: number = 0.7
): { unique: Memory[]; duplicates: Memory[] } {
  const unique: Memory[] = [];
  const duplicates: Memory[] = [];

  const sortedNewestFirst = [...memories].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  for (const memory of sortedNewestFirst) {
    const isDuplicate = unique.some(
      existing => calculateJaccardSimilarity(existing.content, memory.content) >= threshold
    );

    if (isDuplicate) {
      duplicates.push(memory);
    } else {
      unique.push(memory);
    }
  }

  return { unique, duplicates };
}

export function groupByTimeWindow(
  memories: Memory[],
  windowHours: number
): Memory[][] {
  if (memories.length === 0) return [];

  const sorted = [...memories].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  const groups: Memory[][] = [];
  let currentGroup: Memory[] = [sorted[0]];
  let windowStart = new Date(sorted[0].timestamp).getTime();

  for (let i = 1; i < sorted.length; i++) {
    const memoryTime = new Date(sorted[i].timestamp).getTime();
    const windowEnd = windowStart + windowHours * 60 * 60 * 1000;

    if (memoryTime <= windowEnd) {
      currentGroup.push(sorted[i]);
    } else {
      if (currentGroup.length > 0) {
        groups.push(currentGroup);
      }
      currentGroup = [sorted[i]];
      windowStart = memoryTime;
    }
  }

  if (currentGroup.length > 0) {
    groups.push(currentGroup);
  }

  return groups;
}

const IMPORTANT_KEYWORDS = [
  "must", "should", "critical", "important", "never", "always",
  "api", "database", "auth", "security", "error", "fix", "bug",
  "implemented", "created", "updated", "changed", "added", "removed",
];

function extractKeyPoints(content: string): string[] {
  const lines = content.split(/[.\n]/).map(l => l.trim()).filter(l => l.length > 10);

  const scored = lines.map(line => ({
    line,
    score: IMPORTANT_KEYWORDS.filter(kw => line.toLowerCase().includes(kw)).length,
  }));

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(s => s.line);
}

export function summarizeMemories(memories: Memory[]): string {
  if (memories.length === 0) return "";
  if (memories.length === 1) return memories[0].content;

  const themes: string[][] = [];
  const processed = new Set<string>();

  for (const memory of memories) {
    if (processed.has(memory.id)) continue;

    const theme = [memory.content];
    processed.add(memory.id);

    for (const other of memories) {
      if (processed.has(other.id)) continue;
      if (calculateJaccardSimilarity(memory.content, other.content) > 0.4) {
        theme.push(other.content);
        processed.add(other.id);
      }
    }

    themes.push(theme);
  }

  const allKeyPoints: string[] = [];
  for (const theme of themes) {
    for (const content of theme) {
      allKeyPoints.push(...extractKeyPoints(content));
    }
  }

  const uniquePoints = [...new Set(allKeyPoints)];
  const dateRange = getDateRange(memories);
  const header = `[Compressed ${memories.length} memories from ${dateRange}]`;
  const summary = uniquePoints.slice(0, 10).map(p => `- ${p}`).join("\n");

  return `${header}\n\n${summary}`;
}

function getDateRange(memories: Memory[]): string {
  const dates = memories.map(m => new Date(m.timestamp).getTime());
  const min = new Date(Math.min(...dates));
  const max = new Date(Math.max(...dates));

  const format = (d: Date) => d.toISOString().split("T")[0];

  if (format(min) === format(max)) {
    return format(min);
  }
  return `${format(min)} to ${format(max)}`;
}

function mergeTags(memories: Memory[]): string | undefined {
  const allTags = new Set<string>();
  
  for (const memory of memories) {
    if (memory.tags) {
      memory.tags.split(",").map(t => t.trim()).forEach(t => allTags.add(t));
    }
  }

  if (allTags.size === 0) return undefined;
  return [...allTags].slice(0, 10).join(", ");
}

export function compressGroup(
  memories: Memory[],
  config: CompressionConfig = DEFAULT_COMPRESSION_CONFIG
): CompressedMemory | null {
  if (memories.length < config.minMemoriesForCompression) {
    return null;
  }

  const { unique } = deduplicateMemories(memories, config.similarityThreshold);

  if (unique.length < config.minMemoriesForCompression) {
    return null;
  }

  const summary = summarizeMemories(unique);
  const type = memories[0].type;
  const scope = memories[0].scope;

  return {
    type,
    scope,
    content: summary,
    tags: mergeTags(memories),
    sourceIds: memories.map(m => m.id),
  };
}

export function compressMemories(
  memories: Memory[],
  config: CompressionConfig = DEFAULT_COMPRESSION_CONFIG
): CompressionResult {
  const compressedMemories: CompressedMemory[] = [];
  const originalIds: string[] = [];
  let totalOriginalSize = 0;
  let totalCompressedSize = 0;

  const groups = groupMemoriesForCompression(memories, config);

  for (const [_key, groupMemories] of groups) {
    const timeGroups = groupByTimeWindow(groupMemories, config.timeWindowHours);

    for (const timeGroup of timeGroups) {
      if (timeGroup.length < config.minMemoriesForCompression) continue;

      const compressed = compressGroup(timeGroup, config);
      if (compressed) {
        compressedMemories.push(compressed);
        originalIds.push(...compressed.sourceIds);
        totalOriginalSize += timeGroup.reduce((sum, m) => sum + m.content.length, 0);
        totalCompressedSize += compressed.content.length;
      }
    }
  }

  const compressionRatio = totalOriginalSize > 0 
    ? totalCompressedSize / totalOriginalSize 
    : 1;

  return {
    compressedMemories,
    originalIds,
    stats: {
      totalMemories: memories.length,
      memoriesCompressed: originalIds.length,
      compressedTo: compressedMemories.length,
      compressionRatio,
      spaceSavedChars: totalOriginalSize - totalCompressedSize,
      groupsProcessed: groups.size,
    },
  };
}

export function analyzeCompressionPotential(
  memories: Memory[],
  config: CompressionConfig = DEFAULT_COMPRESSION_CONFIG
): {
  canCompress: boolean;
  potentialSavings: number;
  groupsFound: number;
  recommendations: string[];
} {
  const groups = groupMemoriesForCompression(memories, config);
  const recommendations: string[] = [];
  let potentialSavings = 0;

  for (const [key, groupMemories] of groups) {
    const [scope, type] = key.split(":");
    const { duplicates } = deduplicateMemories(groupMemories, config.similarityThreshold);
    
    if (duplicates.length > 0) {
      recommendations.push(
        `Found ${duplicates.length} near-duplicates in ${scope}/${type}`
      );
      potentialSavings += duplicates.reduce((sum, m) => sum + m.content.length, 0);
    }

    if (groupMemories.length >= config.minMemoriesForCompression) {
      const avgSize = groupMemories.reduce((sum, m) => sum + m.content.length, 0) / groupMemories.length;
      const estimatedCompressed = Math.min(1000, avgSize * 0.3) * Math.ceil(groupMemories.length / 5);
      const originalSize = groupMemories.reduce((sum, m) => sum + m.content.length, 0);
      potentialSavings += originalSize - estimatedCompressed;
      
      recommendations.push(
        `Can compress ${groupMemories.length} memories in ${scope}/${type} (est. ${Math.round((1 - estimatedCompressed / originalSize) * 100)}% reduction)`
      );
    }
  }

  return {
    canCompress: groups.size > 0,
    potentialSavings,
    groupsFound: groups.size,
    recommendations,
  };
}

export function incrementalCompress(
  memories: Memory[],
  options: {
    keepRecentDays?: number;
    maxBatchSize?: number;
    config?: CompressionConfig;
  } = {}
): CompressionResult {
  const keepRecentDays = options.keepRecentDays ?? 7;
  const maxBatchSize = options.maxBatchSize ?? 100;
  const config = options.config ?? DEFAULT_COMPRESSION_CONFIG;

  const cutoffDate = new Date(Date.now() - keepRecentDays * 24 * 60 * 60 * 1000);
  const oldMemories = memories.filter(m => new Date(m.timestamp) < cutoffDate);
  const toCompress = oldMemories.slice(0, maxBatchSize);

  return compressMemories(toCompress, config);
}

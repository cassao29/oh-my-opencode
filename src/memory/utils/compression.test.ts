import { describe, it, expect } from "bun:test";
import {
  calculateJaccardSimilarity,
  deduplicateMemories,
  groupByTimeWindow,
  groupMemoriesForCompression,
  summarizeMemories,
  compressGroup,
  compressMemories,
  analyzeCompressionPotential,
  incrementalCompress,
  DEFAULT_COMPRESSION_CONFIG,
} from "./compression";
import type { Memory } from "../storage/sqlite";

function createMockMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    type: "context",
    scope: "test-scope",
    content: "Test memory content",
    source: "manual",
    ...overrides,
  };
}

function createOldMemory(daysAgo: number, overrides: Partial<Memory> = {}): Memory {
  const date = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  return createMockMemory({
    timestamp: date.toISOString(),
    ...overrides,
  });
}

describe("calculateJaccardSimilarity", () => {
  it("returns 1.0 for identical strings", () => {
    // #given
    const text = "the quick brown fox jumps over the lazy dog";
    
    // #when
    const similarity = calculateJaccardSimilarity(text, text);
    
    // #then
    expect(similarity).toBe(1.0);
  });

  it("returns 0 for completely different strings", () => {
    // #given
    const text1 = "apple banana cherry";
    const text2 = "xyz uvw rst";
    
    // #when
    const similarity = calculateJaccardSimilarity(text1, text2);
    
    // #then
    expect(similarity).toBe(0);
  });

  it("returns partial similarity for overlapping content", () => {
    // #given
    const text1 = "the quick brown fox";
    const text2 = "the slow brown bear";
    
    // #when
    const similarity = calculateJaccardSimilarity(text1, text2);
    
    // #then
    expect(similarity).toBeGreaterThan(0);
    expect(similarity).toBeLessThan(1);
  });

  it("handles empty strings", () => {
    expect(calculateJaccardSimilarity("", "test")).toBe(0);
    expect(calculateJaccardSimilarity("test", "")).toBe(0);
    expect(calculateJaccardSimilarity("", "")).toBe(0);
  });

  it("ignores short words (< 3 chars)", () => {
    // #given
    const text1 = "a an the is";
    const text2 = "different words here";
    
    // #when
    const similarity = calculateJaccardSimilarity(text1, text2);
    
    // #then
    expect(similarity).toBe(0);
  });
});

describe("deduplicateMemories", () => {
  it("returns all memories when none are similar", () => {
    // #given
    const memories = [
      createMockMemory({ content: "First unique content about apples" }),
      createMockMemory({ content: "Second unique content about oranges" }),
      createMockMemory({ content: "Third unique content about bananas" }),
    ];
    
    // #when
    const { unique, duplicates } = deduplicateMemories(memories, 0.7);
    
    // #then
    expect(unique.length).toBe(3);
    expect(duplicates.length).toBe(0);
  });

  it("identifies duplicates based on similarity threshold", () => {
    // #given
    const memories = [
      createMockMemory({ content: "The database connection failed with timeout error" }),
      createMockMemory({ content: "Database connection failed due to timeout" }),
      createMockMemory({ content: "Something completely different about cats" }),
    ];
    
    // #when
    const { unique, duplicates } = deduplicateMemories(memories, 0.5);
    
    // #then
    expect(unique.length).toBe(2);
    expect(duplicates.length).toBe(1);
  });

  it("keeps newer memories and marks older as duplicates", () => {
    // #given
    const older = createOldMemory(5, { content: "Original content about the system" });
    const newer = createOldMemory(1, { content: "Original content about the system updated" });
    const memories = [older, newer];
    
    // #when
    const { unique } = deduplicateMemories(memories, 0.7);
    
    // #then
    expect(unique[0].timestamp).toBe(newer.timestamp);
  });
});

describe("groupByTimeWindow", () => {
  it("groups memories within the same time window", () => {
    // #given
    const baseTime = Date.now();
    const memories = [
      createMockMemory({ timestamp: new Date(baseTime).toISOString() }),
      createMockMemory({ timestamp: new Date(baseTime + 60000).toISOString() }),
      createMockMemory({ timestamp: new Date(baseTime + 120000).toISOString() }),
    ];
    
    // #when
    const groups = groupByTimeWindow(memories, 24);
    
    // #then
    expect(groups.length).toBe(1);
    expect(groups[0].length).toBe(3);
  });

  it("creates separate groups for different time windows", () => {
    // #given
    const day1 = createOldMemory(10);
    const day2 = createOldMemory(5);
    const day3 = createOldMemory(1);
    const memories = [day1, day2, day3];
    
    // #when
    const groups = groupByTimeWindow(memories, 24);
    
    // #then
    expect(groups.length).toBe(3);
  });

  it("handles empty array", () => {
    expect(groupByTimeWindow([], 24)).toEqual([]);
  });
});

describe("groupMemoriesForCompression", () => {
  it("groups memories by scope and type", () => {
    // #given
    const memories = [
      createOldMemory(60, { scope: "api", type: "decision" }),
      createOldMemory(60, { scope: "api", type: "decision" }),
      createOldMemory(60, { scope: "api", type: "decision" }),
      createOldMemory(60, { scope: "db", type: "context" }),
    ];
    
    // #when
    const groups = groupMemoriesForCompression(memories, DEFAULT_COMPRESSION_CONFIG);
    
    // #then
    expect(groups.size).toBe(1);
    expect(groups.get("api:decision")?.length).toBe(3);
  });

  it("excludes recent memories", () => {
    // #given
    const recentMemory = createMockMemory({ scope: "test", type: "context" });
    const oldMemories = [
      createOldMemory(60, { scope: "test", type: "context" }),
      createOldMemory(60, { scope: "test", type: "context" }),
      createOldMemory(60, { scope: "test", type: "context" }),
    ];
    
    // #when
    const groups = groupMemoriesForCompression(
      [recentMemory, ...oldMemories],
      DEFAULT_COMPRESSION_CONFIG
    );
    
    // #then
    expect(groups.get("test:context")?.length).toBe(3);
  });

  it("excludes groups with too few memories", () => {
    // #given
    const memories = [
      createOldMemory(60, { scope: "single", type: "context" }),
      createOldMemory(60, { scope: "single", type: "context" }),
    ];
    
    // #when
    const groups = groupMemoriesForCompression(memories, {
      ...DEFAULT_COMPRESSION_CONFIG,
      minMemoriesForCompression: 3,
    });
    
    // #then
    expect(groups.size).toBe(0);
  });
});

describe("summarizeMemories", () => {
  it("returns empty string for empty array", () => {
    expect(summarizeMemories([])).toBe("");
  });

  it("returns content as-is for single memory", () => {
    const memory = createMockMemory({ content: "Single memory content" });
    expect(summarizeMemories([memory])).toBe("Single memory content");
  });

  it("creates summary with header for multiple memories", () => {
    // #given
    const memories = [
      createOldMemory(5, { content: "First important decision about API design" }),
      createOldMemory(5, { content: "Second critical change to database schema" }),
      createOldMemory(5, { content: "Third update to authentication system" }),
    ];
    
    // #when
    const summary = summarizeMemories(memories);
    
    // #then
    expect(summary).toContain("[Compressed 3 memories");
    expect(summary).toContain("-");
  });
});

describe("compressGroup", () => {
  it("returns null for groups below minimum size", () => {
    // #given
    const memories = [
      createOldMemory(60, { content: "First memory" }),
      createOldMemory(60, { content: "Second memory" }),
    ];
    
    // #when
    const result = compressGroup(memories, {
      ...DEFAULT_COMPRESSION_CONFIG,
      minMemoriesForCompression: 3,
    });
    
    // #then
    expect(result).toBeNull();
  });

  it("compresses group into single memory", () => {
    // #given
    const memories = [
      createOldMemory(60, { scope: "test", type: "context", content: "First memory about the important API changes" }),
      createOldMemory(60, { scope: "test", type: "context", content: "Second memory about critical database updates" }),
      createOldMemory(60, { scope: "test", type: "context", content: "Third memory about authentication improvements" }),
    ];
    
    // #when
    const result = compressGroup(memories, DEFAULT_COMPRESSION_CONFIG);
    
    // #then
    expect(result).not.toBeNull();
    expect(result?.type).toBe("context");
    expect(result?.scope).toBe("test");
    expect(result?.sourceIds.length).toBe(3);
  });

  it("merges tags from all memories", () => {
    // #given
    const memories = [
      createOldMemory(60, { tags: "api, backend", content: "API related memory content here" }),
      createOldMemory(60, { tags: "database", content: "Database related memory content here" }),
      createOldMemory(60, { tags: "api, frontend", content: "Frontend API memory content here" }),
    ];
    
    // #when
    const result = compressGroup(memories, DEFAULT_COMPRESSION_CONFIG);
    
    // #then
    expect(result?.tags).toContain("api");
    expect(result?.tags).toContain("backend");
    expect(result?.tags).toContain("database");
    expect(result?.tags).toContain("frontend");
  });
});

describe("compressMemories", () => {
  it("returns empty result when no memories to compress", () => {
    // #given
    const recentMemories = [
      createMockMemory({ content: "Recent memory 1" }),
      createMockMemory({ content: "Recent memory 2" }),
    ];
    
    // #when
    const result = compressMemories(recentMemories, DEFAULT_COMPRESSION_CONFIG);
    
    // #then
    expect(result.compressedMemories.length).toBe(0);
    expect(result.originalIds.length).toBe(0);
  });

  it("compresses eligible memories and reports stats", () => {
    // #given
    const memories = [
      createOldMemory(60, { scope: "api", type: "context", content: "First API context memory about important changes" }),
      createOldMemory(60, { scope: "api", type: "context", content: "Second API context memory about critical updates" }),
      createOldMemory(60, { scope: "api", type: "context", content: "Third API context memory about security patches" }),
    ];
    
    // #when
    const result = compressMemories(memories, DEFAULT_COMPRESSION_CONFIG);
    
    // #then
    expect(result.compressedMemories.length).toBeGreaterThan(0);
    expect(result.stats.memoriesCompressed).toBe(3);
    expect(result.stats.compressedTo).toBe(1);
  });
});

describe("analyzeCompressionPotential", () => {
  it("reports no compression when all memories are recent", () => {
    // #given
    const memories = [
      createMockMemory({ content: "Recent memory 1" }),
      createMockMemory({ content: "Recent memory 2" }),
    ];
    
    // #when
    const analysis = analyzeCompressionPotential(memories, DEFAULT_COMPRESSION_CONFIG);
    
    // #then
    expect(analysis.canCompress).toBe(false);
    expect(analysis.groupsFound).toBe(0);
  });

  it("identifies compression opportunities", () => {
    // #given
    const memories = [
      createOldMemory(60, { scope: "test", type: "context", content: "Old memory about important topic 1" }),
      createOldMemory(60, { scope: "test", type: "context", content: "Old memory about important topic 2" }),
      createOldMemory(60, { scope: "test", type: "context", content: "Old memory about important topic 3" }),
    ];
    
    // #when
    const analysis = analyzeCompressionPotential(memories, DEFAULT_COMPRESSION_CONFIG);
    
    // #then
    expect(analysis.canCompress).toBe(true);
    expect(analysis.groupsFound).toBeGreaterThan(0);
    expect(analysis.recommendations.length).toBeGreaterThan(0);
  });
});

describe("incrementalCompress", () => {
  it("only compresses memories older than keepRecentDays", () => {
    // #given
    const oldMemories = [
      createOldMemory(30, { scope: "old", type: "context", content: "Old memory content about topic 1" }),
      createOldMemory(30, { scope: "old", type: "context", content: "Old memory content about topic 2" }),
      createOldMemory(30, { scope: "old", type: "context", content: "Old memory content about topic 3" }),
    ];
    const recentMemories = [
      createOldMemory(1, { scope: "recent", type: "context", content: "Recent memory 1" }),
      createOldMemory(1, { scope: "recent", type: "context", content: "Recent memory 2" }),
    ];
    
    // #when
    const result = incrementalCompress([...oldMemories, ...recentMemories], {
      keepRecentDays: 7,
    });
    
    // #then
    const compressedScopes = result.compressedMemories.map(m => m.scope);
    expect(compressedScopes).not.toContain("recent");
  });

  it("respects maxBatchSize", () => {
    // #given
    const memories = Array.from({ length: 50 }, (_, i) =>
      createOldMemory(60, { 
        scope: "batch", 
        type: "context", 
        content: `Memory ${i} about important topic` 
      })
    );
    
    // #when
    const result = incrementalCompress(memories, {
      maxBatchSize: 10,
      keepRecentDays: 1,
    });
    
    // #then
    expect(result.stats.totalMemories).toBeLessThanOrEqual(10);
  });
});

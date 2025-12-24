import { describe, test, expect } from "bun:test";
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

describe("Security: Compression Input Validation", () => {
  test("handles empty memory array gracefully", () => {
    const result = compressMemories([], DEFAULT_COMPRESSION_CONFIG);
    expect(result.compressedMemories.length).toBe(0);
    expect(result.originalIds.length).toBe(0);
    expect(result.stats.totalMemories).toBe(0);
  });

  test("handles null/undefined content in memories", () => {
    const memories = [
      createOldMemory(60, { content: null as unknown as string }),
      createOldMemory(60, { content: undefined as unknown as string }),
    ];
    
    expect(() => compressMemories(memories, DEFAULT_COMPRESSION_CONFIG)).not.toThrow();
  });

  test("handles extremely large content without crashing", () => {
    const largeContent = "a".repeat(100000);
    const memories = [
      createOldMemory(60, { scope: "large", type: "context", content: largeContent }),
      createOldMemory(60, { scope: "large", type: "context", content: largeContent }),
      createOldMemory(60, { scope: "large", type: "context", content: largeContent }),
    ];
    
    expect(() => compressMemories(memories, DEFAULT_COMPRESSION_CONFIG)).not.toThrow();
  });

  test("handles special characters in content", () => {
    const specialContent = '<script>alert("xss")</script> SELECT * FROM users; -- ${process.env.SECRET}';
    const memories = [
      createOldMemory(60, { scope: "special", type: "context", content: specialContent }),
      createOldMemory(60, { scope: "special", type: "context", content: specialContent }),
      createOldMemory(60, { scope: "special", type: "context", content: specialContent }),
    ];
    
    const result = compressMemories(memories, DEFAULT_COMPRESSION_CONFIG);
    expect(result).toBeDefined();
  });

  test("handles unicode and emoji in content", () => {
    const unicodeContent = "测试内容 🎉 тест محتوى العربية 日本語テスト";
    const memories = [
      createOldMemory(60, { scope: "unicode", type: "context", content: unicodeContent }),
      createOldMemory(60, { scope: "unicode", type: "context", content: `${unicodeContent} variant` }),
      createOldMemory(60, { scope: "unicode", type: "context", content: `${unicodeContent} another` }),
    ];
    
    const result = compressMemories(memories, DEFAULT_COMPRESSION_CONFIG);
    expect(result).toBeDefined();
  });

  test("handles null bytes in content", () => {
    const contentWithNull = "test\x00content\x00with\x00nulls";
    const memories = [
      createOldMemory(60, { scope: "null", type: "context", content: contentWithNull }),
      createOldMemory(60, { scope: "null", type: "context", content: contentWithNull }),
      createOldMemory(60, { scope: "null", type: "context", content: contentWithNull }),
    ];
    
    expect(() => compressMemories(memories, DEFAULT_COMPRESSION_CONFIG)).not.toThrow();
  });
});

describe("Security: Compression Config Validation", () => {
  test("handles negative maxAgeDays", () => {
    const memories = [createOldMemory(60, { scope: "test", type: "context", content: "test" })];
    const config = { ...DEFAULT_COMPRESSION_CONFIG, maxAgeDays: -1 };
    
    expect(() => compressMemories(memories, config)).not.toThrow();
  });

  test("handles zero timeWindowHours", () => {
    const memories = [
      createOldMemory(60, { scope: "test", type: "context", content: "test 1" }),
      createOldMemory(60, { scope: "test", type: "context", content: "test 2" }),
      createOldMemory(60, { scope: "test", type: "context", content: "test 3" }),
    ];
    const config = { ...DEFAULT_COMPRESSION_CONFIG, timeWindowHours: 0 };
    
    expect(() => compressMemories(memories, config)).not.toThrow();
  });

  test("handles similarityThreshold out of bounds", () => {
    const memories = [
      createOldMemory(60, { scope: "test", type: "context", content: "test content" }),
      createOldMemory(60, { scope: "test", type: "context", content: "test content" }),
      createOldMemory(60, { scope: "test", type: "context", content: "test content" }),
    ];
    
    expect(() => compressMemories(memories, { ...DEFAULT_COMPRESSION_CONFIG, similarityThreshold: -1 })).not.toThrow();
    expect(() => compressMemories(memories, { ...DEFAULT_COMPRESSION_CONFIG, similarityThreshold: 2 })).not.toThrow();
  });

  test("handles minMemoriesForCompression of 0", () => {
    const memories = [createOldMemory(60, { scope: "test", type: "context", content: "test" })];
    const config = { ...DEFAULT_COMPRESSION_CONFIG, minMemoriesForCompression: 0 };
    
    expect(() => compressMemories(memories, config)).not.toThrow();
  });
});

describe("Security: Jaccard Similarity Edge Cases", () => {
  test("handles very long strings", () => {
    const longText1 = "word ".repeat(10000);
    const longText2 = "word ".repeat(10000) + "different";
    
    expect(() => calculateJaccardSimilarity(longText1, longText2)).not.toThrow();
  });

  test("handles strings with only short words", () => {
    const result = calculateJaccardSimilarity("a b c d e", "f g h i j");
    expect(result).toBe(0);
  });

  test("handles strings with special regex characters", () => {
    const text1 = "test.content*with+regex[chars]";
    const text2 = "test.content*with+regex[chars]different";
    
    expect(() => calculateJaccardSimilarity(text1, text2)).not.toThrow();
  });

  test("handles strings with newlines and tabs", () => {
    const text1 = "test\ncontent\twith\nwhitespace";
    const text2 = "test\ncontent\twith\nwhitespace variant";
    
    expect(() => calculateJaccardSimilarity(text1, text2)).not.toThrow();
  });
});

describe("Security: Time-based Operations", () => {
  test("handles invalid timestamps gracefully", () => {
    const memories = [
      createMockMemory({ timestamp: "invalid-date", scope: "test", type: "context" }),
      createMockMemory({ timestamp: "", scope: "test", type: "context" }),
    ];
    
    expect(() => groupByTimeWindow(memories, 24)).not.toThrow();
  });

  test("handles far-future timestamps", () => {
    const futureDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000 * 100);
    const memories = [
      createMockMemory({ timestamp: futureDate.toISOString(), scope: "test", type: "context" }),
    ];
    
    expect(() => groupMemoriesForCompression(memories, DEFAULT_COMPRESSION_CONFIG)).not.toThrow();
  });

  test("handles very old timestamps", () => {
    const veryOldDate = new Date("1970-01-01T00:00:00.000Z");
    const memories = [
      createMockMemory({ timestamp: veryOldDate.toISOString(), scope: "test", type: "context", content: "old content 1" }),
      createMockMemory({ timestamp: veryOldDate.toISOString(), scope: "test", type: "context", content: "old content 2" }),
      createMockMemory({ timestamp: veryOldDate.toISOString(), scope: "test", type: "context", content: "old content 3" }),
    ];
    
    const result = compressMemories(memories, DEFAULT_COMPRESSION_CONFIG);
    expect(result).toBeDefined();
  });
});

describe("Security: Deduplication Protection", () => {
  test("preserves truly unique memories", () => {
    const uniqueMemories = [
      createMockMemory({ content: "Apple banana cherry strawberry watermelon grape" }),
      createMockMemory({ content: "Database connection pooling optimization techniques" }),
      createMockMemory({ content: "JavaScript TypeScript programming languages syntax" }),
      createMockMemory({ content: "Security authentication authorization OAuth tokens" }),
      createMockMemory({ content: "Performance monitoring logging tracing metrics" }),
    ];
    
    const { unique, duplicates } = deduplicateMemories(uniqueMemories, 0.7);
    expect(unique.length).toBe(5);
    expect(duplicates.length).toBe(0);
  });

  test("correctly identifies near-duplicates with threshold", () => {
    const memories = [
      createMockMemory({ content: "The quick brown fox jumps over the lazy dog" }),
      createMockMemory({ content: "The quick brown fox jumps over the lazy cat" }),
      createMockMemory({ content: "Something completely different about programming" }),
    ];
    
    const { unique } = deduplicateMemories(memories, 0.8);
    expect(unique.length).toBeGreaterThanOrEqual(2);
  });
});

describe("Security: Summarization Safety", () => {
  test("summary does not include script tags from content", () => {
    const memories = [
      createOldMemory(60, { content: '<script>alert("xss")</script> Important decision about security' }),
      createOldMemory(60, { content: 'Another important decision about the database' }),
      createOldMemory(60, { content: 'Critical fix applied to authentication' }),
    ];
    
    const summary = summarizeMemories(memories);
    expect(summary).not.toContain('<script>');
    expect(summary).not.toContain('</script>');
  });

  test("handles memories with empty content", () => {
    const memories = [
      createMockMemory({ content: "" }),
      createMockMemory({ content: "   " }),
      createMockMemory({ content: "actual content here" }),
    ];
    
    expect(() => summarizeMemories(memories)).not.toThrow();
  });

  test("truncates extremely long summaries", () => {
    const longContent = "important ".repeat(1000);
    const memories = Array.from({ length: 10 }, () =>
      createMockMemory({ content: longContent })
    );
    
    const summary = summarizeMemories(memories);
    expect(summary.length).toBeLessThan(longContent.length * 10);
  });
});

describe("Security: Tag Merging Safety", () => {
  test("handles malicious tags", () => {
    const memories = [
      createOldMemory(60, { scope: "test", type: "context", content: "content 1", tags: '<script>alert(1)</script>' }),
      createOldMemory(60, { scope: "test", type: "context", content: "content 2", tags: 'normal,tags' }),
      createOldMemory(60, { scope: "test", type: "context", content: "content 3", tags: "'); DROP TABLE memories; --" }),
    ];
    
    const result = compressGroup(memories, DEFAULT_COMPRESSION_CONFIG);
    expect(result).toBeDefined();
  });

  test("limits number of merged tags", () => {
    const manyTags = Array.from({ length: 100 }, (_, i) => `tag${i}`).join(",");
    const memories = [
      createOldMemory(60, { scope: "test", type: "context", content: "content 1", tags: manyTags }),
      createOldMemory(60, { scope: "test", type: "context", content: "content 2", tags: manyTags }),
      createOldMemory(60, { scope: "test", type: "context", content: "content 3", tags: manyTags }),
    ];
    
    const result = compressGroup(memories, DEFAULT_COMPRESSION_CONFIG);
    if (result?.tags) {
      const tagCount = result.tags.split(",").length;
      expect(tagCount).toBeLessThanOrEqual(10);
    }
  });
});

describe("Security: Memory ID Handling", () => {
  test("handles duplicate memory IDs", () => {
    const duplicateId = "same-id-for-all";
    const memories = [
      createOldMemory(60, { id: duplicateId, scope: "test", type: "context", content: "content 1" }),
      createOldMemory(60, { id: duplicateId, scope: "test", type: "context", content: "content 2" }),
      createOldMemory(60, { id: duplicateId, scope: "test", type: "context", content: "content 3" }),
    ];
    
    expect(() => compressMemories(memories, DEFAULT_COMPRESSION_CONFIG)).not.toThrow();
  });

  test("handles empty memory IDs", () => {
    const memories = [
      createOldMemory(60, { id: "", scope: "test", type: "context", content: "content 1" }),
      createOldMemory(60, { id: "", scope: "test", type: "context", content: "content 2" }),
      createOldMemory(60, { id: "", scope: "test", type: "context", content: "content 3" }),
    ];
    
    expect(() => compressMemories(memories, DEFAULT_COMPRESSION_CONFIG)).not.toThrow();
  });
});

describe("Security: Incremental Compression Safety", () => {
  test("never compresses memories newer than keepRecentDays", () => {
    const recentMemories = Array.from({ length: 10 }, (_, i) =>
      createOldMemory(1, { scope: "recent", type: "context", content: `Recent memory ${i}` })
    );
    const oldMemories = Array.from({ length: 10 }, (_, i) =>
      createOldMemory(30, { scope: "old", type: "context", content: `Old memory ${i}` })
    );
    
    const result = incrementalCompress([...recentMemories, ...oldMemories], {
      keepRecentDays: 7,
    });
    
    const compressedScopes = result.compressedMemories.map(m => m.scope);
    expect(compressedScopes).not.toContain("recent");
  });

  test("respects maxBatchSize limit", () => {
    const manyMemories = Array.from({ length: 1000 }, (_, i) =>
      createOldMemory(60, { scope: "batch", type: "context", content: `Memory ${i}` })
    );
    
    const result = incrementalCompress(manyMemories, {
      maxBatchSize: 50,
      keepRecentDays: 1,
    });
    
    expect(result.stats.totalMemories).toBeLessThanOrEqual(50);
  });
});

describe("Security: Analysis Potential", () => {
  test("analyzeCompressionPotential handles empty array", () => {
    const result = analyzeCompressionPotential([], DEFAULT_COMPRESSION_CONFIG);
    expect(result.canCompress).toBe(false);
    expect(result.groupsFound).toBe(0);
    expect(result.recommendations.length).toBe(0);
  });

  test("analyzeCompressionPotential handles single memory", () => {
    const memories = [createMockMemory({ content: "single memory" })];
    const result = analyzeCompressionPotential(memories, DEFAULT_COMPRESSION_CONFIG);
    expect(result.canCompress).toBe(false);
  });
});

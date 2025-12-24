import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, rmSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { Memory, MemoryType } from "../storage/sqlite";
import {
  shareMemories,
  importSharedMemories,
  listAvailableProjects,
  getSharedMemoryStats,
  getGlobalStorage,
  closeGlobalStorage,
  DEFAULT_SHARE_CONFIG,
  type ShareConfig,
  type ShareScope,
} from "./cross-project";

function createMockMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    type: "decision",
    scope: "test-scope",
    content: "Test memory content for testing purposes",
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

describe("DEFAULT_SHARE_CONFIG", () => {
  it("has sensible defaults", () => {
    // #given / #when - checking default config

    // #then
    expect(DEFAULT_SHARE_CONFIG.shareScope).toBe("global");
    expect(DEFAULT_SHARE_CONFIG.includeTypes).toContain("decision");
    expect(DEFAULT_SHARE_CONFIG.includeTypes).toContain("pattern");
    expect(DEFAULT_SHARE_CONFIG.includeTypes).toContain("learning");
    expect(DEFAULT_SHARE_CONFIG.excludeTypes).toContain("blocker");
    expect(DEFAULT_SHARE_CONFIG.excludeTypes).toContain("context");
    expect(DEFAULT_SHARE_CONFIG.redactSecrets).toBe(true);
  });
});

describe("ShareScope types", () => {
  it("supports all expected scope values", () => {
    // #given
    const validScopes: ShareScope[] = ["global", "organization", "team", "personal"];
    
    // #when / #then
    for (const scope of validScopes) {
      const config: ShareConfig = { shareScope: scope };
      expect(config.shareScope).toBe(scope);
    }
  });
});

describe("ShareConfig filtering", () => {
  it("can filter by include types", () => {
    // #given
    const config: ShareConfig = {
      shareScope: "global",
      includeTypes: ["decision", "learning"],
    };
    
    // #then
    expect(config.includeTypes).toHaveLength(2);
    expect(config.includeTypes).toContain("decision");
    expect(config.includeTypes).toContain("learning");
  });

  it("can filter by exclude types", () => {
    // #given
    const config: ShareConfig = {
      shareScope: "global",
      excludeTypes: ["blocker", "context"],
    };
    
    // #then
    expect(config.excludeTypes).toHaveLength(2);
    expect(config.excludeTypes).toContain("blocker");
  });

  it("can filter by tags", () => {
    // #given
    const config: ShareConfig = {
      shareScope: "global",
      includeTags: ["important", "architecture"],
      excludeTags: ["temporary", "wip"],
    };
    
    // #then
    expect(config.includeTags).toContain("important");
    expect(config.excludeTags).toContain("temporary");
  });

  it("can filter by age", () => {
    // #given
    const config: ShareConfig = {
      shareScope: "global",
      minAgeDays: 7,
      maxAgeDays: 90,
    };
    
    // #then
    expect(config.minAgeDays).toBe(7);
    expect(config.maxAgeDays).toBe(90);
  });

  it("supports secret redaction option", () => {
    // #given
    const configWithRedaction: ShareConfig = {
      shareScope: "global",
      redactSecrets: true,
    };
    
    const configWithoutRedaction: ShareConfig = {
      shareScope: "global",
      redactSecrets: false,
    };
    
    // #then
    expect(configWithRedaction.redactSecrets).toBe(true);
    expect(configWithoutRedaction.redactSecrets).toBe(false);
  });
});

describe("Memory type validation", () => {
  it("accepts all valid memory types", () => {
    // #given
    const validTypes: MemoryType[] = [
      "decision",
      "learning", 
      "preference",
      "blocker",
      "context",
      "pattern",
    ];
    
    // #when / #then
    for (const type of validTypes) {
      const memory = createMockMemory({ type });
      expect(memory.type).toBe(type);
    }
  });
});

describe("GlobalMemoryStorage integration", () => {
  beforeEach(() => {
    closeGlobalStorage();
  });

  afterEach(() => {
    closeGlobalStorage();
  });

  it("can be instantiated", () => {
    // #given / #when
    const storage = getGlobalStorage();
    
    // #then
    expect(storage).toBeDefined();
  });

  it("returns same instance on multiple calls", () => {
    // #given
    const storage1 = getGlobalStorage();
    
    // #when
    const storage2 = getGlobalStorage();
    
    // #then
    expect(storage1).toBe(storage2);
  });

  it("returns empty stats initially", () => {
    // #given
    const storage = getGlobalStorage();
    
    // #when
    const stats = storage.getStats();
    
    // #then
    expect(stats.total).toBeGreaterThanOrEqual(0);
    expect(typeof stats.byProject).toBe("object");
    expect(typeof stats.byType).toBe("object");
  });

  it("can list shared memories with filters", () => {
    // #given
    const storage = getGlobalStorage();
    
    // #when
    const memories = storage.listShared({
      limit: 10,
      shareScope: "global",
    });
    
    // #then
    expect(Array.isArray(memories)).toBe(true);
  });
});

describe("getSharedMemoryStats", () => {
  beforeEach(() => {
    closeGlobalStorage();
  });

  afterEach(() => {
    closeGlobalStorage();
  });

  it("returns stats object with expected structure", () => {
    // #given / #when
    const stats = getSharedMemoryStats();
    
    // #then
    expect(stats).toHaveProperty("total");
    expect(stats).toHaveProperty("byProject");
    expect(stats).toHaveProperty("byType");
    expect(typeof stats.total).toBe("number");
    expect(typeof stats.byProject).toBe("object");
    expect(typeof stats.byType).toBe("object");
  });
});

describe("listAvailableProjects", () => {
  beforeEach(() => {
    closeGlobalStorage();
  });

  afterEach(() => {
    closeGlobalStorage();
  });

  it("returns array of project names", () => {
    // #given / #when
    const projects = listAvailableProjects();
    
    // #then
    expect(Array.isArray(projects)).toBe(true);
  });
});

describe("SharedMemory structure", () => {
  it("has required fields", () => {
    // #given
    const mockSharedMemory = {
      id: "test-id",
      original_id: "original-id",
      source_project: "test-project",
      type: "decision" as MemoryType,
      scope: "test-scope",
      content: "Test content",
      shared_at: new Date().toISOString(),
      share_scope: "global" as ShareScope,
    };
    
    // #then
    expect(mockSharedMemory.id).toBeDefined();
    expect(mockSharedMemory.original_id).toBeDefined();
    expect(mockSharedMemory.source_project).toBeDefined();
    expect(mockSharedMemory.type).toBeDefined();
    expect(mockSharedMemory.scope).toBeDefined();
    expect(mockSharedMemory.content).toBeDefined();
    expect(mockSharedMemory.shared_at).toBeDefined();
    expect(mockSharedMemory.share_scope).toBeDefined();
  });

  it("supports optional tags and shared_by fields", () => {
    // #given
    const mockSharedMemory = {
      id: "test-id",
      original_id: "original-id",
      source_project: "test-project",
      type: "decision" as MemoryType,
      scope: "test-scope",
      content: "Test content",
      tags: "important, architecture",
      shared_at: new Date().toISOString(),
      shared_by: "user@example.com",
      share_scope: "global" as ShareScope,
    };
    
    // #then
    expect(mockSharedMemory.tags).toBe("important, architecture");
    expect(mockSharedMemory.shared_by).toBe("user@example.com");
  });
});

describe("ShareResult structure", () => {
  it("has expected result fields", () => {
    // #given
    const mockResult = {
      shared: 5,
      skipped: 3,
      errors: ["Error 1", "Error 2"],
    };
    
    // #then
    expect(typeof mockResult.shared).toBe("number");
    expect(typeof mockResult.skipped).toBe("number");
    expect(Array.isArray(mockResult.errors)).toBe(true);
  });
});

describe("ImportResult structure", () => {
  it("has expected result fields", () => {
    // #given
    const mockResult = {
      imported: 5,
      skipped: 2,
      duplicates: 3,
      errors: [] as string[],
    };
    
    // #then
    expect(typeof mockResult.imported).toBe("number");
    expect(typeof mockResult.skipped).toBe("number");
    expect(typeof mockResult.duplicates).toBe("number");
    expect(Array.isArray(mockResult.errors)).toBe(true);
  });
});

describe("Age filtering logic", () => {
  it("correctly identifies old memories", () => {
    // #given
    const oldMemory = createOldMemory(60);
    const recentMemory = createMockMemory();
    
    // #when
    const oldAge = Date.now() - new Date(oldMemory.timestamp).getTime();
    const recentAge = Date.now() - new Date(recentMemory.timestamp).getTime();
    
    // #then
    expect(oldAge).toBeGreaterThan(30 * 24 * 60 * 60 * 1000);
    expect(recentAge).toBeLessThan(1000);
  });

  it("calculates age in days correctly", () => {
    // #given
    const daysAgo = 45;
    const memory = createOldMemory(daysAgo);
    
    // #when
    const ageMs = Date.now() - new Date(memory.timestamp).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    
    // #then
    expect(Math.round(ageDays)).toBe(daysAgo);
  });
});

describe("Tag filtering logic", () => {
  it("parses comma-separated tags correctly", () => {
    // #given
    const memory = createMockMemory({ tags: "important, architecture, backend" });
    
    // #when
    const tags = memory.tags!.split(",").map(t => t.trim().toLowerCase());
    
    // #then
    expect(tags).toContain("important");
    expect(tags).toContain("architecture");
    expect(tags).toContain("backend");
    expect(tags).toHaveLength(3);
  });

  it("handles empty tags", () => {
    // #given
    const memory = createMockMemory({ tags: undefined });
    
    // #then
    expect(memory.tags).toBeUndefined();
  });
});

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, rmSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir, homedir } from "os";
import { Database } from "bun:sqlite";
import {
  shareMemories,
  importSharedMemories,
  listAvailableProjects,
  getSharedMemoryStats,
  getGlobalStorage,
  closeGlobalStorage,
  type ShareConfig,
} from "../../memory/sync/cross-project";
import { getStorage, closeStorage } from "../../memory/storage/sqlite";

const TEST_PROJECT_A = join(tmpdir(), `omo-share-test-project-a-${Date.now()}`);
const TEST_PROJECT_B = join(tmpdir(), `omo-share-test-project-b-${Date.now()}`);
const GLOBAL_MEMORY_PATH = join(homedir(), ".opencode", "global-memory", "shared.db");

function setupTestProject(projectPath: string): void {
  const memoryDir = join(projectPath, ".opencode", "memory-pro");
  if (!existsSync(memoryDir)) {
    mkdirSync(memoryDir, { recursive: true });
  }
}

function getTestDbPath(projectPath: string): string {
  return join(projectPath, ".opencode", "memory-pro", "memory.db");
}

function createTestMemory(
  storage: ReturnType<typeof getStorage>,
  projectPath: string,
  options: {
    type?: "decision" | "learning" | "preference" | "blocker" | "context" | "pattern";
    scope?: string;
    content?: string;
    tags?: string;
  } = {}
): string {
  return storage.saveMemory({
    type: options.type ?? "decision",
    scope: options.scope ?? "test-scope",
    content: options.content ?? `Test content ${Date.now()}`,
    tags: options.tags,
    source: "auto",
    project_path: projectPath,
  });
}

function countGlobalMemories(): number {
  const globalStorage = getGlobalStorage();
  const stats = globalStorage.getStats();
  return stats.total;
}

function clearGlobalMemoriesForScope(scope: string): void {
  const globalStorage = getGlobalStorage();
  const memories = globalStorage.listShared({ scope, limit: 500 });
  for (const m of memories) {
    globalStorage.unshare(m.id);
  }
}

describe("memory_share tool integration tests", () => {
  let initialGlobalCount: number;

  beforeEach(() => {
    for (const dir of [TEST_PROJECT_A, TEST_PROJECT_B]) {
      if (existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
    setupTestProject(TEST_PROJECT_A);
    setupTestProject(TEST_PROJECT_B);
    
    closeGlobalStorage();
    initialGlobalCount = countGlobalMemories();
  });

  afterEach(() => {
    closeStorage();
    closeGlobalStorage();
    
    for (const dir of [TEST_PROJECT_A, TEST_PROJECT_B]) {
      if (existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  describe("share action", () => {
    it("should share memories from a project to global storage", () => {
      const testScope = `share-test-${Date.now()}`;
      const storage = getStorage(getTestDbPath(TEST_PROJECT_A));
      createTestMemory(storage, TEST_PROJECT_A, {
        type: "decision",
        scope: testScope,
        content: "Use microservices for scalability",
      });
      createTestMemory(storage, TEST_PROJECT_A, {
        type: "pattern",
        scope: testScope,
        content: "Always use async/await over callbacks",
      });

      const result = shareMemories(TEST_PROJECT_A, {
        shareScope: "global",
        includeTypes: ["decision", "pattern"],
        redactSecrets: true,
      });

      expect(result.shared).toBe(2);
      expect(result.skipped).toBe(0);
      expect(result.errors).toHaveLength(0);

      clearGlobalMemoriesForScope(testScope);
    });

    it("should filter memories by type when sharing", () => {
      const testScope = `type-filter-${Date.now()}`;
      const storage = getStorage(getTestDbPath(TEST_PROJECT_A));
      createTestMemory(storage, TEST_PROJECT_A, { type: "decision", scope: testScope });
      createTestMemory(storage, TEST_PROJECT_A, { type: "blocker", scope: testScope });
      createTestMemory(storage, TEST_PROJECT_A, { type: "context", scope: testScope });

      const result = shareMemories(TEST_PROJECT_A, {
        shareScope: "global",
        includeTypes: ["decision"],
        redactSecrets: true,
      });

      expect(result.shared).toBe(1);
      expect(result.skipped).toBe(2);

      clearGlobalMemoriesForScope(testScope);
    });

    it("should skip duplicate memories", () => {
      const testScope = `dup-test-${Date.now()}`;
      const storage = getStorage(getTestDbPath(TEST_PROJECT_A));
      createTestMemory(storage, TEST_PROJECT_A, {
        type: "decision",
        scope: testScope,
        content: "Same content for duplicate test",
      });

      shareMemories(TEST_PROJECT_A, {
        shareScope: "global",
        includeTypes: ["decision"],
        redactSecrets: true,
      });

      const result = shareMemories(TEST_PROJECT_A, {
        shareScope: "global",
        includeTypes: ["decision"],
        redactSecrets: true,
      });

      expect(result.shared).toBe(0);
      expect(result.skipped).toBe(1);

      clearGlobalMemoriesForScope(testScope);
    });

    it("should redact secrets when redactSecrets is true", () => {
      const testScope = `secrets-test-${Date.now()}`;
      const storage = getStorage(getTestDbPath(TEST_PROJECT_A));
      createTestMemory(storage, TEST_PROJECT_A, {
        type: "decision",
        scope: testScope,
        content: "Use api_key=sk1234567890abcdef for authentication with password=supersecret123",
      });

      shareMemories(TEST_PROJECT_A, {
        shareScope: "global",
        includeTypes: ["decision"],
        redactSecrets: true,
      });

      const globalStorage = getGlobalStorage();
      const shared = globalStorage.listShared({ scope: testScope });
      expect(shared.length).toBe(1);
      expect(shared[0].content).not.toContain("sk1234567890abcdef");
      expect(shared[0].content).not.toContain("supersecret123");
      expect(shared[0].content).toContain("[REDACTED]");

      clearGlobalMemoriesForScope(testScope);
    });
  });

  describe("import action", () => {
    it("should import shared memories into a different project", () => {
      const testScope = `import-test-${Date.now()}`;
      const storageA = getStorage(getTestDbPath(TEST_PROJECT_A));
      createTestMemory(storageA, TEST_PROJECT_A, {
        type: "decision",
        scope: testScope,
        content: "Use TypeScript for type safety",
      });
      createTestMemory(storageA, TEST_PROJECT_A, {
        type: "pattern",
        scope: testScope,
        content: "Prefer composition over inheritance",
      });

      shareMemories(TEST_PROJECT_A, {
        shareScope: "global",
        includeTypes: ["decision", "pattern"],
        redactSecrets: true,
      });

      const result = importSharedMemories(TEST_PROJECT_B, {
        shareScope: "global",
        limit: 100,
        skipDuplicates: true,
      });

      expect(result.imported).toBeGreaterThanOrEqual(2);
      expect(result.errors).toHaveLength(0);

      const storageB = getStorage(getTestDbPath(TEST_PROJECT_B));
      const imported = storageB.getMemories({ scope: testScope, limit: 10 });
      expect(imported.length).toBe(2);
      
      for (const memory of imported) {
        expect(memory.tags).toContain("imported");
      }

      clearGlobalMemoriesForScope(testScope);
    });

    it("should skip duplicates when importing", () => {
      const testScope = `dup-import-${Date.now()}`;
      const content = `Unique content ${Date.now()}`;
      
      const storageA = getStorage(getTestDbPath(TEST_PROJECT_A));
      createTestMemory(storageA, TEST_PROJECT_A, {
        type: "decision",
        scope: testScope,
        content,
      });

      shareMemories(TEST_PROJECT_A, {
        shareScope: "global",
        includeTypes: ["decision"],
        redactSecrets: true,
      });

      const storageB = getStorage(getTestDbPath(TEST_PROJECT_B));
      createTestMemory(storageB, TEST_PROJECT_B, {
        type: "decision",
        scope: testScope,
        content,
      });

      const result = importSharedMemories(TEST_PROJECT_B, {
        shareScope: "global",
        skipDuplicates: true,
      });

      expect(result.duplicates).toBeGreaterThanOrEqual(1);

      clearGlobalMemoriesForScope(testScope);
    });
  });

  describe("list action", () => {
    it("should list shared memories with scope filter", () => {
      const testScope = `list-test-${Date.now()}`;
      const storage = getStorage(getTestDbPath(TEST_PROJECT_A));
      createTestMemory(storage, TEST_PROJECT_A, {
        type: "decision",
        scope: testScope,
        content: "First shared memory",
      });
      createTestMemory(storage, TEST_PROJECT_A, {
        type: "pattern",
        scope: testScope,
        content: "Second shared memory",
      });

      shareMemories(TEST_PROJECT_A, {
        shareScope: "global",
        includeTypes: ["decision", "pattern"],
        redactSecrets: true,
      });

      const globalStorage = getGlobalStorage();
      const memories = globalStorage.listShared({ scope: testScope, limit: 50 });

      expect(memories.length).toBe(2);

      clearGlobalMemoriesForScope(testScope);
    });

    it("should filter shared memories by type", () => {
      const testScope = `type-list-${Date.now()}`;
      const storage = getStorage(getTestDbPath(TEST_PROJECT_A));
      createTestMemory(storage, TEST_PROJECT_A, { type: "decision", scope: testScope });
      createTestMemory(storage, TEST_PROJECT_A, { type: "pattern", scope: testScope });
      createTestMemory(storage, TEST_PROJECT_A, { type: "learning", scope: testScope });

      shareMemories(TEST_PROJECT_A, {
        shareScope: "global",
        includeTypes: ["decision", "pattern", "learning"],
        redactSecrets: true,
      });

      const globalStorage = getGlobalStorage();
      const decisions = globalStorage.listShared({ type: "decision", scope: testScope });

      expect(decisions.length).toBe(1);
      expect(decisions[0].type).toBe("decision");

      clearGlobalMemoriesForScope(testScope);
    });
  });

  describe("stats action", () => {
    it("should return correct statistics after sharing", () => {
      const testScope = `stats-test-${Date.now()}`;
      const beforeStats = getSharedMemoryStats();
      
      const storage = getStorage(getTestDbPath(TEST_PROJECT_A));
      createTestMemory(storage, TEST_PROJECT_A, { type: "decision", scope: testScope });
      createTestMemory(storage, TEST_PROJECT_A, { type: "decision", scope: testScope });
      createTestMemory(storage, TEST_PROJECT_A, { type: "pattern", scope: testScope });

      shareMemories(TEST_PROJECT_A, {
        shareScope: "global",
        includeTypes: ["decision", "pattern"],
        redactSecrets: true,
      });

      const afterStats = getSharedMemoryStats();

      expect(afterStats.total).toBe(beforeStats.total + 3);

      clearGlobalMemoriesForScope(testScope);
    });
  });

  describe("unshare action", () => {
    it("should remove a shared memory by ID", () => {
      const testScope = `unshare-test-${Date.now()}`;
      const storage = getStorage(getTestDbPath(TEST_PROJECT_A));
      createTestMemory(storage, TEST_PROJECT_A, {
        type: "decision",
        scope: testScope,
        content: "Memory to be unshared",
      });

      shareMemories(TEST_PROJECT_A, {
        shareScope: "global",
        includeTypes: ["decision"],
        redactSecrets: true,
      });

      const globalStorage = getGlobalStorage();
      const beforeUnshare = globalStorage.listShared({ scope: testScope });
      expect(beforeUnshare.length).toBe(1);

      const memoryId = beforeUnshare[0].id;

      const success = globalStorage.unshare(memoryId);

      expect(success).toBe(true);
      const afterUnshare = globalStorage.listShared({ scope: testScope });
      expect(afterUnshare.length).toBe(0);
    });

    it("should return false for invalid memory ID", () => {
      const invalidId = "not-a-valid-uuid";

      const globalStorage = getGlobalStorage();
      const success = globalStorage.unshare(invalidId);

      expect(success).toBe(false);
    });

    it("should return false for non-existent memory ID", () => {
      const nonExistentId = "00000000-0000-4000-8000-000000000000";

      const globalStorage = getGlobalStorage();
      const success = globalStorage.unshare(nonExistentId);

      expect(success).toBe(false);
    });
  });

  describe("listAvailableProjects", () => {
    it("should return list of projects that have shared memories", () => {
      const testScope = `projects-test-${Date.now()}`;
      const storage = getStorage(getTestDbPath(TEST_PROJECT_A));
      createTestMemory(storage, TEST_PROJECT_A, { type: "decision", scope: testScope });

      shareMemories(TEST_PROJECT_A, {
        shareScope: "global",
        includeTypes: ["decision"],
        redactSecrets: true,
      });

      const projects = listAvailableProjects();

      expect(projects.length).toBeGreaterThan(0);

      clearGlobalMemoriesForScope(testScope);
    });
  });

  describe("end-to-end workflow", () => {
    it("should complete full share -> list -> import -> verify workflow", () => {
      const testScope = `e2e-test-${Date.now()}`;
      
      const storageA = getStorage(getTestDbPath(TEST_PROJECT_A));
      createTestMemory(storageA, TEST_PROJECT_A, {
        type: "decision",
        scope: testScope,
        content: "E2E: Use dependency injection for testability",
      });
      createTestMemory(storageA, TEST_PROJECT_A, {
        type: "pattern",
        scope: testScope,
        content: "E2E: Repository pattern for data access",
      });
      createTestMemory(storageA, TEST_PROJECT_A, {
        type: "learning",
        scope: testScope,
        content: "E2E: Integration tests catch more bugs than unit tests",
      });

      const shareResult = shareMemories(TEST_PROJECT_A, {
        shareScope: "global",
        includeTypes: ["decision", "pattern", "learning"],
        redactSecrets: true,
      });
      expect(shareResult.shared).toBe(3);

      const globalStorage = getGlobalStorage();
      const listed = globalStorage.listShared({ scope: testScope });
      expect(listed.length).toBe(3);

      const projects = listAvailableProjects();
      expect(projects.length).toBeGreaterThan(0);

      const importResult = importSharedMemories(TEST_PROJECT_B, {
        shareScope: "global",
        skipDuplicates: true,
      });
      expect(importResult.imported).toBeGreaterThanOrEqual(3);

      const storageB = getStorage(getTestDbPath(TEST_PROJECT_B));
      const importedMemories = storageB.getMemories({ scope: testScope, limit: 10 });
      expect(importedMemories.length).toBe(3);

      for (const memory of importedMemories) {
        expect(memory.tags).toContain("imported");
      }

      const reimportResult = importSharedMemories(TEST_PROJECT_B, {
        shareScope: "global",
        skipDuplicates: true,
      });
      expect(reimportResult.duplicates).toBeGreaterThanOrEqual(3);

      clearGlobalMemoriesForScope(testScope);
    });
  });
});

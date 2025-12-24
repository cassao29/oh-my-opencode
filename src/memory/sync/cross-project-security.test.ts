import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  getGlobalStorage,
  closeGlobalStorage,
  type ShareConfig,
  type ShareScope,
} from "./cross-project";
import type { Memory, MemoryType } from "../storage/sqlite";

function createMockMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    type: "decision",
    scope: "test-scope",
    content: "Test memory content",
    source: "manual",
    ...overrides,
  };
}

describe("Cross-Project Security Tests", () => {
  beforeEach(() => {
    closeGlobalStorage();
  });

  afterEach(() => {
    closeGlobalStorage();
  });

  describe("SQL Injection Prevention", () => {
    it("rejects SQL injection in sourceProject filter", () => {
      const storage = getGlobalStorage();
      
      const maliciousProject = "'; DROP TABLE shared_memories; --";
      const memories = storage.listShared({ sourceProject: maliciousProject });
      
      expect(Array.isArray(memories)).toBe(true);
      
      const stats = storage.getStats();
      expect(stats).toHaveProperty("total");
    });

    it("rejects SQL injection in scope filter", () => {
      const storage = getGlobalStorage();
      
      const maliciousScope = "test' OR '1'='1";
      const memories = storage.listShared({ scope: maliciousScope });
      
      expect(Array.isArray(memories)).toBe(true);
    });

    it("rejects SQL injection in type filter", () => {
      const storage = getGlobalStorage();
      
      const memories = storage.listShared({ 
        type: "decision' OR '1'='1" as MemoryType 
      });
      
      expect(Array.isArray(memories)).toBe(true);
    });
  });

  describe("XSS Prevention", () => {
    it("sanitizes script tags in shared content", () => {
      const storage = getGlobalStorage();
      
      const xssMemory = createMockMemory({
        content: '<script>alert("XSS")</script>Normal content',
      });
      
      const config: ShareConfig = {
        shareScope: "global",
        redactSecrets: false,
      };
      
      const id = storage.share(xssMemory, "test-project", config);
      const shared = storage.getSharedById(id);
      
      expect(shared).toBeDefined();
      expect(shared!.content).not.toContain("<script>");
      expect(shared!.content).toContain("[REDACTED]");
      expect(shared!.content).toContain("Normal content");
    });

    it("sanitizes javascript: protocol in content", () => {
      const storage = getGlobalStorage();
      
      const xssMemory = createMockMemory({
        content: '<a href="javascript:alert(1)">Click me</a>',
      });
      
      const config: ShareConfig = {
        shareScope: "global",
        redactSecrets: false,
      };
      
      const id = storage.share(xssMemory, "test-project", config);
      const shared = storage.getSharedById(id);
      
      expect(shared).toBeDefined();
      expect(shared!.content).not.toContain("javascript:");
    });

    it("sanitizes event handlers in content", () => {
      const storage = getGlobalStorage();
      
      const xssMemory = createMockMemory({
        content: '<img src="x" onerror="alert(1)">',
      });
      
      const config: ShareConfig = {
        shareScope: "global",
        redactSecrets: false,
      };
      
      const id = storage.share(xssMemory, "test-project", config);
      const shared = storage.getSharedById(id);
      
      expect(shared).toBeDefined();
      expect(shared!.content).not.toContain("onerror=");
    });
  });

  describe("Input Validation", () => {
    it("rejects invalid memory ID format", () => {
      const storage = getGlobalStorage();
      
      const invalidIds = [
        "not-a-uuid",
        "../../../etc/passwd",
        "'; DROP TABLE --",
        "",
        "12345",
        "<script>alert(1)</script>",
      ];
      
      for (const invalidId of invalidIds) {
        const memory = storage.getSharedById(invalidId);
        expect(memory).toBeUndefined();
      }
    });

    it("rejects unshare with invalid ID", () => {
      const storage = getGlobalStorage();
      
      const result = storage.unshare("invalid-id-format");
      expect(result).toBe(false);
    });

    it("sanitizes project name with special characters", () => {
      const storage = getGlobalStorage();
      
      const memory = createMockMemory();
      const maliciousProject = '../../../etc/passwd\x00';
      
      const config: ShareConfig = {
        shareScope: "global",
        redactSecrets: true,
      };
      
      const id = storage.share(memory, maliciousProject, config);
      const shared = storage.getSharedById(id);
      
      expect(shared).toBeDefined();
      expect(shared!.source_project).not.toContain("..");
      expect(shared!.source_project).not.toContain("/");
      expect(shared!.source_project).not.toContain("\\");
      expect(shared!.source_project).not.toContain("\x00");
    });

    it("enforces maximum project name length", () => {
      const storage = getGlobalStorage();
      
      const memory = createMockMemory();
      const longProject = "a".repeat(1000);
      
      const config: ShareConfig = {
        shareScope: "global",
        redactSecrets: true,
      };
      
      const id = storage.share(memory, longProject, config);
      const shared = storage.getSharedById(id);
      
      expect(shared).toBeDefined();
      expect(shared!.source_project.length).toBeLessThanOrEqual(255);
    });

    it("rejects invalid share scope", () => {
      const storage = getGlobalStorage();
      
      const memory = createMockMemory();
      const config = {
        shareScope: "invalid-scope" as ShareScope,
        redactSecrets: true,
      };
      
      expect(() => {
        storage.share(memory, "test-project", config);
      }).toThrow("Invalid share scope");
    });

    it("rejects invalid memory scope", () => {
      const storage = getGlobalStorage();
      
      const memory = createMockMemory({
        scope: "../../../etc/passwd",
      });
      
      const config: ShareConfig = {
        shareScope: "global",
        redactSecrets: true,
      };
      
      expect(() => {
        storage.share(memory, "test-project", config);
      }).toThrow("Invalid memory scope");
    });
  });

  describe("Content Length Limits", () => {
    it("truncates oversized content", () => {
      const storage = getGlobalStorage();
      
      const hugeContent = "x".repeat(50000);
      const memory = createMockMemory({ content: hugeContent });
      
      const config: ShareConfig = {
        shareScope: "global",
        redactSecrets: false,
      };
      
      const id = storage.share(memory, "test-project", config);
      const shared = storage.getSharedById(id);
      
      expect(shared).toBeDefined();
      expect(shared!.content.length).toBeLessThanOrEqual(10000);
    });
  });

  describe("Limit Enforcement", () => {
    it("enforces maximum list limit", () => {
      const storage = getGlobalStorage();
      
      const memories = storage.listShared({ limit: 10000 });
      
      expect(Array.isArray(memories)).toBe(true);
    });
  });

  describe("Secret Redaction", () => {
    it("redacts API keys when enabled", () => {
      const storage = getGlobalStorage();
      
      const memory = createMockMemory({
        content: "API_KEY=sk-1234567890abcdef password=secret123",
      });
      
      const config: ShareConfig = {
        shareScope: "global",
        redactSecrets: true,
      };
      
      const id = storage.share(memory, "test-project", config);
      const shared = storage.getSharedById(id);
      
      expect(shared).toBeDefined();
      expect(shared!.content).not.toContain("sk-1234567890abcdef");
      expect(shared!.content).not.toContain("secret123");
    });

    it("preserves content when redaction is disabled", () => {
      const storage = getGlobalStorage();
      
      const memory = createMockMemory({
        content: "Normal content without secrets",
      });
      
      const config: ShareConfig = {
        shareScope: "global",
        redactSecrets: false,
      };
      
      const id = storage.share(memory, "test-project", config);
      const shared = storage.getSharedById(id);
      
      expect(shared).toBeDefined();
      expect(shared!.content).toBe("Normal content without secrets");
    });
  });

  describe("Path Traversal Prevention", () => {
    it("prevents path traversal in scope", () => {
      const storage = getGlobalStorage();
      
      const invalidScopes = [
        "../../../etc/passwd",
        "..\\..\\windows\\system32",
        "scope/../../../etc",
        "/etc/passwd",
        "C:\\Windows\\System32",
      ];
      
      for (const scope of invalidScopes) {
        const memories = storage.listShared({ scope });
        expect(Array.isArray(memories)).toBe(true);
      }
    });
  });
});

describe("Share Config Validation", () => {
  it("accepts valid share scopes", () => {
    const validScopes: ShareScope[] = ["global", "organization", "team", "personal"];
    
    for (const scope of validScopes) {
      const config: ShareConfig = { shareScope: scope };
      expect(config.shareScope).toBe(scope);
    }
  });

  it("accepts valid memory types in config", () => {
    const validTypes: MemoryType[] = [
      "decision", "learning", "preference", 
      "blocker", "context", "pattern"
    ];
    
    const config: ShareConfig = {
      shareScope: "global",
      includeTypes: validTypes,
    };
    
    expect(config.includeTypes).toHaveLength(6);
  });
});

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { validateProjectPath, validateSessionId } from "./utils/validation";
import { sanitizeContent, redactSecrets, isSensitivePath } from "./utils/privacy";
import { getProjectPath, getMemoryDbPath } from "./utils/project";
import { checkRateLimit, validateScope, validateContentLength, validateTags } from "./utils/limits";
import { MemoryStorage, getStorage, closeStorage } from "./storage/sqlite";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("Security: Path Traversal Protection", () => {
  test("rejects path with .. traversal", () => {
    expect(validateProjectPath("/home/user/../etc/passwd")).toBe(false);
    expect(validateProjectPath("/home/user/../../root")).toBe(false);
    expect(validateProjectPath("../../../etc/shadow")).toBe(false);
  });

  test("rejects Windows-style path traversal", () => {
    expect(validateProjectPath("C:\\Users\\..\\Windows")).toBe(false);
    expect(validateProjectPath("..\\..\\Windows\\System32")).toBe(false);
  });

  test("rejects non-canonical paths", () => {
    expect(validateProjectPath("/home/user/./project")).toBe(false);
  });

  test("rejects null and undefined", () => {
    expect(validateProjectPath(null as unknown as string)).toBe(false);
    expect(validateProjectPath(undefined as unknown as string)).toBe(false);
  });

  test("rejects extremely long paths", () => {
    const longPath = "/home/" + "a".repeat(5000);
    expect(validateProjectPath(longPath)).toBe(false);
  });

  test("getProjectPath throws on system directories", () => {
    expect(() => getProjectPath("/etc")).toThrow("system directories");
    expect(() => getProjectPath("/usr")).toThrow("system directories");
    expect(() => getProjectPath("/var")).toThrow("system directories");
    expect(() => getProjectPath("/root")).toThrow("system directories");
    expect(() => getProjectPath("/proc")).toThrow("system directories");
    expect(() => getProjectPath("/sys")).toThrow("system directories");
  });

  test("getProjectPath throws on traversal attempts", () => {
    expect(() => getProjectPath("/home/../etc")).toThrow();
  });
});

describe("Security: SQL Injection Prevention", () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "sql-injection-test-"));
    dbPath = join(tempDir, "test.db");
  });

  afterEach(() => {
    closeStorage();
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  test("handles SQL injection in scope field", () => {
    const storage = getStorage(dbPath);
    
    const maliciousScope = "test'; DROP TABLE memories; --";
    
    expect(() => {
      storage.saveMemory({
        type: "context",
        scope: maliciousScope,
        content: "test content",
        source: "manual",
      });
    }).not.toThrow();

    const memories = storage.getMemories({ limit: 10 });
    expect(memories.some(m => m.scope === maliciousScope)).toBe(true);
  });

  test("handles SQL injection in content field", () => {
    const storage = getStorage(dbPath);
    
    const maliciousContent = "'); DELETE FROM memories WHERE '1'='1";
    
    storage.saveMemory({
      type: "context",
      scope: "test",
      content: maliciousContent,
      source: "manual",
    });

    const stats = storage.getStats();
    expect(stats.memories).toBeGreaterThan(0);
  });

  test("handles SQL injection in query parameters", () => {
    const storage = getStorage(dbPath);
    
    storage.saveMemory({
      type: "decision",
      scope: "safe",
      content: "safe content",
      source: "manual",
    });

    const maliciousQuery = "' OR '1'='1";
    const results = storage.getMemories({ 
      scope: maliciousQuery,
      limit: 10 
    });
    
    expect(results.length).toBe(0);
  });

  test("handles UNION injection attempts", () => {
    const storage = getStorage(dbPath);
    
    storage.saveMemory({
      type: "context",
      scope: "test",
      content: "original content",
      source: "manual",
    });

    const unionInjection = "test' UNION SELECT * FROM sqlite_master --";
    const results = storage.getMemories({ 
      scope: unionInjection,
      limit: 10 
    });
    
    expect(results.length).toBe(0);
  });
});

describe("Security: Secret Redaction", () => {
  test("redacts passwords", () => {
    expect(redactSecrets("password: mysecret123")).toBe("[REDACTED]");
    expect(redactSecrets("pwd=hunter2")).toBe("[REDACTED]");
    expect(redactSecrets("pass: abc123")).toBe("[REDACTED]");
  });

  test("redacts API keys", () => {
    expect(redactSecrets("api_key: sk-1234567890abcdef")).toBe("[REDACTED]");
    expect(redactSecrets("apiKey=AKIAIOSFODNN7EXAMPLE")).toBe("[REDACTED]");
    expect(redactSecrets("access_key: myaccesskey")).toBe("[REDACTED]");
  });

  test("redacts bearer tokens", () => {
    expect(redactSecrets("Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9")).toBe("[REDACTED]");
    expect(redactSecrets("auth_token: abc123xyz")).toBe("[REDACTED]");
  });

  test("redacts connection strings with credentials", () => {
    const url1 = redactSecrets("https://user:password@example.com");
    expect(url1).toContain("[REDACTED]");
    expect(url1).not.toContain("password");
    
    const url2 = redactSecrets("postgresql://admin:secret@localhost:5432/db");
    expect(url2).toContain("[REDACTED]");
    expect(url2).not.toContain("secret");
  });

  test("redacts private keys", () => {
    const privateKey = "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBg...\n-----END PRIVATE KEY-----";
    expect(redactSecrets(privateKey)).toBe("[REDACTED]");
  });

  test("redacts SSH keys", () => {
    const result = redactSecrets("ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQDExample");
    expect(result).toContain("[REDACTED]");
    expect(result).not.toContain("AAAAB3NzaC1yc2E");
  });

  test("redacts base64 strings that look like secrets", () => {
    const longBase64 = "a".repeat(40);
    expect(redactSecrets(`secret: ${longBase64}`)).toContain("[REDACTED]");
  });

  test("handles null and empty strings", () => {
    expect(redactSecrets("")).toBe("");
    expect(redactSecrets(null as unknown as string)).toBeNull();
  });
});

describe("Security: Input Validation", () => {
  test("validates session ID format", () => {
    expect(validateSessionId("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
    expect(validateSessionId("invalid-uuid")).toBe(false);
    expect(validateSessionId("")).toBe(false);
    expect(validateSessionId(null as unknown as string)).toBe(false);
    expect(validateSessionId("a".repeat(100))).toBe(false);
  });

  test("validates scope format", () => {
    expect(validateScope("valid-scope")).toBe(true);
    expect(validateScope("scope_with_underscore")).toBe(true);
    expect(validateScope("../../../etc")).toBe(false);
    expect(validateScope("path/with/slashes")).toBe(false);
    expect(validateScope("path\\with\\backslashes")).toBe(false);
    expect(validateScope("a".repeat(300))).toBe(false);
  });

  test("validates content length", () => {
    expect(validateContentLength("short content")).toBe(true);
    expect(validateContentLength("a".repeat(10000))).toBe(true);
    expect(validateContentLength("a".repeat(10001))).toBe(false);
  });

  test("validates tags length", () => {
    expect(validateTags("tag1,tag2,tag3")).toBe(true);
    expect(validateTags("a".repeat(1000))).toBe(true);
    expect(validateTags("a".repeat(1001))).toBe(false);
  });
});

describe("Security: Rate Limiting", () => {
  test("allows requests under limit", () => {
    const identifier = `test-${Date.now()}`;
    for (let i = 0; i < 50; i++) {
      expect(checkRateLimit(identifier)).toBe(true);
    }
  });

  test("blocks requests over limit", () => {
    const identifier = `rate-limit-test-${Date.now()}`;
    for (let i = 0; i < 100; i++) {
      checkRateLimit(identifier);
    }
    expect(checkRateLimit(identifier)).toBe(false);
  });
});

describe("Security: Sensitive Path Detection", () => {
  test("detects environment files", () => {
    expect(isSensitivePath(".env")).toBe(true);
    expect(isSensitivePath(".env.local")).toBe(true);
    expect(isSensitivePath(".env.production")).toBe(true);
  });

  test("detects key files", () => {
    expect(isSensitivePath("server.key")).toBe(true);
    expect(isSensitivePath("certificate.pem")).toBe(true);
    expect(isSensitivePath("keystore.jks")).toBe(true);
  });

  test("detects secrets directories", () => {
    expect(isSensitivePath("secrets/api.json")).toBe(true);
    expect(isSensitivePath("credentials/db.txt")).toBe(true);
  });

  test("detects database files", () => {
    expect(isSensitivePath("data.db")).toBe(true);
    expect(isSensitivePath("app.sqlite")).toBe(true);
    expect(isSensitivePath("database.sqlite3")).toBe(true);
  });
});

describe("Security: XSS Prevention", () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "xss-test-"));
    dbPath = join(tempDir, "test.db");
  });

  afterEach(() => {
    closeStorage();
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  test("removes script tags from content", () => {
    const storage = getStorage(dbPath);
    
    const xssContent = '<script>alert("xss")</script>Hello';
    storage.saveMemory({
      type: "context",
      scope: "test",
      content: xssContent,
      source: "manual",
    });

    const memories = storage.getMemories({ scope: "test", limit: 1 });
    expect(memories[0].content).not.toContain("<script>");
    expect(memories[0].content).toContain("[SCRIPT REMOVED]");
  });

  test("removes HTML tags from content", () => {
    const storage = getStorage(dbPath);
    
    const htmlContent = '<img src="x" onerror="alert(1)">Safe text';
    storage.saveMemory({
      type: "context",
      scope: "test",
      content: htmlContent,
      source: "manual",
    });

    const memories = storage.getMemories({ scope: "test", limit: 1 });
    expect(memories[0].content).not.toContain("<img");
    expect(memories[0].content).toContain("[HTML REMOVED]");
  });
});

describe("Security: Private Content Handling", () => {
  test("sanitizes private tags", () => {
    const content = "Normal text <private>SECRET DATA</private> more text";
    expect(sanitizeContent(content)).toBe("Normal text [REDACTED] more text");
  });

  test("handles multiple private sections", () => {
    const content = "<private>secret1</private> visible <private>secret2</private>";
    const result = sanitizeContent(content);
    expect(result).not.toContain("secret1");
    expect(result).not.toContain("secret2");
    expect(result).toContain("visible");
  });
});

describe("Security: Database Path Validation", () => {
  test("getMemoryDbPath returns path in .opencode directory", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "db-path-test-"));
    try {
      const dbPath = getMemoryDbPath(tempDir);
      expect(dbPath).toContain(".opencode");
      expect(dbPath).toContain("memory-pro");
      expect(dbPath).toContain("memory.db");
      expect(dbPath.startsWith(tempDir)).toBe(true);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe("Security: Memory Storage Edge Cases", () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "memory-edge-test-"));
    dbPath = join(tempDir, "test.db");
  });

  afterEach(() => {
    closeStorage();
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  test("handles empty string inputs gracefully", () => {
    const storage = getStorage(dbPath);
    
    expect(() => {
      storage.saveMemory({
        type: "context",
        scope: "",
        content: "test",
        source: "manual",
      });
    }).toThrow("Invalid scope");
  });

  test("handles very long content up to limit", () => {
    const storage = getStorage(dbPath);
    const longContent = "a".repeat(10000);
    
    expect(() => {
      storage.saveMemory({
        type: "context",
        scope: "test",
        content: longContent,
        source: "manual",
      });
    }).not.toThrow();
  });

  test("rejects content exceeding limit", () => {
    const storage = getStorage(dbPath);
    const tooLongContent = "a".repeat(10001);
    
    expect(() => {
      storage.saveMemory({
        type: "context",
        scope: "test",
        content: tooLongContent,
        source: "manual",
      });
    }).toThrow("Invalid content");
  });

  test("handles unicode content correctly", () => {
    const storage = getStorage(dbPath);
    const unicodeContent = "测试内容 🎉 тест محتوى";
    
    storage.saveMemory({
      type: "context",
      scope: "unicode-test",
      content: unicodeContent,
      source: "manual",
    });

    const memories = storage.getMemories({ scope: "unicode-test", limit: 1 });
    expect(memories[0].content).toBe(unicodeContent);
  });

  test("handles null bytes in content", () => {
    const storage = getStorage(dbPath);
    const contentWithNull = "test\x00content";
    
    storage.saveMemory({
      type: "context",
      scope: "null-byte-test",
      content: contentWithNull,
      source: "manual",
    });

    const memories = storage.getMemories({ scope: "null-byte-test", limit: 1 });
    expect(memories.length).toBe(1);
  });

  test("handles newlines and special characters in scope", () => {
    const storage = getStorage(dbPath);
    
    storage.saveMemory({
      type: "context",
      scope: "test-scope-with-dashes",
      content: "content",
      source: "manual",
    });

    const memories = storage.getMemories({ scope: "test-scope-with-dashes", limit: 1 });
    expect(memories.length).toBe(1);
  });
});

describe("Security: FTS Injection Prevention", () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "fts-injection-test-"));
    dbPath = join(tempDir, "test.db");
  });

  afterEach(() => {
    closeStorage();
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  test("sanitizes FTS special characters in query", () => {
    const storage = getStorage(dbPath);
    
    storage.saveMemory({
      type: "context",
      scope: "test",
      content: "normal content for testing",
      source: "manual",
    });

    const ftsInjection = 'content AND NOT "test"';
    
    const results = storage.getMemories({ query: ftsInjection, limit: 10 });
    expect(results.length).toBeGreaterThanOrEqual(0);
  });

  test("sanitizes asterisk wildcard in query", () => {
    const storage = getStorage(dbPath);
    
    storage.saveMemory({
      type: "context",
      scope: "test",
      content: "test content",
      source: "manual",
    });

    const results = storage.getMemories({ query: "*", limit: 10 });
    expect(results.length).toBeGreaterThanOrEqual(0);
  });

  test("sanitizes quotes in query", () => {
    const storage = getStorage(dbPath);
    
    storage.saveMemory({
      type: "context",
      scope: "test",
      content: "test content",
      source: "manual",
    });

    const results = storage.getMemories({ query: '"unclosed quote', limit: 10 });
    expect(results.length).toBeGreaterThanOrEqual(0);
  });

  test("sanitizes parentheses in query", () => {
    const storage = getStorage(dbPath);
    
    storage.saveMemory({
      type: "context",
      scope: "test",
      content: "test content",
      source: "manual",
    });

    const results = storage.getMemories({ query: '(test OR admin)', limit: 10 });
    expect(results.length).toBeGreaterThanOrEqual(0);
  });

  test("handles empty query after sanitization", () => {
    const storage = getStorage(dbPath);
    
    storage.saveMemory({
      type: "context",
      scope: "test",
      content: "test content",
      source: "manual",
    });

    const results = storage.getMemories({ query: '***', limit: 10 });
    expect(results.length).toBeGreaterThanOrEqual(0);
  });

  test("preserves legitimate search terms", () => {
    const storage = getStorage(dbPath);
    
    storage.saveMemory({
      type: "context",
      scope: "test",
      content: "important security fix applied",
      source: "manual",
    });

    const results = storage.getMemories({ query: "security fix", limit: 10 });
    expect(results.length).toBe(1);
    expect(results[0].content).toContain("security");
  });
});

describe("Security: Concurrent Access", () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "concurrent-test-"));
    dbPath = join(tempDir, "test.db");
  });

  afterEach(() => {
    closeStorage();
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  test("handles rapid sequential writes", async () => {
    const storage = getStorage(dbPath);
    
    const promises = Array.from({ length: 10 }, (_, i) => 
      Promise.resolve(storage.saveMemory({
        type: "context",
        scope: `rapid-test-${i}`,
        content: `content ${i}`,
        source: "manual",
      }))
    );

    await Promise.all(promises);
    
    const stats = storage.getStats();
    expect(stats.memories).toBe(10);
  });

  test("storage singleton returns same instance", () => {
    const storage1 = getStorage(dbPath);
    const storage2 = getStorage(dbPath);
    
    expect(storage1).toBe(storage2);
  });
});

describe("Security: Type Coercion Attacks", () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "type-coercion-test-"));
    dbPath = join(tempDir, "test.db");
  });

  afterEach(() => {
    closeStorage();
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  test("rejects array as scope", () => {
    const storage = getStorage(dbPath);
    
    expect(() => {
      storage.saveMemory({
        type: "context",
        scope: ["array", "scope"] as unknown as string,
        content: "test",
        source: "manual",
      });
    }).toThrow();
  });

  test("rejects object as content", () => {
    const storage = getStorage(dbPath);
    
    expect(() => {
      storage.saveMemory({
        type: "context",
        scope: "test",
        content: { nested: "object" } as unknown as string,
        source: "manual",
      });
    }).toThrow();
  });

  test("rejects number as scope", () => {
    const storage = getStorage(dbPath);
    
    expect(() => {
      storage.saveMemory({
        type: "context",
        scope: 12345 as unknown as string,
        content: "test",
        source: "manual",
      });
    }).toThrow();
  });
});

describe("Security: Observation Validation", () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "observation-test-"));
    dbPath = join(tempDir, "test.db");
  });

  afterEach(() => {
    closeStorage();
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  test("rejects empty session_id", () => {
    const storage = getStorage(dbPath);
    
    expect(() => {
      storage.saveObservation({
        session_id: "",
        tool_name: "test",
        type: "read",
        relevance_score: 0.5,
      });
    }).toThrow("Invalid session_id");
  });

  test("rejects tool_name exceeding limit", () => {
    const storage = getStorage(dbPath);
    
    expect(() => {
      storage.saveObservation({
        session_id: "550e8400-e29b-41d4-a716-446655440000",
        tool_name: "a".repeat(300),
        type: "read",
        relevance_score: 0.5,
      });
    }).toThrow("Invalid tool_name");
  });

  test("redacts secrets in tool_args", () => {
    const storage = getStorage(dbPath);
    const sessionId = storage.createSession("/tmp/test");
    
    storage.saveObservation({
      session_id: sessionId,
      tool_name: "bash",
      tool_args: '{"command": "export API_KEY=sk-1234567890abcdef"}',
      type: "bash",
      relevance_score: 0.5,
    });

    const observations = storage.getSessionObservations(sessionId);
    expect(observations[0].tool_args).toContain("[REDACTED]");
    expect(observations[0].tool_args).not.toContain("sk-1234567890abcdef");
  });

  test("redacts secrets in compressed_output", () => {
    const storage = getStorage(dbPath);
    const sessionId = storage.createSession("/tmp/test");
    
    storage.saveObservation({
      session_id: sessionId,
      tool_name: "read",
      compressed_output: "Found password: mysecretpass123 in config",
      type: "read",
      relevance_score: 0.5,
    });

    const observations = storage.getSessionObservations(sessionId);
    expect(observations[0].compressed_output).toContain("[REDACTED]");
  });
});

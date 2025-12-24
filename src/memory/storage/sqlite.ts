import { Database } from "bun:sqlite";
import { readFileSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import { redactSecrets } from "../utils/privacy";
import { getMemoryDbPath } from "../utils/project";
import type { MemoryType, MemorySource, ObservationType, Memory, Session, Observation } from "../types";

const __dirname = dirname(fileURLToPath(import.meta.url));

export class MemoryStorage {
  private db: Database;
  private currentSessionId?: string;

  constructor(dbPath: string) {
    const resolvedDbPath = resolve(dbPath);
    if (resolvedDbPath !== dbPath) {
      throw new Error("Database path must be absolute and canonical");
    }

    this.db = new Database(resolvedDbPath, { create: true });
    this.db.run("PRAGMA journal_mode = WAL");
    this.db.run("PRAGMA foreign_keys = ON");
    this.db.run("PRAGMA busy_timeout = 5000");
    this.db.run("PRAGMA cache_size = -64000");
    this.initSchema();
  }

  private initSchema(): void {
    try {
      const schemaPath = join(__dirname, "schema.sql");
      const schema = readFileSync(schemaPath, "utf-8");
      this.db.run(schema);
    } catch (err) {
      throw new Error(`Failed to initialize database schema: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }

  createSession(projectPath: string): string {
    const id = randomUUID();
    const stmt = this.db.prepare(`
      INSERT INTO sessions (id, project_path)
      VALUES (?, ?)
    `);
    stmt.run(id, projectPath);
    this.currentSessionId = id;
    return id;
  }

  getCurrentSessionId(): string | undefined {
    return this.currentSessionId;
  }

  setCurrentSessionId(id: string): void {
    this.currentSessionId = id;
  }

  endSession(sessionId: string, summary?: string): void {
    const stmt = this.db.prepare(`
      UPDATE sessions
      SET ended_at = datetime('now'), summary = ?
      WHERE id = ?
    `);
    stmt.run(summary ?? null, sessionId);
    if (this.currentSessionId === sessionId) {
      this.currentSessionId = undefined;
    }
  }

  getLastSession(projectPath: string): Session | undefined {
    const stmt = this.db.prepare(`
      SELECT * FROM sessions
      WHERE project_path = ?
      ORDER BY started_at DESC
      LIMIT 1
    `);
    return stmt.get(projectPath) as Session | undefined;
  }

  saveMemory(memory: Omit<Memory, "id" | "timestamp">): string {
    if (!memory.scope || typeof memory.scope !== 'string' || memory.scope.length > 255) {
      throw new Error("Invalid scope: must be string, non-empty, max 255 chars");
    }

    if (!memory.content || typeof memory.content !== 'string' || memory.content.length > 10000) {
      throw new Error("Invalid content: must be string, non-empty, max 10000 chars");
    }

    if (memory.tags && (typeof memory.tags !== 'string' || memory.tags.length > 1000)) {
      throw new Error("Invalid tags: must be string, max 1000 chars");
    }

    if (memory.issue && (typeof memory.issue !== 'string' || memory.issue.length > 255)) {
      throw new Error("Invalid issue: must be string, max 255 chars");
    }

    const sanitizedContent = memory.content
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '[SCRIPT REMOVED]')
      .replace(/<[^>]*>/g, '[HTML REMOVED]');

    const id = randomUUID();
    const stmt = this.db.prepare(`
      INSERT INTO memories (id, session_id, type, scope, content, project_path, tags, source, issue)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      id,
      memory.session_id ?? this.currentSessionId ?? null,
      memory.type,
      memory.scope.trim(),
      sanitizedContent,
      memory.project_path ?? null,
      memory.tags?.trim() ?? null,
      memory.source,
      memory.issue?.trim() ?? null
    );
    return id;
  }

  updateMemory(query: string, scope: string, type: MemoryType, updates: Partial<Memory>): boolean {
    const existing = this.db.prepare(`
      SELECT id FROM memories
      WHERE scope = ? AND type = ? AND content LIKE ?
      ORDER BY timestamp DESC
      LIMIT 1
    `).get(scope, type, `%${query}%`) as { id: string } | undefined;

    if (!existing) return false;

    const setClauses: string[] = [];
    const values: (string | number | null)[] = [];

    if (updates.content !== undefined) {
      setClauses.push("content = ?");
      values.push(updates.content);
    }
    if (updates.tags !== undefined) {
      setClauses.push("tags = ?");
      values.push(updates.tags ?? null);
    }
    if (updates.issue !== undefined) {
      setClauses.push("issue = ?");
      values.push(updates.issue ?? null);
    }

    if (setClauses.length === 0) return false;

    values.push(existing.id);
    const stmt = this.db.prepare(`
      UPDATE memories SET ${setClauses.join(", ")}
      WHERE id = ?
    `);
    const result = stmt.run(...values);
    return result.changes > 0;
  }

  deleteMemory(scope: string, type: MemoryType, _reason: string): number {
    const stmt = this.db.prepare(`
      DELETE FROM memories
      WHERE scope = ? AND type = ?
    `);
    const result = stmt.run(scope, type);
    return result.changes;
  }

  getMemories(options: {
    projectPath?: string;
    scope?: string;
    type?: MemoryType;
    query?: string;
    limit?: number;
  }): Memory[] {
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (options.projectPath) {
      conditions.push("project_path = ?");
      params.push(options.projectPath);
    }
    if (options.scope) {
      conditions.push("scope = ?");
      params.push(options.scope);
    }
    if (options.type) {
      conditions.push("type = ?");
      params.push(options.type);
    }

    let sql: string;
    if (options.query) {
      sql = `
        SELECT m.* FROM memories m
        JOIN memories_fts fts ON m.rowid = fts.rowid
        WHERE memories_fts MATCH ?
        ${conditions.length > 0 ? "AND " + conditions.join(" AND ") : ""}
        ORDER BY m.timestamp DESC
        LIMIT ?
      `;
      params.unshift(options.query);
    } else {
      sql = `
        SELECT * FROM memories
        ${conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : ""}
        ORDER BY timestamp DESC
        LIMIT ?
      `;
    }
    params.push(options.limit ?? 50);

    const stmt = this.db.prepare(sql);
    return stmt.all(...params) as Memory[];
  }

  getRecentMemories(projectPath: string, options: {
    limit?: number;
    types?: MemoryType[];
  }): Memory[] {
    const types = options.types ?? ["decision", "context", "blocker", "pattern"];
    const placeholders = types.map(() => "?").join(", ");
    
    const stmt = this.db.prepare(`
      SELECT * FROM memories
      WHERE (project_path = ? OR project_path IS NULL)
      AND type IN (${placeholders})
      ORDER BY timestamp DESC
      LIMIT ?
    `);
    
    return stmt.all(projectPath, ...types, options.limit ?? 50) as Memory[];
  }

  getMemoryById(id: string): Memory | undefined {
    const stmt = this.db.prepare(`
      SELECT * FROM memories WHERE id = ?
    `);
    return stmt.get(id) as Memory | undefined;
  }

  saveObservation(observation: Omit<Observation, "id" | "timestamp">): string {
    if (!observation.session_id || typeof observation.session_id !== 'string') {
      throw new Error("Invalid session_id: must be non-empty string");
    }

    if (!observation.tool_name || typeof observation.tool_name !== 'string' || observation.tool_name.length > 255) {
      throw new Error("Invalid tool_name: must be string, max 255 chars");
    }

    if (observation.tool_args && (typeof observation.tool_args !== 'string' || observation.tool_args.length > 10000)) {
      throw new Error("Invalid tool_args: must be string, max 10000 chars");
    }

    if (observation.compressed_output && (typeof observation.compressed_output !== 'string' || observation.compressed_output.length > 50000)) {
      throw new Error("Invalid compressed_output: must be string, max 50000 chars");
    }

    const id = randomUUID();
    const stmt = this.db.prepare(`
      INSERT INTO observations (id, session_id, tool_name, tool_args, compressed_output, tokens, type, relevance_score)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      id,
      observation.session_id,
      observation.tool_name,
      observation.tool_args ? redactSecrets(observation.tool_args) : null,
      observation.compressed_output ? redactSecrets(observation.compressed_output) : null,
      observation.tokens ?? null,
      observation.type,
      observation.relevance_score
    );
    return id;
  }

  getSessionObservations(sessionId: string): Observation[] {
    const stmt = this.db.prepare(`
      SELECT * FROM observations
      WHERE session_id = ?
      ORDER BY timestamp ASC
    `);
    return stmt.all(sessionId) as Observation[];
  }

  listScopes(): string[] {
    const stmt = this.db.prepare(`
      SELECT DISTINCT scope FROM memories
      ORDER BY scope
    `);
    return (stmt.all() as { scope: string }[]).map(r => r.scope);
  }

  listTypes(): MemoryType[] {
    const stmt = this.db.prepare(`
      SELECT DISTINCT type FROM memories
      ORDER BY type
    `);
    return (stmt.all() as { type: MemoryType }[]).map(r => r.type);
  }

  getStats(): { memories: number; sessions: number; observations: number } {
    const memories = (this.db.prepare("SELECT COUNT(*) as count FROM memories").get() as { count: number }).count;
    const sessions = (this.db.prepare("SELECT COUNT(*) as count FROM sessions").get() as { count: number }).count;
    const observations = (this.db.prepare("SELECT COUNT(*) as count FROM observations").get() as { count: number }).count;
    return { memories, sessions, observations };
  }

  close(): void {
    this.db.close();
  }
}

let storageInstance: MemoryStorage | null = null;
let currentDbPath: string | null = null;
let storageLock = false;

export function getStorage(dbPath?: string): MemoryStorage {
  const resolvedPath = dbPath ?? getMemoryDbPath();

  if (!resolvedPath || typeof resolvedPath !== 'string') {
    throw new Error("Invalid database path");
  }

  if (resolvedPath.includes("..") || resolvedPath.includes("../") || resolvedPath.includes("..\\")) {
    throw new Error("Invalid database path: directory traversal detected");
  }

  const sensitiveDirs = ['/etc', '/usr', '/var', '/root', '/boot', '/sys', '/proc'];
  for (const dir of sensitiveDirs) {
    if (resolvedPath.startsWith(dir)) {
      throw new Error("Invalid database path: access to system directories not allowed");
    }
  }

  if (storageLock) {
    throw new Error("Storage initialization in progress");
  }

  if (storageInstance && currentDbPath !== resolvedPath) {
    try {
      storageInstance.close();
    } catch (err) {
      console.warn("Error closing previous storage instance:", err);
    }
    storageInstance = null;
  }

  if (!storageInstance) {
    storageLock = true;
    try {
      storageInstance = new MemoryStorage(resolvedPath);
      currentDbPath = resolvedPath;
    } finally {
      storageLock = false;
    }
  }

  return storageInstance;
}

export function closeStorage(): void {
  if (storageInstance) {
    storageInstance.close();
    storageInstance = null;
    currentDbPath = null;
  }
}

export type { MemoryType, MemorySource, ObservationType, Memory, Session, Observation };

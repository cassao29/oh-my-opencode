import { existsSync, mkdirSync } from "fs";
import { join, resolve } from "path";
import { homedir } from "os";
import { Database } from "bun:sqlite";
import { randomUUID } from "crypto";
import type { Memory, MemoryType } from "../storage/sqlite";
import { getStorage } from "../storage/sqlite";
import { getMemoryDbPath, getProjectName } from "../utils/project";
import { redactSecrets } from "../utils/privacy";

const GLOBAL_MEMORY_SCHEMA = `
CREATE TABLE IF NOT EXISTS shared_memories (
  id TEXT PRIMARY KEY,
  original_id TEXT NOT NULL,
  source_project TEXT NOT NULL,
  type TEXT NOT NULL,
  scope TEXT NOT NULL,
  content TEXT NOT NULL,
  tags TEXT,
  shared_at TEXT NOT NULL DEFAULT (datetime('now')),
  shared_by TEXT,
  share_scope TEXT DEFAULT 'global'
);

CREATE INDEX IF NOT EXISTS idx_shared_memories_type ON shared_memories(type);
CREATE INDEX IF NOT EXISTS idx_shared_memories_scope ON shared_memories(scope);
CREATE INDEX IF NOT EXISTS idx_shared_memories_source ON shared_memories(source_project);
CREATE INDEX IF NOT EXISTS idx_shared_memories_share_scope ON shared_memories(share_scope);
`;

export type ShareScope = "global" | "organization" | "team" | "personal";

export interface SharedMemory {
  id: string;
  original_id: string;
  source_project: string;
  type: MemoryType;
  scope: string;
  content: string;
  tags?: string;
  shared_at: string;
  shared_by?: string;
  share_scope: ShareScope;
}

export interface ShareConfig {
  shareScope: ShareScope;
  includeTypes?: MemoryType[];
  excludeTypes?: MemoryType[];
  includeTags?: string[];
  excludeTags?: string[];
  minAgeDays?: number;
  maxAgeDays?: number;
  redactSecrets?: boolean;
}

export const DEFAULT_SHARE_CONFIG: ShareConfig = {
  shareScope: "global",
  includeTypes: ["decision", "pattern", "learning"],
  excludeTypes: ["blocker", "context"],
  redactSecrets: true,
};

export interface ShareResult {
  shared: number;
  skipped: number;
  errors: string[];
}

export interface ImportResult {
  imported: number;
  skipped: number;
  duplicates: number;
  errors: string[];
}

function getGlobalMemoryDbPath(): string {
  const globalDir = join(homedir(), ".opencode", "global-memory");
  
  if (!existsSync(globalDir)) {
    mkdirSync(globalDir, { recursive: true, mode: 0o755 });
  }
  
  return join(globalDir, "shared.db");
}

class GlobalMemoryStorage {
  private db: Database;
  
  constructor() {
    const dbPath = getGlobalMemoryDbPath();
    this.db = new Database(dbPath, { create: true });
    this.db.run("PRAGMA journal_mode = WAL");
    this.db.run("PRAGMA busy_timeout = 5000");
    this.initSchema();
  }
  
  private initSchema(): void {
    this.db.run(GLOBAL_MEMORY_SCHEMA);
  }
  
  share(memory: Memory, sourceProject: string, config: ShareConfig): string {
    const id = randomUUID();
    const content = config.redactSecrets 
      ? redactSecrets(memory.content) 
      : memory.content;
    
    const stmt = this.db.prepare(`
      INSERT INTO shared_memories (id, original_id, source_project, type, scope, content, tags, share_scope, shared_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      id,
      memory.id,
      sourceProject,
      memory.type,
      memory.scope,
      content,
      memory.tags ?? null,
      config.shareScope,
      null
    );
    
    return id;
  }
  
  listShared(options: {
    sourceProject?: string;
    shareScope?: ShareScope;
    type?: MemoryType;
    scope?: string;
    limit?: number;
  } = {}): SharedMemory[] {
    const conditions: string[] = [];
    const params: (string | number)[] = [];
    
    if (options.sourceProject) {
      conditions.push("source_project = ?");
      params.push(options.sourceProject);
    }
    if (options.shareScope) {
      conditions.push("share_scope = ?");
      params.push(options.shareScope);
    }
    if (options.type) {
      conditions.push("type = ?");
      params.push(options.type);
    }
    if (options.scope) {
      conditions.push("scope = ?");
      params.push(options.scope);
    }
    
    const whereClause = conditions.length > 0 
      ? `WHERE ${conditions.join(" AND ")}` 
      : "";
    
    const sql = `
      SELECT * FROM shared_memories
      ${whereClause}
      ORDER BY shared_at DESC
      LIMIT ?
    `;
    
    params.push(options.limit ?? 100);
    
    return this.db.prepare(sql).all(...params) as SharedMemory[];
  }
  
  getSharedById(id: string): SharedMemory | undefined {
    return this.db.prepare(`
      SELECT * FROM shared_memories WHERE id = ?
    `).get(id) as SharedMemory | undefined;
  }
  
  findDuplicate(memory: Memory, targetProject: string): boolean {
    const stmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM shared_memories
      WHERE type = ? AND scope = ? AND content = ?
    `);
    
    const result = stmt.get(memory.type, memory.scope, memory.content) as { count: number };
    return result.count > 0;
  }
  
  unshare(id: string): boolean {
    const result = this.db.prepare(`
      DELETE FROM shared_memories WHERE id = ?
    `).run(id);
    return result.changes > 0;
  }
  
  getStats(): { total: number; byProject: Record<string, number>; byType: Record<string, number> } {
    const total = (this.db.prepare("SELECT COUNT(*) as count FROM shared_memories").get() as { count: number }).count;
    
    const byProjectRows = this.db.prepare(`
      SELECT source_project, COUNT(*) as count 
      FROM shared_memories 
      GROUP BY source_project
    `).all() as Array<{ source_project: string; count: number }>;
    
    const byTypeRows = this.db.prepare(`
      SELECT type, COUNT(*) as count 
      FROM shared_memories 
      GROUP BY type
    `).all() as Array<{ type: string; count: number }>;
    
    const byProject: Record<string, number> = {};
    for (const row of byProjectRows) {
      byProject[row.source_project] = row.count;
    }
    
    const byType: Record<string, number> = {};
    for (const row of byTypeRows) {
      byType[row.type] = row.count;
    }
    
    return { total, byProject, byType };
  }
  
  close(): void {
    this.db.close();
  }
}

let globalStorageInstance: GlobalMemoryStorage | null = null;

export function getGlobalStorage(): GlobalMemoryStorage {
  if (!globalStorageInstance) {
    globalStorageInstance = new GlobalMemoryStorage();
  }
  return globalStorageInstance;
}

export function closeGlobalStorage(): void {
  if (globalStorageInstance) {
    globalStorageInstance.close();
    globalStorageInstance = null;
  }
}

function shouldShareMemory(memory: Memory, config: ShareConfig): boolean {
  if (config.includeTypes && !config.includeTypes.includes(memory.type)) {
    return false;
  }
  
  if (config.excludeTypes && config.excludeTypes.includes(memory.type)) {
    return false;
  }
  
  if (memory.tags) {
    const tags = memory.tags.split(",").map(t => t.trim().toLowerCase());
    
    if (config.includeTags && config.includeTags.length > 0) {
      const hasIncludeTag = config.includeTags.some(t => tags.includes(t.toLowerCase()));
      if (!hasIncludeTag) return false;
    }
    
    if (config.excludeTags && config.excludeTags.length > 0) {
      const hasExcludeTag = config.excludeTags.some(t => tags.includes(t.toLowerCase()));
      if (hasExcludeTag) return false;
    }
  }
  
  if (config.minAgeDays || config.maxAgeDays) {
    const ageMs = Date.now() - new Date(memory.timestamp).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    
    if (config.minAgeDays && ageDays < config.minAgeDays) return false;
    if (config.maxAgeDays && ageDays > config.maxAgeDays) return false;
  }
  
  return true;
}

export function shareMemories(
  projectPath: string,
  config: ShareConfig = DEFAULT_SHARE_CONFIG
): ShareResult {
  const result: ShareResult = { shared: 0, skipped: 0, errors: [] };
  
  try {
    const storage = getStorage(getMemoryDbPath(projectPath));
    const globalStorage = getGlobalStorage();
    const projectName = getProjectName(projectPath);
    
    const memories = storage.getMemories({ 
      projectPath, 
      limit: 500 
    });
    
    for (const memory of memories) {
      try {
        if (!shouldShareMemory(memory, config)) {
          result.skipped++;
          continue;
        }
        
        if (globalStorage.findDuplicate(memory, projectName)) {
          result.skipped++;
          continue;
        }
        
        globalStorage.share(memory, projectName, config);
        result.shared++;
      } catch (err) {
        result.errors.push(`Failed to share memory ${memory.id}: ${err instanceof Error ? err.message : "Unknown error"}`);
      }
    }
  } catch (err) {
    result.errors.push(`Share operation failed: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
  
  return result;
}

export function importSharedMemories(
  targetProjectPath: string,
  options: {
    sourceProject?: string;
    shareScope?: ShareScope;
    types?: MemoryType[];
    scopes?: string[];
    limit?: number;
    skipDuplicates?: boolean;
  } = {}
): ImportResult {
  const result: ImportResult = { imported: 0, skipped: 0, duplicates: 0, errors: [] };
  const skipDuplicates = options.skipDuplicates ?? true;
  
  try {
    const targetStorage = getStorage(getMemoryDbPath(targetProjectPath));
    const globalStorage = getGlobalStorage();
    const targetProject = getProjectName(targetProjectPath);
    
    const sharedMemories = globalStorage.listShared({
      sourceProject: options.sourceProject,
      shareScope: options.shareScope,
      limit: options.limit ?? 100,
    });
    
    const filteredMemories = sharedMemories.filter(sm => {
      if (sm.source_project === targetProject) return false;
      if (options.types && !options.types.includes(sm.type)) return false;
      if (options.scopes && !options.scopes.includes(sm.scope)) return false;
      return true;
    });
    
    for (const shared of filteredMemories) {
      try {
        if (skipDuplicates) {
          const existing = targetStorage.getMemories({
            scope: shared.scope,
            type: shared.type,
            limit: 100,
          });
          
          const isDuplicate = existing.some(e => e.content === shared.content);
          if (isDuplicate) {
            result.duplicates++;
            continue;
          }
        }
        
        targetStorage.saveMemory({
          type: shared.type,
          scope: shared.scope,
          content: shared.content,
          tags: shared.tags ? `${shared.tags}, imported, from:${shared.source_project}` : `imported, from:${shared.source_project}`,
          source: "auto",
          project_path: targetProjectPath,
        });
        
        result.imported++;
      } catch (err) {
        result.errors.push(`Failed to import memory ${shared.id}: ${err instanceof Error ? err.message : "Unknown error"}`);
      }
    }
  } catch (err) {
    result.errors.push(`Import operation failed: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
  
  return result;
}

export function listAvailableProjects(): string[] {
  const globalStorage = getGlobalStorage();
  const stats = globalStorage.getStats();
  return Object.keys(stats.byProject);
}

export function getSharedMemoryStats(): { 
  total: number; 
  byProject: Record<string, number>; 
  byType: Record<string, number> 
} {
  return getGlobalStorage().getStats();
}

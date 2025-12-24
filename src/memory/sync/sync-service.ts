import { getStorage, type Memory, type MemoryType } from "../storage/sqlite";
import { getMemoryDbPath } from "../utils/project";
import {
  DEFAULT_SYNC_CONFIG,
  type SyncConfig,
  type SyncDiff,
  type SyncResult,
  type SyncableMemory,
  type Entity,
  type MemoryEntity,
  type MemoryRelation,
} from "./types";
import { extractEntitiesFromBatch } from "./entity-extractor";
import { extractRelations } from "./relation-extractor";
import { tryConnectNeo4j, type Neo4jWorkerClient } from "./neo4j-client";
import { createHash } from "crypto";
import { log } from "../../shared";

function computeMemoryHash(memory: Memory): string {
  const content = `${memory.type}:${memory.scope}:${memory.content}:${memory.tags || ""}`;
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

interface RemoteMemoryAPI {
  list: () => Promise<{ scopes: string[]; types: MemoryType[] }>;
  recall: (params: { scope?: string; type?: MemoryType; limit?: number }) => Promise<Memory[]>;
  remember: (memory: Omit<Memory, "id" | "timestamp">) => Promise<string>;
  update: (memory: Partial<Memory> & { scope: string; type: MemoryType }) => Promise<boolean>;
  forget: (scope: string, type: MemoryType, reason: string) => Promise<number>;
}

export class MemorySyncService {
  private projectPath: string;
  private config: SyncConfig;
  private remoteAPI?: RemoteMemoryAPI;
  private neo4jClient?: Neo4jWorkerClient;
  private syncInProgress = false;
  private lastSyncTime?: Date;
  private neo4jConnectionAttempted = false;

  constructor(projectPath: string, config: Partial<SyncConfig> = {}) {
    this.projectPath = projectPath;
    this.config = { ...DEFAULT_SYNC_CONFIG, ...config };
  }

  setRemoteAPI(api: RemoteMemoryAPI): void {
    this.remoteAPI = api;
  }

  async tryConnectNeo4j(): Promise<boolean> {
    if (this.neo4jClient?.isConnected()) {
      return true;
    }

    if (this.neo4jConnectionAttempted) {
      return false;
    }

    this.neo4jConnectionAttempted = true;
    this.neo4jClient = await tryConnectNeo4j() ?? undefined;
    
    if (this.neo4jClient) {
      log("Connected to Neo4j memory worker");
      return true;
    }
    
    log("Neo4j memory worker not available, using SQLite only");
    return false;
  }

  isNeo4jConnected(): boolean {
    return this.neo4jClient?.isConnected() ?? false;
  }

  private getStorage() {
    const dbPath = getMemoryDbPath(this.projectPath);
    return getStorage(dbPath);
  }

  async pullFromRemote(): Promise<Memory[]> {
    if (!this.remoteAPI) {
      throw new Error("Remote API not configured");
    }

    const { scopes } = await this.remoteAPI.list();
    const allMemories: Memory[] = [];

    for (const scope of scopes) {
      const memories = await this.remoteAPI.recall({ scope, limit: 100 });
      allMemories.push(...memories);
    }

    return allMemories;
  }

  async pushToRemote(memories: Memory[]): Promise<void> {
    if (!this.remoteAPI) {
      throw new Error("Remote API not configured");
    }

    for (const memory of memories) {
      await this.remoteAPI.remember({
        type: memory.type,
        scope: memory.scope,
        content: memory.content,
        tags: memory.tags,
        source: memory.source,
        issue: memory.issue,
        project_path: memory.project_path,
      });
    }
  }

  computeDiff(localMemories: Memory[], remoteMemories: Memory[]): SyncDiff {
    const localByKey = new Map<string, Memory>();
    const remoteByKey = new Map<string, Memory>();

    for (const m of localMemories) {
      const key = `${m.type}:${m.scope}:${computeMemoryHash(m)}`;
      localByKey.set(key, m);
    }

    for (const m of remoteMemories) {
      const key = `${m.type}:${m.scope}:${computeMemoryHash(m)}`;
      remoteByKey.set(key, m);
    }

    const toCreate: Memory[] = [];
    const toUpdate: Memory[] = [];
    const toDelete: Memory[] = [];
    const conflicts: Array<{ local: Memory; remote: Memory }> = [];

    for (const [key, local] of localByKey) {
      if (!remoteByKey.has(key)) {
        toCreate.push(local);
      }
    }

    for (const [key, remote] of remoteByKey) {
      if (!localByKey.has(key)) {
        const storage = this.getStorage();
        storage.saveMemory({
          type: remote.type,
          scope: remote.scope,
          content: remote.content,
          tags: remote.tags,
          source: remote.source,
          issue: remote.issue,
          project_path: remote.project_path,
        });
      }
    }

    for (const [key, local] of localByKey) {
      const remote = remoteByKey.get(key);
      if (remote && local.content !== remote.content) {
        conflicts.push({ local, remote });
      }
    }

    return { toCreate, toUpdate, toDelete, conflicts };
  }

  async sync(): Promise<SyncResult> {
    if (this.syncInProgress) {
      return {
        created: 0,
        updated: 0,
        deleted: 0,
        conflicts: 0,
        errors: ["Sync already in progress"],
      };
    }

    this.syncInProgress = true;
    const result: SyncResult = {
      created: 0,
      updated: 0,
      deleted: 0,
      conflicts: 0,
      errors: [],
    };

    try {
      const storage = this.getStorage();
      const localMemories = storage.getMemories({ limit: 1000 });

      let entities: Entity[] = [];
      let relations: MemoryRelation[] = [];

      if (this.config.extract_entities) {
        const extracted = extractEntitiesFromBatch(localMemories);
        entities = extracted.entities;
        await this.saveEntities(entities, extracted.relations);
      }

      if (this.config.extract_relations) {
        relations = extractRelations(localMemories);
        await this.saveRelations(relations);
      }

      if (this.remoteAPI) {
        const remoteMemories = await this.pullFromRemote();
        const diff = this.computeDiff(localMemories, remoteMemories);

        await this.pushToRemote(diff.toCreate);
        result.created = diff.toCreate.length;

        result.conflicts = diff.conflicts.length;
        for (const { local } of diff.conflicts) {
          if (this.config.conflict_resolution === "local_wins") {
            await this.remoteAPI.update({
              type: local.type,
              scope: local.scope,
              content: local.content,
            });
          }
        }
      }

      await this.tryConnectNeo4j();
      if (this.neo4jClient?.isConnected()) {
        const neo4jResult = await this.neo4jClient.sync({
          memories: localMemories,
          entities,
          relations,
        });

        result.created += neo4jResult.memoriesStored;
        if (neo4jResult.errors.length > 0) {
          result.errors.push(...neo4jResult.errors);
        }

        log(`Neo4j sync: ${neo4jResult.memoriesStored} memories, ${neo4jResult.entitiesStored} entities, ${neo4jResult.relationsCreated} relations`);
      }

      this.lastSyncTime = new Date();
    } catch (err) {
      result.errors.push(err instanceof Error ? err.message : "Unknown error");
    } finally {
      this.syncInProgress = false;
    }

    return result;
  }

  private async saveEntities(entities: Entity[], memoryEntities: MemoryEntity[]): Promise<void> {
    const storage = this.getStorage();
    const db = (storage as unknown as { db: { prepare: (sql: string) => { run: (...args: unknown[]) => void } } }).db;

    try {
      db.prepare(`
        CREATE TABLE IF NOT EXISTS entities (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          entity_type TEXT NOT NULL,
          first_seen TEXT NOT NULL,
          mention_count INTEGER DEFAULT 1,
          metadata TEXT
        )
      `).run();

      db.prepare(`
        CREATE TABLE IF NOT EXISTS memory_entities (
          memory_id TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          relevance_score REAL,
          PRIMARY KEY(memory_id, entity_id)
        )
      `).run();
    } catch {
      // Tables might already exist
    }

    for (const entity of entities) {
      try {
        db.prepare(`
          INSERT OR REPLACE INTO entities (id, name, entity_type, first_seen, mention_count)
          VALUES (?, ?, ?, ?, ?)
        `).run(entity.id, entity.name, entity.entity_type, entity.first_seen, entity.mention_count);
      } catch {
        // Ignore duplicates
      }
    }

    for (const me of memoryEntities) {
      try {
        db.prepare(`
          INSERT OR REPLACE INTO memory_entities (memory_id, entity_id, relevance_score)
          VALUES (?, ?, ?)
        `).run(me.memory_id, me.entity_id, me.relevance_score ?? null);
      } catch {
        // Ignore duplicates
      }
    }
  }

  private async saveRelations(relations: MemoryRelation[]): Promise<void> {
    const storage = this.getStorage();
    const db = (storage as unknown as { db: { prepare: (sql: string) => { run: (...args: unknown[]) => void } } }).db;

    try {
      db.prepare(`
        CREATE TABLE IF NOT EXISTS memory_relations (
          id TEXT PRIMARY KEY,
          source_id TEXT NOT NULL,
          target_id TEXT NOT NULL,
          relation_type TEXT NOT NULL,
          metadata TEXT,
          created_at TEXT NOT NULL,
          UNIQUE(source_id, target_id, relation_type)
        )
      `).run();
    } catch {
      // Table might already exist
    }

    for (const rel of relations) {
      try {
        db.prepare(`
          INSERT OR IGNORE INTO memory_relations (id, source_id, target_id, relation_type, metadata, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          rel.id,
          rel.source_id,
          rel.target_id,
          rel.relation_type,
          rel.metadata ? JSON.stringify(rel.metadata) : null,
          rel.created_at
        );
      } catch {
        // Ignore duplicates
      }
    }
  }

  getLastSyncTime(): Date | undefined {
    return this.lastSyncTime;
  }

  isSyncing(): boolean {
    return this.syncInProgress;
  }
}

let syncServiceInstance: MemorySyncService | null = null;

export function getSyncService(projectPath: string, config?: Partial<SyncConfig>): MemorySyncService {
  if (!syncServiceInstance || syncServiceInstance["projectPath"] !== projectPath) {
    syncServiceInstance = new MemorySyncService(projectPath, config);
  }
  return syncServiceInstance;
}

import type { Memory, MemoryType } from "../types";
import type { Entity, MemoryRelation, GraphNode, GraphEdge, GraphQueryResult } from "./types";
import { log } from "../../shared";

export interface Neo4jWorkerConfig {
  baseUrl: string;
  timeout: number;
}

const DEFAULT_CONFIG: Neo4jWorkerConfig = {
  baseUrl: "http://localhost:36497",
  timeout: 30000,
};

export interface Neo4jMemoryNode {
  id: string;
  type: MemoryType;
  scope: string;
  content: string;
  tags?: string;
  source?: string;
  created_at: string;
  project_path?: string;
}

export interface Neo4jRelationship {
  id: string;
  source_id: string;
  target_id: string;
  relation_type: string;
  metadata?: Record<string, unknown>;
}

export class Neo4jWorkerClient {
  private config: Neo4jWorkerConfig;
  private connected: boolean = false;
  private lastHealthCheck: Date | null = null;

  constructor(config: Partial<Neo4jWorkerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  private async fetch<T>(endpoint: string, options: RequestInit = {}): Promise<T | null> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

      const response = await fetch(`${this.config.baseUrl}${endpoint}`, {
        ...options,
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...options.headers,
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        log(`Neo4j worker request failed: ${response.status} ${response.statusText}`);
        return null;
      }

      return await response.json() as T;
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        log("Neo4j worker request timed out");
      } else {
        log("Neo4j worker request failed:", err);
      }
      return null;
    }
  }

  async healthCheck(): Promise<boolean> {
    const result = await this.fetch<{ status: string }>("/health");
    this.connected = result?.status === "ok";
    this.lastHealthCheck = new Date();
    return this.connected;
  }

  isConnected(): boolean {
    return this.connected;
  }

  getLastHealthCheck(): Date | null {
    return this.lastHealthCheck;
  }

  async storeMemory(memory: Memory): Promise<string | null> {
    const node: Neo4jMemoryNode = {
      id: memory.id,
      type: memory.type,
      scope: memory.scope,
      content: memory.content,
      tags: memory.tags,
      source: memory.source,
      created_at: memory.timestamp,
      project_path: memory.project_path,
    };

    const result = await this.fetch<{ id: string }>("/memories", {
      method: "POST",
      body: JSON.stringify(node),
    });

    return result?.id ?? null;
  }

  async storeMemories(memories: Memory[]): Promise<number> {
    const nodes = memories.map((m): Neo4jMemoryNode => ({
      id: m.id,
      type: m.type,
      scope: m.scope,
      content: m.content,
      tags: m.tags,
      source: m.source,
      created_at: m.timestamp,
      project_path: m.project_path,
    }));

    const result = await this.fetch<{ stored: number }>("/memories/batch", {
      method: "POST",
      body: JSON.stringify({ memories: nodes }),
    });

    return result?.stored ?? 0;
  }

  async storeEntity(entity: Entity): Promise<string | null> {
    const result = await this.fetch<{ id: string }>("/entities", {
      method: "POST",
      body: JSON.stringify(entity),
    });

    return result?.id ?? null;
  }

  async storeEntities(entities: Entity[]): Promise<number> {
    const result = await this.fetch<{ stored: number }>("/entities/batch", {
      method: "POST",
      body: JSON.stringify({ entities }),
    });

    return result?.stored ?? 0;
  }

  async createRelation(relation: MemoryRelation): Promise<string | null> {
    const result = await this.fetch<{ id: string }>("/relations", {
      method: "POST",
      body: JSON.stringify(relation),
    });

    return result?.id ?? null;
  }

  async createRelations(relations: MemoryRelation[]): Promise<number> {
    const result = await this.fetch<{ created: number }>("/relations/batch", {
      method: "POST",
      body: JSON.stringify({ relations }),
    });

    return result?.created ?? 0;
  }

  async queryMemories(params: {
    scope?: string;
    type?: MemoryType;
    limit?: number;
    project_path?: string;
  }): Promise<Neo4jMemoryNode[]> {
    const queryParams = new URLSearchParams();
    if (params.scope) queryParams.set("scope", params.scope);
    if (params.type) queryParams.set("type", params.type);
    if (params.limit) queryParams.set("limit", String(params.limit));
    if (params.project_path) queryParams.set("project_path", params.project_path);

    const result = await this.fetch<{ memories: Neo4jMemoryNode[] }>(
      `/memories?${queryParams.toString()}`
    );

    return result?.memories ?? [];
  }

  async getRelatedMemories(memoryId: string, depth: number = 2): Promise<GraphQueryResult> {
    const result = await this.fetch<GraphQueryResult>(
      `/memories/${memoryId}/related?depth=${depth}`
    );

    return result ?? { nodes: [], edges: [] };
  }

  async searchMemories(query: string, options: {
    scope?: string;
    type?: MemoryType;
    limit?: number;
  } = {}): Promise<Neo4jMemoryNode[]> {
    const result = await this.fetch<{ memories: Neo4jMemoryNode[] }>("/memories/search", {
      method: "POST",
      body: JSON.stringify({ query, ...options }),
    });

    return result?.memories ?? [];
  }

  async getGraphStats(): Promise<{
    nodeCount: number;
    edgeCount: number;
    memoryCount: number;
    entityCount: number;
  } | null> {
    return await this.fetch("/stats");
  }

  async sync(data: {
    memories: Memory[];
    entities: Entity[];
    relations: MemoryRelation[];
  }): Promise<{
    memoriesStored: number;
    entitiesStored: number;
    relationsCreated: number;
    errors: string[];
  }> {
    const result = await this.fetch<{
      memories_stored: number;
      entities_stored: number;
      relations_created: number;
      errors: string[];
    }>("/sync", {
      method: "POST",
      body: JSON.stringify({
        memories: data.memories.map((m) => ({
          id: m.id,
          type: m.type,
          scope: m.scope,
          content: m.content,
          tags: m.tags,
          source: m.source,
          created_at: m.timestamp,
          project_path: m.project_path,
        })),
        entities: data.entities,
        relations: data.relations,
      }),
    });

    return {
      memoriesStored: result?.memories_stored ?? 0,
      entitiesStored: result?.entities_stored ?? 0,
      relationsCreated: result?.relations_created ?? 0,
      errors: result?.errors ?? [],
    };
  }

  async getPruningAdvice(options: {
    project_path: string;
    context_tokens: number;
    max_tokens: number;
  }): Promise<{
    canPrune: string[];
    mustKeep: string[];
    reasoning: string;
  } | null> {
    return await this.fetch("/prune/advice", {
      method: "POST",
      body: JSON.stringify(options),
    });
  }
}

let clientInstance: Neo4jWorkerClient | null = null;

export function getNeo4jClient(config?: Partial<Neo4jWorkerConfig>): Neo4jWorkerClient {
  if (!clientInstance) {
    clientInstance = new Neo4jWorkerClient(config);
  }
  return clientInstance;
}

export async function tryConnectNeo4j(config?: Partial<Neo4jWorkerConfig>): Promise<Neo4jWorkerClient | null> {
  const client = getNeo4jClient(config);
  const connected = await client.healthCheck();
  return connected ? client : null;
}

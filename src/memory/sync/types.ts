import type { Memory, MemoryType } from "../types";

export interface SyncableMemory extends Memory {
  sync_hash?: string;
  synced_at?: string;
  sync_status: "pending" | "synced" | "conflict" | "local_only";
}

export interface MemoryRelation {
  id: string;
  source_id: string;
  target_id: string;
  relation_type: RelationType;
  metadata?: Record<string, unknown>;
  created_at: string;
}

export type RelationType = 
  | "depends_on"      // A depends on B
  | "supersedes"      // A replaces/supersedes B
  | "related_to"      // A is related to B (bidirectional)
  | "derived_from"    // A was derived from B
  | "contradicts"     // A contradicts B
  | "supports"        // A supports/reinforces B
  | "implements"      // A implements B (decision -> pattern)
  | "blocks"          // A blocks B (blocker -> decision)
  | "resolves";       // A resolves B (learning -> blocker)

export interface Entity {
  id: string;
  name: string;
  entity_type: EntityType;
  first_seen: string;
  mention_count: number;
  metadata?: Record<string, unknown>;
}

export type EntityType = 
  | "project"
  | "component"
  | "technology"
  | "concept"
  | "person"
  | "file"
  | "api"
  | "pattern";

export interface MemoryEntity {
  memory_id: string;
  entity_id: string;
  relevance_score?: number;
}

export interface SyncDiff {
  toCreate: Memory[];
  toUpdate: Memory[];
  toDelete: Memory[];
  conflicts: Array<{ local: Memory; remote: Memory }>;
}

export interface SyncResult {
  created: number;
  updated: number;
  deleted: number;
  conflicts: number;
  errors: string[];
}

export interface GraphNode {
  id: string;
  labels: string[];
  properties: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  type: string;
  source: string;
  target: string;
  properties: Record<string, unknown>;
}

export interface GraphQueryResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface SyncConfig {
  enabled: boolean;
  auto_sync: boolean;
  sync_interval_ms: number;
  conflict_resolution: "local_wins" | "remote_wins" | "manual";
  extract_entities: boolean;
  extract_relations: boolean;
}

export const DEFAULT_SYNC_CONFIG: SyncConfig = {
  enabled: true,
  auto_sync: true,
  sync_interval_ms: 60000,
  conflict_resolution: "local_wins",
  extract_entities: true,
  extract_relations: true,
};

export interface PreemptiveSyncConfig {
  contextThreshold: number;
  memoryThreshold: number;
  minIntervalMs: number;
  syncOnCompaction: boolean;
}

export interface SyncState {
  lastSyncTime: number;
  lastSyncMemoryCount: number;
  syncInProgress: boolean;
  totalSyncs: number;
  lastError?: string;
}

export interface SyncTrigger {
  reason: "context_threshold" | "memory_threshold" | "compaction" | "manual";
  contextUsage?: number;
  memoryCount?: number;
  timestamp: number;
}

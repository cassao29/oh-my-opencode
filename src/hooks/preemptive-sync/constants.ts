import type { PreemptiveSyncConfig } from "./types";

export const DEFAULT_CONFIG: PreemptiveSyncConfig = {
  contextThreshold: 0.6,
  memoryThreshold: 50,
  minIntervalMs: 5 * 60 * 1000,
  syncOnCompaction: true,
};

export const HOOK_NAME = "preemptive-sync";

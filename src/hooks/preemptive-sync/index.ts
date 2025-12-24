import type { Hooks } from "../../memory/types";
import { getSyncService } from "../../memory/sync";
import { getStorage } from "../../memory/storage/sqlite";
import { getMemoryDbPath } from "../../memory/utils/project";
import { log } from "../../shared";
import { DEFAULT_CONFIG, HOOK_NAME } from "./constants";
import type { PreemptiveSyncConfig, SyncState, SyncTrigger } from "./types";

interface PluginInput {
  directory: string;
  worktree: string;
}

const syncState: SyncState = {
  lastSyncTime: 0,
  lastSyncMemoryCount: 0,
  syncInProgress: false,
  totalSyncs: 0,
};

function shouldSync(
  trigger: SyncTrigger,
  config: PreemptiveSyncConfig
): boolean {
  if (syncState.syncInProgress) {
    return false;
  }

  const timeSinceLastSync = trigger.timestamp - syncState.lastSyncTime;
  if (timeSinceLastSync < config.minIntervalMs) {
    return false;
  }

  switch (trigger.reason) {
    case "context_threshold":
      return (trigger.contextUsage || 0) >= config.contextThreshold;

    case "memory_threshold": {
      const newMemories = (trigger.memoryCount || 0) - syncState.lastSyncMemoryCount;
      return newMemories >= config.memoryThreshold;
    }

    case "compaction":
      return config.syncOnCompaction;

    case "manual":
      return true;

    default:
      return false;
  }
}

async function performSync(
  projectPath: string,
  trigger: SyncTrigger
): Promise<void> {
  if (syncState.syncInProgress) {
    return;
  }

  syncState.syncInProgress = true;
  log(`[${HOOK_NAME}] Starting preemptive sync (reason: ${trigger.reason})`);

  try {
    const syncService = getSyncService(projectPath);
    const connected = await syncService.tryConnectNeo4j();

    if (!connected) {
      log(`[${HOOK_NAME}] Neo4j not available, skipping sync`);
      return;
    }

    const result = await syncService.sync();

    syncState.lastSyncTime = Date.now();
    syncState.totalSyncs++;

    const storage = getStorage(getMemoryDbPath(projectPath));
    syncState.lastSyncMemoryCount = storage.getStats().memories;

    if (result.errors.length > 0) {
      syncState.lastError = result.errors.join("; ");
      log(`[${HOOK_NAME}] Sync completed with errors: ${syncState.lastError}`);
    } else {
      syncState.lastError = undefined;
      log(
        `[${HOOK_NAME}] Sync completed: ${result.created} created, ` +
        `${result.updated} updated, ${result.conflicts} conflicts`
      );
    }
  } catch (err) {
    syncState.lastError = err instanceof Error ? err.message : "Unknown error";
    log(`[${HOOK_NAME}] Sync failed: ${syncState.lastError}`);
  } finally {
    syncState.syncInProgress = false;
  }
}

function checkAndTriggerSync(
  projectPath: string,
  config: PreemptiveSyncConfig
): void {
  const storage = getStorage(getMemoryDbPath(projectPath));
  const stats = storage.getStats();

  const memoryTrigger: SyncTrigger = {
    reason: "memory_threshold",
    memoryCount: stats.memories,
    timestamp: Date.now(),
  };

  if (shouldSync(memoryTrigger, config)) {
    performSync(projectPath, memoryTrigger).catch((err) => {
      log(`[${HOOK_NAME}] Background sync error: ${err}`);
    });
  }
}

export function createPreemptiveSyncHook(
  input: PluginInput,
  config: Partial<PreemptiveSyncConfig> = {}
): Hooks {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };
  const projectPath = input.worktree || input.directory;

  return {
    "experimental.session.compacting": async () => {
      if (!mergedConfig.syncOnCompaction) {
        return;
      }

      const trigger: SyncTrigger = {
        reason: "compaction",
        timestamp: Date.now(),
      };

      if (shouldSync(trigger, mergedConfig)) {
        await performSync(projectPath, trigger);
      }
    },

    "tool.execute.after": async (
      toolInput: { tool: string; sessionID: string },
      _output: { output: string }
    ) => {
      if (toolInput.tool === "memory_remember") {
        checkAndTriggerSync(projectPath, mergedConfig);
      }
    },
  };
}

export function getSyncState(): Readonly<SyncState> {
  return { ...syncState };
}

export function resetSyncState(): void {
  syncState.lastSyncTime = 0;
  syncState.lastSyncMemoryCount = 0;
  syncState.syncInProgress = false;
  syncState.totalSyncs = 0;
  syncState.lastError = undefined;
}

export { HOOK_NAME, DEFAULT_CONFIG };
export type { PreemptiveSyncConfig, SyncState, SyncTrigger };

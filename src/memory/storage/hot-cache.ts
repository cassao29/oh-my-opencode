import type { Memory, Observation } from "../types";
import { selectMemoriesToKeep } from "../utils/h2o-scoring";

export interface HotCacheConfig {
  maxMemories: number;
  maxObservations: number;
  ttlMs: number;
}

export const DEFAULT_HOT_CACHE_CONFIG: HotCacheConfig = {
  maxMemories: 50,
  maxObservations: 20,
  ttlMs: 30 * 60 * 1000,
};

interface CachedItem<T> {
  data: T;
  accessCount: number;
  lastAccess: number;
  createdAt: number;
}

export class HotCache {
  private memories: Map<string, CachedItem<Memory>> = new Map();
  private observations: Map<string, CachedItem<Observation>> = new Map();
  private config: HotCacheConfig;

  constructor(config: Partial<HotCacheConfig> = {}) {
    this.config = { ...DEFAULT_HOT_CACHE_CONFIG, ...config };
  }

  putMemory(memory: Memory): void {
    const item: CachedItem<Memory> = {
      data: memory,
      accessCount: 1,
      lastAccess: Date.now(),
      createdAt: Date.now(),
    };

    this.memories.set(memory.id, item);
    this.evictMemoriesIfNeeded();
  }

  getMemory(id: string): Memory | undefined {
    const item = this.memories.get(id);
    if (!item) return undefined;

    if (this.isExpired(item)) {
      this.memories.delete(id);
      return undefined;
    }

    item.accessCount++;
    item.lastAccess = Date.now();
    return item.data;
  }

  getHotMemories(): Memory[] {
    const validMemories: Memory[] = [];

    for (const [id, item] of this.memories) {
      if (this.isExpired(item)) {
        this.memories.delete(id);
      } else {
        validMemories.push(item.data);
      }
    }

    return validMemories;
  }

  putObservation(observation: Observation): void {
    const item: CachedItem<Observation> = {
      data: observation,
      accessCount: 1,
      lastAccess: Date.now(),
      createdAt: Date.now(),
    };

    this.observations.set(observation.id, item);
    this.evictObservationsIfNeeded();
  }

  getRecentObservations(limit: number = 10): Observation[] {
    const items = Array.from(this.observations.values())
      .filter((item) => !this.isExpired(item))
      .sort((a, b) => b.lastAccess - a.lastAccess)
      .slice(0, limit);

    return items.map((item) => item.data);
  }

  private isExpired(item: CachedItem<unknown>): boolean {
    return Date.now() - item.createdAt > this.config.ttlMs;
  }

  private evictMemoriesIfNeeded(): void {
    if (this.memories.size <= this.config.maxMemories) return;

    const accessCounts = new Map<string, number>();
    for (const [id, item] of this.memories) {
      const key = `${item.data.scope}:${item.data.type}`;
      accessCounts.set(key, item.accessCount);
    }

    const allMemories = Array.from(this.memories.values()).map((i) => i.data);
    const toKeep = selectMemoriesToKeep(
      allMemories,
      this.config.maxMemories,
      accessCounts
    );

    const keepIds = new Set(toKeep.map((m) => m.id));
    for (const id of this.memories.keys()) {
      if (!keepIds.has(id)) {
        this.memories.delete(id);
      }
    }
  }

  private evictObservationsIfNeeded(): void {
    if (this.observations.size <= this.config.maxObservations) return;

    const sorted = Array.from(this.observations.entries()).sort(
      ([, a], [, b]) => b.lastAccess - a.lastAccess
    );

    const toRemove = sorted.slice(this.config.maxObservations);
    for (const [id] of toRemove) {
      this.observations.delete(id);
    }
  }

  clear(): void {
    this.memories.clear();
    this.observations.clear();
  }

  getStats(): {
    memoriesCount: number;
    observationsCount: number;
    totalAccessCount: number;
  } {
    let totalAccessCount = 0;
    for (const item of this.memories.values()) {
      totalAccessCount += item.accessCount;
    }
    for (const item of this.observations.values()) {
      totalAccessCount += item.accessCount;
    }

    return {
      memoriesCount: this.memories.size,
      observationsCount: this.observations.size,
      totalAccessCount,
    };
  }
}

let globalHotCache: HotCache | null = null;

export function getHotCache(config?: Partial<HotCacheConfig>): HotCache {
  if (!globalHotCache) {
    globalHotCache = new HotCache(config);
  }
  return globalHotCache;
}

export function resetHotCache(): void {
  globalHotCache?.clear();
  globalHotCache = null;
}

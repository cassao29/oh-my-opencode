import { existsSync, statSync } from "fs";

export const MAX_MEMORY_COUNT = 10000;
export const MAX_DB_SIZE_MB = 100;
export const MAX_OBSERVATION_COUNT = 50000;
export const MAX_REQUESTS_PER_MINUTE = 100;
export const MAX_CONTENT_LENGTH = 10000;
export const MAX_SCOPE_LENGTH = 255;
export const MAX_TAGS_LENGTH = 1000;

const requestCounts = new Map<string, { count: number, resetTime: number }>();

export function checkStorageLimits(getStorage: () => { getStats: () => { memories: number; observations: number } }, getMemoryDbPath: () => string): void {
  const storage = getStorage();
  const stats = storage.getStats();

  if (stats.memories > MAX_MEMORY_COUNT) {
    throw new Error(`Memory limit exceeded (${MAX_MEMORY_COUNT}). Please archive old memories.`);
  }

  if (stats.observations > MAX_OBSERVATION_COUNT) {
    throw new Error(`Observation limit exceeded (${MAX_OBSERVATION_COUNT}). Please archive old sessions.`);
  }

  try {
    const dbPath = getMemoryDbPath();
    if (existsSync(dbPath)) {
      const fileStats = statSync(dbPath);
      const sizeMB = fileStats.size / (1024 * 1024);
      if (sizeMB > MAX_DB_SIZE_MB) {
        throw new Error(`Database size limit exceeded (${MAX_DB_SIZE_MB}MB). Please archive old data.`);
      }
    }
  } catch {
    // Ignore file stat errors, limits will be enforced by SQLite
  }
}

export function checkRateLimit(identifier: string): boolean {
  const now = Date.now();
  const windowStart = Math.floor(now / 60000) * 60000;
  const key = `${identifier}:${windowStart}`;

  const current = requestCounts.get(key) || { count: 0, resetTime: windowStart + 60000 };

  if (now > current.resetTime) {
    requestCounts.set(key, { count: 1, resetTime: windowStart + 60000 });
    return true;
  }

  if (current.count >= MAX_REQUESTS_PER_MINUTE) {
    return false;
  }

  current.count++;
  requestCounts.set(key, current);

  for (const [k, v] of requestCounts.entries()) {
    if (now > v.resetTime) {
      requestCounts.delete(k);
    }
  }

  return true;
}

export function validateContentLength(content: string | undefined): boolean {
  return !content || content.length <= MAX_CONTENT_LENGTH;
}

export function validateScope(scope: string | undefined): boolean {
  return !scope ||
         (scope.length <= MAX_SCOPE_LENGTH &&
         !scope.includes("..") &&
         !scope.includes("/") &&
         !scope.includes("\\"));
}

export function validateTags(tags: string | undefined): boolean {
  return !tags || tags.length <= MAX_TAGS_LENGTH;
}

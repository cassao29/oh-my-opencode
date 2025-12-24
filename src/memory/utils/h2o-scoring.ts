import type { Memory } from "../storage/sqlite";

export interface H2OScore {
  memory: Memory;
  totalScore: number;
  components: {
    recency: number;
    typeWeight: number;
    accessPattern: number;
    contentRelevance: number;
    connectedness: number;
  };
}

export interface H2OScoringConfig {
  recencyWeight: number;
  typeWeight: number;
  accessWeight: number;
  relevanceWeight: number;
  connectednessWeight: number;
  recencyHalfLifeDays: number;
}

export const DEFAULT_H2O_CONFIG: H2OScoringConfig = {
  recencyWeight: 0.25,
  typeWeight: 0.20,
  accessWeight: 0.20,
  relevanceWeight: 0.20,
  connectednessWeight: 0.15,
  recencyHalfLifeDays: 7,
};

const TYPE_PRIORITIES: Record<string, number> = {
  decision: 1.0,
  blocker: 0.95,
  pattern: 0.85,
  context: 0.75,
  preference: 0.65,
  learning: 0.55,
};

const IMPORTANT_KEYWORDS = [
  "critical", "important", "must", "never", "always", "security",
  "error", "bug", "fix", "api", "database", "auth", "performance",
  "architecture", "design", "constraint", "requirement",
];

export function calculateRecencyScore(
  memory: Memory,
  halfLifeDays: number
): number {
  const ageMs = Date.now() - new Date(memory.timestamp).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  return Math.pow(0.5, ageDays / halfLifeDays);
}

export function calculateTypeScore(memory: Memory): number {
  return TYPE_PRIORITIES[memory.type] ?? 0.5;
}

export function calculateAccessScore(
  memory: Memory,
  accessCounts: Map<string, number>
): number {
  const key = `${memory.scope}:${memory.type}`;
  const accessCount = accessCounts.get(key) ?? 0;
  return Math.min(1.0, accessCount / 10);
}

export function calculateContentRelevance(
  memory: Memory,
  currentContext?: string
): number {
  const content = memory.content.toLowerCase();
  let score = 0;

  const keywordMatches = IMPORTANT_KEYWORDS.filter((kw) =>
    content.includes(kw)
  ).length;
  score += Math.min(0.5, keywordMatches * 0.1);

  if (currentContext) {
    const contextWords = new Set(
      currentContext.toLowerCase().split(/\s+/).filter((w) => w.length > 3)
    );
    const contentWords = content.split(/\s+/).filter((w) => w.length > 3);
    const overlap = contentWords.filter((w) => contextWords.has(w)).length;
    score += Math.min(0.5, overlap / 10);
  }

  return Math.min(1.0, score);
}

export function calculateConnectednessScore(
  memory: Memory,
  allMemories: Memory[]
): number {
  const scope = memory.scope;
  const sameScope = allMemories.filter((m) => m.scope === scope && m.id !== memory.id);
  return Math.min(1.0, sameScope.length / 5);
}

export function calculateH2OScore(
  memory: Memory,
  allMemories: Memory[],
  accessCounts: Map<string, number>,
  currentContext?: string,
  config: H2OScoringConfig = DEFAULT_H2O_CONFIG
): H2OScore {
  const recency = calculateRecencyScore(memory, config.recencyHalfLifeDays);
  const typeWeight = calculateTypeScore(memory);
  const accessPattern = calculateAccessScore(memory, accessCounts);
  const contentRelevance = calculateContentRelevance(memory, currentContext);
  const connectedness = calculateConnectednessScore(memory, allMemories);

  const totalScore =
    recency * config.recencyWeight +
    typeWeight * config.typeWeight +
    accessPattern * config.accessWeight +
    contentRelevance * config.relevanceWeight +
    connectedness * config.connectednessWeight;

  return {
    memory,
    totalScore,
    components: {
      recency,
      typeWeight,
      accessPattern,
      contentRelevance,
      connectedness,
    },
  };
}

export function rankMemoriesByH2O(
  memories: Memory[],
  accessCounts: Map<string, number> = new Map(),
  currentContext?: string,
  config: H2OScoringConfig = DEFAULT_H2O_CONFIG
): H2OScore[] {
  return memories
    .map((m) => calculateH2OScore(m, memories, accessCounts, currentContext, config))
    .sort((a, b) => b.totalScore - a.totalScore);
}

export function selectMemoriesToEvict(
  memories: Memory[],
  budget: number,
  accessCounts: Map<string, number> = new Map(),
  currentContext?: string,
  config: H2OScoringConfig = DEFAULT_H2O_CONFIG
): Memory[] {
  if (memories.length <= budget) return [];

  const ranked = rankMemoriesByH2O(memories, accessCounts, currentContext, config);
  const toEvict = ranked.slice(budget).map((s) => s.memory);

  return toEvict;
}

export function selectMemoriesToKeep(
  memories: Memory[],
  budget: number,
  accessCounts: Map<string, number> = new Map(),
  currentContext?: string,
  config: H2OScoringConfig = DEFAULT_H2O_CONFIG
): Memory[] {
  if (memories.length <= budget) return memories;

  const ranked = rankMemoriesByH2O(memories, accessCounts, currentContext, config);
  return ranked.slice(0, budget).map((s) => s.memory);
}

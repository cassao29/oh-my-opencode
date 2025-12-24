/**
 * Context Analytics Dashboard - Context window optimization metrics
 * Research: LITM (Liu et al. 2024), H2O (Zhang et al. 2024), Context Poisoning (dbreunig 2025)
 */

import { tool } from "@opencode-ai/plugin";
import { getStorage, type Memory } from "../../memory/storage/sqlite";
import { getHotCache } from "../../memory/storage/hot-cache";
import { rankMemoriesByH2O } from "../../memory/utils/h2o-scoring";

const AVG_CHARS_PER_TOKEN = 4;
const HOURS_24_MS = 24 * 60 * 60 * 1000;

interface ContextMetrics {
  totalMemories: number;
  totalObservations: number;
  estimatedTokens: number;
  hotCacheStats: {
    memories: number;
    observations: number;
    totalAccesses: number;
  };
  h2oDistribution: {
    high: number;
    medium: number;
    low: number;
  };
  poisoningRisk: {
    level: "low" | "medium" | "high";
    factors: string[];
  };
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / AVG_CHARS_PER_TOKEN);
}

function calculateContextMetrics(memories: Memory[]): ContextMetrics {
  const storage = getStorage();
  const stats = storage.getStats();
  const hotCache = getHotCache();
  const hotCacheStats = hotCache.getStats();

  let totalContentLength = 0;
  for (const memory of memories) {
    totalContentLength += memory.content.length;
    if (memory.tags) totalContentLength += memory.tags.length;
    if (memory.issue) totalContentLength += memory.issue.length;
  }

  const h2oScores = rankMemoriesByH2O(memories);
  const h2oDistribution = {
    high: h2oScores.filter((s) => s.totalScore > 0.7).length,
    medium: h2oScores.filter((s) => s.totalScore >= 0.4 && s.totalScore <= 0.7).length,
    low: h2oScores.filter((s) => s.totalScore < 0.4).length,
  };

  const poisoningFactors: string[] = [];
  const recentMemories = memories.filter((m) => {
    const age = Date.now() - new Date(m.timestamp).getTime();
    return age < HOURS_24_MS;
  });

  const scopeCounts = new Map<string, number>();
  for (const m of recentMemories) {
    scopeCounts.set(m.scope, (scopeCounts.get(m.scope) || 0) + 1);
  }
  const maxScopeCount = Math.max(...scopeCounts.values(), 0);
  if (maxScopeCount > 10) {
    poisoningFactors.push(`Repetitive scope pattern: ${maxScopeCount} memories in same scope`);
  }

  const errorMemories = recentMemories.filter(
    (m) => m.type === "blocker" || m.content.toLowerCase().includes("error")
  );
  if (errorMemories.length > 5) {
    poisoningFactors.push(`High error density: ${errorMemories.length} error-related memories`);
  }

  if (h2oDistribution.low > h2oDistribution.high * 2) {
    poisoningFactors.push(`Low-value memory accumulation: ${h2oDistribution.low} low-score memories`);
  }

  const poisoningLevel: "low" | "medium" | "high" =
    poisoningFactors.length === 0 ? "low" :
    poisoningFactors.length <= 2 ? "medium" : "high";

  return {
    totalMemories: stats.memories,
    totalObservations: stats.observations,
    estimatedTokens: estimateTokens(totalContentLength.toString()) + Math.ceil(totalContentLength / AVG_CHARS_PER_TOKEN),
    hotCacheStats: {
      memories: hotCacheStats.memoriesCount,
      observations: hotCacheStats.observationsCount,
      totalAccesses: hotCacheStats.totalAccessCount,
    },
    h2oDistribution,
    poisoningRisk: {
      level: poisoningLevel,
      factors: poisoningFactors,
    },
  };
}

function formatOverview(metrics: ContextMetrics): string {
  const hotCacheHitRate = metrics.hotCacheStats.totalAccesses > 0
    ? ((metrics.hotCacheStats.memories / metrics.totalMemories) * 100).toFixed(1)
    : "0.0";

  return `Context Analytics Dashboard

📊 Storage Overview
├─ Total Memories: ${metrics.totalMemories}
├─ Total Observations: ${metrics.totalObservations}
└─ Estimated Tokens: ~${metrics.estimatedTokens.toLocaleString()}

🔥 Hot Cache Status
├─ Cached Memories: ${metrics.hotCacheStats.memories}
├─ Cached Observations: ${metrics.hotCacheStats.observations}
├─ Total Accesses: ${metrics.hotCacheStats.totalAccesses}
└─ Cache Coverage: ${hotCacheHitRate}%

📈 H2O Score Distribution
├─ High (>0.7): ${metrics.h2oDistribution.high} memories
├─ Medium (0.4-0.7): ${metrics.h2oDistribution.medium} memories
└─ Low (<0.4): ${metrics.h2oDistribution.low} memories

⚠️ Context Poisoning Risk: ${metrics.poisoningRisk.level.toUpperCase()}
${metrics.poisoningRisk.factors.length > 0
  ? metrics.poisoningRisk.factors.map((f) => `└─ ${f}`).join('\n')
  : '└─ No risk factors detected'}`;
}

function formatTokenBreakdown(memories: Memory[]): string {
  const byType: Record<string, { count: number; tokens: number }> = {};

  for (const memory of memories) {
    const tokens = estimateTokens(memory.content);
    if (!byType[memory.type]) {
      byType[memory.type] = { count: 0, tokens: 0 };
    }
    byType[memory.type].count++;
    byType[memory.type].tokens += tokens;
  }

  const sorted = Object.entries(byType)
    .sort(([, a], [, b]) => b.tokens - a.tokens);

  const totalTokens = sorted.reduce((sum, [, v]) => sum + v.tokens, 0);

  return `Token Usage Breakdown by Type

${sorted
  .map(([type, stats]) => {
    const pct = ((stats.tokens / totalTokens) * 100).toFixed(1);
    return `${type}:
├─ Count: ${stats.count}
├─ Tokens: ~${stats.tokens.toLocaleString()}
└─ Share: ${pct}%`;
  })
  .join('\n\n')}

Total: ~${totalTokens.toLocaleString()} tokens`;
}

function formatH2OAnalysis(memories: Memory[]): string {
  const scores = rankMemoriesByH2O(memories);
  const topScores = scores.slice(0, 10);
  const bottomScores = scores.slice(-5).reverse();

  const avgComponents = {
    recency: 0,
    typeWeight: 0,
    accessPattern: 0,
    contentRelevance: 0,
    connectedness: 0,
  };

  for (const score of scores) {
    avgComponents.recency += score.components.recency;
    avgComponents.typeWeight += score.components.typeWeight;
    avgComponents.accessPattern += score.components.accessPattern;
    avgComponents.contentRelevance += score.components.contentRelevance;
    avgComponents.connectedness += score.components.connectedness;
  }

  const count = scores.length || 1;
  for (const key of Object.keys(avgComponents) as (keyof typeof avgComponents)[]) {
    avgComponents[key] = avgComponents[key] / count;
  }

  return `H2O Scoring Analysis

📊 Average Component Scores
├─ Recency: ${(avgComponents.recency * 100).toFixed(1)}%
├─ Type Weight: ${(avgComponents.typeWeight * 100).toFixed(1)}%
├─ Access Pattern: ${(avgComponents.accessPattern * 100).toFixed(1)}%
├─ Content Relevance: ${(avgComponents.contentRelevance * 100).toFixed(1)}%
└─ Connectedness: ${(avgComponents.connectedness * 100).toFixed(1)}%

🏆 Top 10 Highest Scoring Memories
${topScores
  .map((s, i) => `${i + 1}. [${s.totalScore.toFixed(3)}] ${s.memory.type}:${s.memory.scope.slice(0, 30)}...`)
  .join('\n')}

⚠️ Bottom 5 Lowest Scoring (Eviction Candidates)
${bottomScores
  .map((s, i) => `${i + 1}. [${s.totalScore.toFixed(3)}] ${s.memory.type}:${s.memory.scope.slice(0, 30)}...`)
  .join('\n')}`;
}

function formatRecommendations(metrics: ContextMetrics, memories: Memory[]): string {
  const recommendations: string[] = [];

  if (metrics.estimatedTokens > 50000) {
    recommendations.push(
      "🔴 HIGH: Token usage exceeds 50k. Consider running memory_cleanup with 'h2o' strategy."
    );
  } else if (metrics.estimatedTokens > 20000) {
    recommendations.push(
      "🟡 MEDIUM: Token usage is moderate (20k+). Monitor and consider periodic cleanup."
    );
  }

  const cacheRatio = metrics.hotCacheStats.memories / (metrics.totalMemories || 1);
  if (cacheRatio < 0.1) {
    recommendations.push(
      "💡 Hot cache has low coverage. Frequently accessed memories may not be cached optimally."
    );
  }

  if (metrics.h2oDistribution.low > metrics.h2oDistribution.high) {
    recommendations.push(
      `🧹 ${metrics.h2oDistribution.low} low-value memories detected. Run memory_cleanup with 'h2o' strategy to prune.`
    );
  }

  if (metrics.poisoningRisk.level === "high") {
    recommendations.push(
      "⚠️ HIGH context poisoning risk! Consider resetting session or aggressive memory cleanup."
    );
  } else if (metrics.poisoningRisk.level === "medium") {
    recommendations.push(
      "⚡ Moderate poisoning risk. Review recent memory patterns for repetition."
    );
  }

  const decisionCount = memories.filter((m) => m.type === "decision").length;
  if (decisionCount > 0) {
    recommendations.push(
      `📍 LITM: ${decisionCount} decisions found. Use memory_recall/smart_recall with litmReorder=true for optimal positioning.`
    );
  }

  if (recommendations.length === 0) {
    recommendations.push("✅ Context is well-optimized. No immediate actions needed.");
  }

  return `Context Optimization Recommendations

${recommendations.map((r, i) => `${i + 1}. ${r}`).join('\n\n')}

Quick Actions:
• Run \`memory_cleanup\` with strategy='h2o' and budget=${Math.floor(metrics.totalMemories * 0.7)} to keep top 70%
• Use \`memory_smart_recall\` with litmReorder=true for LITM-aware retrieval
• Monitor \`memory_context_analytics\` periodically for context health`;
}

function formatPoisoningDetails(metrics: ContextMetrics, memories: Memory[]): string {
  const recentMemories = memories
    .filter((m) => {
      const age = Date.now() - new Date(m.timestamp).getTime();
      return age < HOURS_24_MS;
    })
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const scopeFreq = new Map<string, number>();
  for (const m of recentMemories) {
    scopeFreq.set(m.scope, (scopeFreq.get(m.scope) || 0) + 1);
  }

  const topScopes = Array.from(scopeFreq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const typeFreq = new Map<string, number>();
  for (const m of recentMemories) {
    typeFreq.set(m.type, (typeFreq.get(m.type) || 0) + 1);
  }

  return `Context Poisoning Analysis (Last 24h)

📊 Risk Level: ${metrics.poisoningRisk.level.toUpperCase()}

🔍 Risk Factors:
${metrics.poisoningRisk.factors.length > 0
  ? metrics.poisoningRisk.factors.map((f) => `• ${f}`).join('\n')
  : '• No significant risk factors detected'}

📈 Recent Memory Distribution
├─ Total in last 24h: ${recentMemories.length}
├─ Types: ${Array.from(typeFreq.entries()).map(([t, c]) => `${t}(${c})`).join(', ')}
└─ Top Scopes:
${topScopes.map(([scope, count]) => `   • ${scope}: ${count} memories`).join('\n')}

🛡️ Mitigation Strategies:
${metrics.poisoningRisk.level === "high" ? `
• URGENT: Consider session reset or aggressive cleanup
• Run memory_cleanup with strategy='h2o' and low budget
• Review and remove repetitive/error memories manually
` : metrics.poisoningRisk.level === "medium" ? `
• Monitor for continued pattern repetition
• Consider targeted cleanup of repetitive scopes
• Use memory_prune_advice for smart suggestions
` : `
• No immediate action needed
• Continue normal operation
• Periodic monitoring recommended
`}`;
}

export const memory_context_analytics = tool({
  description: `Context Analytics Dashboard for context window optimization.
Provides metrics on token usage, hot cache status, H2O scoring distribution,
and context poisoning risk assessment. Based on LITM, H2O, and context poisoning research.`,
  args: {
    view: tool.schema
      .enum(["overview", "tokens", "h2o", "recommendations", "poisoning"])
      .default("overview")
      .describe("Analytics view: overview (default), tokens (breakdown), h2o (scoring), recommendations, or poisoning (risk details)"),
  },
  async execute(args) {
    try {
      const storage = getStorage();
      const memories = storage.getMemories({ limit: 1000 });
      const metrics = calculateContextMetrics(memories);

      switch (args.view) {
        case "overview":
          return formatOverview(metrics);
        case "tokens":
          return formatTokenBreakdown(memories);
        case "h2o":
          return formatH2OAnalysis(memories);
        case "recommendations":
          return formatRecommendations(metrics, memories);
        case "poisoning":
          return formatPoisoningDetails(metrics, memories);
        default:
          return formatOverview(metrics);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      return `Failed to generate context analytics: ${msg}`;
    }
  },
});

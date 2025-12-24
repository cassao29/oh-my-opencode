import { tool } from "@opencode-ai/plugin";
import { getStorage, type Memory } from "../../memory/storage/sqlite";

interface MemoryStats {
  memories: number;
  sessions: number;
  observations: number;
}

function generateOverview(stats: MemoryStats, memories: Memory[]): string {
  const totalMemories = memories.length;
  const avgPerSession = stats.sessions > 0 ? (totalMemories / stats.sessions).toFixed(1) : "0";

  const typeBreakdown = memories.reduce((acc, m) => {
    acc[m.type] = (acc[m.type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const scopeBreakdown = memories.reduce((acc, m) => {
    acc[m.scope] = (acc[m.scope] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return `Memory Analytics Overview:

Database Statistics:
- Total Memories: ${stats.memories}
- Total Sessions: ${stats.sessions}
- Total Observations: ${stats.observations}
- Avg Memories/Session: ${avgPerSession}

Memory Types:
${Object.entries(typeBreakdown)
  .sort(([,a], [,b]) => (b as number) - (a as number))
  .map(([type, count]) => `- ${type}: ${count} (${(((count as number)/totalMemories)*100).toFixed(1)}%)`)
  .join('\n')}

Top Scopes:
${Object.entries(scopeBreakdown)
  .sort(([,a], [,b]) => (b as number) - (a as number))
  .slice(0, 5)
  .map(([scope, count]) => `- ${scope}: ${count} memories`)
  .join('\n')}`;
}

function analyzePatterns(memories: Memory[]): string {
  const words = memories
    .flatMap(m => m.content.toLowerCase().split(/\s+/))
    .filter(word => word.length > 3);

  const wordFreq = words.reduce((acc, word) => {
    acc[word] = (acc[word] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const topWords = Object.entries(wordFreq)
    .sort(([,a], [,b]) => (b as number) - (a as number))
    .slice(0, 20)
    .filter(([, count]) => (count as number) > 1);

  return `Memory Content Patterns:

Most Frequent Terms:
${topWords.map(([word, count]) => `- "${word}": ${count} occurrences`).join('\n')}

Content Insights:
- Average memory length: ${Math.round(memories.reduce((sum, m) => sum + m.content.length, 0) / memories.length)} characters
- Memories with code: ${memories.filter(m => m.content.includes('```') || m.content.includes('function') || m.content.includes('class')).length}
- Memories with issues: ${memories.filter(m => m.issue).length}`;
}

function analyzeTimeline(memories: Memory[], days: number): string {
  const now = new Date();
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  const recentMemories = memories.filter(m => m.timestamp && new Date(m.timestamp) >= cutoff);

  return `Timeline Analysis (Last ${days} days):

Summary:
- Total memories in period: ${recentMemories.length}
- Average per day: ${(recentMemories.length / days).toFixed(1)}
- Period start: ${cutoff.toISOString().split('T')[0]}

Memory Distribution:
${['decision', 'learning', 'preference', 'blocker', 'context', 'pattern']
  .map(type => {
    const count = recentMemories.filter(m => m.type === type).length;
    const percentage = recentMemories.length > 0 ? ((count / recentMemories.length) * 100).toFixed(1) : '0';
    return `- ${type}: ${count} (${percentage}%)`;
  })
  .join('\n')}`;
}

function analyzeTypes(memories: Memory[]): string {
  const typeStats = memories.reduce((acc, m) => {
    if (!acc[m.type]) {
      acc[m.type] = {
        count: 0,
        avgLength: 0,
        scopes: new Set<string>(),
        tags: new Set<string>()
      };
    }
    const typeStat = acc[m.type];
    typeStat.count++;
    typeStat.avgLength += m.content.length;
    typeStat.scopes.add(m.scope);
    if (m.tags) m.tags.split(',').forEach((tag: string) => typeStat.tags.add(tag.trim()));
    return acc;
  }, {} as Record<string, { count: number, avgLength: number, scopes: Set<string>, tags: Set<string> }>);

  return `Memory Types Analysis:

Type Breakdown:
${Object.entries(typeStats)
  .map(([type, stats]) => {
    const avgLen = Math.round(stats.avgLength / stats.count);
    return `- ${type}: ${stats.count} memories
  - Avg length: ${avgLen} chars
  - Unique scopes: ${stats.scopes.size}
  - Tags used: ${Array.from(stats.tags).join(', ') || 'none'}`;
  })
  .join('\n\n')}`;
}

function analyzeUsage(memories: Memory[]): string {
  const sessions = [...new Set(memories.map(m => m.session_id).filter(Boolean))];
  const memoriesPerSession = sessions.length > 0 ? memories.length / sessions.length : 0;

  return `Usage Analysis:

Session Patterns:
- Unique sessions: ${sessions.length}
- Memories per session: ${memoriesPerSession.toFixed(1)}
- Sessions with memories: ${sessions.filter(s =>
    memories.some(m => m.session_id === s)).length}

Memory Lifecycle:
- Memories with tags: ${memories.filter(m => m.tags).length} (${((memories.filter(m => m.tags).length / memories.length) * 100).toFixed(1)}%)
- Memories with issues: ${memories.filter(m => m.issue).length}
- Oldest memory: ${memories.reduce((oldest, m) =>
    m.timestamp < oldest.timestamp ? m : oldest).timestamp.split('T')[0]}
- Newest memory: ${memories.reduce((newest, m) =>
    m.timestamp > newest.timestamp ? m : newest).timestamp.split('T')[0]}`;
}

function generateInsights(memories: Memory[], stats: MemoryStats): string {
  const insights = [];

  const recent = memories.filter(m => {
    const age = Date.now() - new Date(m.timestamp).getTime();
    return age < 7 * 24 * 60 * 60 * 1000;
  });
  const weeklyGrowth = recent.length;

  insights.push(`Weekly memory growth: ${weeklyGrowth} new memories`);

  const scopeActivity = memories.reduce((acc, m) => {
    acc[m.scope] = (acc[m.scope] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const topScope = Object.entries(scopeActivity).reduce((max, [scope, count]) =>
    (count as number) > ((scopeActivity[max] as number) || 0) ? scope : max, '');

  insights.push(`Most active area: "${topScope}" (${scopeActivity[topScope] || 0} memories)`);

  const withIssues = memories.filter(m => m.issue).length;
  const issueRatio = withIssues / memories.length;

  insights.push(`Issue tracking: ${withIssues} memories reference issues (${(issueRatio * 100).toFixed(1)}%)`);

  const decisionRatio = memories.filter(m => m.type === 'decision').length / memories.length;
  if (decisionRatio < 0.1) {
    insights.push(`Low decision capture: Only ${(decisionRatio * 100).toFixed(1)}% of memories are decisions`);
  }

  return `AI-Generated Insights:

${insights.map(insight => `- ${insight}`).join('\n')}

Recommendations:
- ${decisionRatio < 0.1 ? 'Consider capturing more architectural decisions' : 'Good balance of decision vs operational memories'}
- ${withIssues < memories.length * 0.1 ? 'Consider linking more memories to issues/tickets' : 'Good issue tracking coverage'}
- ${weeklyGrowth > 10 ? 'High memory growth - consider periodic cleanup' : 'Memory growth is manageable'}`;
}

export const memory_analytics = tool({
  description: "Analyze memory patterns, usage statistics, and provide insights about the project's memory",
  args: {
    analysisType: tool.schema
      .enum(["overview", "patterns", "timeline", "types", "usage", "insights"])
      .default("overview")
      .describe("Type of analysis to perform"),
    days: tool.schema
      .number()
      .min(1)
      .max(365)
      .optional()
      .default(30)
      .describe("Number of days to analyze")
  },
  async execute(args) {
    try {
      const storage = getStorage();
      const stats = storage.getStats();

      const recentMemories = storage.getMemories({
        limit: 1000,
      });

      switch (args.analysisType) {
        case "overview":
          return generateOverview(stats, recentMemories);

        case "patterns":
          return analyzePatterns(recentMemories);

        case "timeline":
          return analyzeTimeline(recentMemories, args.days ?? 30);

        case "types":
          return analyzeTypes(recentMemories);

        case "usage":
          return analyzeUsage(recentMemories);

        case "insights":
          return generateInsights(recentMemories, stats);

        default:
          return "Unknown analysis type";
      }

    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      return `Failed to perform analytics: ${msg}`;
    }
  },
});

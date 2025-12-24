import type { PluginInput } from "@opencode-ai/plugin";
import { getStorage } from "../../memory/storage/sqlite";
import { ensureMemoryDir, getMemoryDbPath, getProjectName } from "../../memory/utils/project";
import { truncateToTokens } from "../../memory/utils/tokens";

const MAX_CONTEXT_TOKENS = 2000;

export async function handleSessionStart(
  ctx: PluginInput,
  _sessionId: string
): Promise<string | null> {
  const projectPath = ctx.directory;
  
  ensureMemoryDir(projectPath);
  const dbPath = getMemoryDbPath(projectPath);
  const storage = getStorage(dbPath);
  
  storage.createSession(projectPath);
  
  const memories = storage.getRecentMemories(projectPath, {
    limit: 50,
    types: ["decision", "context", "blocker", "pattern", "preference"],
  });

  if (memories.length === 0) {
    return null;
  }

  const lastSession = storage.getLastSession(projectPath);
  
  const contextParts: string[] = [
    `## Session Context (auto-injected by memory-pro)`,
    `**Project**: ${getProjectName(projectPath)}`,
    "",
  ];

  const decisions = memories.filter(m => m.type === "decision");
  if (decisions.length > 0) {
    contextParts.push("### Recent Decisions");
    decisions.slice(0, 5).forEach(d => {
      const date = d.timestamp.split("T")[0];
      contextParts.push(`- [${date}] **${d.scope}**: ${d.content}`);
    });
    contextParts.push("");
  }

  const blockers = memories.filter(m => m.type === "blocker");
  if (blockers.length > 0) {
    contextParts.push("### Active Blockers");
    blockers.slice(0, 3).forEach(b => {
      contextParts.push(`- **${b.scope}**: ${b.content}`);
    });
    contextParts.push("");
  }

  const patterns = memories.filter(m => m.type === "pattern");
  if (patterns.length > 0) {
    contextParts.push("### Code Patterns");
    patterns.slice(0, 3).forEach(p => {
      contextParts.push(`- **${p.scope}**: ${p.content}`);
    });
    contextParts.push("");
  }

  const preferences = memories.filter(m => m.type === "preference");
  if (preferences.length > 0) {
    contextParts.push("### User Preferences");
    preferences.slice(0, 3).forEach(p => {
      contextParts.push(`- **${p.scope}**: ${p.content}`);
    });
    contextParts.push("");
  }

  if (lastSession?.summary) {
    contextParts.push("### Last Session Summary");
    contextParts.push(lastSession.summary);
    contextParts.push("");
  }

  const context = contextParts.join("\n");
  return truncateToTokens(context, MAX_CONTEXT_TOKENS);
}

export function formatContextStats(memories: number, hasLastSession: boolean): string {
  const parts = [`Loaded ${memories} memories`];
  if (hasLastSession) {
    parts.push("+ last session summary");
  }
  return parts.join(" ");
}

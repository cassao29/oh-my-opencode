import { getStorage, type ObservationType } from "../../memory/storage/sqlite";
import { getMemoryDbPath } from "../../memory/utils/project";
import { countTokens, truncateToTokens } from "../../memory/utils/tokens";
import { redactSecrets } from "../../memory/utils/privacy";
import { secureLog } from "../../memory/utils/logging";

const CAPTURED_TOOLS = new Set([
  "read",
  "write", 
  "edit",
  "bash",
  "glob",
  "grep",
  "list",
  "git",
  "lsp_hover",
  "lsp_goto_definition",
  "lsp_find_references",
]);

const IGNORED_TOOLS = new Set([
  "memory_remember",
  "memory_recall",
  "memory_smart_recall",
  "memory_search",
  "memory_update",
  "memory_forget",
  "memory_list",
  "memory_analytics",
  "memory_cleanup",
  "memory_export",
  "todoread",
  "todowrite",
]);

const LOW_RELEVANCE_PATTERNS = [
  /^ls\s+-la?\s*$/,
  /^pwd$/,
  /^echo\s+/,
  /^cat\s+.*\.lock$/i,
  /node_modules/,
  /\.git\//,
];

const HIGH_RELEVANCE_PATTERNS = [
  /error/i,
  /failed/i,
  /exception/i,
  /created?\s+file/i,
  /successfully/i,
  /migration/i,
  /schema/i,
  /config/i,
  /\.env/,
];

export interface ToolExecution {
  name: string;
  args?: Record<string, unknown>;
  output?: string;
  error?: string;
  duration?: number;
}

export interface PostToolUseOptions {
  projectPath: string;
  sessionId: string;
  maxOutputTokens?: number;
  enableCompression?: boolean;
}

function categorizeToolType(toolName: string): ObservationType {
  const name = toolName.toLowerCase();
  if (name === "read" || name === "glob" || name === "grep" || name === "list") return "read";
  if (name === "write") return "write";
  if (name === "edit") return "edit";
  if (name === "bash" || name === "git") return "bash";
  return "other";
}

function calculateRelevance(tool: ToolExecution): number {
  let score = 0.5;

  const output = tool.output ?? "";
  const args = JSON.stringify(tool.args ?? {});

  for (const pattern of LOW_RELEVANCE_PATTERNS) {
    if (pattern.test(args) || pattern.test(output)) {
      score -= 0.2;
    }
  }

  for (const pattern of HIGH_RELEVANCE_PATTERNS) {
    if (pattern.test(output)) {
      score += 0.15;
    }
  }

  if (tool.error) {
    score += 0.3;
  }

  if (tool.name === "write" || tool.name === "edit") {
    score += 0.2;
  }

  return Math.max(0, Math.min(1, score));
}

function shouldCapture(tool: ToolExecution): boolean {
  if (IGNORED_TOOLS.has(tool.name)) {
    return false;
  }

  if (CAPTURED_TOOLS.has(tool.name)) {
    return true;
  }

  if (tool.error) {
    return true;
  }

  return false;
}

function compressOutput(output: string, maxTokens: number): string {
  const tokens = countTokens(output);
  
  if (tokens <= maxTokens) {
    return output;
  }

  const truncated = truncateToTokens(output, maxTokens);
  return `${truncated}\n\n[... truncated from ${tokens} to ${maxTokens} tokens]`;
}

function extractArgsInfo(tool: ToolExecution): string | undefined {
  const args = tool.args;
  if (!args) return undefined;

  const parts: string[] = [];

  if (args.filePath) parts.push(`file: ${args.filePath}`);
  if (args.path) parts.push(`path: ${args.path}`);
  if (args.command) parts.push(`cmd: ${String(args.command).slice(0, 100)}`);
  if (args.pattern) parts.push(`pattern: ${args.pattern}`);
  if (args.query) parts.push(`query: ${args.query}`);

  if (parts.length === 0) {
    return JSON.stringify(args).slice(0, 500);
  }

  return parts.join(", ");
}

export async function handlePostToolUse(
  tool: ToolExecution,
  options: PostToolUseOptions
): Promise<void> {
  try {
    if (!shouldCapture(tool)) {
      return;
    }

    const { projectPath, sessionId, maxOutputTokens = 500 } = options;

    const relevance = calculateRelevance(tool);

    if (relevance < 0.2) {
      return;
    }

    const dbPath = getMemoryDbPath(projectPath);
    const storage = getStorage(dbPath);

    let output = tool.output ?? "";
    if (tool.error) {
      output = `ERROR: ${tool.error}\n\n${output}`;
    }

    const compressedOutput = compressOutput(output, maxOutputTokens);

    const safeOutput = redactSecrets(compressedOutput);
    const safeArgs = extractArgsInfo(tool);

    storage.saveObservation({
      session_id: sessionId,
      tool_name: tool.name,
      tool_args: safeArgs,
      compressed_output: safeOutput || undefined,
      tokens: countTokens(safeOutput),
      type: categorizeToolType(tool.name),
      relevance_score: relevance,
    });

    secureLog('info', 'Captured tool execution', { 
      tool: tool.name, 
      relevance: relevance.toFixed(2),
      tokens: countTokens(safeOutput)
    });

  } catch (err) {
    secureLog('warn', 'Failed to capture tool execution', {
      error: err instanceof Error ? err.message : 'Unknown'
    });
  }
}

export function createPostToolUseHook(projectPath: string, getSessionId: () => string | undefined) {
  return async (input: { tool: { name: string; input?: unknown }; output?: unknown; error?: unknown }) => {
    const sessionId = getSessionId();
    if (!sessionId) return;

    const tool: ToolExecution = {
      name: input.tool.name,
      args: input.tool.input as Record<string, unknown> | undefined,
      output: typeof input.output === 'string' ? input.output : JSON.stringify(input.output),
      error: input.error ? String(input.error) : undefined,
    };

    await handlePostToolUse(tool, { projectPath, sessionId });
  };
}

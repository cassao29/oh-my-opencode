import type { PluginInput } from "@opencode-ai/plugin";
import { handleSessionStart, formatContextStats } from "./session-start";
import { handleSessionEnd } from "./session-end";
import { handlePostToolUse, type ToolExecution, type PostToolUseOptions } from "./post-tool-use";
import { getStorage } from "../../memory/storage/sqlite";
import { getMemoryDbPath } from "../../memory/utils/project";
import { log } from "../../shared";

interface MemoryHooksState {
  currentSessionId?: string;
}

export function createMemoryHooks(ctx: PluginInput) {
  const state: MemoryHooksState = {};

  return {
    event: async (input: { event: { type: string; properties?: Record<string, unknown> } }) => {
      const { event } = input;
      const props = event.properties as Record<string, unknown> | undefined;

      if (event.type === "session.created") {
        const sessionInfo = props?.info as { id?: string; parentID?: string } | undefined;
        
        if (!sessionInfo?.parentID) {
          const sessionId = sessionInfo?.id ?? "";
          state.currentSessionId = sessionId;

          try {
            const context = await handleSessionStart(ctx, sessionId);
            if (context) {
              log("Memory context injected for session");
            }
          } catch (err) {
            log("Failed to handle session start:", err);
          }
        }
      }

      if (event.type === "session.deleted" || event.type === "session.ended") {
        const sessionInfo = props?.info as { id?: string } | undefined;
        const sessionId = sessionInfo?.id ?? state.currentSessionId;

        if (sessionId) {
          try {
            await handleSessionEnd(ctx.directory, sessionId);
            log("Memory session ended");
          } catch (err) {
            log("Failed to handle session end:", err);
          }
        }

        state.currentSessionId = undefined;
      }
    },

    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { title: string; output: string; metadata: unknown }
    ) => {
      const sessionId = state.currentSessionId;
      if (!sessionId) return;

      try {
        const tool: ToolExecution = {
          name: input.tool,
          output: output.output,
        };

        await handlePostToolUse(tool, {
          projectPath: ctx.directory,
          sessionId,
        });
      } catch (err) {
        log("Failed to capture tool execution:", err);
      }
    },

    "experimental.chat.system.transform": async (
      _input: Record<string, never>,
      output: { system: string[] }
    ) => {
      if (!state.currentSessionId) return;

      try {
        const context = await handleSessionStart(ctx, state.currentSessionId);
        if (context) {
          output.system.push(context);
          
          const dbPath = getMemoryDbPath(ctx.directory);
          const storage = getStorage(dbPath);
          const memories = storage.getRecentMemories(ctx.directory, { limit: 50 });
          const lastSession = storage.getLastSession(ctx.directory);
          
          log(formatContextStats(memories.length, !!lastSession?.summary));
        }
      } catch (err) {
        log("Failed to inject memory context:", err);
      }
    },

    getSessionId: () => state.currentSessionId,
    setSessionId: (id: string | undefined) => { state.currentSessionId = id; },
  };
}

export { handleSessionStart, formatContextStats } from "./session-start";
export { handleSessionEnd } from "./session-end";
export { handlePostToolUse, createPostToolUseHook } from "./post-tool-use";
export type { ToolExecution, PostToolUseOptions } from "./post-tool-use";

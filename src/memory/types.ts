export interface PluginInput {
  client: {
    session: {
      prompt: (options: {
        path: { id: string };
        body: {
          noReply?: boolean;
          parts: Array<{ type: string; text: string; synthetic?: boolean }>;
        };
      }) => Promise<void>;
    };
  };
  project: unknown;
  directory: string;
  worktree: string;
  $: unknown;
}

export interface Event {
  type: string;
  properties?: {
    info?: {
      id?: string;
    };
    sessionID?: string;
  };
}

export interface Hooks {
  event?: (input: { event: Event }) => Promise<void>;
  tool?: Record<string, unknown>;
  "experimental.chat.system.transform"?: (
    input: Record<string, never>,
    output: { system: string[] }
  ) => Promise<void>;
  "experimental.session.compacting"?: (
    input: { sessionID: string },
    output: { context: string[] }
  ) => Promise<void>;
  "tool.execute.after"?: (
    input: { tool: string; sessionID: string; callID: string },
    output: { title: string; output: string; metadata: unknown }
  ) => Promise<void>;
}

export type Plugin = (input: PluginInput) => Promise<Hooks>;

export type MemoryType = "decision" | "learning" | "preference" | "blocker" | "context" | "pattern";
export type MemorySource = "auto" | "manual" | "extracted";
export type ObservationType = "read" | "write" | "edit" | "bash" | "other";

export interface Memory {
  id: string;
  session_id?: string;
  timestamp: string;
  type: MemoryType;
  scope: string;
  content: string;
  project_path?: string;
  tags?: string;
  source: MemorySource;
  issue?: string;
}

export interface Session {
  id: string;
  project_path: string;
  started_at: string;
  ended_at?: string;
  summary?: string;
  tokens_used: number;
}

export interface Observation {
  id: string;
  session_id: string;
  timestamp: string;
  tool_name: string;
  tool_args?: string;
  compressed_output?: string;
  tokens?: number;
  type: ObservationType;
  relevance_score: number;
}

import type { PluginInput } from "@opencode-ai/plugin";
import type { ExperimentalConfig } from "../../config/schema";
import type {
  ToolAction,
  PoisoningDetectionResult,
  ContextPoisoningState,
} from "./types";
import {
  DEFAULT_POISONING_CONFIG,
  ERROR_INDICATORS,
  HALLUCINATION_INDICATORS,
  MITIGATION_COOLDOWN_MS,
} from "./constants";
import { log } from "../../shared/logger";

export interface ContextPoisoningOptions {
  experimental?: ExperimentalConfig;
}

function createState(): ContextPoisoningState {
  return {
    toolActions: new Map(),
    detectionCount: new Map(),
    lastMitigationTime: new Map(),
  };
}

function isErrorOutput(output: string): boolean {
  const lower = output.toLowerCase();
  return ERROR_INDICATORS.some((indicator) => lower.includes(indicator));
}

function isHallucination(output: string): boolean {
  const lower = output.toLowerCase();
  return HALLUCINATION_INDICATORS.some((indicator) => lower.includes(indicator));
}

function detectActionLoop(
  actions: ToolAction[],
  maxRepetitions: number,
  patternLength: number
): PoisoningDetectionResult {
  if (actions.length < patternLength * maxRepetitions) {
    return { poisoned: false, confidence: 0 };
  }

  const recentActions = actions.slice(-patternLength * (maxRepetitions + 1));
  const toolSequences: string[] = [];

  for (let i = 0; i <= recentActions.length - patternLength; i++) {
    const pattern = recentActions
      .slice(i, i + patternLength)
      .map((a) => a.tool)
      .join("->");
    toolSequences.push(pattern);
  }

  const patternCounts = new Map<string, number>();
  for (const seq of toolSequences) {
    patternCounts.set(seq, (patternCounts.get(seq) || 0) + 1);
  }

  for (const [pattern, count] of patternCounts) {
    if (count >= maxRepetitions) {
      return {
        poisoned: true,
        reason: "action_loop",
        details: `Pattern "${pattern}" repeated ${count} times`,
        confidence: Math.min(1, count / maxRepetitions),
      };
    }
  }

  return { poisoned: false, confidence: 0 };
}

function detectErrorAccumulation(
  actions: ToolAction[],
  windowSize: number,
  threshold: number
): PoisoningDetectionResult {
  const recentActions = actions.slice(-windowSize);
  if (recentActions.length < windowSize / 2) {
    return { poisoned: false, confidence: 0 };
  }

  const errorCount = recentActions.filter((a) => !a.success).length;
  const errorRatio = errorCount / recentActions.length;

  if (errorRatio >= threshold) {
    return {
      poisoned: true,
      reason: "error_accumulation",
      details: `${(errorRatio * 100).toFixed(0)}% error rate in last ${recentActions.length} actions`,
      confidence: errorRatio,
    };
  }

  return { poisoned: false, confidence: errorRatio / threshold };
}

function detectStuckPattern(actions: ToolAction[]): PoisoningDetectionResult {
  if (actions.length < 5) {
    return { poisoned: false, confidence: 0 };
  }

  const lastFive = actions.slice(-5);
  const uniqueTools = new Set(lastFive.map((a) => a.tool));

  if (uniqueTools.size === 1) {
    const tool = lastFive[0].tool;
    return {
      poisoned: true,
      reason: "stuck_pattern",
      details: `Same tool "${tool}" called 5+ times consecutively`,
      confidence: 0.9,
    };
  }

  return { poisoned: false, confidence: 0 };
}

export function createContextPoisoningDetectorHook(
  ctx: PluginInput,
  options?: ContextPoisoningOptions
) {
  const config = {
    ...DEFAULT_POISONING_CONFIG,
    enabled: options?.experimental?.context_poisoning_detection !== false,
  };

  if (!config.enabled) {
    return { "tool.execute.after": async () => {} };
  }

  const state = createState();

  const getSessionActions = (sessionID: string): ToolAction[] => {
    if (!state.toolActions.has(sessionID)) {
      state.toolActions.set(sessionID, []);
    }
    return state.toolActions.get(sessionID)!;
  };

  const detect = (sessionID: string): PoisoningDetectionResult => {
    const actions = getSessionActions(sessionID);

    const loopResult = detectActionLoop(
      actions,
      config.maxRepetitions,
      config.actionPatternLength
    );
    if (loopResult.poisoned) return loopResult;

    const errorResult = detectErrorAccumulation(
      actions,
      config.windowSize,
      config.errorThreshold
    );
    if (errorResult.poisoned) return errorResult;

    const stuckResult = detectStuckPattern(actions);
    if (stuckResult.poisoned) return stuckResult;

    return { poisoned: false, confidence: 0 };
  };

  const shouldMitigate = (sessionID: string): boolean => {
    const lastMitigation = state.lastMitigationTime.get(sessionID) || 0;
    return Date.now() - lastMitigation > MITIGATION_COOLDOWN_MS;
  };

  const toolExecuteAfter = async (
    input: { tool: string; sessionID: string; callID: string },
    output: { title: string; output: string; metadata: unknown }
  ) => {
    const { tool, sessionID } = input;
    const actions = getSessionActions(sessionID);

    const isError = isErrorOutput(output.output) || isHallucination(output.output);

    actions.push({
      tool,
      timestamp: Date.now(),
      success: !isError,
      errorMessage: isError ? output.output.slice(0, 200) : undefined,
    });

    if (actions.length > 100) {
      actions.splice(0, actions.length - 100);
    }

    const detection = detect(sessionID);

    if (detection.poisoned && shouldMitigate(sessionID)) {
      state.lastMitigationTime.set(sessionID, Date.now());
      state.detectionCount.set(
        sessionID,
        (state.detectionCount.get(sessionID) || 0) + 1
      );

      log("[context-poisoning-detector] poisoning detected", {
        sessionID,
        reason: detection.reason,
        details: detection.details,
        confidence: detection.confidence,
      });

      const warningMessage = `\n\n[CONTEXT POISONING WARNING]
Detected: ${detection.reason}
${detection.details}

RECOMMENDED ACTIONS:
1. STOP and re-evaluate your current approach
2. The current strategy is not working - try something different
3. If stuck in a loop, consider:
   - Using a different tool
   - Asking the user for clarification
   - Checking if the target exists
   - Breaking down the task differently

DO NOT continue the same pattern of actions.`;

      output.output += warningMessage;

      await ctx.client.tui
        .showToast({
          body: {
            title: "Context Poisoning Detected",
            message: `${detection.reason}: ${detection.details}`,
            variant: "warning",
            duration: 5000,
          },
        })
        .catch(() => {});
    }
  };

  const eventHandler = async ({
    event,
  }: {
    event: { type: string; properties?: unknown };
  }) => {
    const props = event.properties as Record<string, unknown> | undefined;

    if (event.type === "session.deleted") {
      const sessionInfo = props?.info as { id?: string } | undefined;
      if (sessionInfo?.id) {
        state.toolActions.delete(sessionInfo.id);
        state.detectionCount.delete(sessionInfo.id);
        state.lastMitigationTime.delete(sessionInfo.id);
      }
    }
  };

  return {
    "tool.execute.after": toolExecuteAfter,
    event: eventHandler,
  };
}

export * from "./types";
export * from "./constants";

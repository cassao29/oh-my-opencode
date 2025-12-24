import type { PluginInput } from "@opencode-ai/plugin";
import type { ExperimentalConfig } from "../../config/schema";
import type { ObservationMaskingState, ObservationRecord } from "./types";
import { DEFAULT_OBSERVATION_MASKING_CONFIG, MASKABLE_TOOLS } from "./constants";
import { log } from "../../shared/logger";

export interface ObservationMaskingOptions {
  experimental?: ExperimentalConfig;
}

function createState(): ObservationMaskingState {
  return {
    observations: new Map(),
  };
}

export function createObservationMaskingHook(
  _ctx: PluginInput,
  options?: ObservationMaskingOptions
) {
  const config = {
    ...DEFAULT_OBSERVATION_MASKING_CONFIG,
    enabled: options?.experimental?.observation_masking !== false,
  };

  if (!config.enabled) {
    return { "tool.execute.after": async () => {} };
  }

  const state = createState();

  const getSessionObservations = (sessionID: string): ObservationRecord[] => {
    if (!state.observations.has(sessionID)) {
      state.observations.set(sessionID, []);
    }
    return state.observations.get(sessionID)!;
  };

  const shouldMask = (tool: string): boolean => {
    if (config.preserveTools.includes(tool)) return false;
    return MASKABLE_TOOLS.includes(tool);
  };

  const toolExecuteAfter = async (
    input: { tool: string; sessionID: string; callID: string },
    output: { title: string; output: string; metadata: unknown }
  ) => {
    const { tool, sessionID, callID } = input;
    const observations = getSessionObservations(sessionID);

    const record: ObservationRecord = {
      callID,
      tool,
      timestamp: Date.now(),
      outputSize: output.output.length,
      masked: false,
    };

    observations.push(record);

    if (observations.length <= config.preserveRecent) return;

    const oldObservations = observations.slice(0, -config.preserveRecent);

    for (const obs of oldObservations) {
      if (obs.masked) continue;
      if (!shouldMask(obs.tool)) continue;

      const age = observations.length - observations.indexOf(obs);

      if (age > config.maxAge) {
        obs.masked = true;
        log("[observation-masking] masked old observation", {
          sessionID,
          tool: obs.tool,
          age,
          callID: obs.callID,
        });
      }
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
        state.observations.delete(sessionInfo.id);
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

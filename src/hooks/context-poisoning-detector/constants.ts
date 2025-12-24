import type { ContextPoisoningConfig } from "./types";

export const DEFAULT_POISONING_CONFIG: ContextPoisoningConfig = {
  enabled: true,
  maxRepetitions: 3,
  windowSize: 20,
  errorThreshold: 0.5,
  actionPatternLength: 3,
};

export const ERROR_INDICATORS = [
  "error",
  "failed",
  "unable",
  "cannot",
  "not found",
  "exception",
  "invalid",
  "timeout",
  "permission denied",
  "access denied",
];

export const HALLUCINATION_INDICATORS = [
  "does not exist",
  "no such file",
  "command not found",
  "undefined",
  "null reference",
  "missing",
];

export const MITIGATION_COOLDOWN_MS = 60_000;

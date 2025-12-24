export const CONTEXT_LIMIT = 200_000

export const DEFAULT_PROBABILITY_THRESHOLD = 0.80
export const PROBABILITY_THRESHOLD = 0.80

export const MIN_TOKENS_FOR_MEMORY_SAVE = 50_000

export const MEMORY_SAVE_COOLDOWN_MS = 5 * 60 * 1000

export const MAX_MEMORY_SAVE_RETRIES = 2

export const HARD_OCCUPANCY_LIMIT = 0.90
export const CRITICAL_REMAINING_TOKENS = 8_000

export const EWMA_ALPHA = 0.4

export const MIN_TURNS_FOR_GROWTH_RATIO = 2

export const DEFAULT_HORIZON = 12
export const MAX_HORIZON = 25

export const SPIKE_THRESHOLD = 5.0
export const MASSIVE_SPIKE_RATIO = 0.10

export const WEIGHT_FUTURE = 0.45
export const WEIGHT_OCCUPANCY = 0.35
export const WEIGHT_COMPLEXITY = 0.20

export const TOOL_DECAY_FACTOR = 0.7

export const MEMORY_TYPES = {
  DECISION: "decision",
  LEARNING: "learning",
  CONTEXT: "context",
  PATTERN: "pattern",
  BLOCKER: "blocker",
} as const

export const DEFAULT_MEMORY_SCOPE = "session-auto-save"

/** @deprecated Use PROBABILITY_THRESHOLD instead */
export const DEFAULT_MEMORY_SAVE_THRESHOLD = 170_000

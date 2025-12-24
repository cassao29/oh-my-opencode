/**
 * Context Exhaustion Probability Score
 *
 * Hybrid algorithm that combines:
 * 1. Token dynamics (velocity, acceleration, growth ratio)
 * 2. Occupancy-based probability
 * 3. Tool complexity patterns
 *
 * Triggers memory save when probability >= 80% or hard safety limits are hit.
 */

import type { TokenMetrics, ToolMetrics, TurnHistory, ExhaustionResult } from "./types"
import {
  CONTEXT_LIMIT,
  EWMA_ALPHA,
  PROBABILITY_THRESHOLD,
  HARD_OCCUPANCY_LIMIT,
  CRITICAL_REMAINING_TOKENS,
  SPIKE_THRESHOLD,
  MIN_TURNS_FOR_GROWTH_RATIO,
  DEFAULT_HORIZON,
  MAX_HORIZON,
  WEIGHT_FUTURE,
  WEIGHT_OCCUPANCY,
  WEIGHT_COMPLEXITY,
} from "./constants"

/**
 * Sigmoid function for smooth probability transitions
 */
function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x))
}

/**
 * Calculate EWMA (Exponentially Weighted Moving Average)
 */
function ewma(current: number, previous: number, alpha: number = EWMA_ALPHA): number {
  return alpha * current + (1 - alpha) * previous
}

/**
 * Calculate median of an array
 */
function median(values: number[]): number {
  if (values.length === 0) return 1
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * Calculate token metrics from turn history
 */
export function calculateTokenMetrics(
  currentTokens: number,
  history: TurnHistory[]
): TokenMetrics {
  const previousTokens = history.length > 0 ? history[history.length - 1].totalTokens : 0
  const delta = Math.max(0, currentTokens - previousTokens) // Clamp to handle summarization

  // Calculate EWMA velocity
  const previousVelocity = history.length > 0 ? history[history.length - 1].velocity : delta
  const velocity = ewma(delta, previousVelocity)

  // Calculate EWMA acceleration
  const previousDelta = history.length > 0 ? history[history.length - 1].delta : delta
  const accelRaw = delta - previousDelta
  const previousAccel = history.length > 0 ? history[history.length - 1].acceleration : 0
  const acceleration = ewma(accelRaw, previousAccel)

  // Calculate growth ratio (ρ) from last few turns
  let growthRatio = 1.0
  if (history.length >= MIN_TURNS_FOR_GROWTH_RATIO) {
    const ratios: number[] = []
    for (let i = 1; i < Math.min(history.length, 6); i++) {
      const current = history[history.length - i].delta + 1
      const previous = history[history.length - i - 1]?.delta ?? current
      ratios.push(current / (previous + 1))
    }
    growthRatio = median(ratios)
  }

  // Calculate spike indicator
  const spike = delta / (velocity + 1)

  // Occupancy and remaining
  const occupancy = currentTokens / CONTEXT_LIMIT
  const remaining = CONTEXT_LIMIT - currentTokens

  return {
    current: currentTokens,
    delta,
    velocity,
    acceleration,
    growthRatio,
    spike,
    occupancy,
    remaining,
  }
}

/**
 * Calculate tool-based complexity score
 */
export function calculateComplexityScore(tools: ToolMetrics): number {
  // Normalize each pressure to 0-1
  const readPressure = Math.min(tools.readBytes / 200_000, 1)
  const editPressure = Math.min(tools.editCalls / 6, 1)
  const searchPressure = Math.min(tools.searchCalls / 8, 1)
  const debugPressure = Math.min(tools.bashErrorRate, 1)
  const multifilePressure = Math.min(tools.distinctFilesEdited / 8, 1)

  // Weighted combination
  const z =
    1.2 * readPressure +
    1.0 * editPressure +
    0.8 * searchPressure +
    1.0 * debugPressure +
    0.5 * multifilePressure

  // Sigmoid to convert to probability
  return sigmoid(z - 1.5)
}

/**
 * Predict tokens that will be added over horizon H
 */
function predictFutureTokens(
  tokens: TokenMetrics,
  horizon: number
): number {
  const { velocity, acceleration, growthRatio, delta } = tokens
  const positiveAccel = Math.max(0, acceleration)

  // Linear + acceleration projection
  const addLinear = horizon * velocity + 0.5 * horizon * (horizon - 1) * positiveAccel

  // Exponential projection (only if growth ratio > 1.02)
  let addExponential: number
  if (growthRatio <= 1.02) {
    addExponential = horizon * velocity
  } else {
    addExponential = delta * (Math.pow(growthRatio, horizon) - 1) / (growthRatio - 1)
  }

  // Calculate blend weight based on how exponential it looks
  let wExp = Math.max(0, Math.min(1, (growthRatio - 1.05) / 0.20))

  // Boost exponential weight if there's a spike
  if (tokens.spike > 2.0) {
    wExp = Math.max(wExp, Math.min(1, (tokens.spike - 2.0) / 3.0))
  }

  // Blend linear and exponential predictions
  return wExp * addExponential + (1 - wExp) * addLinear
}

/**
 * Calculate future exhaustion probability
 */
function calculateFutureProbability(
  tokens: TokenMetrics,
  horizon: number
): number {
  const predicted = predictFutureTokens(tokens, horizon)
  const scale = 0.03 * CONTEXT_LIMIT // ~6000 tokens

  // Sigmoid centered on when prediction equals remaining budget
  return sigmoid((predicted - tokens.remaining) / scale)
}

/**
 * Calculate occupancy-based probability
 */
function calculateOccupancyProbability(occupancy: number): number {
  // Rises fast after 78% occupancy
  return sigmoid((occupancy - 0.78) / 0.06)
}

/**
 * Calculate dynamic horizon based on session state
 */
function calculateHorizon(
  turnCount: number,
  complexityScore: number
): number {
  const base = 8
  const complexityBonus = 10 * complexityScore
  const turnBonus = 0.1 * turnCount

  return Math.round(
    Math.max(base, Math.min(base + complexityBonus + turnBonus, MAX_HORIZON))
  )
}

/**
 * Main function: Calculate context exhaustion probability
 *
 * Returns a score from 0-100 and whether to trigger save
 */
export function calculateExhaustionProbability(
  tokens: TokenMetrics,
  tools: ToolMetrics,
  turnCount: number
): ExhaustionResult {
  // Hard safety checks first
  if (tokens.occupancy >= HARD_OCCUPANCY_LIMIT) {
    return {
      score: 100,
      shouldSave: true,
      reason: "hard_occupancy_limit",
      details: {
        occupancy: tokens.occupancy,
        remaining: tokens.remaining,
      },
    }
  }

  if (tokens.remaining <= CRITICAL_REMAINING_TOKENS) {
    return {
      score: 100,
      shouldSave: true,
      reason: "critical_remaining",
      details: {
        remaining: tokens.remaining,
      },
    }
  }

  // Spike detection - immediate save if huge injection
  if (tokens.delta > 0.10 * CONTEXT_LIMIT) {
    return {
      score: 95,
      shouldSave: true,
      reason: "massive_spike",
      details: {
        delta: tokens.delta,
        spike: tokens.spike,
      },
    }
  }

  // Calculate component probabilities
  const pComplexity = calculateComplexityScore(tools)
  const horizon = calculateHorizon(turnCount, pComplexity)
  const pFuture = calculateFutureProbability(tokens, horizon)
  const pOccupancy = calculateOccupancyProbability(tokens.occupancy)

  // Final weighted combination
  const probability =
    WEIGHT_FUTURE * pFuture +
    WEIGHT_OCCUPANCY * pOccupancy +
    WEIGHT_COMPLEXITY * pComplexity

  // Clamp to 0-1
  const clampedProbability = Math.max(0, Math.min(1, probability))
  const score = Math.round(100 * clampedProbability)

  const shouldSave = clampedProbability >= PROBABILITY_THRESHOLD

  return {
    score,
    shouldSave,
    reason: shouldSave ? "probability_threshold" : "below_threshold",
    details: {
      pFuture,
      pOccupancy,
      pComplexity,
      horizon,
      velocity: tokens.velocity,
      acceleration: tokens.acceleration,
      growthRatio: tokens.growthRatio,
      spike: tokens.spike,
      occupancy: tokens.occupancy,
      remaining: tokens.remaining,
    },
  }
}

/**
 * Create empty tool metrics
 */
export function createEmptyToolMetrics(): ToolMetrics {
  return {
    readCalls: 0,
    readBytes: 0,
    editCalls: 0,
    distinctFilesEdited: 0,
    searchCalls: 0,
    bashCalls: 0,
    bashErrors: 0,
    bashErrorRate: 0,
  }
}

/**
 * Merge tool metrics from a new turn into rolling window
 */
export function mergeToolMetrics(
  accumulated: ToolMetrics,
  newTurn: Partial<ToolMetrics>
): ToolMetrics {
  const merged: ToolMetrics = {
    readCalls: accumulated.readCalls + (newTurn.readCalls ?? 0),
    readBytes: accumulated.readBytes + (newTurn.readBytes ?? 0),
    editCalls: accumulated.editCalls + (newTurn.editCalls ?? 0),
    distinctFilesEdited: accumulated.distinctFilesEdited + (newTurn.distinctFilesEdited ?? 0),
    searchCalls: accumulated.searchCalls + (newTurn.searchCalls ?? 0),
    bashCalls: accumulated.bashCalls + (newTurn.bashCalls ?? 0),
    bashErrors: accumulated.bashErrors + (newTurn.bashErrors ?? 0),
    bashErrorRate: 0,
  }

  // Calculate error rate
  if (merged.bashCalls > 0) {
    merged.bashErrorRate = merged.bashErrors / merged.bashCalls
  }

  return merged
}

/**
 * Decay old tool metrics (for rolling window effect)
 * Applies 0.7 decay factor to simulate ~3-turn rolling window
 */
export function decayToolMetrics(metrics: ToolMetrics, factor: number = 0.7): ToolMetrics {
  return {
    readCalls: Math.floor(metrics.readCalls * factor),
    readBytes: Math.floor(metrics.readBytes * factor),
    editCalls: Math.floor(metrics.editCalls * factor),
    distinctFilesEdited: Math.floor(metrics.distinctFilesEdited * factor),
    searchCalls: Math.floor(metrics.searchCalls * factor),
    bashCalls: Math.floor(metrics.bashCalls * factor),
    bashErrors: Math.floor(metrics.bashErrors * factor),
    bashErrorRate: metrics.bashErrorRate * factor,
  }
}

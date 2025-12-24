import type { PluginInput } from "@opencode-ai/plugin"
import type {
  MemoryAutoSaveState,
  MemoryAutoSaveOptions,
  TokenInfo,
  TurnHistory,
  ToolMetrics,
  TokenMetrics,
} from "./types"
import {
  MIN_TOKENS_FOR_MEMORY_SAVE,
  MEMORY_SAVE_COOLDOWN_MS,
  TOOL_DECAY_FACTOR,
} from "./constants"
import {
  extractSessionSummary,
  extractToolMetricsFromMessage,
  hasSignificantContent,
} from "./extractor"
import {
  calculateTokenMetrics,
  calculateExhaustionProbability,
  createEmptyToolMetrics,
  mergeToolMetrics,
  decayToolMetrics,
} from "./complexity-score"
import { log } from "../../shared/logger"

interface MessageInfo {
  id: string
  role: string
  sessionID: string
  providerID?: string
  modelID?: string
  tokens?: TokenInfo
  summary?: boolean
  finish?: boolean
}

interface MessagePart {
  type?: string
  text?: string
  tool?: string
  name?: string
  input?: Record<string, unknown>
  output?: string
}

interface MessageWrapper {
  info: MessageInfo
  parts?: MessagePart[]
}

function createState(): MemoryAutoSaveState {
  return {
    lastSaveTime: new Map(),
    saveInProgress: new Set(),
    savedSessions: new Set(),
    turnHistory: new Map(),
    toolMetrics: new Map(),
    turnCount: new Map(),
  }
}

export function createMemoryAutoSaveHook(
  ctx: PluginInput,
  options?: MemoryAutoSaveOptions
) {
  const enabled = options?.enabled !== false
  const minTokens = options?.minTokens ?? MIN_TOKENS_FOR_MEMORY_SAVE
  const cooldownMs = options?.cooldownMs ?? MEMORY_SAVE_COOLDOWN_MS

  if (!enabled) {
    return { event: async () => {} }
  }

  const state = createState()

  const saveSessionMemory = async (
    sessionID: string,
    messages: MessageWrapper[],
    exhaustionScore: number
  ): Promise<boolean> => {
    if (state.saveInProgress.has(sessionID)) {
      log("[memory-auto-save] save already in progress", { sessionID })
      return false
    }

    state.saveInProgress.add(sessionID)

    try {
      const summary = extractSessionSummary(messages)

      if (!hasSignificantContent(summary)) {
        log("[memory-auto-save] no significant content to save", { sessionID })
        return false
      }

      log("[memory-auto-save] saving to Neo4j graph", {
        sessionID,
        exhaustionScore,
        decisions: summary.decisions.length,
        learnings: summary.learnings.length,
        patterns: summary.patterns.length,
        context: summary.context.length,
      })

      await ctx.client.tui
        .showToast({
          body: {
            title: "Memory Auto-Save",
            message: `Context exhaustion ${exhaustionScore}% - Saving to Neo4j...`,
            variant: "info",
            duration: 2000,
          },
        })
        .catch(() => {})

      const prompt = buildNeo4jMemoryPrompt(summary, sessionID, exhaustionScore)

      await ctx.client.session.prompt({
        path: { id: sessionID },
        body: {
          parts: [{ type: "text", text: prompt }],
        },
        query: { directory: ctx.directory },
      })

      state.lastSaveTime.set(sessionID, Date.now())
      state.savedSessions.add(sessionID)

      await ctx.client.tui
        .showToast({
          body: {
            title: "Memory Graph Updated",
            message: "Session knowledge saved to Neo4j",
            variant: "success",
            duration: 3000,
          },
        })
        .catch(() => {})

      log("[memory-auto-save] memory save requested", { sessionID })

      return true
    } catch (err) {
      log("[memory-auto-save] failed to save memory", { sessionID, error: err })
      return false
    } finally {
      state.saveInProgress.delete(sessionID)
    }
  }

  const updateMetrics = (
    sessionID: string,
    tokens: TokenInfo,
    parts: MessagePart[]
  ): { tokenMetrics: TokenMetrics; toolMetrics: ToolMetrics; turnCount: number } => {
    const totalTokens = tokens.input + tokens.cache.read + tokens.output

    const history = state.turnHistory.get(sessionID) ?? []
    const tokenMetrics = calculateTokenMetrics(totalTokens, history)

    const newTurnHistory: TurnHistory = {
      totalTokens,
      delta: tokenMetrics.delta,
      velocity: tokenMetrics.velocity,
      acceleration: tokenMetrics.acceleration,
      timestamp: Date.now(),
    }
    history.push(newTurnHistory)

    if (history.length > 10) {
      history.shift()
    }
    state.turnHistory.set(sessionID, history)

    let currentToolMetrics = state.toolMetrics.get(sessionID) ?? createEmptyToolMetrics()
    currentToolMetrics = decayToolMetrics(currentToolMetrics, TOOL_DECAY_FACTOR)

    const turnToolMetrics = extractToolMetricsFromMessage(parts)
    currentToolMetrics = mergeToolMetrics(currentToolMetrics, turnToolMetrics)
    state.toolMetrics.set(sessionID, currentToolMetrics)

    const currentTurnCount = (state.turnCount.get(sessionID) ?? 0) + 1
    state.turnCount.set(sessionID, currentTurnCount)

    return {
      tokenMetrics,
      toolMetrics: currentToolMetrics,
      turnCount: currentTurnCount,
    }
  }

  const checkAndTriggerSave = async (
    sessionID: string,
    tokens: TokenInfo,
    parts: MessagePart[]
  ): Promise<void> => {
    if (state.saveInProgress.has(sessionID)) return

    const lastSave = state.lastSaveTime.get(sessionID) ?? 0
    if (Date.now() - lastSave < cooldownMs) return

    const totalTokens = tokens.input + tokens.cache.read + tokens.output
    if (totalTokens < minTokens) return

    const { tokenMetrics, toolMetrics, turnCount } = updateMetrics(sessionID, tokens, parts)

    const result = calculateExhaustionProbability(tokenMetrics, toolMetrics, turnCount)

    log("[memory-auto-save] exhaustion check", {
      sessionID,
      score: result.score,
      shouldSave: result.shouldSave,
      reason: result.reason,
      totalTokens,
      velocity: Math.round(tokenMetrics.velocity),
      occupancy: Math.round(tokenMetrics.occupancy * 100),
    })

    if (!result.shouldSave) return

    log("[memory-auto-save] triggering save", {
      sessionID,
      score: result.score,
      reason: result.reason,
      details: result.details,
    })

    try {
      const resp = await ctx.client.session.messages({
        path: { id: sessionID },
        query: { directory: ctx.directory },
      })

      const messages = (resp.data ?? resp) as MessageWrapper[]
      await saveSessionMemory(sessionID, messages, result.score)
    } catch (err) {
      log("[memory-auto-save] failed to fetch messages", { sessionID, error: err })
    }
  }

  const cleanupSession = (sessionID: string) => {
    state.lastSaveTime.delete(sessionID)
    state.saveInProgress.delete(sessionID)
    state.savedSessions.delete(sessionID)
    state.turnHistory.delete(sessionID)
    state.toolMetrics.delete(sessionID)
    state.turnCount.delete(sessionID)
  }

  const eventHandler = async ({ event }: { event: { type: string; properties?: unknown } }) => {
    const props = event.properties as Record<string, unknown> | undefined

    if (event.type === "session.deleted") {
      const sessionInfo = props?.info as { id?: string } | undefined
      if (sessionInfo?.id) {
        cleanupSession(sessionInfo.id)
      }
      return
    }

    if (event.type === "message.updated") {
      const info = props?.info as MessageInfo | undefined
      if (!info) return

      if (info.role !== "assistant" || !info.finish) return

      const sessionID = info.sessionID
      if (!sessionID) return

      const tokens = info.tokens
      if (!tokens) return

      const parts = (props as { parts?: MessagePart[] })?.parts ?? []

      await checkAndTriggerSave(sessionID, tokens, parts)
    }
  }

  return {
    event: eventHandler,
    saveSessionMemory,
    getState: () => state,
    getExhaustionScore: (sessionID: string, tokens: TokenInfo, parts: MessagePart[]) => {
      const { tokenMetrics, toolMetrics, turnCount } = updateMetrics(sessionID, tokens, parts)
      return calculateExhaustionProbability(tokenMetrics, toolMetrics, turnCount)
    },
  }
}

interface SessionSummary {
  decisions: string[]
  learnings: string[]
  context: string[]
  patterns: string[]
  blockers: string[]
}

function buildNeo4jMemoryPrompt(
  summary: SessionSummary,
  sessionID: string,
  exhaustionScore: number
): string {
  const timestamp = new Date().toISOString()
  const parts: string[] = []

  parts.push(`[MEMORY AUTO-SAVE - NEO4J GRAPH]

Session ${sessionID} context exhaustion probability: ${exhaustionScore}%
Saving knowledge to Neo4j graph using memory_put and memory_link tools.

IMPORTANT: Execute these tool calls NOW, then continue with your previous task.
`)

  let nodeCount = 0

  if (summary.decisions.length > 0) {
    parts.push("## Decisions to Save")
    summary.decisions.forEach((decision, i) => {
      nodeCount++
      const key = `decision:session-${sessionID.slice(0, 8)}:${i + 1}`
      parts.push(`
${nodeCount}. memory_put:
   - key: "${key}"
   - value: "${escapeForPrompt(decision)}"
   - tags: ["auto-save", "decision", "session-${sessionID.slice(0, 8)}"]
   - scope: "project"`)
    })
  }

  if (summary.learnings.length > 0) {
    parts.push("\n## Learnings to Save")
    summary.learnings.forEach((learning, i) => {
      nodeCount++
      const key = `learning:session-${sessionID.slice(0, 8)}:${i + 1}`
      parts.push(`
${nodeCount}. memory_put:
   - key: "${key}"
   - value: "${escapeForPrompt(learning)}"
   - tags: ["auto-save", "learning", "session-${sessionID.slice(0, 8)}"]
   - scope: "project"`)
    })
  }

  if (summary.patterns.length > 0) {
    parts.push("\n## Patterns to Save")
    summary.patterns.forEach((pattern, i) => {
      nodeCount++
      const key = `pattern:session-${sessionID.slice(0, 8)}:${i + 1}`
      parts.push(`
${nodeCount}. memory_put:
   - key: "${key}"
   - value: "${escapeForPrompt(pattern)}"
   - tags: ["auto-save", "pattern", "session-${sessionID.slice(0, 8)}"]
   - scope: "project"`)
    })
  }

  if (summary.context.length > 0) {
    parts.push("\n## Context to Save")
    summary.context.forEach((ctx, i) => {
      nodeCount++
      const key = `context:session-${sessionID.slice(0, 8)}:${i + 1}`
      parts.push(`
${nodeCount}. memory_put:
   - key: "${key}"
   - value: "${escapeForPrompt(ctx)}"
   - tags: ["auto-save", "context", "session-${sessionID.slice(0, 8)}"]
   - scope: "project"`)
    })
  }

  if (summary.blockers.length > 0) {
    parts.push("\n## Blockers to Save")
    summary.blockers.forEach((blocker, i) => {
      nodeCount++
      const key = `blocker:session-${sessionID.slice(0, 8)}:${i + 1}`
      parts.push(`
${nodeCount}. memory_put:
   - key: "${key}"
   - value: "${escapeForPrompt(blocker)}"
   - tags: ["auto-save", "blocker", "session-${sessionID.slice(0, 8)}"]
   - scope: "project"`)
    })
  }

  if (nodeCount > 1) {
    parts.push(`

## Relationships to Create
After saving all nodes, link related memories:`)

    if (summary.decisions.length > 0 && summary.learnings.length > 0) {
      parts.push(`
- memory_link:
  - fromKey: "decision:session-${sessionID.slice(0, 8)}:1"
  - toKey: "learning:session-${sessionID.slice(0, 8)}:1"
  - relation: "informed_by"`)
    }

    if (summary.decisions.length > 0 && summary.blockers.length > 0) {
      parts.push(`
- memory_link:
  - fromKey: "decision:session-${sessionID.slice(0, 8)}:1"
  - toKey: "blocker:session-${sessionID.slice(0, 8)}:1"
  - relation: "addresses"`)
    }
  }

  parts.push(`

---
Auto-saved at: ${timestamp}
Exhaustion score: ${exhaustionScore}%
Total nodes: ${nodeCount}

Execute memory_put for each item above, then resume your previous task.`)

  return parts.join("\n")
}

function escapeForPrompt(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, " ")
    .slice(0, 500)
}

export type { MemoryAutoSaveState, MemoryAutoSaveOptions } from "./types"

export interface MemoryAutoSaveState {
  lastSaveTime: Map<string, number>
  saveInProgress: Set<string>
  savedSessions: Set<string>
  turnHistory: Map<string, TurnHistory[]>
  toolMetrics: Map<string, ToolMetrics>
  turnCount: Map<string, number>
}

export interface TokenInfo {
  input: number
  output: number
  reasoning: number
  cache: { read: number; write: number }
}

export interface TokenMetrics {
  current: number
  delta: number
  velocity: number
  acceleration: number
  growthRatio: number
  spike: number
  occupancy: number
  remaining: number
}

export interface ToolMetrics {
  readCalls: number
  readBytes: number
  editCalls: number
  distinctFilesEdited: number
  searchCalls: number
  bashCalls: number
  bashErrors: number
  bashErrorRate: number
}

export interface TurnHistory {
  totalTokens: number
  delta: number
  velocity: number
  acceleration: number
  timestamp: number
}

export interface ExhaustionResult {
  score: number
  shouldSave: boolean
  reason: string
  details: Record<string, number>
}

export interface MemoryEntry {
  type: string
  scope: string
  content: string
  tags?: string
  sessionID?: string
}

export interface SessionSummary {
  decisions: string[]
  learnings: string[]
  context: string[]
  patterns: string[]
  blockers: string[]
}

export interface MemoryAutoSaveOptions {
  enabled?: boolean
  probabilityThreshold?: number
  minTokens?: number
  cooldownMs?: number
  useHybridDetection?: boolean
}

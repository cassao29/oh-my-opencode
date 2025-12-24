import type { SessionSummary, ToolMetrics } from "./types"

interface MessagePart {
  type?: string
  text?: string
  tool?: string
  name?: string
  input?: Record<string, unknown>
  output?: string
}

interface MessageWrapper {
  info: {
    role: string
    sessionID?: string
  }
  parts?: MessagePart[]
}

const DECISION_PATTERNS = [
  /decided to/i,
  /choosing/i,
  /will use/i,
  /going with/i,
  /architecture:/i,
  /design decision/i,
  /approach:/i,
  /selected/i,
  /opted for/i,
  /strategy:/i,
]

const LEARNING_PATTERNS = [
  /learned that/i,
  /discovered/i,
  /found out/i,
  /realized/i,
  /important:/i,
  /note:/i,
  /issue:/i,
  /bug:/i,
  /fixed/i,
  /the problem was/i,
  /root cause/i,
  /turns out/i,
]

const PATTERN_PATTERNS = [
  /pattern:/i,
  /best practice/i,
  /convention/i,
  /standard/i,
  /always/i,
  /never/i,
  /should/i,
  /must/i,
  /recommended/i,
]

const BLOCKER_PATTERNS = [
  /blocked by/i,
  /waiting for/i,
  /cannot/i,
  /failed/i,
  /error:/i,
  /problem:/i,
  /issue:/i,
  /doesn't work/i,
  /not working/i,
  /stuck on/i,
]

function matchesAnyPattern(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text))
}

function extractKeyInfo(text: string, maxLength: number = 400): string {
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 15)

  const prioritySentences = sentences.filter((s) =>
    /because|due to|since|therefore|so that|in order to|decided|chose|using|implemented/i.test(s)
  )

  const relevantSentences = prioritySentences.length > 0 ? prioritySentences : sentences

  let result = ""
  for (const sentence of relevantSentences.slice(0, 3)) {
    if (result.length + sentence.length > maxLength) break
    result += sentence.trim() + ". "
  }

  return result.trim() || text.slice(0, maxLength)
}

function extractEntities(text: string): string[] {
  const entities: string[] = []

  const filePattern =
    /(?:file|in|from|to|editing|created?|modified?|updated?)\s+[`'"]*([a-zA-Z0-9_\-./]+\.[a-zA-Z]{2,6})[`'"]*|([a-zA-Z0-9_\-./]+\.[a-zA-Z]{2,6})/gi
  let match
  while ((match = filePattern.exec(text)) !== null) {
    const file = match[1] || match[2]
    if (file && !entities.includes(file)) {
      entities.push(file)
    }
  }

  const techPattern =
    /\b(React|Vue|Angular|Next\.?js|PostgreSQL|MySQL|Redis|Neo4j|MongoDB|Docker|Kubernetes|AWS|GCP|Azure|TypeScript|JavaScript|Python|Rust|Go)\b/gi
  while ((match = techPattern.exec(text)) !== null) {
    const tech = match[1]
    if (tech && !entities.includes(tech.toLowerCase())) {
      entities.push(tech.toLowerCase())
    }
  }

  return entities.slice(0, 5)
}

export function extractSessionSummary(messages: MessageWrapper[]): SessionSummary {
  const summary: SessionSummary = {
    decisions: [],
    learnings: [],
    context: [],
    patterns: [],
    blockers: [],
  }

  const seenContent = new Set<string>()
  const allEntities: string[] = []

  for (const msg of messages) {
    if (msg.info.role !== "assistant") continue

    const parts = msg.parts ?? []
    for (const part of parts) {
      if (part.type !== "text" || !part.text) continue

      const text = part.text
      const contentKey = text.slice(0, 80).toLowerCase()

      if (seenContent.has(contentKey)) continue
      seenContent.add(contentKey)

      const entities = extractEntities(text)
      allEntities.push(...entities)

      if (matchesAnyPattern(text, DECISION_PATTERNS)) {
        const content = extractKeyInfo(text)
        if (content && summary.decisions.length < 5) {
          const entitySuffix = entities.length > 0 ? ` [entities: ${entities.join(", ")}]` : ""
          summary.decisions.push(content + entitySuffix)
        }
      }

      if (matchesAnyPattern(text, LEARNING_PATTERNS)) {
        const content = extractKeyInfo(text)
        if (content && summary.learnings.length < 5) {
          summary.learnings.push(content)
        }
      }

      if (matchesAnyPattern(text, PATTERN_PATTERNS)) {
        const content = extractKeyInfo(text)
        if (content && summary.patterns.length < 3) {
          summary.patterns.push(content)
        }
      }

      if (matchesAnyPattern(text, BLOCKER_PATTERNS)) {
        const content = extractKeyInfo(text)
        if (content && summary.blockers.length < 3) {
          summary.blockers.push(content)
        }
      }
    }

    for (const part of parts) {
      if (part.type !== "tool_use" && !part.tool) continue

      const toolName = part.tool || part.name
      const toolInput = part.input

      if (toolName === "todowrite" && toolInput?.todos) {
        const todos = toolInput.todos as Array<{ content?: string; status?: string }>
        const activeTodos = todos
          .filter((t) => t.status !== "completed" && t.status !== "cancelled")
          .map((t) => t.content)
          .filter(Boolean)

        if (activeTodos.length > 0 && summary.context.length < 3) {
          summary.context.push(`Active tasks: ${activeTodos.slice(0, 3).join("; ")}`)
        }
      }

      if ((toolName === "memory_put" || toolName === "memory_remember") && toolInput) {
        const content = (toolInput.content as string) || (toolInput.value as string)
        if (content && summary.context.length < 5) {
          summary.context.push(`[saved] ${content.slice(0, 150)}`)
        }
      }

      if (toolName === "edit" && toolInput?.filePath) {
        const file = toolInput.filePath as string
        if (!allEntities.includes(file)) {
          allEntities.push(file)
        }
      }
    }
  }

  const uniqueEntities = [...new Set(allEntities)].slice(0, 10)
  if (uniqueEntities.length > 0 && summary.context.length < 5) {
    summary.context.push(`Key files/tech: ${uniqueEntities.join(", ")}`)
  }

  return summary
}

export function extractToolMetricsFromMessage(parts: MessagePart[]): Partial<ToolMetrics> {
  const metrics: Partial<ToolMetrics> = {
    readCalls: 0,
    readBytes: 0,
    editCalls: 0,
    distinctFilesEdited: 0,
    searchCalls: 0,
    bashCalls: 0,
    bashErrors: 0,
  }

  const editedFiles = new Set<string>()

  for (const part of parts) {
    if (part.type !== "tool_use" && !part.tool) continue

    const toolName = part.tool || part.name
    const toolInput = part.input
    const toolOutput = part.output

    switch (toolName) {
      case "read":
        metrics.readCalls = (metrics.readCalls ?? 0) + 1
        if (toolOutput) {
          metrics.readBytes = (metrics.readBytes ?? 0) + toolOutput.length
        }
        break

      case "edit":
      case "write":
        metrics.editCalls = (metrics.editCalls ?? 0) + 1
        if (toolInput?.filePath) {
          editedFiles.add(toolInput.filePath as string)
        }
        break

      case "grep":
      case "glob":
      case "ast_grep_search":
      case "lsp_find_references":
      case "lsp_workspace_symbols":
        metrics.searchCalls = (metrics.searchCalls ?? 0) + 1
        break

      case "bash":
        metrics.bashCalls = (metrics.bashCalls ?? 0) + 1
        if (toolOutput && /error|failed|exit code [1-9]/i.test(toolOutput)) {
          metrics.bashErrors = (metrics.bashErrors ?? 0) + 1
        }
        break
    }
  }

  metrics.distinctFilesEdited = editedFiles.size

  return metrics
}

export function formatSummaryForMemory(summary: SessionSummary, sessionID: string): string {
  const parts: string[] = []

  parts.push(`Session: ${sessionID}`)
  parts.push(`Saved at: ${new Date().toISOString()}`)
  parts.push("")

  if (summary.decisions.length > 0) {
    parts.push("## Decisions")
    summary.decisions.forEach((d, i) => parts.push(`${i + 1}. ${d}`))
    parts.push("")
  }

  if (summary.learnings.length > 0) {
    parts.push("## Learnings")
    summary.learnings.forEach((l, i) => parts.push(`${i + 1}. ${l}`))
    parts.push("")
  }

  if (summary.patterns.length > 0) {
    parts.push("## Patterns")
    summary.patterns.forEach((p, i) => parts.push(`${i + 1}. ${p}`))
    parts.push("")
  }

  if (summary.blockers.length > 0) {
    parts.push("## Blockers")
    summary.blockers.forEach((b, i) => parts.push(`${i + 1}. ${b}`))
    parts.push("")
  }

  if (summary.context.length > 0) {
    parts.push("## Context")
    summary.context.forEach((c, i) => parts.push(`${i + 1}. ${c}`))
  }

  return parts.join("\n")
}

export function hasSignificantContent(summary: SessionSummary): boolean {
  const totalItems =
    summary.decisions.length +
    summary.learnings.length +
    summary.patterns.length +
    summary.blockers.length +
    summary.context.length

  return totalItems >= 2
}

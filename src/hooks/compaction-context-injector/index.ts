import type { SummarizeContext } from "../preemptive-compaction"
import { injectHookMessage } from "../../features/hook-message-injector"
import { log } from "../../shared/logger"

const SUMMARIZE_CONTEXT_PROMPT = `[COMPACTION CONTEXT INJECTION - LITM-AWARE STRUCTURE]

IMPORTANT: LLMs have reduced accuracy for information in the MIDDLE of context.
Structure your summary to place CRITICAL information at START and END.

## SECTION 1 - START (Highest Attention)
### Critical Constraints (MUST NOT)
- Things explicitly forbidden by user
- Approaches that FAILED - do not retry
- User's explicit restrictions
- Security/safety requirements

### Current Active Task
- What you are currently working on
- Immediate next step required

## SECTION 2 - MIDDLE (Background Context)
### Work Completed
- Files created/modified
- Features implemented
- Problems solved

### Historical Decisions
- Key decisions made during session
- Rationale for architectural choices

## SECTION 3 - END (High Attention)
### User's Original Intent
- Original request (verbatim if possible)
- Ultimate goal/deliverable

### Remaining Tasks (In Priority Order)
1. [Highest priority task]
2. [Next priority task]
...

### Critical Reminders
- Repeat any MUST NOT constraints
- Key learnings that must not be forgotten

This LITM-aware structure ensures critical information is at context edges.
`

export function createCompactionContextInjector() {
  return async (ctx: SummarizeContext): Promise<void> => {
    log("[compaction-context-injector] injecting context", { sessionID: ctx.sessionID })

    const success = injectHookMessage(ctx.sessionID, SUMMARIZE_CONTEXT_PROMPT, {
      agent: "general",
      model: { providerID: ctx.providerID, modelID: ctx.modelID },
      path: { cwd: ctx.directory },
    })

    if (success) {
      log("[compaction-context-injector] context injected", { sessionID: ctx.sessionID })
    } else {
      log("[compaction-context-injector] injection failed", { sessionID: ctx.sessionID })
    }
  }
}

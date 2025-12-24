export interface ToolAction {
  tool: string;
  timestamp: number;
  success: boolean;
  errorMessage?: string;
}

export interface PoisoningDetectionResult {
  poisoned: boolean;
  reason?: "action_loop" | "error_accumulation" | "hallucination_loop" | "stuck_pattern";
  details?: string;
  confidence: number;
}

export interface ContextPoisoningConfig {
  enabled: boolean;
  maxRepetitions: number;
  windowSize: number;
  errorThreshold: number;
  actionPatternLength: number;
}

export interface ContextPoisoningState {
  toolActions: Map<string, ToolAction[]>;
  detectionCount: Map<string, number>;
  lastMitigationTime: Map<string, number>;
}

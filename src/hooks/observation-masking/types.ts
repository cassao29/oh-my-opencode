export interface ObservationRecord {
  callID: string;
  tool: string;
  timestamp: number;
  outputSize: number;
  masked: boolean;
}

export interface ObservationMaskingConfig {
  enabled: boolean;
  maxAge: number;
  preserveRecent: number;
  preserveTools: string[];
  maskPlaceholder: string;
}

export interface ObservationMaskingState {
  observations: Map<string, ObservationRecord[]>;
}

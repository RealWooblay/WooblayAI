export type RunEventType =
  | 'state_change'
  | 'tool_call'
  | 'evidence'
  | 'approval'
  | 'error'
  | 'budget';

export interface RunEvent {
  id: string;
  runId: string;
  type: RunEventType;
  data: Record<string, unknown>;
  timestamp: string;
  sequenceNum: number;
}

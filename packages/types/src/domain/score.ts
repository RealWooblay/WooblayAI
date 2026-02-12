export enum ScoreLabel {
  SUCCESS = 'SUCCESS',
  FAIL = 'FAIL',
  NEEDS_HUMAN = 'NEEDS_HUMAN',
  REGRESSION = 'REGRESSION',
}

export interface Score {
  id: string;
  taskId: string;
  agentPubkey: string;
  label: ScoreLabel;
  cost: number | null;
  duration: number | null;
  notes: string | null;
  createdAt: string;
}

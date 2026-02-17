/** Rollback engine types. */

export type RollbackType = 'rollback:pr_revert' | 'rollback:capability_revoke' | 'rollback:config_revert';

export interface RollbackInput {
  originalProposalId: string;
  runId: string;
  type: RollbackType;
  reason: string;
  compensatingParams?: Record<string, unknown>;
}

export interface RollbackResult {
  rollbackProposalId: string;
  status: 'pending' | 'auto_executed';
}

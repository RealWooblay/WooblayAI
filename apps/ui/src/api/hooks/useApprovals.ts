import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getApprovals, approveApproval, denyApproval } from '../client.ts';
import type { ApprovalDecisionRequest } from '@wooblay/types';

export function useApprovals() {
  return useQuery({
    queryKey: ['approvals', 'pending'],
    queryFn: getApprovals,
    refetchInterval: 5_000,
  });
}

export function useApproveApproval() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ApprovalDecisionRequest }) =>
      approveApproval(id, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['approvals'] });
    },
  });
}

export function useDenyApproval() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ApprovalDecisionRequest }) =>
      denyApproval(id, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['approvals'] });
    },
  });
}

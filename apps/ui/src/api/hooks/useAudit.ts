import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getAuditLog,
  getAuditFlags,
  dismissFlag,
  runAnalysis,
} from '../client.ts';
import type { AuditLogFilters, AuditFlagFilters } from '../client.ts';

export function useAuditLog(filters: AuditLogFilters = {}) {
  return useQuery({
    queryKey: ['audit', 'log', filters],
    queryFn: () => getAuditLog(filters),
    refetchInterval: 10_000,
  });
}

export function useAuditFlags(filters: AuditFlagFilters = {}) {
  return useQuery({
    queryKey: ['audit', 'flags', filters],
    queryFn: () => getAuditFlags(filters),
    refetchInterval: 15_000,
  });
}

export function useDismissFlag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => dismissFlag(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['audit', 'flags'] });
    },
  });
}

export function useRunAnalysis() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => runAnalysis(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['audit', 'flags'] });
    },
  });
}

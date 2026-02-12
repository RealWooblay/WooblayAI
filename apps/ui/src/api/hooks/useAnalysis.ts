import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getTaskAnalysis,
  getAgentInsights,
  getAgentLineage,
  recomputeAnalysis,
  getCanaries,
  createCanary,
  deleteCanary,
  overrideTrust,
} from '../client.ts';
import type { TrustOverrideRequest, CreateCanaryRequest } from '@wooblay/types';

export function useTaskAnalysis(taskId: string | undefined) {
  return useQuery({
    queryKey: ['analysis', 'task', taskId],
    queryFn: () => getTaskAnalysis(taskId!),
    enabled: !!taskId,
    refetchInterval: 15_000,
  });
}

export function useAgentInsights(pubkey: string | undefined) {
  return useQuery({
    queryKey: ['analysis', 'insights', pubkey],
    queryFn: () => getAgentInsights(pubkey!),
    enabled: !!pubkey,
    refetchInterval: 30_000,
  });
}

export function useAgentLineage(pubkey: string | undefined) {
  return useQuery({
    queryKey: ['analysis', 'lineage', pubkey],
    queryFn: () => getAgentLineage(pubkey!),
    enabled: !!pubkey,
  });
}

export function useRecomputeAnalysis() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) => recomputeAnalysis(taskId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['analysis'] });
    },
  });
}

export function useCanaries() {
  return useQuery({
    queryKey: ['canaries'],
    queryFn: getCanaries,
  });
}

export function useCreateCanary() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateCanaryRequest) => createCanary(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['canaries'] });
    },
  });
}

export function useDeleteCanary() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteCanary(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['canaries'] });
    },
  });
}

export function useOverrideTrust() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ pubkey, body }: { pubkey: string; body: TrustOverrideRequest }) =>
      overrideTrust(pubkey, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['agents'] });
      void qc.invalidateQueries({ queryKey: ['analysis'] });
    },
  });
}

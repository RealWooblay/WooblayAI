/**
 * TanStack Query hooks for the GitHub attribution API.
 */

import { useQuery } from '@tanstack/react-query';
import { fetchApi } from '../client.ts';
import type {
  GitHubPRAttributionResponse,
  GitHubAgentStats,
  GitHubOrgOverview,
  GitHubPRListResponse,
  GitHubPRListFilters,
} from '@wooblay/types';

// ── Query key factory ────────────────────────────────────────────────────────

export const githubKeys = {
  all: ['github'] as const,
  prs: (filters?: GitHubPRListFilters) => [...githubKeys.all, 'prs', filters] as const,
  attribution: (repoId: string, prNumber: number) =>
    [...githubKeys.all, 'attribution', repoId, prNumber] as const,
  agentStats: (pubkey: string) => [...githubKeys.all, 'agent-stats', pubkey] as const,
  orgOverview: (installationId: string) =>
    [...githubKeys.all, 'org-overview', installationId] as const,
};

// ── API functions ────────────────────────────────────────────────────────────

function toQueryString(params: Record<string, string | number | boolean | undefined>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== '');
  if (!entries.length) return '';
  return '?' + entries.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
}

export function getGitHubPRs(filters: GitHubPRListFilters = {}) {
  return fetchApi<GitHubPRListResponse>(
    `/api/github/prs${toQueryString(filters as Record<string, string | number | boolean | undefined>)}`,
  );
}

export function getGitHubAttribution(repoId: string, prNumber: number) {
  return fetchApi<GitHubPRAttributionResponse>(
    `/api/github/repos/${repoId}/prs/${prNumber}/attribution`,
  );
}

export function getAgentGitHubStats(pubkey: string) {
  return fetchApi<GitHubAgentStats>(`/api/github/agents/${pubkey}/stats`);
}

export function getGitHubOverview(installationId: string) {
  return fetchApi<GitHubOrgOverview>(`/api/github/orgs/${installationId}/overview`);
}

// ── Hooks ────────────────────────────────────────────────────────────────────

export function useGitHubPRs(filters: GitHubPRListFilters = {}) {
  return useQuery({
    queryKey: githubKeys.prs(filters),
    queryFn: () => getGitHubPRs(filters),
    staleTime: 10_000,
  });
}

export function useGitHubAttribution(repoId: string, prNumber: number) {
  return useQuery({
    queryKey: githubKeys.attribution(repoId, prNumber),
    queryFn: () => getGitHubAttribution(repoId, prNumber),
    staleTime: 10_000,
    enabled: !!repoId && prNumber > 0,
  });
}

export function useAgentGitHubStats(pubkey: string) {
  return useQuery({
    queryKey: githubKeys.agentStats(pubkey),
    queryFn: () => getAgentGitHubStats(pubkey),
    staleTime: 10_000,
    enabled: !!pubkey,
  });
}

export function useGitHubOverview(installationId: string) {
  return useQuery({
    queryKey: githubKeys.orgOverview(installationId),
    queryFn: () => getGitHubOverview(installationId),
    staleTime: 10_000,
    enabled: !!installationId,
  });
}

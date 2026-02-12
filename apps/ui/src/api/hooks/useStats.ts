import { useQuery } from '@tanstack/react-query';
import { getStats, getSuggestions } from '../client.ts';

export function useStats() {
  return useQuery({
    queryKey: ['stats'],
    queryFn: getStats,
    refetchInterval: 15_000,
  });
}

export function useSuggestions() {
  return useQuery({
    queryKey: ['stats', 'suggestions'],
    queryFn: getSuggestions,
  });
}

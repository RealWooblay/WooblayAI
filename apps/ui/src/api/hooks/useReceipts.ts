import { useQuery } from '@tanstack/react-query';
import { getReceipt, verifyReceipt } from '../client.ts';

export function useReceipt(hash: string | undefined) {
  return useQuery({
    queryKey: ['receipt', hash],
    queryFn: () => getReceipt(hash!),
    enabled: !!hash,
  });
}

export function useVerifyReceipt(hash: string | undefined) {
  return useQuery({
    queryKey: ['receipt', hash, 'verify'],
    queryFn: () => verifyReceipt(hash!),
    enabled: !!hash,
  });
}

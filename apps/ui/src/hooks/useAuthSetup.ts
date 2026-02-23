/**
 * Connects Clerk's auth token to the API client.
 * Call once at the top level of the app.
 *
 * Sets the token function SYNCHRONOUSLY (not in useEffect) so it's
 * available before any API query fires on the same render cycle.
 */

import { useAuth } from '@clerk/clerk-react';
import { setGetTokenFn, setGetTokenFreshFn } from '../api/client.ts';

export function useAuthSetup() {
  const { getToken } = useAuth();

  // Normal path — uses Clerk's built-in caching
  setGetTokenFn(async () => {
    const token = await getToken();
    if (token) return token;
    // Clerk returned null — force fresh
    return getToken({ skipCache: true });
  });

  // Retry path — always bypass Clerk's internal cache (used on 401 retry)
  setGetTokenFreshFn(async () => {
    return getToken({ skipCache: true });
  });
}

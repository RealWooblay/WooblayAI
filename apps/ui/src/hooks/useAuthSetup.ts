/**
 * Connects Clerk's auth token to the API client.
 * Call once at the top level of the app.
 *
 * Sets the token function SYNCHRONOUSLY (not in useEffect) so it's
 * available before any API query fires on the same render cycle.
 */

import { useAuth } from '@clerk/clerk-react';
import { setGetTokenFn } from '../api/client.ts';

export function useAuthSetup() {
  const { getToken } = useAuth();
  // Must be synchronous — useEffect would run AFTER the first render,
  // causing API calls to fire without the token.
  setGetTokenFn(() => getToken());
}

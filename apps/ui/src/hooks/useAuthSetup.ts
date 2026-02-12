/**
 * Connects Clerk's auth token to the API client.
 * Call once at the top level of the app.
 */

import { useEffect } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { setGetTokenFn } from '../api/client.ts';

export function useAuthSetup() {
  const { getToken } = useAuth();

  useEffect(() => {
    setGetTokenFn(() => getToken());
  }, [getToken]);
}

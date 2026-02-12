/**
 * Octokit factory for GitHub App authentication.
 *
 * Creates authenticated Octokit instances using GitHub App JWT auth,
 * with installation access token caching and automatic refresh.
 */

import { Octokit } from 'octokit';
import { createAppAuth } from '@octokit/auth-app';

// ── Types ────────────────────────────────────────────────────────────────────

export interface GitHubAppConfig {
  appId: string;
  privateKey: string;
  webhookSecret: string;
}

interface CachedToken {
  token: string;
  expiresAt: number; // epoch ms
}

// ── Token cache ──────────────────────────────────────────────────────────────

const tokenCache = new Map<number, CachedToken>();

/** Minimum remaining lifetime before refreshing (5 minutes). */
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

// ── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create an Octokit instance authenticated as the GitHub App itself (JWT).
 * Use this for app-level operations like listing installations.
 */
export function createAppOctokit(config: GitHubAppConfig): Octokit {
  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: config.appId,
      privateKey: config.privateKey,
    },
  });
}

/**
 * Create an Octokit instance authenticated as a specific installation.
 * Caches and refreshes installation tokens automatically.
 */
export async function createInstallationOctokit(
  config: GitHubAppConfig,
  installationId: number,
): Promise<Octokit> {
  const cached = tokenCache.get(installationId);
  const now = Date.now();

  if (cached && cached.expiresAt - now > REFRESH_BUFFER_MS) {
    return new Octokit({ auth: cached.token });
  }

  // Fetch a new installation access token
  const appOctokit = createAppOctokit(config);
  const { data } = await appOctokit.rest.apps.createInstallationAccessToken({
    installation_id: installationId,
  });

  const expiresAt = new Date(data.expires_at).getTime();
  tokenCache.set(installationId, { token: data.token, expiresAt });

  return new Octokit({ auth: data.token });
}

/**
 * Invalidate a cached installation token (e.g. on uninstall).
 */
export function evictInstallationToken(installationId: number): void {
  tokenCache.delete(installationId);
}

/**
 * Clear all cached tokens (for testing or shutdown).
 */
export function clearTokenCache(): void {
  tokenCache.clear();
}

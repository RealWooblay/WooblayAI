/**
 * GitHub App Installation Token Service.
 *
 * Mints short-lived (~1hr) installation tokens via the GitHub App API.
 * These replace PATs: the agent never holds credentials, and tokens
 * are scoped to specific repos in the installation's allowlist.
 *
 * Flow:
 * 1. Connection stores githubInstallationId + app private key ref
 * 2. On demand, JWT is signed with the app private key
 * 3. JWT is exchanged for an installation token scoped to repos
 * 4. Token is cached until near-expiry
 * 5. Expired tokens are automatically refreshed
 */

import { createSign } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';

// ── Token Cache ─────────────────────────────────────────────────────────

interface CachedToken {
  token: string;
  expiresAt: Date;
  repos: string[];
}

const tokenCache = new Map<string, CachedToken>();

// ── JWT Creation (for GitHub App auth) ──────────────────────────────────

function createAppJWT(appId: number, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iat: now - 60, // Allow clock drift
    exp: now + 600, // 10 min max for GitHub App JWTs
    iss: appId,
  };

  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const unsigned = `${header}.${body}`;

  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  const signature = signer.sign(privateKey, 'base64url');

  return `${unsigned}.${signature}`;
}

// ── Installation Token Minting ──────────────────────────────────────────

export async function mintInstallationToken(
  prisma: PrismaClient,
  connectionId: string,
  requestedRepos?: string[],
): Promise<{ token: string; expiresAt: Date; repos: string[] }> {
  const connection = await prisma.connection.findUnique({ where: { id: connectionId } });
  if (!connection) throw new Error('Connection not found');

  if (connection.authMode !== 'github_app') {
    throw new Error(`Connection ${connectionId} is not a GitHub App connection (authMode=${connection.authMode})`);
  }

  if (!connection.githubInstallationId || !connection.githubAppId) {
    throw new Error('Missing githubInstallationId or githubAppId on connection');
  }

  // Check allowlist
  const allowlist: string[] | null = connection.repoAllowlist
    ? JSON.parse(connection.repoAllowlist)
    : null;

  if (requestedRepos && allowlist) {
    const denied = requestedRepos.filter((r) => !allowlist.includes(r));
    if (denied.length > 0) {
      throw new Error(`Repos not in allowlist: ${denied.join(', ')}`);
    }
  }

  // Check cache
  const cacheKey = `${connectionId}:${(requestedRepos ?? []).sort().join(',')}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt.getTime() > Date.now() + 5 * 60_000) {
    return cached;
  }

  // Get the app private key
  const privateKey = connection.githubAppPrivateKey;
  if (!privateKey) throw new Error('Missing GitHub App private key');

  // Create JWT
  const jwt = createAppJWT(connection.githubAppId, privateKey);

  // Exchange JWT for installation token
  const url = `https://api.github.com/app/installations/${connection.githubInstallationId}/access_tokens`;
  const body: Record<string, unknown> = {};

  // Scope to specific repos if requested
  if (requestedRepos && requestedRepos.length > 0) {
    // GitHub API needs repo IDs, not names — for MVP we use repository_names
    body.repositories = requestedRepos.map((r) => r.split('/').pop());
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Wooblay-Gateway/1.0',
    },
    body: Object.keys(body).length > 0 ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub installation token mint failed (${response.status}): ${text.slice(0, 200)}`);
  }

  const data = await response.json() as { token: string; expires_at: string; repositories?: { full_name: string }[] };

  const result: CachedToken = {
    token: data.token,
    expiresAt: new Date(data.expires_at),
    repos: data.repositories?.map((r) => r.full_name) ?? requestedRepos ?? [],
  };

  // Cache
  tokenCache.set(cacheKey, result);

  // Record lease
  await prisma.secretLease.create({
    data: {
      connectionId,
      secretArn: `github-install-token:${connection.githubInstallationId}`,
      leaseType: 'installation_token',
      scopes: JSON.stringify(result.repos),
      expiresAt: result.expiresAt,
    },
  });

  return result;
}

/**
 * Resolve a GitHub token for a connection, preferring installation tokens.
 * Falls back to PAT for legacy connections.
 */
export async function resolveGitHubToken(
  prisma: PrismaClient,
  connectionId: string,
  requestedRepos?: string[],
): Promise<string> {
  const connection = await prisma.connection.findUnique({ where: { id: connectionId } });
  if (!connection) throw new Error('Connection not found');

  if (connection.authMode === 'github_app') {
    const { token } = await mintInstallationToken(prisma, connectionId, requestedRepos);
    return token;
  }

  // Legacy PAT fallback
  if (!connection.credentialRef) {
    throw new Error('No credential available for connection');
  }

  return connection.credentialRef;
}

/**
 * Check if a repo is in the connection's allowlist.
 */
export function isRepoAllowed(connection: { repoAllowlist: string | null }, repoFullName: string): boolean {
  if (!connection.repoAllowlist) return true; // No allowlist = all repos
  const allowlist: string[] = JSON.parse(connection.repoAllowlist);
  return allowlist.includes(repoFullName);
}

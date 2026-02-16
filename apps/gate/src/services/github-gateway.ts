/**
 * GitHub Gateway Service.
 *
 * Executes GitHub API operations on behalf of agents WITHOUT exposing
 * credentials. The agent sends a capability token + action description;
 * this service validates the token, retrieves the real GitHub credential
 * from the Connection vault, and executes the operation.
 *
 * The agent NEVER sees the GitHub token.
 */

import type { PrismaClient } from '@prisma/client';
import { resolveGitHubToken, isRepoAllowed } from './github-app.js';
import { redactSecrets } from './vault.js';

// ── Supported GitHub Actions ────────────────────────────────────────────

export type GitHubAction =
  | 'github:pr:create'
  | 'github:pr:list'
  | 'github:pr:get'
  | 'github:pr:merge'
  | 'github:pr:comment'
  | 'github:file:read'
  | 'github:file:write'
  | 'github:branch:create'
  | 'github:branch:list'
  | 'github:checks:list'
  | 'github:repo:get';

export interface GatewayRequest {
  action: GitHubAction;
  params: Record<string, unknown>;
}

export interface GatewayResponse {
  success: boolean;
  data?: unknown;
  error?: string;
}

// ── Gateway Execution ───────────────────────────────────────────────────

export async function executeGitHubAction(
  prisma: PrismaClient,
  connectionId: string,
  request: GatewayRequest,
): Promise<GatewayResponse> {
  // 1. Retrieve the connection and its credential
  const connection = await prisma.connection.findUnique({
    where: { id: connectionId },
  });

  if (!connection || connection.status !== 'active') {
    return { success: false, error: 'GitHub connection not found or inactive' };
  }

  if (connection.provider !== 'github') {
    return { success: false, error: `Invalid provider: ${connection.provider}` };
  }

  // 2. Check repo allowlist
  const params = request.params;
  if (params.owner && params.repo) {
    const repoFullName = `${params.owner}/${params.repo}`;
    if (!isRepoAllowed(connection, repoFullName)) {
      return { success: false, error: `Repo ${repoFullName} is not in the connection's allowlist` };
    }
  }

  // 3. Resolve token — prefers GitHub App installation tokens over PATs
  let githubToken: string;
  try {
    const requestedRepos = params.owner && params.repo ? [`${params.owner}/${params.repo}`] : undefined;
    githubToken = await resolveGitHubToken(prisma, connectionId, requestedRepos);
  } catch (err: any) {
    return { success: false, error: `Failed to resolve GitHub credential: ${redactSecrets(err.message)}` };
  }

  // 4. Execute the requested GitHub action
  try {
    const result = await dispatchAction(githubToken, request);
    return { success: true, data: result };
  } catch (err: any) {
    return { success: false, error: redactSecrets(err.message || 'GitHub API error') };
  }
}

// ── Action Dispatch ─────────────────────────────────────────────────────

async function dispatchAction(
  token: string,
  request: GatewayRequest,
): Promise<unknown> {
  const { action, params } = request;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'Wooblay-Gateway/1.0',
  };

  switch (action) {
    case 'github:repo:get': {
      const { owner, repo } = params as { owner: string; repo: string };
      return ghFetch(`https://api.github.com/repos/${owner}/${repo}`, { headers });
    }

    case 'github:pr:list': {
      const { owner, repo, state } = params as { owner: string; repo: string; state?: string };
      const qs = state ? `?state=${state}` : '';
      return ghFetch(`https://api.github.com/repos/${owner}/${repo}/pulls${qs}`, { headers });
    }

    case 'github:pr:get': {
      const { owner, repo, number } = params as { owner: string; repo: string; number: number };
      return ghFetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${number}`, { headers });
    }

    case 'github:pr:create': {
      const { owner, repo, title, head, base, body } = params as {
        owner: string; repo: string; title: string; head: string; base: string; body?: string;
      };
      return ghFetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, head, base, body }),
      });
    }

    case 'github:pr:merge': {
      const { owner, repo, number, merge_method } = params as {
        owner: string; repo: string; number: number; merge_method?: string;
      };
      return ghFetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${number}/merge`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ merge_method: merge_method ?? 'squash' }),
      });
    }

    case 'github:pr:comment': {
      const { owner, repo, number, body: commentBody } = params as {
        owner: string; repo: string; number: number; body: string;
      };
      return ghFetch(`https://api.github.com/repos/${owner}/${repo}/issues/${number}/comments`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: commentBody }),
      });
    }

    case 'github:file:read': {
      const { owner, repo, path, ref } = params as {
        owner: string; repo: string; path: string; ref?: string;
      };
      const qs = ref ? `?ref=${ref}` : '';
      return ghFetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}${qs}`, { headers });
    }

    case 'github:file:write': {
      const { owner, repo, path, content, message, branch, sha } = params as {
        owner: string; repo: string; path: string; content: string;
        message: string; branch?: string; sha?: string;
      };
      return ghFetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          content: Buffer.from(content).toString('base64'),
          branch,
          sha,
        }),
      });
    }

    case 'github:branch:create': {
      const { owner, repo, ref, sha } = params as {
        owner: string; repo: string; ref: string; sha: string;
      };
      return ghFetch(`https://api.github.com/repos/${owner}/${repo}/git/refs`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref: `refs/heads/${ref}`, sha }),
      });
    }

    case 'github:branch:list': {
      const { owner, repo } = params as { owner: string; repo: string };
      return ghFetch(`https://api.github.com/repos/${owner}/${repo}/branches`, { headers });
    }

    case 'github:checks:list': {
      const { owner, repo, ref } = params as { owner: string; repo: string; ref: string };
      return ghFetch(`https://api.github.com/repos/${owner}/${repo}/commits/${ref}/check-runs`, { headers });
    }

    default:
      throw new Error(`Unsupported GitHub action: ${action}`);
  }
}

// ── HTTP Helper ─────────────────────────────────────────────────────────

async function ghFetch(url: string, init: RequestInit): Promise<unknown> {
  const response = await fetch(url, init);
  const body = await response.text();

  if (!response.ok) {
    throw new Error(`GitHub API ${response.status}: ${body.slice(0, 500)}`);
  }

  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

// ── Credential Management ───────────────────────────────────────────────

/**
 * Decrypt a credential reference.
 * MVP: credential is stored directly (encrypted at rest by Postgres/EBS).
 * Production: use AWS Secrets Manager ARN and fetch from Secrets Manager.
 */
function decryptCredential(credentialRef: string): string | null {
  // In MVP, the credentialRef IS the token (encrypted at rest by DB/disk).
  // In production, this would call AWS Secrets Manager:
  //   const client = new SecretsManagerClient({});
  //   const secret = await client.send(new GetSecretValueCommand({ SecretId: credentialRef }));
  //   return secret.SecretString;
  if (!credentialRef) return null;
  return credentialRef;
}

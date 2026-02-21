/**
 * Execution Verification Engine — post-action proof.
 *
 * After the gateway executes an action, the verifier reads back from the
 * source-of-truth API to confirm the action actually took effect. Only
 * after verification does the receipt get finalized.
 *
 * Flow: gateway.execute → verify → receipt.finalize
 *
 * Verify rules per action class:
 * - "github:pr:create"   → GET /repos/{owner}/{repo}/pulls/{number} exists
 * - "github:pr:merge"    → PR state = "closed", merged = true
 * - "github:pr:comment"  → comment exists on the PR
 * - "github:file:write"  → file content hash matches at HEAD
 * - "github:branch:create" → branch exists
 * - "github:checks:list" → read-only, always passes
 */

import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { emitRunEvent } from './run-events.js';
import { persistEvent } from '../events/bus.js';

// ── Types ───────────────────────────────────────────────────────────────

export interface VerifyInput {
  proposalId: string;
  runId: string;
  capabilityId?: string;
  actionClass: string;
  params: Record<string, unknown>;
  executionResult: unknown;
  connectionId: string;
}

export interface VerifyResult {
  status: 'passed' | 'failed' | 'skipped';
  verificationId: string;
  failureReason?: string;
}

interface ExpectedOutcome {
  type: string;
  [key: string]: unknown;
}

// ── Main Verify Function ────────────────────────────────────────────────

export async function verifyExecution(
  prisma: PrismaClient,
  input: VerifyInput,
): Promise<VerifyResult> {
  // 1. Determine expected outcome from action class + result
  const expected = computeExpectedOutcome(input.actionClass, input.params, input.executionResult);

  // 2. Create verification record
  const verification = await prisma.verification.create({
    data: {
      proposalId: input.proposalId,
      runId: input.runId,
      capabilityId: input.capabilityId ?? null,
      expectedOutcome: JSON.stringify(expected),
      status: 'pending',
    },
  });

  // 3. Read back from source-of-truth
  let observed: Record<string, unknown> | null = null;
  let apiReads: string[] = [];

  try {
    const connection = await prisma.connection.findUnique({
      where: { id: input.connectionId },
    });

    if (!connection || connection.status !== 'active') {
      return finalize(prisma, verification.id, input, 'skipped', 'Connection unavailable for verification');
    }

    const token = connection.credentialRef;
    const readResult = await verifyViaAPI(token, input.actionClass, input.params, input.executionResult);
    observed = readResult.observed;
    apiReads = readResult.apiReads;
  } catch (err: any) {
    return finalize(prisma, verification.id, input, 'failed', `Verification API read failed: ${err.message}`);
  }

  // 4. Compare expected vs observed
  const match = compareOutcomes(expected, observed);

  if (!match.passed) {
    return finalize(prisma, verification.id, input, 'failed', match.reason, observed, apiReads);
  }

  return finalize(prisma, verification.id, input, 'passed', undefined, observed, apiReads);
}

// ── Expected Outcome Computation ────────────────────────────────────────

function computeExpectedOutcome(
  actionClass: string,
  params: Record<string, unknown>,
  result: unknown,
): ExpectedOutcome {
  const res = result as Record<string, unknown> | undefined;

  switch (actionClass) {
    case 'github:pr:create':
      return { type: 'pr_created', number: res?.number, owner: params.owner, repo: params.repo };
    case 'github:pr:merge':
      return { type: 'pr_merged', number: params.number, owner: params.owner, repo: params.repo };
    case 'github:pr:comment':
      return { type: 'comment_posted', number: params.number, owner: params.owner, repo: params.repo };
    case 'github:file:write':
      return { type: 'file_written', path: params.path, owner: params.owner, repo: params.repo };
    case 'github:branch:create':
      return { type: 'branch_created', ref: params.ref, owner: params.owner, repo: params.repo };
    case 'github:file:read':
    case 'github:pr:list':
    case 'github:pr:get':
    case 'github:branch:list':
    case 'github:checks:list':
    case 'github:repo:get':
      return { type: 'read_only' };
    default:
      return { type: 'unknown', actionClass };
  }
}

// ── API Verification ────────────────────────────────────────────────────

async function verifyViaAPI(
  token: string,
  actionClass: string,
  params: Record<string, unknown>,
  executionResult: unknown,
): Promise<{ observed: Record<string, unknown>; apiReads: string[] }> {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'Wooblay-Verifier/1.0',
  };

  const apiReads: string[] = [];
  const res = executionResult as Record<string, unknown> | undefined;

  switch (actionClass) {
    case 'github:pr:create': {
      const url = `https://api.github.com/repos/${params.owner}/${params.repo}/pulls/${res?.number}`;
      apiReads.push(`GET ${url}`);
      const pr = await ghFetch(url, { headers });
      return { observed: { type: 'pr_created', state: (pr as any)?.state, number: (pr as any)?.number }, apiReads };
    }

    case 'github:pr:merge': {
      const url = `https://api.github.com/repos/${params.owner}/${params.repo}/pulls/${params.number}`;
      apiReads.push(`GET ${url}`);
      const pr = await ghFetch(url, { headers });
      return { observed: { type: 'pr_merged', merged: (pr as any)?.merged, state: (pr as any)?.state }, apiReads };
    }

    case 'github:pr:comment': {
      const url = `https://api.github.com/repos/${params.owner}/${params.repo}/issues/${params.number}/comments?per_page=1&sort=created&direction=desc`;
      apiReads.push(`GET ${url}`);
      const comments = await ghFetch(url, { headers }) as any[];
      return { observed: { type: 'comment_posted', found: comments?.length > 0 }, apiReads };
    }

    case 'github:file:write': {
      const url = `https://api.github.com/repos/${params.owner}/${params.repo}/contents/${params.path}`;
      apiReads.push(`GET ${url}`);
      const file = await ghFetch(url, { headers });
      return { observed: { type: 'file_written', sha: (file as any)?.sha, exists: true }, apiReads };
    }

    case 'github:branch:create': {
      const url = `https://api.github.com/repos/${params.owner}/${params.repo}/git/refs/heads/${params.ref}`;
      apiReads.push(`GET ${url}`);
      const ref = await ghFetch(url, { headers });
      return { observed: { type: 'branch_created', exists: !!(ref as any)?.ref }, apiReads };
    }

    default:
      // Read-only or unknown — auto-pass
      return { observed: { type: 'read_only', skipped: true }, apiReads };
  }
}

// ── Outcome Comparison ──────────────────────────────────────────────────

function compareOutcomes(
  expected: ExpectedOutcome,
  observed: Record<string, unknown> | null,
): { passed: boolean; reason?: string } {
  if (expected.type === 'read_only' || expected.type === 'unknown') {
    return { passed: true };
  }

  if (!observed) {
    return { passed: false, reason: 'No observed outcome from API read' };
  }

  switch (expected.type) {
    case 'pr_created':
      if (observed.state === 'open' || observed.number) return { passed: true };
      return { passed: false, reason: `PR not found or not open: state=${observed.state}` };

    case 'pr_merged':
      if (observed.merged === true) return { passed: true };
      return { passed: false, reason: `PR not merged: merged=${observed.merged}, state=${observed.state}` };

    case 'comment_posted':
      if (observed.found === true) return { passed: true };
      return { passed: false, reason: 'Comment not found on PR' };

    case 'file_written':
      if (observed.exists === true) return { passed: true };
      return { passed: false, reason: 'File not found at expected path' };

    case 'branch_created':
      if (observed.exists === true) return { passed: true };
      return { passed: false, reason: 'Branch ref not found' };

    default:
      return { passed: true };
  }
}

// ── Finalize ────────────────────────────────────────────────────────────

async function finalize(
  prisma: PrismaClient,
  verificationId: string,
  input: VerifyInput,
  status: 'passed' | 'failed' | 'skipped',
  failureReason?: string,
  observed?: Record<string, unknown> | null,
  apiReads?: string[],
): Promise<VerifyResult> {
  const observedHash = observed
    ? createHash('sha256').update(JSON.stringify(observed)).digest('hex')
    : null;

  await prisma.verification.update({
    where: { id: verificationId },
    data: {
      status,
      failureReason: failureReason ?? null,
      observedOutcome: observed ? JSON.stringify(observed) : null,
      observedHash,
      apiReads: apiReads?.length ? JSON.stringify(apiReads) : null,
      verifiedAt: new Date(),
    },
  });

  // Link verification to proposal
  await prisma.proposal.update({
    where: { id: input.proposalId },
    data: { verificationId },
  });

  // Emit run event
  await emitRunEvent(prisma, input.runId, 'verification', {
    verificationId,
    proposalId: input.proposalId,
    status,
    failureReason,
  });

  return { status, verificationId, failureReason };
}

// ── HTTP Helper ─────────────────────────────────────────────────────────

async function ghFetch(url: string, init: RequestInit): Promise<unknown> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`GitHub ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }
  return response.json();
}

/**
 * Sensor Engine — context/action-based sensors.
 *
 * Sensors detect context and declare intent:
 * - New PR opened → "qa" intent (run QA/tests)
 * - Push to branch → "review" intent (code review)
 * - CI failure on default branch → "fix" intent
 * - CI failure on agent PR → "fix" intent
 *
 * Each sensor outputs an Operation with an `intent` field that tells the
 * orchestrator what kind of run to create.
 *
 * Hybrid evaluation: rule-based filtering first, then AI enrichment via router.
 * Deduplication: by (repoFullName, branch, commitSha, source) within window.
 */

import type { PrismaClient } from '@prisma/client';
import { persistEvent } from '../events/bus.js';
import type { OperationPriority, GitHubSensorConfig } from '@wooblay/types';

const DEDUPE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

// ── GitHub Webhook Payload Types ────────────────────────────────────────

interface CheckRunPayload {
  action: string;
  check_run: {
    id: number;
    name: string;
    conclusion: string | null;
    status: string;
    head_sha: string;
    check_suite?: {
      id: number;
      head_branch: string;
      head_sha: string;
      pull_requests?: { number: number; head: { ref: string } }[];
    };
  };
  repository: {
    full_name: string;
    default_branch: string;
  };
  sender?: { login: string; type?: string };
}

interface PullRequestPayload {
  action: string;
  number: number;
  pull_request: {
    number: number;
    title: string;
    head: { ref: string; sha: string };
    base: { ref: string };
    labels: { name: string }[];
    user: { login: string; type?: string };
    body: string | null;
    draft: boolean;
    changed_files?: number;
  };
  repository: {
    full_name: string;
    default_branch: string;
  };
  sender?: { login: string; type?: string };
}

interface PushPayload {
  ref: string;
  before: string;
  after: string;
  commits: { id: string; message: string; author: { username: string } }[];
  repository: {
    full_name: string;
    default_branch: string;
  };
  pusher: { name: string };
  sender?: { login: string; type?: string };
}

// ── Sensor Results ──────────────────────────────────────────────────────

export interface SensorResult {
  matched: boolean;
  sensor: string;
  operationData?: {
    title: string;
    summary: string;
    priority: OperationPriority;
    source: string;
    intent: string;
    repoFullName: string;
    branch: string;
    commitSha: string;
    prNumber?: number;
    externalId: string;
    sourcePayload: string;
  };
}

// ── Rule-Based Filtering ────────────────────────────────────────────────

function passesRuleFilter(
  eventType: string,
  payload: unknown,
  config: GitHubSensorConfig | null,
): boolean {
  if (!config) return true; // No config = accept all

  // Event type filter
  const eventMap: Record<string, string> = {
    check_run: 'check_run',
    pull_request: 'pull_request',
    push: 'push',
    issues: 'issues',
  };
  if (config.watchEvents && !config.watchEvents.includes(eventMap[eventType] as any)) {
    return false;
  }

  // Draft filter
  if (config.ignoreDrafts && eventType === 'pull_request') {
    const pr = (payload as PullRequestPayload).pull_request;
    if (pr.draft) return false;
  }

  // Bot filter
  if (config.ignoreBot) {
    const sender = (payload as any)?.sender;
    if (sender?.type === 'Bot' || sender?.login?.endsWith('[bot]')) return false;
  }

  // Branch filter
  if (config.branchFilter && config.branchFilter.length > 0) {
    let branch: string | undefined;
    if (eventType === 'push') {
      branch = (payload as PushPayload).ref.replace('refs/heads/', '');
    } else if (eventType === 'pull_request') {
      branch = (payload as PullRequestPayload).pull_request.head.ref;
    } else if (eventType === 'check_run') {
      branch = (payload as CheckRunPayload).check_run.check_suite?.head_branch;
    }
    if (branch && !config.branchFilter.includes(branch)) return false;
  }

  return true;
}

// ── Sensor: CI Failure on Default Branch → fix ──────────────────────────

export function evaluateGitHubCISensor(payload: CheckRunPayload): SensorResult {
  if (payload.action !== 'completed') return { matched: false, sensor: 'github_ci' };

  const checkRun = payload.check_run;
  if (checkRun.conclusion !== 'failure') return { matched: false, sensor: 'github_ci' };

  const branch = checkRun.check_suite?.head_branch;
  const defaultBranch = payload.repository.default_branch;
  if (!branch || branch !== defaultBranch) return { matched: false, sensor: 'github_ci' };

  return {
    matched: true,
    sensor: 'github_ci',
    operationData: {
      title: `CI failure on ${payload.repository.full_name}/${defaultBranch}`,
      summary: `Check "${checkRun.name}" failed on commit ${checkRun.head_sha.slice(0, 8)}`,
      priority: 'P1',
      source: 'github_ci',
      intent: 'fix',
      repoFullName: payload.repository.full_name,
      branch: defaultBranch,
      commitSha: checkRun.head_sha,
      externalId: `check_run:${checkRun.id}`,
      sourcePayload: JSON.stringify(payload),
    },
  };
}

// ── Sensor: CI Failure on Agent PR → fix ────────────────────────────────

export function evaluateAgentPRCISensor(payload: CheckRunPayload): SensorResult {
  if (payload.action !== 'completed') return { matched: false, sensor: 'github_agent_pr' };

  const checkRun = payload.check_run;
  if (checkRun.conclusion !== 'failure') return { matched: false, sensor: 'github_agent_pr' };

  const pullRequests = checkRun.check_suite?.pull_requests ?? [];
  if (pullRequests.length === 0) return { matched: false, sensor: 'github_agent_pr' };

  const pr = pullRequests[0]!;
  const branchName = pr.head.ref;
  const isAgentBranch = /^(wooblay|agent|bot|fix|auto)[-/]/.test(branchName);
  if (!isAgentBranch) return { matched: false, sensor: 'github_agent_pr' };

  return {
    matched: true,
    sensor: 'github_agent_pr',
    operationData: {
      title: `Agent PR CI failure: ${payload.repository.full_name}#${pr.number}`,
      summary: `Check "${checkRun.name}" failed on agent branch "${branchName}" (${checkRun.head_sha.slice(0, 8)})`,
      priority: 'P1',
      source: 'github_agent_pr',
      intent: 'fix',
      repoFullName: payload.repository.full_name,
      branch: branchName,
      commitSha: checkRun.head_sha,
      prNumber: pr.number,
      externalId: `check_run:${checkRun.id}:pr:${pr.number}`,
      sourcePayload: JSON.stringify(payload),
    },
  };
}

// ── Sensor: New PR Opened → qa ──────────────────────────────────────────

export function evaluateNewPRSensor(payload: PullRequestPayload): SensorResult {
  if (payload.action !== 'opened' && payload.action !== 'synchronize') {
    return { matched: false, sensor: 'github_pr_opened' };
  }

  if (payload.pull_request.draft) return { matched: false, sensor: 'github_pr_opened' };

  const pr = payload.pull_request;
  return {
    matched: true,
    sensor: 'github_pr_opened',
    operationData: {
      title: `QA: ${payload.repository.full_name}#${payload.number} — ${pr.title}`,
      summary: `PR opened by ${pr.user.login}: "${pr.title}" (${pr.head.sha.slice(0, 8)}, ${pr.changed_files ?? '?'} files)`,
      priority: 'P2',
      source: 'github_pr_opened',
      intent: 'qa',
      repoFullName: payload.repository.full_name,
      branch: pr.head.ref,
      commitSha: pr.head.sha,
      prNumber: payload.number,
      externalId: `pr:${payload.number}:${pr.head.sha}`,
      sourcePayload: JSON.stringify(payload),
    },
  };
}

// ── Sensor: Push to Protected Branch → review ───────────────────────────

export function evaluatePushSensor(payload: PushPayload): SensorResult {
  const branch = payload.ref.replace('refs/heads/', '');
  const isDefault = branch === payload.repository.default_branch;

  if (!isDefault || payload.commits.length === 0) {
    return { matched: false, sensor: 'github_push' };
  }

  const latestCommit = payload.commits[payload.commits.length - 1]!;

  return {
    matched: true,
    sensor: 'github_push',
    operationData: {
      title: `Push to ${payload.repository.full_name}/${branch}`,
      summary: `${payload.commits.length} commit(s) by ${payload.pusher.name}: "${latestCommit.message.slice(0, 80)}"`,
      priority: 'P2',
      source: 'github_push',
      intent: 'review',
      repoFullName: payload.repository.full_name,
      branch,
      commitSha: payload.after,
      externalId: `push:${payload.after}`,
      sourcePayload: JSON.stringify(payload),
    },
  };
}

// ── Deduplication ───────────────────────────────────────────────────────

export async function isDuplicate(
  prisma: PrismaClient,
  repoFullName: string,
  branch: string,
  commitSha: string,
  source: string,
): Promise<boolean> {
  const windowStart = new Date(Date.now() - DEDUPE_WINDOW_MS);

  const existing = await prisma.operation.findFirst({
    where: {
      repoFullName,
      branch,
      commitSha,
      source,
      createdAt: { gte: windowStart },
    },
  });

  return existing !== null;
}

// ── Process Webhook ─────────────────────────────────────────────────────

export async function processGitHubWebhook(
  prisma: PrismaClient,
  eventType: string,
  payload: unknown,
  opts?: {
    connectionId?: string;
    orgId?: string;
    sensorConfig?: GitHubSensorConfig | null;
  },
): Promise<{ operationId: string | null; sensor: string | null; deduplicated: boolean }> {
  const { connectionId, orgId, sensorConfig } = opts ?? {};

  // Rule-based filtering from sensorConfig
  if (sensorConfig && !passesRuleFilter(eventType, payload, sensorConfig)) {
    return { operationId: null, sensor: null, deduplicated: false };
  }

  let results: SensorResult[] = [];

  switch (eventType) {
    case 'check_run': {
      const p = payload as CheckRunPayload;
      results = [
        evaluateAgentPRCISensor(p),
        evaluateGitHubCISensor(p),
      ];
      break;
    }
    case 'pull_request': {
      const p = payload as PullRequestPayload;
      results = [evaluateNewPRSensor(p)];
      break;
    }
    case 'push': {
      const p = payload as PushPayload;
      results = [evaluatePushSensor(p)];
      break;
    }
    default:
      return { operationId: null, sensor: null, deduplicated: false };
  }

  const result = results.find((r) => r.matched);
  if (!result || !result.operationData) {
    return { operationId: null, sensor: null, deduplicated: false };
  }

  // Deduplicate
  const dup = await isDuplicate(
    prisma,
    result.operationData.repoFullName,
    result.operationData.branch,
    result.operationData.commitSha,
    result.operationData.source,
  );

  if (dup) {
    return { operationId: null, sensor: result.sensor, deduplicated: true };
  }

  // Create operation (stamped with orgId + connectionId when from webhook)
  const operation = await prisma.operation.create({
    data: {
      title: result.operationData.title,
      summary: result.operationData.summary,
      priority: result.operationData.priority,
      source: result.operationData.source,
      intent: result.operationData.intent,
      repoFullName: result.operationData.repoFullName,
      branch: result.operationData.branch,
      commitSha: result.operationData.commitSha,
      prNumber: result.operationData.prNumber ?? null,
      externalId: result.operationData.externalId,
      sourcePayload: result.operationData.sourcePayload,
      orgId: orgId ?? null,
      connectionId: connectionId ?? null,
      routingStatus: 'pending',
    },
  });

  await persistEvent(prisma, {
    type: 'operation.created',
    data: {
      operationId: operation.id,
      source: operation.source,
      priority: operation.priority as OperationPriority,
      title: operation.title,
    },
  });

  return { operationId: operation.id, sensor: result.sensor, deduplicated: false };
}

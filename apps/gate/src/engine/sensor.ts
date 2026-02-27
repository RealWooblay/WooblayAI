/**
 * Sensor Engine — intelligent event-to-operation pipeline.
 *
 * Architecture: Sense → Enrich → Escalate → Route
 *
 * 1. SENSE: Detect events from any source (GitHub webhooks today, any sensor tomorrow)
 * 2. ENRICH: Extract rich, structured EventContext from raw payloads
 *    - Code metrics (additions, deletions, file lists, change size)
 *    - Author classification (human, bot, agent)
 *    - Branch classification (default, release, agent, protected)
 *    - Risk signals (large deletions, force push, config file changes)
 * 3. ESCALATE: AI-driven priority adjustment from context signals
 *    - No manual conditions — the engine reads context and decides
 *    - Force push to protected branch → P0
 *    - High risk signal or massive changes → escalate
 *    - Release branch CI failure → escalate
 * 4. ROUTE: AI router classifies intent, matches agents, suggests follow-ups
 *    - User sets default intent or leaves as pending_classification
 *    - AI overrides when context warrants it
 *    - Follow-up decisions are AI-driven (fix → verify, etc.)
 *
 * No hardcoded defaults. No manual workflows. User declares what they care
 * about. AI handles everything else.
 *
 * Deduplication: by (repoFullName, branch, commitSha, source) within window.
 */

import type { PrismaClient } from '@prisma/client';
import { persistEvent } from '../events/bus.js';
import type {
  OperationPriority,
  OperationIntent,
  GitHubSensorConfig,
  SensorEventRule,
} from '@wooblay/types';

const DEDUPE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

import type { CheckRunPayload, PullRequestPayload, PushPayload, EventContext, SensorResult } from '../types/sensor.js';
export type { EventContext, SensorResult };

// ── Change Size Classification ──────────────────────────────────────────

function classifyChangeSize(totalChanges: number | undefined): EventContext['changeSize'] {
  if (totalChanges === undefined) return undefined;
  if (totalChanges <= 5) return 'trivial';
  if (totalChanges <= 50) return 'small';
  if (totalChanges <= 200) return 'medium';
  if (totalChanges <= 1000) return 'large';
  return 'massive';
}

// ── Risk Signal Detection ───────────────────────────────────────────────

const HIGH_RISK_PATTERNS = [
  /^\.env/, /dockerfile/i, /docker-compose/i,
  /\.github\/workflows/, /\.gitlab-ci/, /jenkinsfile/i,
  /terraform/, /\.tf$/, /pulumi/,
  /prisma\/schema/, /migrations?\//,
  /package\.json$/, /package-lock\.json$/, /yarn\.lock$/, /pnpm-lock/,
  /secrets?\./, /credentials?\./, /\.pem$/, /\.key$/,
];

function detectRiskSignal(fileList: string[] | undefined, forcePush?: boolean): EventContext['riskSignal'] {
  if (forcePush) return 'high';
  if (!fileList || fileList.length === 0) return 'low';

  let sensitiveCount = 0;
  for (const file of fileList) {
    if (HIGH_RISK_PATTERNS.some((p) => p.test(file))) sensitiveCount++;
  }

  if (sensitiveCount >= 3) return 'high';
  if (sensitiveCount >= 1) return 'medium';
  return 'low';
}

// ── Branch Classification ───────────────────────────────────────────────

function isReleaseBranch(branch: string): boolean {
  return /^(release|hotfix|v?\d+\.\d+)[\/-]/.test(branch);
}

function isProtectedBranch(branch: string, defaultBranch: string): boolean {
  const protectedPatterns = [defaultBranch, 'main', 'master', 'develop', 'staging', 'production'];
  return protectedPatterns.includes(branch) || isReleaseBranch(branch);
}

// ── Rule-Based Filtering ────────────────────────────────────────────────

function passesRuleFilter(
  eventType: string,
  payload: unknown,
  config: GitHubSensorConfig | null,
): boolean {
  if (!config) return true;

  const eventMap: Record<string, string> = {
    check_run: 'check_run',
    pull_request: 'pull_request',
    push: 'push',
    issues: 'issues',
  };
  if (config.watchEvents && !config.watchEvents.includes(eventMap[eventType] as any)) {
    return false;
  }

  if (config.ignoreDrafts && eventType === 'pull_request') {
    const pr = (payload as PullRequestPayload).pull_request;
    if (pr.draft) return false;
  }

  if (config.ignoreBot) {
    const sender = (payload as any)?.sender;
    if (sender?.type === 'Bot' || sender?.login?.endsWith('[bot]')) return false;
  }

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

// ── Event Rule Matching ─────────────────────────────────────────────────

const SOURCE_TO_EVENT: Record<string, SensorEventRule['event']> = {
  github_ci: 'ci_failure',
  github_agent_pr: 'ci_failure',
  github_pr_opened: 'pr_opened',
  github_push: 'push',
};

/**
 * Resolve event rules against a matched sensor result.
 *
 * No hardcoded defaults. Two modes:
 * - No user rules → everything passes through with pending_classification (AI decides)
 * - User rules exist → only events with a matching enabled rule produce operations
 *
 * Returns null = suppress (user has rules but none match this event).
 * Returns {} = no overrides (AI classifies from context).
 * Returns { intent, priority } = user-set defaults (AI may still reclassify).
 */
function resolveEventRule(
  source: string,
  config: GitHubSensorConfig | null | undefined,
): { intent?: OperationIntent; priority?: OperationPriority } | null {
  const eventType = SOURCE_TO_EVENT[source];
  if (!eventType) return {}; // Unknown source — let it through, AI classifies

  const rules = config?.eventRules;
  if (!rules || rules.length === 0) {
    // No user rules — let everything through. AI classifies intent from context.
    return {};
  }

  // User has rules — only create operations for events they explicitly enabled
  const rule = rules.find((r: { event: string; enabled: boolean; intent?: string; priority?: string }) => r.event === eventType && r.enabled);
  if (!rule) return null; // User didn't include this event — suppress

  return { intent: rule.intent, priority: rule.priority };
}

// ── AI-Driven Smart Escalation ──────────────────────────────────────────
// Automatically adjusts priority based on event context signals.
// The user sets a default priority — the AI escalates when context warrants it.
// This replaces manual condition rules with intelligent, context-aware decisions.

function smartEscalate(
  context: EventContext,
  basePriority: OperationPriority,
): OperationPriority {
  const priorityOrder: OperationPriority[] = ['P0', 'P1', 'P2'];
  let escalationLevel = priorityOrder.indexOf(basePriority);

  // High-risk signals → escalate
  if (context.riskSignal === 'high') {
    escalationLevel = Math.max(0, escalationLevel - 1);
  }

  // Force push to protected branch → always P0
  if (context.forcePush && context.isProtectedBranch) {
    return 'P0';
  }

  // Massive changes → escalate
  if (context.changeSize === 'massive' || context.changeSize === 'large') {
    escalationLevel = Math.max(0, escalationLevel - 1);
  }

  // CI failure on release branch → escalate
  if (context.eventType === 'check_run' && context.isReleaseBranch) {
    escalationLevel = Math.max(0, escalationLevel - 1);
  }

  // Agent self-healing (CI failure on agent branch) → keep same priority (agent handles its own mess)
  if (context.isAgentBranch && context.eventType === 'check_run') {
    return basePriority;
  }

  return priorityOrder[escalationLevel] ?? basePriority;
}

// ── Sensor: CI Failure on Default Branch → fix ──────────────────────────

export function evaluateGitHubCISensor(payload: CheckRunPayload): SensorResult {
  if (payload.action !== 'completed') return { matched: false, sensor: 'github_ci' };

  const checkRun = payload.check_run;
  if (checkRun.conclusion !== 'failure') return { matched: false, sensor: 'github_ci' };

  const branch = checkRun.check_suite?.head_branch;
  const defaultBranch = payload.repository.default_branch;
  if (!branch || branch !== defaultBranch) return { matched: false, sensor: 'github_ci' };

  const eventContext: EventContext = {
    eventType: 'check_run',
    action: payload.action,
    repo: payload.repository.full_name,
    branch: defaultBranch,
    commitSha: checkRun.head_sha,
    author: payload.sender?.login ?? 'unknown',
    authorType: payload.sender?.type ?? 'unknown',
    checkName: checkRun.name,
    checkConclusion: checkRun.conclusion ?? undefined,
    checkAnnotations: checkRun.output?.annotations_count,
    checkOutputTitle: checkRun.output?.title,
    defaultBranch,
    isDefaultBranch: true,
    isAgentBranch: false,
    isReleaseBranch: isReleaseBranch(defaultBranch),
    isProtectedBranch: true,
    riskSignal: 'medium',
  };

  return {
    matched: true,
    sensor: 'github_ci',
    operationData: {
      title: `CI failure on ${payload.repository.full_name}/${defaultBranch}`,
      summary: `Check "${checkRun.name}" failed on commit ${checkRun.head_sha.slice(0, 8)}${checkRun.output?.title ? ` — ${checkRun.output.title}` : ''}`,
      priority: 'P1',
      source: 'github_ci',
      intent: 'pending_classification',
      suggestedIntent: 'fix',
      eventContext,
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

  const eventContext: EventContext = {
    eventType: 'check_run',
    action: payload.action,
    repo: payload.repository.full_name,
    branch: branchName,
    commitSha: checkRun.head_sha,
    author: payload.sender?.login ?? 'unknown',
    authorType: payload.sender?.type ?? 'unknown',
    prNumber: pr.number,
    checkName: checkRun.name,
    checkConclusion: checkRun.conclusion ?? undefined,
    checkAnnotations: checkRun.output?.annotations_count,
    checkOutputTitle: checkRun.output?.title,
    defaultBranch: payload.repository.default_branch,
    isDefaultBranch: false,
    isAgentBranch: true,
    isReleaseBranch: false,
    isProtectedBranch: false,
    riskSignal: 'low',
  };

  return {
    matched: true,
    sensor: 'github_agent_pr',
    operationData: {
      title: `Agent PR CI failure: ${payload.repository.full_name}#${pr.number}`,
      summary: `Check "${checkRun.name}" failed on agent branch "${branchName}" (${checkRun.head_sha.slice(0, 8)})`,
      priority: 'P1',
      source: 'github_agent_pr',
      intent: 'pending_classification',
      suggestedIntent: 'fix',
      eventContext,
      repoFullName: payload.repository.full_name,
      branch: branchName,
      commitSha: checkRun.head_sha,
      prNumber: pr.number,
      externalId: `check_run:${checkRun.id}:pr:${pr.number}`,
      sourcePayload: JSON.stringify(payload),
    },
  };
}

// ── Sensor: New PR Opened → review ──────────────────────────────────────

export function evaluateNewPRSensor(payload: PullRequestPayload): SensorResult {
  if (payload.action !== 'opened' && payload.action !== 'synchronize') {
    return { matched: false, sensor: 'github_pr_opened' };
  }

  if (payload.pull_request.draft) return { matched: false, sensor: 'github_pr_opened' };

  const pr = payload.pull_request;
  const branchName = pr.head.ref;
  const isAgentBranch = /^(wooblay|agent|bot|fix|auto)[-/]/.test(branchName);

  // Extract rich code metrics
  const additions = pr.additions ?? 0;
  const deletions = pr.deletions ?? 0;
  const changedFiles = pr.changed_files ?? 0;
  const totalChanges = additions + deletions;
  const labels = pr.labels?.map((l) => l.name) ?? [];
  const reviewers = pr.requested_reviewers?.map((r) => r.login) ?? [];

  const eventContext: EventContext = {
    eventType: 'pull_request',
    action: payload.action,
    repo: payload.repository.full_name,
    branch: branchName,
    baseBranch: pr.base.ref,
    commitSha: pr.head.sha,
    author: pr.user.login,
    authorType: pr.user.type ?? 'User',
    prNumber: payload.number,
    prTitle: pr.title,
    prBody: pr.body ?? undefined,
    prDraft: pr.draft,
    labels,
    requestedReviewers: reviewers,
    mergeableState: pr.mergeable_state,
    changedFiles,
    additions,
    deletions,
    totalChanges,
    changeSize: classifyChangeSize(totalChanges),
    defaultBranch: payload.repository.default_branch,
    isDefaultBranch: false,
    isAgentBranch,
    isReleaseBranch: isReleaseBranch(branchName),
    isProtectedBranch: false,
    riskSignal: 'low',
  };

  return {
    matched: true,
    sensor: 'github_pr_opened',
    operationData: {
      title: `PR: ${payload.repository.full_name}#${payload.number} — ${pr.title}`,
      summary: `PR ${payload.action} by ${pr.user.login}: "${pr.title}" (${pr.head.sha.slice(0, 8)}, ${changedFiles} files, +${additions}/-${deletions})`,
      priority: 'P2',
      source: 'github_pr_opened',
      intent: 'pending_classification',
      suggestedIntent: 'qa',
      eventContext,
      repoFullName: payload.repository.full_name,
      branch: branchName,
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

  // Aggregate file change data from all commits
  const addedFiles: string[] = [];
  const removedFiles: string[] = [];
  const modifiedFiles: string[] = [];
  for (const commit of payload.commits) {
    if (commit.added) addedFiles.push(...commit.added);
    if (commit.removed) removedFiles.push(...commit.removed);
    if (commit.modified) modifiedFiles.push(...commit.modified);
  }
  const allFiles = [...new Set([...addedFiles, ...removedFiles, ...modifiedFiles])];

  const eventContext: EventContext = {
    eventType: 'push',
    action: 'push',
    repo: payload.repository.full_name,
    branch,
    commitSha: payload.after,
    author: payload.pusher.name,
    authorType: payload.sender?.type ?? 'User',
    commitCount: payload.commits.length,
    commitMessages: payload.commits.map((c) => c.message.slice(0, 120)),
    forcePush: payload.forced,
    addedFiles: [...new Set(addedFiles)],
    removedFiles: [...new Set(removedFiles)],
    modifiedFiles: [...new Set(modifiedFiles)],
    fileList: allFiles,
    changedFiles: allFiles.length,
    changeSize: classifyChangeSize(allFiles.length),
    defaultBranch: payload.repository.default_branch,
    isDefaultBranch: true,
    isAgentBranch: false,
    isReleaseBranch: isReleaseBranch(branch),
    isProtectedBranch: isProtectedBranch(branch, payload.repository.default_branch),
    riskSignal: detectRiskSignal(allFiles, payload.forced),
  };

  return {
    matched: true,
    sensor: 'github_push',
    operationData: {
      title: `Push to ${payload.repository.full_name}/${branch}`,
      summary: `${payload.commits.length} commit(s) by ${payload.pusher.name}: "${latestCommit.message.slice(0, 80)}" (${allFiles.length} files${payload.forced ? ', FORCE PUSH' : ''})`,
      priority: 'P2',
      source: 'github_push',
      intent: 'pending_classification',
      suggestedIntent: 'review',
      eventContext,
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

  // Apply user-defined event rules (simple: event → intent + default priority)
  const ruleResult = resolveEventRule(result.operationData.source, sensorConfig);
  if (ruleResult === null) {
    return { operationId: null, sensor: result.sensor, deduplicated: false };
  }
  if (ruleResult.intent) {
    result.operationData.intent = ruleResult.intent;
    result.operationData.suggestedIntent = ruleResult.intent;
  }
  if (ruleResult.priority) {
    result.operationData.priority = ruleResult.priority;
  }

  // AI-driven smart escalation: automatically adjust priority based on context signals
  // (change size, risk signals, force push, release branch, etc.)
  // User sets the default — AI escalates when the context warrants it.
  result.operationData.priority = smartEscalate(
    result.operationData.eventContext,
    result.operationData.priority,
  );

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

  // Create operation with rich context
  const operation = await prisma.operation.create({
    data: {
      title: result.operationData.title,
      summary: result.operationData.summary,
      priority: result.operationData.priority,
      source: result.operationData.source,
      intent: result.operationData.intent,
      suggestedIntent: result.operationData.suggestedIntent,
      eventContext: JSON.stringify(result.operationData.eventContext),
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

  return {
    operationId: operation.id,
    sensor: result.sensor,
    deduplicated: false,
  };
}

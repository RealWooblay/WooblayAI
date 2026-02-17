/**
 * Sensor engine types — GitHub webhook payloads and event context.
 *
 * EventContext is the rich, structured representation of what happened.
 * It's extracted from the webhook payload and fed to:
 * 1. The condition engine (for conditional event rules)
 * 2. The AI router (for intent classification and agent matching)
 * 3. The operation record (for full traceability)
 */

import type { OperationPriority } from '@wooblay/types';

export interface CheckRunPayload {
  action: string;
  check_run: {
    id: number;
    name: string;
    conclusion: string | null;
    status: string;
    head_sha: string;
    output?: {
      title?: string;
      summary?: string;
      annotations_count?: number;
    };
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

export interface PullRequestPayload {
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
    additions?: number;
    deletions?: number;
    mergeable?: boolean;
    mergeable_state?: string;
    requested_reviewers?: { login: string }[];
  };
  repository: {
    full_name: string;
    default_branch: string;
  };
  sender?: { login: string; type?: string };
}

export interface PushPayload {
  ref: string;
  before: string;
  after: string;
  forced: boolean;
  commits: {
    id: string;
    message: string;
    author: { username: string };
    added?: string[];
    removed?: string[];
    modified?: string[];
  }[];
  repository: {
    full_name: string;
    default_branch: string;
  };
  pusher: { name: string };
  sender?: { login: string; type?: string };
}

/**
 * Rich, structured event context extracted from webhook payloads.
 *
 * Every field here is available for:
 * - Condition evaluation (event rules)
 * - AI routing decisions
 * - Operation display in the UI
 *
 * Fields are intentionally flat for easy condition matching:
 * e.g., { field: 'changedFiles', operator: 'gt', value: 20 }
 */
export interface EventContext {
  // Core event info
  eventType: string;
  action: string;
  repo: string;
  branch: string;
  commitSha: string;

  // Author info
  author: string;
  authorType: string;

  // PR-specific
  prNumber?: number;
  prTitle?: string;
  prBody?: string;
  prDraft?: boolean;
  baseBranch?: string;
  labels?: string[];
  requestedReviewers?: string[];
  mergeableState?: string;

  // Code change metrics
  changedFiles?: number;
  additions?: number;
  deletions?: number;
  totalChanges?: number;
  fileList?: string[];

  // CI-specific
  checkName?: string;
  checkConclusion?: string;
  checkAnnotations?: number;
  checkOutputTitle?: string;

  // Push-specific
  commitCount?: number;
  commitMessages?: string[];
  forcePush?: boolean;
  addedFiles?: string[];
  removedFiles?: string[];
  modifiedFiles?: string[];

  // Branch classification
  defaultBranch: string;
  isDefaultBranch: boolean;
  isAgentBranch: boolean;
  isReleaseBranch?: boolean;
  isProtectedBranch?: boolean;

  // Computed signals (set by sensor engine, used by condition engine)
  changeSize?: 'trivial' | 'small' | 'medium' | 'large' | 'massive';
  riskSignal?: 'low' | 'medium' | 'high';
}

export interface SensorResult {
  matched: boolean;
  sensor: string;
  operationData?: {
    title: string;
    summary: string;
    priority: OperationPriority;
    source: string;
    intent: string;
    suggestedIntent: string;
    eventContext: EventContext;
    repoFullName: string;
    branch: string;
    commitSha: string;
    prNumber?: number;
    externalId: string;
    sourcePayload: string;
  };
}

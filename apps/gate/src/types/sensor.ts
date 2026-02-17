/** Sensor engine types — GitHub webhook payloads and event context. */

import type { OperationPriority } from '@wooblay/types';

export interface CheckRunPayload {
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
  commits: { id: string; message: string; author: { username: string } }[];
  repository: {
    full_name: string;
    default_branch: string;
  };
  pusher: { name: string };
  sender?: { login: string; type?: string };
}

export interface EventContext {
  eventType: string;
  action: string;
  repo: string;
  branch: string;
  commitSha: string;
  author: string;
  authorType: string;
  prNumber?: number;
  prTitle?: string;
  prBody?: string;
  prDraft?: boolean;
  changedFiles?: number;
  checkName?: string;
  checkConclusion?: string;
  commitCount?: number;
  commitMessages?: string[];
  defaultBranch: string;
  isDefaultBranch: boolean;
  isAgentBranch: boolean;
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

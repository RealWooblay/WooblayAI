/**
 * Collector
 *
 * Pre-fetches all data needed for detectors so they can run as pure functions
 * with no DB queries. Supports two scopes:
 *   - Single receipt (on receipt.created)
 *   - Full task (on score.created or recompute)
 */

import type { PrismaClient } from '@prisma/client';
import type { AgentProfile, SpawnScope } from '@wooblay/types';

// ── Collected data types ──────────────────────────────────────────────────────

export interface CollectedToolCall {
  id: string;
  taskId: string | null;
  sessionId: string | null;
  agentPubkey: string;
  toolName: string;
  args: string;
  parsedArgs: Record<string, unknown>;
  riskTier: string;
  adapter: string | null;
  createdAt: Date;
}

export interface CollectedReceipt {
  id: string;
  toolCallId: string;
  agentPubkey: string;
  toolName: string;
  riskTier: string;
  policyDecision: string;
  policyRuleId: string | null;
  approvalDecision: string | null;
  approver: string | null;
  executionSummary: string | null;
  decisionTrail: string;
  chainPrev: string | null;
  timestamp: string;
  hash: string;
  createdAt: Date;
}

export interface CollectedExecution {
  id: string;
  toolCallId: string;
  status: string;
  stdout: string | null;
  stderr: string | null;
  exitCode: number | null;
  durationMs: number | null;
}

export interface CollectedApproval {
  id: string;
  toolCallId: string;
  status: string;
  approver: string | null;
  reason: string | null;
  decidedAt: Date | null;
}

export interface AgentContext {
  pubkey: string;
  name: string;
  status: string;
  trustLevel: string;
  trustScore: number;
  parentPubkey: string | null;
  spawnDepth: number;
  profile: AgentProfile | null;
  spawnScope: SpawnScope | null;
  allowlisted: boolean;
}

/**
 * The complete context passed to detectors.
 * All data is pre-fetched -- detectors are pure functions.
 */
export interface DetectorContext {
  toolCalls: CollectedToolCall[];
  receipts: CollectedReceipt[];
  executions: CollectedExecution[];
  approvals: CollectedApproval[];
  agent: AgentContext;
  taskId?: string;
  /** For single-receipt analysis, the specific receipt being analyzed. */
  focusReceiptId?: string;
  /** All sibling agents (same parent) for cross-lineage checks. */
  siblingPubkeys: string[];
  /** Recent tool calls from sibling agents. */
  siblingToolCalls: CollectedToolCall[];
}

// ── Collector functions ───────────────────────────────────────────────────────

/**
 * Collect data for a single receipt analysis (triggered on receipt.created).
 */
export async function collectForReceipt(
  prisma: PrismaClient,
  receiptId: string,
): Promise<DetectorContext | null> {
  const receipt = await prisma.receipt.findUnique({
    where: { id: receiptId },
    include: {
      toolCall: {
        include: {
          approval: true,
          execution: true,
        },
      },
    },
  });

  if (!receipt) return null;

  const agent = await getAgentContext(prisma, receipt.agentPubkey);
  if (!agent) return null;

  // Get recent tool calls for this agent (for pattern detection)
  const recentCalls = await prisma.toolCall.findMany({
    where: { agentPubkey: receipt.agentPubkey },
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: { receipt: true, execution: true, approval: true },
  });

  const recentReceipts = await prisma.receipt.findMany({
    where: { agentPubkey: receipt.agentPubkey },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  const { siblingPubkeys, siblingToolCalls } = await getSiblingContext(prisma, agent);

  return {
    toolCalls: recentCalls.map(mapToolCall),
    receipts: recentReceipts.map(mapReceipt),
    executions: recentCalls
      .filter((tc) => tc.execution)
      .map((tc) => mapExecution(tc.execution!)),
    approvals: recentCalls
      .filter((tc) => tc.approval)
      .map((tc) => mapApproval(tc.approval!)),
    agent,
    taskId: receipt.toolCall.taskId ?? undefined,
    focusReceiptId: receiptId,
    siblingPubkeys,
    siblingToolCalls,
  };
}

/**
 * Collect data for a full task analysis (triggered on score.created or recompute).
 */
export async function collectForTask(
  prisma: PrismaClient,
  taskId: string,
  agentPubkey: string,
): Promise<DetectorContext | null> {
  const agent = await getAgentContext(prisma, agentPubkey);
  if (!agent) return null;

  const toolCalls = await prisma.toolCall.findMany({
    where: { taskId, agentPubkey },
    orderBy: { createdAt: 'asc' },
    include: { receipt: true, execution: true, approval: true },
  });

  const receipts = await prisma.receipt.findMany({
    where: {
      toolCallId: { in: toolCalls.map((tc) => tc.id) },
    },
    orderBy: { createdAt: 'asc' },
  });

  const { siblingPubkeys, siblingToolCalls } = await getSiblingContext(prisma, agent);

  return {
    toolCalls: toolCalls.map(mapToolCall),
    receipts: receipts.map(mapReceipt),
    executions: toolCalls
      .filter((tc) => tc.execution)
      .map((tc) => mapExecution(tc.execution!)),
    approvals: toolCalls
      .filter((tc) => tc.approval)
      .map((tc) => mapApproval(tc.approval!)),
    agent,
    taskId,
    siblingPubkeys,
    siblingToolCalls,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getAgentContext(
  prisma: PrismaClient,
  pubkey: string,
): Promise<AgentContext | null> {
  const agent = await prisma.agent.findUnique({ where: { pubkey } });
  if (!agent) return null;

  let profile: AgentProfile | null = null;
  if (agent.profileJson) {
    try {
      profile = JSON.parse(agent.profileJson) as AgentProfile;
    } catch { /* corrupted */ }
  }

  // Get spawn scope from most recent attestation
  let spawnScope: SpawnScope | null = null;
  const attestation = await prisma.spawnAttestation.findFirst({
    where: { spawnedPubkey: pubkey },
    orderBy: { createdAt: 'desc' },
  });
  if (attestation?.scopeJson) {
    try {
      spawnScope = JSON.parse(attestation.scopeJson) as SpawnScope;
    } catch { /* corrupted */ }
  }

  return {
    pubkey: agent.pubkey,
    name: agent.name,
    status: agent.status,
    trustLevel: agent.trustLevel,
    trustScore: agent.trustScore,
    parentPubkey: agent.parentPubkey,
    spawnDepth: agent.spawnDepth,
    profile,
    spawnScope,
    allowlisted: agent.allowlisted,
  };
}

async function getSiblingContext(
  prisma: PrismaClient,
  agent: AgentContext,
): Promise<{ siblingPubkeys: string[]; siblingToolCalls: CollectedToolCall[] }> {
  if (!agent.parentPubkey) {
    return { siblingPubkeys: [], siblingToolCalls: [] };
  }

  const siblings = await prisma.agent.findMany({
    where: { parentPubkey: agent.parentPubkey, pubkey: { not: agent.pubkey } },
    select: { pubkey: true },
  });

  const siblingPubkeys = siblings.map((s) => s.pubkey);

  if (siblingPubkeys.length === 0) {
    return { siblingPubkeys, siblingToolCalls: [] };
  }

  const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);
  const siblingCalls = await prisma.toolCall.findMany({
    where: {
      agentPubkey: { in: siblingPubkeys },
      createdAt: { gte: thirtyMinAgo },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  return {
    siblingPubkeys,
    siblingToolCalls: siblingCalls.map(mapToolCall),
  };
}

function mapToolCall(tc: {
  id: string;
  taskId: string | null;
  sessionId: string | null;
  agentPubkey: string;
  toolName: string;
  args: string;
  riskTier: string;
  adapter: string | null;
  createdAt: Date;
}): CollectedToolCall {
  let parsedArgs: Record<string, unknown> = {};
  try {
    parsedArgs = JSON.parse(tc.args);
  } catch { /* not JSON */ }

  return { ...tc, parsedArgs };
}

function mapReceipt(r: {
  id: string;
  toolCallId: string;
  agentPubkey: string;
  toolName: string;
  riskTier: string;
  policyDecision: string;
  policyRuleId: string | null;
  approvalDecision: string | null;
  approver: string | null;
  executionSummary: string | null;
  decisionTrail: string;
  chainPrev: string | null;
  timestamp: string;
  hash: string;
  createdAt: Date;
}): CollectedReceipt {
  return r;
}

function mapExecution(e: {
  id: string;
  toolCallId: string;
  status: string;
  stdout: string | null;
  stderr: string | null;
  exitCode: number | null;
  durationMs: number | null;
}): CollectedExecution {
  return e;
}

function mapApproval(a: {
  id: string;
  toolCallId: string;
  status: string;
  approver: string | null;
  reason: string | null;
  decidedAt: Date | null;
}): CollectedApproval {
  return a;
}

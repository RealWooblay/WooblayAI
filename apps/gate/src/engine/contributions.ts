/**
 * Agent contribution analytics.
 *
 * Computes what an agent actually accomplished from existing tool call data:
 *   - Files created/edited
 *   - Commands executed
 *   - Lines written (approximate)
 *   - PRs/commits detected
 *   - Research actions
 *   - Approval efficiency
 *   - Denial rate
 */

import type { PrismaClient } from '@prisma/client';
import { assessContributions, isAIEnabled, type ContributionAssessment } from '../services/ai-supervisor.js';

export interface ContributionSummary {
  filesCreated: number;
  filesEdited: number;
  commandsExecuted: number;
  linesWritten: number;
  prsAndCommits: number;
  researchActions: number;
  approvalEfficiency: string;
  denialRate: string;
  totalActions: number;
}

export interface ContributionsByCategory {
  planning: number;   // read, web_search, web_fetch (read), memory
  executing: number;  // exec, write, edit
  blocked: number;    // denied actions
}

export interface ContributionResult {
  summary: ContributionSummary;
  byCategory: ContributionsByCategory;
  byDay: Array<{ date: string; count: number }>;
  aiAssessment?: ContributionAssessment | null;
}

export async function computeContributions(
  prisma: PrismaClient,
  filter: { agentPubkey?: string; instanceId?: string },
): Promise<ContributionResult> {
  const where: Record<string, unknown> = {};
  if (filter.agentPubkey) where.agentPubkey = filter.agentPubkey;

  const toolCalls = await prisma.toolCall.findMany({
    where,
    include: {
      receipt: { select: { policyDecision: true, approvalDecision: true } },
      execution: { select: { status: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  const writePaths = new Set<string>();
  const editPaths = new Set<string>();
  let commandsExecuted = 0;
  let linesWritten = 0;
  let prsAndCommits = 0;
  let researchActions = 0;
  let planning = 0;
  let executing = 0;
  let blocked = 0;
  let autoAllowed = 0;
  let humanApproved = 0;
  let denied = 0;

  // By day aggregation
  const dayMap = new Map<string, number>();

  for (const tc of toolCalls) {
    const tool = tc.toolName.replace(/^(gated_|wooblay_)/, '');
    const day = tc.createdAt.toISOString().slice(0, 10);
    dayMap.set(day, (dayMap.get(day) ?? 0) + 1);

    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(tc.args);
    } catch {
      // keep empty
    }

    const decision = tc.receipt?.policyDecision;
    const approvalDecision = tc.receipt?.approvalDecision;

    if (decision === 'DENY' || approvalDecision === 'DENIED') {
      blocked++;
      denied++;
      continue;
    }

    if (decision === 'ALLOW') autoAllowed++;
    if (approvalDecision === 'APPROVED') humanApproved++;

    switch (tool) {
      case 'write': {
        const path = String(args['path'] ?? args['file'] ?? '');
        if (path) writePaths.add(path);
        const content = String(args['content'] ?? '');
        linesWritten += content.split('\n').length;
        executing++;
        break;
      }
      case 'edit': {
        const path = String(args['path'] ?? args['file'] ?? '');
        if (path) editPaths.add(path);
        executing++;
        break;
      }
      case 'exec': {
        commandsExecuted++;
        executing++;
        const cmd = String(args['command'] ?? args['cmd'] ?? '');
        if (/\bgit\s+(push|commit)\b/.test(cmd) || /\bgh\s+pr\s+create\b/.test(cmd)) {
          prsAndCommits++;
        }
        break;
      }
      case 'read':
      case 'web_search':
      case 'memory_search':
      case 'memory_get':
        researchActions++;
        planning++;
        break;
      case 'web_fetch':
      case 'http':
        researchActions++;
        planning++;
        break;
      default:
        planning++;
        break;
    }
  }

  const totalActions = toolCalls.length;
  const needingReview = humanApproved + denied;
  const efficiency = totalActions > 0
    ? ((autoAllowed / totalActions) * 100).toFixed(1) + '%'
    : '0%';
  const denialPct = totalActions > 0
    ? ((denied / totalActions) * 100).toFixed(1) + '%'
    : '0%';

  // Last 7 days
  const byDay: Array<{ date: string; count: number }> = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    byDay.push({ date: key, count: dayMap.get(key) ?? 0 });
  }

  // AI assessment (if enabled)
  let aiAssessment: ContributionAssessment | null = null;
  if (isAIEnabled() && toolCalls.length > 0) {
    try {
      aiAssessment = await assessContributions(
        toolCalls.map((tc) => ({
          toolName: tc.toolName,
          args: tc.args,
          status: tc.receipt?.policyDecision === 'DENY' ? 'denied'
            : tc.receipt?.approvalDecision === 'DENIED' ? 'denied'
            : tc.receipt?.policyDecision === 'ALLOW' ? 'auto-allowed'
            : 'approved',
          createdAt: tc.createdAt.toISOString(),
        })),
      );
    } catch {
      // Non-critical — continue without AI
    }
  }

  return {
    summary: {
      filesCreated: writePaths.size,
      filesEdited: editPaths.size,
      commandsExecuted,
      linesWritten,
      prsAndCommits,
      researchActions,
      approvalEfficiency: efficiency,
      denialRate: denialPct,
      totalActions,
    },
    byCategory: { planning, executing, blocked },
    byDay,
    aiAssessment,
  };
}

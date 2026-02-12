/**
 * Audit Analysis Engine
 *
 * Detects anomalous patterns in agent behavior and auto-raises flags.
 * Runs lightweight checks on every tool call + periodic batch analysis.
 */

import type { PrismaClient } from '@prisma/client';

// ── Sensitive path patterns ──────────────────────────────────────────────────

const SENSITIVE_PATH_PATTERNS = [
  /\/etc\b/,
  /\/root\b/,
  /~?\/?\.ssh\b/,
  /\/var\/log\b/,
  /\.env\b/,
  /\.git\/config\b/,
  /id_rsa\b/,
  /credentials\b/,
  /secrets?\b/,
];

// ── Privilege escalation patterns ────────────────────────────────────────────

const PRIVILEGE_ESCALATION_PATTERNS = [
  /\bsudo\b/,
  /\bsu\s+/,
  /\bchmod\s+777\b/,
  /\bchown\s+root\b/,
];

// ── Off-hours window (UTC) ───────────────────────────────────────────────────

const OFF_HOURS_START = parseInt(process.env['AUDIT_OFF_HOURS_START'] ?? '0', 10);
const OFF_HOURS_END = parseInt(process.env['AUDIT_OFF_HOURS_END'] ?? '6', 10);

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Returns the start of the current hour (used for dedup windows). */
function currentHourStart(): Date {
  const now = new Date();
  now.setMinutes(0, 0, 0);
  return now;
}

/**
 * Check if a similar flag already exists in the current hour to avoid
 * duplicate spam.
 */
async function flagExistsThisHour(
  prisma: PrismaClient,
  category: string,
  agentPubkey: string | null,
): Promise<boolean> {
  const hourStart = currentHourStart();
  const count = await prisma.auditFlag.count({
    where: {
      category,
      agentPubkey: agentPubkey ?? undefined,
      createdAt: { gte: hourStart },
    },
  });
  return count > 0;
}

/** Create a flag record if one doesn't already exist this hour. */
async function maybeCreateFlag(
  prisma: PrismaClient,
  data: {
    severity: string;
    category: string;
    title: string;
    description: string;
    agentPubkey?: string | null;
    toolCallId?: string | null;
    metadata?: Record<string, unknown> | null;
  },
) {
  const exists = await flagExistsThisHour(prisma, data.category, data.agentPubkey ?? null);
  if (exists) return null;

  return prisma.auditFlag.create({
    data: {
      severity: data.severity,
      category: data.category,
      title: data.title,
      description: data.description,
      agentPubkey: data.agentPubkey ?? null,
      toolCallId: data.toolCallId ?? null,
      metadata: data.metadata ? JSON.stringify(data.metadata) : null,
    },
  });
}

// ── Per-tool-call analysis ───────────────────────────────────────────────────

interface ToolCallRecord {
  id: string;
  agentPubkey: string;
  toolName: string;
  args: string;
  riskTier: string;
  createdAt: Date;
}

/**
 * Analyze a single tool call for anomalies. Called after every tool call is
 * created. Returns an array of newly-created flags (may be empty).
 */
export async function analyzeToolCall(
  prisma: PrismaClient,
  toolCall: ToolCallRecord,
): Promise<unknown[]> {
  const flags: unknown[] = [];

  let parsedArgs: Record<string, unknown> = {};
  try {
    parsedArgs = JSON.parse(toolCall.args);
  } catch {
    // args may not be JSON — that's ok
  }

  const command = String(parsedArgs['command'] ?? parsedArgs['cmd'] ?? '');

  // 1. Velocity anomaly
  const sixtySecondsAgo = new Date(Date.now() - 60_000);
  const recentCount = await prisma.toolCall.count({
    where: {
      agentPubkey: toolCall.agentPubkey,
      createdAt: { gte: sixtySecondsAgo },
    },
  });

  if (recentCount > 30) {
    const flag = await maybeCreateFlag(prisma, {
      severity: 'HIGH',
      category: 'velocity_anomaly',
      title: 'Extreme tool call velocity',
      description: `Agent ${toolCall.agentPubkey} made ${recentCount} tool calls in the last 60 seconds (threshold: 30).`,
      agentPubkey: toolCall.agentPubkey,
      toolCallId: toolCall.id,
      metadata: { recentCount, windowSeconds: 60, threshold: 30 },
    });
    if (flag) flags.push(flag);
  } else if (recentCount > 10) {
    const flag = await maybeCreateFlag(prisma, {
      severity: 'MEDIUM',
      category: 'velocity_anomaly',
      title: 'High tool call velocity',
      description: `Agent ${toolCall.agentPubkey} made ${recentCount} tool calls in the last 60 seconds (threshold: 10).`,
      agentPubkey: toolCall.agentPubkey,
      toolCallId: toolCall.id,
      metadata: { recentCount, windowSeconds: 60, threshold: 10 },
    });
    if (flag) flags.push(flag);
  }

  // 2. Sensitive path access
  if (toolCall.toolName === 'wooblay_exec' && command) {
    for (const pattern of SENSITIVE_PATH_PATTERNS) {
      if (pattern.test(command)) {
        const flag = await maybeCreateFlag(prisma, {
          severity: 'HIGH',
          category: 'sensitive_access',
          title: 'Sensitive path access detected',
          description: `Agent ${toolCall.agentPubkey} executed a command referencing a sensitive path: ${command.slice(0, 200)}`,
          agentPubkey: toolCall.agentPubkey,
          toolCallId: toolCall.id,
          metadata: { command: command.slice(0, 500), matchedPattern: pattern.source },
        });
        if (flag) flags.push(flag);
        break; // one flag per tool call for this category
      }
    }
  }

  // 3. Privilege escalation
  if (toolCall.toolName === 'wooblay_exec' && command) {
    for (const pattern of PRIVILEGE_ESCALATION_PATTERNS) {
      if (pattern.test(command)) {
        const flag = await maybeCreateFlag(prisma, {
          severity: 'CRITICAL',
          category: 'privilege_escalation',
          title: 'Privilege escalation attempt',
          description: `Agent ${toolCall.agentPubkey} attempted privilege escalation: ${command.slice(0, 200)}`,
          agentPubkey: toolCall.agentPubkey,
          toolCallId: toolCall.id,
          metadata: { command: command.slice(0, 500), matchedPattern: pattern.source },
        });
        if (flag) flags.push(flag);
        break;
      }
    }
  }

  // 4. Repeated denial retries (evasion pattern)
  const recentCalls = await prisma.toolCall.findMany({
    where: { agentPubkey: toolCall.agentPubkey },
    orderBy: { createdAt: 'desc' },
    take: 10,
    include: { receipt: true },
  });

  const deniedCalls = recentCalls.filter(
    (tc) => tc.receipt?.policyDecision === 'DENY',
  );

  if (deniedCalls.length >= 3) {
    const similarDenied = deniedCalls.filter(
      (tc) => tc.toolName === toolCall.toolName,
    );
    if (similarDenied.length >= 3) {
      const flag = await maybeCreateFlag(prisma, {
        severity: 'HIGH',
        category: 'evasion_pattern',
        title: 'Repeated denial retries',
        description: `Agent ${toolCall.agentPubkey} retried "${toolCall.toolName}" after ${similarDenied.length} denials in recent calls.`,
        agentPubkey: toolCall.agentPubkey,
        toolCallId: toolCall.id,
        metadata: {
          deniedCount: similarDenied.length,
          toolName: toolCall.toolName,
          deniedToolCallIds: similarDenied.map((tc) => tc.id),
        },
      });
      if (flag) flags.push(flag);
    }
  }

  return flags;
}

// ── Batch analysis ───────────────────────────────────────────────────────────

/**
 * Run batch analysis across all agents. More expensive — meant to be
 * triggered on-demand via API.
 */
export async function runBatchAnalysis(prisma: PrismaClient): Promise<unknown[]> {
  const flags: unknown[] = [];
  const oneHourAgo = new Date(Date.now() - 3_600_000);

  // 1. Session anomaly — agents with >50% WRITE or DESTRUCTIVE calls in the last hour
  const agents = await prisma.agent.findMany({ select: { pubkey: true } });

  for (const agent of agents) {
    const totalCalls = await prisma.toolCall.count({
      where: { agentPubkey: agent.pubkey, createdAt: { gte: oneHourAgo } },
    });

    if (totalCalls === 0) continue;

    const writeCalls = await prisma.toolCall.count({
      where: {
        agentPubkey: agent.pubkey,
        createdAt: { gte: oneHourAgo },
        riskTier: { in: ['WRITE', 'DESTRUCTIVE'] },
      },
    });

    if (writeCalls / totalCalls > 0.5) {
      const flag = await maybeCreateFlag(prisma, {
        severity: 'MEDIUM',
        category: 'unusual_pattern',
        title: 'High write/destructive ratio',
        description: `Agent ${agent.pubkey} has ${writeCalls}/${totalCalls} (${Math.round((writeCalls / totalCalls) * 100)}%) write/destructive calls in the last hour.`,
        agentPubkey: agent.pubkey,
        metadata: { totalCalls, writeCalls, ratio: writeCalls / totalCalls },
      });
      if (flag) flags.push(flag);
    }
  }

  // 2. Denied then retry — find sequences where DENY was followed by similar tool call within 5 min
  for (const agent of agents) {
    const calls = await prisma.toolCall.findMany({
      where: { agentPubkey: agent.pubkey, createdAt: { gte: oneHourAgo } },
      orderBy: { createdAt: 'asc' },
      include: { receipt: true },
    });

    for (let i = 0; i < calls.length; i++) {
      const call = calls[i];
      if (call.receipt?.policyDecision !== 'DENY') continue;

      // Look for a retry within 5 minutes
      const fiveMinLater = new Date(call.createdAt.getTime() + 5 * 60_000);
      for (let j = i + 1; j < calls.length; j++) {
        const nextCall = calls[j];
        if (nextCall.createdAt > fiveMinLater) break;
        if (nextCall.toolName === call.toolName) {
          const flag = await maybeCreateFlag(prisma, {
            severity: 'HIGH',
            category: 'evasion_pattern',
            title: 'Retry after denial',
            description: `Agent ${agent.pubkey} retried "${call.toolName}" within 5 minutes of a denial.`,
            agentPubkey: agent.pubkey,
            toolCallId: nextCall.id,
            metadata: {
              deniedToolCallId: call.id,
              retryToolCallId: nextCall.id,
              gapSeconds: Math.round(
                (nextCall.createdAt.getTime() - call.createdAt.getTime()) / 1000,
              ),
            },
          });
          if (flag) flags.push(flag);
          break; // only flag once per denied call
        }
      }
    }
  }

  // 3. Off-hours activity
  const recentCalls = await prisma.toolCall.findMany({
    where: { createdAt: { gte: oneHourAgo } },
    select: { id: true, agentPubkey: true, createdAt: true },
  });

  for (const call of recentCalls) {
    const hour = call.createdAt.getUTCHours();
    if (hour >= OFF_HOURS_START && hour < OFF_HOURS_END) {
      const flag = await maybeCreateFlag(prisma, {
        severity: 'LOW',
        category: 'unusual_pattern',
        title: 'Off-hours activity',
        description: `Agent ${call.agentPubkey} made a tool call at ${call.createdAt.toISOString()} (off-hours: ${OFF_HOURS_START}:00-${OFF_HOURS_END}:00 UTC).`,
        agentPubkey: call.agentPubkey,
        toolCallId: call.id,
        metadata: { hour, offHoursStart: OFF_HOURS_START, offHoursEnd: OFF_HOURS_END },
      });
      if (flag) flags.push(flag);
    }
  }

  return flags;
}

// ── Human-readable descriptions ──────────────────────────────────────────────

/**
 * Produce a human-readable description of what a tool call does.
 */
export function describeToolCall(
  toolName: string,
  args: Record<string, unknown>,
): string {
  switch (toolName) {
    case 'wooblay_exec': {
      const command = String(args['command'] ?? args['cmd'] ?? '').trim();
      if (!command) return 'Execute an empty shell command';

      // Parse the base command
      const parts = command.split(/\s+/);
      const base = parts[0];

      switch (base) {
        case 'ls': {
          const lsTarget = parts.filter((p) => !p.startsWith('-')).slice(1).join(' ');
          return `List files in ${lsTarget || 'current directory'}`;
        }
        case 'mkdir':
          return `Create directory ${parts.filter((p) => !p.startsWith('-')).slice(1).join(' ') || '<path>'}`;
        case 'rm': {
          const hasR = /\s-\w*r/.test(command) || /\s--recursive/.test(command);
          const hasF = /\s-\w*f/.test(command) || /\s--force/.test(command);
          const target = parts.filter((p) => !p.startsWith('-')).slice(1).join(' ') || '<path>';
          if (hasR && hasF) return `Delete ${target} and all contents (forced, recursive) ⚠️`;
          if (hasR) return `Delete ${target} and all contents (recursive) ⚠️`;
          if (hasF) return `Delete ${target} (forced) ⚠️`;
          return `Delete ${target}`;
        }
        case 'curl':
        case 'wget': {
          const url = parts.find((p) => p.startsWith('http')) ?? parts[1] ?? '<url>';
          return `Download from ${url}`;
        }
        case 'git': {
          const subcommand = parts[1] ?? '';
          if (subcommand === 'push') return 'Push changes to remote repository';
          if (subcommand === 'pull') return 'Pull changes from remote repository';
          if (subcommand === 'clone') return `Clone repository ${parts[2] ?? ''}`;
          if (subcommand === 'commit') return 'Commit staged changes';
          return `Git ${subcommand}: ${command}`;
        }
        case 'npm': {
          const sub = parts[1] ?? '';
          if (sub === 'install' || sub === 'i') return 'Install npm packages';
          if (sub === 'publish') return 'Publish npm package';
          return `npm ${sub}`;
        }
        case 'sudo':
          return `Execute with superuser privileges: ${parts.slice(1).join(' ')} ⚠️`;
        case 'chmod':
          return `Change permissions on ${parts.filter((p) => !p.startsWith('-')).slice(1).join(' ') || '<path>'}`;
        case 'chown':
          return `Change ownership of ${parts.filter((p) => !p.startsWith('-')).slice(1).join(' ') || '<path>'}`;
        case 'cat':
          return `Read file ${parts[1] ?? '<path>'}`;
        case 'cd':
          return `Change directory to ${parts[1] ?? '<path>'}`;
        case 'cp':
          return `Copy ${parts.filter((p) => !p.startsWith('-')).slice(1).join(' to ') || 'files'}`;
        case 'mv':
          return `Move ${parts.filter((p) => !p.startsWith('-')).slice(1).join(' to ') || 'files'}`;
        default:
          return `Execute: ${command.length > 120 ? command.slice(0, 120) + '…' : command}`;
      }
    }

    case 'wooblay_http': {
      const method = String(args['method'] ?? 'GET').toUpperCase();
      const url = String(args['url'] ?? args['endpoint'] ?? '<url>');
      return `Make ${method} request to ${url}`;
    }

    case 'wooblay_browser': {
      const action = String(args['action'] ?? args['type'] ?? 'navigate');
      const target = String(args['url'] ?? args['selector'] ?? '<target>');
      return `Browser action: ${action} on ${target}`;
    }

    default:
      return `Call tool "${toolName}" with ${Object.keys(args).length} argument(s)`;
  }
}

/**
 * Explain why a tool call is classified at its risk tier.
 */
export function describeRisk(
  riskTier: string,
  toolName: string,
  args: Record<string, unknown>,
): string {
  switch (riskTier) {
    case 'DESTRUCTIVE': {
      const command = String(args['command'] ?? args['cmd'] ?? '');
      if (/\bsudo\b/.test(command)) return 'This command requires root access and could modify critical system state';
      if (/\brm\s/.test(command)) return 'This command permanently deletes data';
      if (/\bchmod\s+777\b/.test(command)) return 'This command sets world-writable permissions, a security risk';
      if (/\bmkfs\b/.test(command) || /\bdd\b/.test(command) || /\bfdisk\b/.test(command)) {
        return 'This command modifies disk/partition layout and can cause permanent data loss';
      }
      if (toolName === 'wooblay_http') return 'This HTTP DELETE request permanently removes remote data';
      return 'This command permanently deletes data or modifies system configuration';
    }

    case 'WRITE': {
      const command = String(args['command'] ?? args['cmd'] ?? '');
      if (/\bgit\s+(push|commit|merge)\b/.test(command)) return 'This command pushes code or modifies version control history';
      if (/\bnpm\s+(install|publish)\b/.test(command) || /\bpip\s+install\b/.test(command)) {
        return 'This command installs packages which may introduce dependencies';
      }
      if (toolName === 'wooblay_http') return 'This HTTP request modifies remote data';
      if (toolName === 'wooblay_browser') return 'Browser automation can mutate external state';
      return 'This command modifies files, installs packages, or pushes code';
    }

    case 'READ':
      return 'This command only reads data, no side effects expected';

    default:
      return `Risk tier "${riskTier}" — review the command details`;
  }
}

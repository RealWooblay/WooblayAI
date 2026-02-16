/**
 * Rule-based flag detection engine.
 *
 * Detects anomalous agent behaviour patterns without external AI APIs:
 *   - Velocity anomaly: >10 tool calls from same agent in 60 seconds
 *   - Retry loop: same tool+args called 3+ times in 5 minutes
 *   - Privilege escalation: agent denied then attempts similar action
 *   - Sensitive access: commands touching /etc, .env, .ssh, credentials
 *
 * Called asynchronously after each tool call (non-blocking).
 */

import type { PrismaClient, ToolCall } from '@prisma/client';
import { assessThreat, analyzeBehavior, inferRole, isAIEnabled } from '../services/ai-supervisor.js';

interface FlagInput {
  toolCallId: string;
  agentPubkey: string;
  toolName: string;
  args: string;
  riskTier: string;
  category?: string | null;
  instanceId?: string | null;
}

/**
 * Run all flag detectors for a given tool call.
 * Writes any detected flags to the AuditFlag table.
 *
 * Layer 1: Rule-based (instant, always runs)
 * Layer 2: AI-powered (async, runs if OpenAI key configured)
 */
export async function detectFlags(
  prisma: PrismaClient,
  input: FlagInput,
): Promise<void> {
  try {
    // Layer 1: Rule-based (fast, deterministic)
    await Promise.all([
      detectVelocityAnomaly(prisma, input),
      detectRetryLoop(prisma, input),
      detectPrivilegeEscalation(prisma, input),
      detectSensitiveAccess(prisma, input),
    ]);

    // Layer 2: AI-powered (async, non-blocking)
    if (isAIEnabled()) {
      // Run AI analysis in background — don't await to avoid slowing the response
      runAIAnalysis(prisma, input).catch((err) =>
        console.warn('[flags] AI analysis error (non-critical):', err),
      );
    }
  } catch (err) {
    // Non-blocking — log but don't throw
    console.error('[flags] Detection error:', err);
  }
}

/**
 * Resolve the effective agent role from the instance.
 */
async function getAgentRole(prisma: PrismaClient, instanceId?: string | null): Promise<string | null> {
  if (!instanceId) {
    // Try to find the most recent instance
    const instance = await prisma.instance.findFirst({ orderBy: { updatedAt: 'desc' } });
    return instance?.role ?? instance?.inferredRole ?? null;
  }
  const instance = await prisma.instance.findUnique({ where: { id: instanceId } });
  return instance?.role ?? instance?.inferredRole ?? null;
}

/**
 * AI-powered threat assessment and behavioral analysis.
 * Runs asynchronously after rule-based detection.
 */
async function runAIAnalysis(
  prisma: PrismaClient,
  input: FlagInput,
): Promise<void> {
  // Get recent actions for context
  const recentActions = await prisma.toolCall.findMany({
    where: { agentPubkey: input.agentPubkey },
    orderBy: { createdAt: 'desc' },
    take: 15,
    select: { toolName: true, args: true, riskTier: true, category: true, createdAt: true },
  });

  let parsedArgs: Record<string, unknown> = {};
  try {
    parsedArgs = JSON.parse(input.args);
  } catch {
    // keep empty
  }

  // Resolve agent role for context
  const agentRole = await getAgentRole(prisma, input.instanceId);

  // 1. Real-time threat assessment with role context + pattern anomaly detection
  const threat = await assessThreat(
    input.toolName,
    parsedArgs,
    input.riskTier,
    recentActions.map((a) => ({ toolName: a.toolName, args: a.args, riskTier: a.riskTier, category: a.category })),
    agentRole,
    input.category,
  );

  if (threat && threat.threatLevel !== 'none' && threat.concerns.length > 0) {
    const severityMap: Record<string, string> = {
      critical: 'CRITICAL',
      high: 'HIGH',
      medium: 'MEDIUM',
      low: 'LOW',
    };

    await prisma.auditFlag.create({
      data: {
        severity: severityMap[threat.threatLevel] ?? 'MEDIUM',
        category: 'ai_threat_assessment',
        title: `AI: ${threat.summary.slice(0, 100)}`,
        description: threat.summary + '\n\nConcerns:\n' + threat.concerns.map((c) => `• ${c}`).join('\n'),
        agentPubkey: input.agentPubkey,
        toolCallId: input.toolCallId,
        metadata: JSON.stringify({
          threatLevel: threat.threatLevel,
          recommendation: threat.recommendation,
          concerns: threat.concerns,
          agentRole: agentRole ?? null,
          category: input.category ?? null,
          model: 'ai-supervisor',
        }),
      },
    });
  }

  // 2. Periodic behavioral analysis + role inference (every 10th action to avoid cost)
  const actionCount = await prisma.toolCall.count({
    where: { agentPubkey: input.agentPubkey },
  });

  if (actionCount > 0 && actionCount % 10 === 0) {
    const actionsWithStatus = await prisma.toolCall.findMany({
      where: { agentPubkey: input.agentPubkey },
      orderBy: { createdAt: 'desc' },
      take: 30,
      include: { approval: { select: { status: true } }, receipt: { select: { policyDecision: true } } },
    });

    const enriched = actionsWithStatus.map((a) => ({
      toolName: a.toolName,
      args: a.args,
      riskTier: a.riskTier,
      category: a.category,
      createdAt: a.createdAt.toISOString(),
      status: a.approval?.status === 'DENIED' ? 'denied'
        : a.approval?.status === 'APPROVED' ? 'approved'
        : a.receipt?.policyDecision === 'ALLOW' ? 'auto-allowed'
        : a.receipt?.policyDecision === 'DENY' ? 'denied'
        : 'pending',
    }));

    // Behavior analysis with role context
    const patterns = await analyzeBehavior(input.agentPubkey, enriched, agentRole);

    for (const p of patterns) {
      await prisma.auditFlag.create({
        data: {
          severity: p.severity,
          category: `ai_${p.pattern}`,
          title: `AI: ${p.title}`,
          description: p.description + '\n\nEvidence:\n' + p.evidence.map((e) => `• ${e}`).join('\n'),
          agentPubkey: input.agentPubkey,
          toolCallId: input.toolCallId,
          metadata: JSON.stringify({
            pattern: p.pattern,
            evidence: p.evidence,
            agentRole: agentRole ?? null,
            model: 'ai-supervisor',
          }),
        },
      });
    }

    // 3. Role inference — update inferredRole on the instance
    if (input.instanceId || true) { // Always try to infer
      try {
        const roleResult = await inferRole(
          enriched.map(a => ({ toolName: a.toolName, args: a.args, category: a.category })),
        );
        if (roleResult && roleResult.confidence !== 'low') {
          // Find the instance to update (use first instance if no instanceId)
          const instance = input.instanceId
            ? await prisma.instance.findUnique({ where: { id: input.instanceId } })
            : await prisma.instance.findFirst({ orderBy: { updatedAt: 'desc' } });

          if (instance && !instance.role) {
            // Only update inferredRole if user hasn't set a manual override
            await prisma.instance.update({
              where: { id: instance.id },
              data: { inferredRole: roleResult.role },
            });
          }
        }
      } catch (err) {
        console.warn('[flags] Role inference failed (non-critical):', err);
      }
    }
  }
}

// ── Velocity anomaly ─────────────────────────────────────────────────────────

async function detectVelocityAnomaly(
  prisma: PrismaClient,
  input: FlagInput,
): Promise<void> {
  const oneMinuteAgo = new Date(Date.now() - 60_000);
  const count = await prisma.toolCall.count({
    where: {
      agentPubkey: input.agentPubkey,
      createdAt: { gte: oneMinuteAgo },
    },
  });

  if (count > 10) {
    await prisma.auditFlag.create({
      data: {
        severity: 'HIGH',
        category: 'velocity_anomaly',
        title: `High velocity: ${count} actions in 60s`,
        description: `Agent ${input.agentPubkey.slice(0, 12)}... made ${count} tool calls in the last 60 seconds, exceeding the threshold of 10.`,
        agentPubkey: input.agentPubkey,
        toolCallId: input.toolCallId,
        metadata: JSON.stringify({ count, windowSeconds: 60, threshold: 10 }),
      },
    });
  }
}

// ── Retry loop ───────────────────────────────────────────────────────────────

async function detectRetryLoop(
  prisma: PrismaClient,
  input: FlagInput,
): Promise<void> {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60_000);
  const similar = await prisma.toolCall.count({
    where: {
      agentPubkey: input.agentPubkey,
      toolName: input.toolName,
      args: input.args,
      createdAt: { gte: fiveMinutesAgo },
    },
  });

  if (similar >= 3) {
    await prisma.auditFlag.create({
      data: {
        severity: 'MEDIUM',
        category: 'unusual_pattern',
        title: `Retry loop detected: ${input.toolName} called ${similar}x`,
        description: `Agent ${input.agentPubkey.slice(0, 12)}... called ${input.toolName} with identical arguments ${similar} times in the last 5 minutes, suggesting a retry loop.`,
        agentPubkey: input.agentPubkey,
        toolCallId: input.toolCallId,
        metadata: JSON.stringify({ toolName: input.toolName, count: similar, windowMinutes: 5 }),
      },
    });
  }
}

// ── Privilege escalation ─────────────────────────────────────────────────────

async function detectPrivilegeEscalation(
  prisma: PrismaClient,
  input: FlagInput,
): Promise<void> {
  // Check if there was a recent DENIED approval for same agent + similar tool
  const tenMinutesAgo = new Date(Date.now() - 10 * 60_000);
  const recentDenials = await prisma.approval.findMany({
    where: {
      status: 'DENIED',
      decidedAt: { gte: tenMinutesAgo },
      toolCall: {
        agentPubkey: input.agentPubkey,
        toolName: input.toolName,
      },
    },
    take: 1,
  });

  if (recentDenials.length > 0) {
    await prisma.auditFlag.create({
      data: {
        severity: 'HIGH',
        category: 'privilege_escalation',
        title: `Retry after denial: ${input.toolName}`,
        description: `Agent ${input.agentPubkey.slice(0, 12)}... attempted ${input.toolName} after being denied the same tool within the last 10 minutes. This may indicate escalation or evasion.`,
        agentPubkey: input.agentPubkey,
        toolCallId: input.toolCallId,
        metadata: JSON.stringify({
          deniedApprovalId: recentDenials[0].id,
          toolName: input.toolName,
        }),
      },
    });
  }
}

// ── Sensitive access ─────────────────────────────────────────────────────────

const SENSITIVE_PATTERNS = [
  /\/etc\//,
  /\.env/,
  /\.ssh/,
  /credentials/i,
  /\.aws\//,
  /password/i,
  /secret/i,
  /private[_-]?key/i,
  /\.pem$/,
  /\.key$/,
  /id_rsa/,
  /\/proc\//,
  /\/sys\//,
];

async function detectSensitiveAccess(
  prisma: PrismaClient,
  input: FlagInput,
): Promise<void> {
  const argsStr = input.args.toLowerCase();

  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.test(input.args) || pattern.test(argsStr)) {
      const matchedPattern = pattern.source;
      await prisma.auditFlag.create({
        data: {
          severity: 'CRITICAL',
          category: 'sensitive_access',
          title: `Sensitive access: ${matchedPattern}`,
          description: `Agent ${input.agentPubkey.slice(0, 12)}... accessed a sensitive path or credential (matched: ${matchedPattern}). Tool: ${input.toolName}.`,
          agentPubkey: input.agentPubkey,
          toolCallId: input.toolCallId,
          metadata: JSON.stringify({
            pattern: matchedPattern,
            toolName: input.toolName,
          }),
        },
      });
      return; // Only flag once per call
    }
  }
}

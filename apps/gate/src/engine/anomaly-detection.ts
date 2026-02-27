/**
 * Anomaly detection — simple heuristics against a rolling 7-day baseline.
 * Detects unusual agent behavior and pushes alerts to admins.
 */

import type { PrismaClient } from '@prisma/client';
import { sendNotification } from '../services/notifications.js';

export interface AnomalyAlert {
  type: 'action_rate_spike' | 'consecutive_denials' | 'unusual_tool_access' | 'cost_spike';
  severity: 'warning' | 'critical';
  title: string;
  description: string;
  agentId?: string;
  toolName?: string;
  suggestedAction: string;
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;

export async function checkForAnomalies(
  prisma: PrismaClient,
  orgId: string,
): Promise<AnomalyAlert[]> {
  const alerts: AnomalyAlert[] = [];
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - SEVEN_DAYS_MS);
  const oneHourAgo = new Date(now.getTime() - ONE_HOUR_MS);

  // Resolve org-scoped agent pubkeys via API keys
  const orgKeys = await prisma.apiKey.findMany({
    where: { orgId, revokedAt: null },
    select: { id: true },
  });
  const orgPubkeys = orgKeys.map((k) => `apikey:${k.id}`);
  if (orgPubkeys.length === 0) return alerts;

  const orgFilter = { agentPubkey: { in: orgPubkeys } };

  // 1. Action rate spike — current hour vs 7-day hourly average
  try {
    const [currentHourCount, sevenDayCount] = await Promise.all([
      prisma.toolCall.count({
        where: { ...orgFilter, createdAt: { gte: oneHourAgo } },
      }),
      prisma.toolCall.count({
        where: { ...orgFilter, createdAt: { gte: sevenDaysAgo } },
      }),
    ]);

    const hoursInPeriod = Math.max(1, (now.getTime() - sevenDaysAgo.getTime()) / ONE_HOUR_MS);
    const hourlyAvg = sevenDayCount / hoursInPeriod;

    if (hourlyAvg > 0 && currentHourCount > hourlyAvg * 5) {
      alerts.push({
        type: 'action_rate_spike',
        severity: currentHourCount > hourlyAvg * 10 ? 'critical' : 'warning',
        title: 'Action rate spike detected',
        description: `${currentHourCount} actions in the last hour (average: ${Math.round(hourlyAvg)}/hr)`,
        suggestedAction: 'Review agent activity. Consider pausing agents if unexpected.',
      });
    }
  } catch {
    // Non-critical
  }

  // 2. Consecutive denials
  try {
    const recentCalls = await prisma.toolCall.findMany({
      where: orgFilter,
      include: { receipt: { select: { policyDecision: true } } },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    let consecutiveDenials = 0;
    for (const call of recentCalls) {
      if (call.receipt?.policyDecision === 'DENY') {
        consecutiveDenials++;
      } else {
        break;
      }
    }

    if (consecutiveDenials >= 3) {
      alerts.push({
        type: 'consecutive_denials',
        severity: consecutiveDenials >= 5 ? 'critical' : 'warning',
        title: `${consecutiveDenials} consecutive denials`,
        description: `The last ${consecutiveDenials} tool calls were denied. An agent may be stuck retrying blocked actions.`,
        agentId: recentCalls[0]?.agentPubkey,
        suggestedAction: 'Check policy rules — an agent may need a different approach.',
      });
    }
  } catch {
    // Non-critical
  }

  // 3. Unusual tool access — tools used in last hour that were never used in prior 7 days
  try {
    const [recentTools, historicalToolCalls] = await Promise.all([
      prisma.toolCall.findMany({
        where: { ...orgFilter, createdAt: { gte: oneHourAgo } },
        select: { toolName: true },
        distinct: ['toolName'],
      }),
      prisma.toolCall.findMany({
        where: { ...orgFilter, createdAt: { gte: sevenDaysAgo, lt: oneHourAgo } },
        select: { toolName: true },
        distinct: ['toolName'],
      }),
    ]);

    const historicalTools = new Set(historicalToolCalls.map((t) => t.toolName));
    const newTools = recentTools.filter((t) => !historicalTools.has(t.toolName));

    for (const tool of newTools) {
      if (historicalTools.size > 0) {
        alerts.push({
          type: 'unusual_tool_access',
          severity: 'warning',
          title: `New tool accessed: ${tool.toolName}`,
          description: `${tool.toolName} was used for the first time. It hasn't been seen in the last 7 days.`,
          toolName: tool.toolName,
          suggestedAction: 'Verify this is expected. Consider creating a policy rule if needed.',
        });
      }
    }
  } catch {
    // Non-critical
  }

  // 4. Cost spike — today vs 7-day daily average (using RunCost.amountCents)
  try {
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    const [todayCosts, weekCosts] = await Promise.all([
      prisma.runCost.aggregate({
        where: { orgId, createdAt: { gte: todayStart } },
        _sum: { amountCents: true },
      }),
      prisma.runCost.aggregate({
        where: { orgId, createdAt: { gte: sevenDaysAgo } },
        _sum: { amountCents: true },
      }),
    ]);

    const todayTotal = (todayCosts._sum?.amountCents ?? 0) / 100;
    const weekTotal = (weekCosts._sum?.amountCents ?? 0) / 100;
    const dailyAvg = weekTotal / 7;

    if (dailyAvg > 0 && todayTotal > dailyAvg * 3) {
      alerts.push({
        type: 'cost_spike',
        severity: todayTotal > dailyAvg * 5 ? 'critical' : 'warning',
        title: 'Cost spike detected',
        description: `Today's spend: $${todayTotal.toFixed(2)} (daily average: $${dailyAvg.toFixed(2)})`,
        suggestedAction: 'Review spend breakdown and check for runaway agents.',
      });
    }
  } catch {
    // RunCost table may not have data yet
  }

  return alerts;
}

/**
 * Send anomaly alerts to org admins via notification service.
 */
export async function processAndNotifyAnomalies(
  prisma: PrismaClient,
  orgId: string,
): Promise<AnomalyAlert[]> {
  const alerts = await checkForAnomalies(prisma, orgId);

  for (const alert of alerts) {
    await sendNotification(prisma, {
      type: 'anomaly_alert',
      orgId,
      title: alert.title,
      body: `${alert.description}\n\nSuggested action: ${alert.suggestedAction}`,
      requiredRole: 'admin',
    }).catch((err) => console.error('[anomaly] Notification failed:', err));
  }

  return alerts;
}

/**
 * Start a periodic anomaly check for all orgs.
 */
export function startAnomalyWatcher(prisma: PrismaClient): void {
  const INTERVAL_MS = 5 * 60 * 1000;

  setInterval(async () => {
    try {
      const orgs = await prisma.organization.findMany({ select: { id: true } });
      for (const org of orgs) {
        const alerts = await checkForAnomalies(prisma, org.id);
        if (alerts.length > 0) {
          console.log(`[anomaly] ${org.id}: ${alerts.length} alert(s) detected`);
          for (const alert of alerts) {
            await sendNotification(prisma, {
              type: 'anomaly_alert',
              orgId: org.id,
              title: alert.title,
              body: `${alert.description}\n\nSuggested action: ${alert.suggestedAction}`,
              requiredRole: 'admin',
            }).catch(() => {});
          }
        }
      }
    } catch (err) {
      console.error('[anomaly] Watcher error:', err);
    }
  }, INTERVAL_MS);

  console.log(`[anomaly] Watcher started — checking every ${INTERVAL_MS / 1000}s`);
}

/**
 * Admin routes — password-protected security visibility endpoints.
 *
 * GET /api/admin/security-events — L2/L3 execution events, verifications, flags
 * GET /api/admin/executions       — Recent MCP executions with container details
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db/client.js';

const ADMIN_PASSWORD = process.env['ADMIN_PASSWORD'] ?? 'admin1';

function checkAdminAuth(request: FastifyRequest, reply: FastifyReply): boolean {
  const auth = request.headers['x-admin-password'] ?? '';
  if (auth !== ADMIN_PASSWORD) {
    reply.code(401).send({ error: 'Invalid admin password' });
    return false;
  }
  return true;
}

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/admin/security-events
   * Returns recent EventLog entries for L2/L3 verification events.
   */
  app.get('/api/admin/security-events', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!checkAdminAuth(request, reply)) return;

    const query = request.query as Record<string, string | undefined>;
    const limit = Math.min(200, Math.max(1, parseInt(query.limit ?? '50', 10)));

    const events = await prisma.eventLog.findMany({
      where: {
        type: {
          in: [
            'secure_exec.completed',
            'mcp_pre_verification.completed',
            'mcp_verification.completed',
            'simulation.completed',
          ],
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return reply.send({
      events: events.map(e => ({
        id: e.id,
        type: e.type,
        data: JSON.parse(e.data),
        createdAt: e.createdAt.toISOString(),
      })),
    });
  });

  /**
   * GET /api/admin/executions
   * Returns recent MCP executions with L3 container details.
   */
  app.get('/api/admin/executions', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!checkAdminAuth(request, reply)) return;

    const query = request.query as Record<string, string | undefined>;
    const limit = Math.min(200, Math.max(1, parseInt(query.limit ?? '50', 10)));

    const executions = await prisma.execution.findMany({
      include: {
        toolCall: {
          select: {
            toolName: true,
            args: true,
            riskTier: true,
            createdAt: true,
            approval: { select: { status: true, approver: true, decidedAt: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return reply.send({
      executions: executions.map(e => ({
        id: e.id,
        status: e.status,
        exitCode: e.exitCode,
        durationMs: e.durationMs,
        stdout: e.stdout?.slice(0, 500),
        stderr: e.stderr?.slice(0, 500),
        createdAt: e.createdAt.toISOString(),
        toolCall: {
          toolName: e.toolCall.toolName,
          args: e.toolCall.args,
          riskTier: e.toolCall.riskTier,
          createdAt: e.toolCall.createdAt.toISOString(),
          approval: e.toolCall.approval,
        },
      })),
    });
  });

  /**
   * GET /api/admin/flags
   * Returns recent audit flags (anomalies, mismatches).
   */
  app.get('/api/admin/flags', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!checkAdminAuth(request, reply)) return;

    const flags = await prisma.auditFlag.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return reply.send({ flags });
  });

  /**
   * GET /api/admin/summary
   * Quick counts for the admin dashboard header.
   */
  app.get('/api/admin/summary', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!checkAdminAuth(request, reply)) return;

    const oneHourAgo = new Date(Date.now() - 3_600_000);
    const oneDayAgo = new Date(Date.now() - 24 * 3_600_000);

    const [
      totalExecutions,
      recentExecutions,
      totalPreChecks,
      blockedPreChecks,
      totalFlags,
      recentFlags,
    ] = await Promise.all([
      prisma.execution.count(),
      prisma.execution.count({ where: { createdAt: { gte: oneHourAgo } } }),
      prisma.eventLog.count({ where: { type: 'mcp_pre_verification.completed' } }),
      prisma.eventLog.count({
        where: {
          type: 'mcp_pre_verification.completed',
          data: { contains: '"safe":false' },
        },
      }),
      prisma.auditFlag.count(),
      prisma.auditFlag.count({ where: { createdAt: { gte: oneDayAgo } } }),
    ]);

    return reply.send({
      totalExecutions,
      recentExecutions,
      totalPreChecks,
      blockedPreChecks,
      totalFlags,
      recentFlags,
    });
  });
}

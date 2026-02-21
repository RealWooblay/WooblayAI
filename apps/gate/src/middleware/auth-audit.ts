/**
 * Auth audit middleware — logs auth successes and failures.
 *
 * Records every authentication attempt to AuthAuditLog for compliance.
 * Tracks: user ID, IP, user agent, session ID, success/failure reason.
 */

import type { PrismaClient } from '@prisma/client';

export async function recordAuthSuccess(
  prisma: PrismaClient,
  data: {
    userId: string;
    action: string;
    sessionId?: string;
    ipAddress?: string;
    userAgent?: string;
  },
): Promise<void> {
  await prisma.authAuditLog.create({
    data: {
      userId: data.userId,
      action: data.action,
      success: true,
      sessionId: data.sessionId ?? null,
      ipAddress: data.ipAddress ?? null,
      userAgent: data.userAgent ?? null,
    },
  }).catch(() => {
    // Don't let audit logging failures break auth
  });
}

export async function recordAuthFailure(
  prisma: PrismaClient,
  data: {
    userId?: string;
    action: string;
    detail: string;
    ipAddress?: string;
    userAgent?: string;
  },
): Promise<void> {
  await prisma.authAuditLog.create({
    data: {
      userId: data.userId ?? null,
      action: data.action,
      success: false,
      detail: data.detail,
      ipAddress: data.ipAddress ?? null,
      userAgent: data.userAgent ?? null,
    },
  }).catch(() => {
    // Don't let audit logging failures break auth
  });
}

/**
 * Extract IP address from a Fastify request.
 * Handles X-Forwarded-For for proxied requests.
 */
export function extractIp(request: { ip: string; headers: Record<string, string | string[] | undefined> }): string {
  const forwarded = request.headers['x-forwarded-for'];
  if (forwarded) {
    const first = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0];
    return first?.trim() ?? request.ip;
  }
  return request.ip;
}

/**
 * Extract user agent from headers (truncated for storage).
 */
export function extractUserAgent(request: { headers: Record<string, string | string[] | undefined> }): string {
  const ua = request.headers['user-agent'];
  const val = Array.isArray(ua) ? ua[0] : ua;
  return val?.slice(0, 256) ?? '';
}

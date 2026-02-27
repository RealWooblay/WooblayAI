/**
 * Resolve org ID for an authenticated request when JWT has no org_id.
 * Tries: User's org from DB → any existing org → create default org and assign user.
 */

import type { FastifyRequest } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { getOrgScope } from './org-scope.js';

const DEFAULT_ORG_ID = 'wooblay_default';

/**
 * Returns orgId for the current request. Uses JWT org_id, then User.orgId from DB,
 * then any org, then creates a default org and assigns the current user to it.
 */
export async function resolveOrgIdForRequest(
  prisma: PrismaClient,
  request: FastifyRequest,
): Promise<string | null> {
  const org = getOrgScope(request);
  if (org.orgId) return org.orgId;

  const clerkUserId = request.clerkUserId;
  if (clerkUserId) {
    const user = await prisma.user.findUnique({
      where: { clerkId: clerkUserId },
      select: { orgId: true },
    });
    if (user?.orgId) return user.orgId;
  }

  const fallback = await prisma.organization.findFirst({ select: { id: true } });
  if (fallback) return fallback.id;

  if (clerkUserId) {
    return ensureDefaultOrgAndAssignUser(prisma, clerkUserId);
  }

  return null;
}

/**
 * When there are no orgs in the DB, create a default org and assign the user to it.
 */
async function ensureDefaultOrgAndAssignUser(
  prisma: PrismaClient,
  clerkUserId: string,
): Promise<string> {
  await prisma.organization.upsert({
    where: { id: DEFAULT_ORG_ID },
    create: { id: DEFAULT_ORG_ID, name: 'Default' },
    update: {},
  });

  await prisma.user.upsert({
    where: { clerkId: clerkUserId },
    create: {
      clerkId: clerkUserId,
      email: `pending-${clerkUserId}@wooblay.com`,
      orgId: DEFAULT_ORG_ID,
    },
    update: { orgId: DEFAULT_ORG_ID },
  });

  return DEFAULT_ORG_ID;
}

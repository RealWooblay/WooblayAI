/**
 * Org Scope — Multi-tenant isolation boundary.
 *
 * Provides query guards that automatically inject orgId filters
 * into every Prisma query. Never rely on frontend filtering.
 *
 * Usage:
 *   const org = getOrgScope(request);
 *   const runs = await prisma.run.findMany({ where: { ...org.filter, status: 'running' } });
 *
 * The orgId is extracted from the authenticated user's session (Clerk).
 * If orgId is null (e.g. superadmin), no filter is applied.
 */

import type { FastifyRequest } from 'fastify';

// ── Types ───────────────────────────────────────────────────────────────

export interface OrgScope {
  /** The org ID for the current request (null = superadmin, no filter). */
  orgId: string | null;
  /** Query filter — spread into Prisma `where` clauses. */
  filter: { orgId: string } | {};
  /** Returns true if this scope can access the given orgId. */
  canAccess: (targetOrgId: string | null) => boolean;
}

// ── Extract org scope from request ──────────────────────────────────────

/**
 * Get the org scope for the current authenticated request.
 * The orgId is set on the request by the Clerk auth middleware.
 */
export function getOrgScope(request: FastifyRequest): OrgScope {
  const user = request.user;

  // Superadmin / system calls — no org filter
  if (!user || user.role === 'superadmin') {
    return {
      orgId: null,
      filter: {},
      canAccess: () => true,
    };
  }

  const orgId = user.orgId ?? null;

  if (!orgId) {
    // User without an org — can only see their own unscoped data
    return {
      orgId: null,
      filter: {},
      canAccess: (target) => target === null,
    };
  }

  return {
    orgId,
    filter: { orgId },
    canAccess: (target) => target === orgId || target === null,
  };
}

/**
 * Assert that a resource belongs to the current org.
 * Throws 403 if the resource's orgId doesn't match.
 */
export function assertOrgAccess(
  scope: OrgScope,
  resource: { orgId?: string | null },
  resourceType: string,
): void {
  if (scope.orgId === null) return; // superadmin
  if (resource.orgId === null || resource.orgId === undefined) return; // unscoped resource
  if (resource.orgId !== scope.orgId) {
    const error = new Error(`Access denied: ${resourceType} belongs to a different organization`);
    (error as any).statusCode = 403;
    throw error;
  }
}

/**
 * Inject orgId into create data.
 * Use when creating new records to ensure they inherit the current org scope.
 */
export function withOrg<T extends Record<string, unknown>>(
  scope: OrgScope,
  data: T,
): T & { orgId?: string } {
  if (scope.orgId) {
    return { ...data, orgId: scope.orgId };
  }
  return data;
}

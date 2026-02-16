/**
 * Incident routes.
 *
 * CRUD for incidents + manual creation.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db/client.js';
import { persistEvent } from '../events/bus.js';
import { getOrgScope, assertOrgAccess, withOrg } from '../middleware/org-scope.js';
import type { IncidentPriority } from '@wooblay/types';

export async function incidentRoutes(app: FastifyInstance): Promise<void> {
  // ── List incidents ────────────────────────────────────────────────────
  app.get('/api/incidents', async (request: FastifyRequest, reply: FastifyReply) => {
    const org = getOrgScope(request);
    const query = request.query as {
      status?: string;
      priority?: string;
      limit?: string;
      offset?: string;
    };

    const where: Record<string, unknown> = { ...org.filter };
    if (query.status) where.status = query.status;
    if (query.priority) where.priority = query.priority;

    const [incidents, total] = await Promise.all([
      prisma.incident.findMany({
        where,
        orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
        take: Math.min(Number(query.limit) || 50, 100),
        skip: Number(query.offset) || 0,
        include: { runs: { orderBy: { attempt: 'desc' }, take: 1 } },
      }),
      prisma.incident.count({ where }),
    ]);

    return reply.send({ incidents, total });
  });

  // ── Get single incident ───────────────────────────────────────────────
  app.get('/api/incidents/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const org = getOrgScope(request);
    const { id } = request.params as { id: string };

    const incident = await prisma.incident.findUnique({
      where: { id },
      include: {
        runs: {
          orderBy: { attempt: 'desc' },
          include: {
            proposals: { orderBy: { createdAt: 'desc' } },
            evidenceBundles: { orderBy: { createdAt: 'desc' } },
          },
        },
      },
    });

    if (!incident) {
      return reply.code(404).send({ error: 'Incident not found' });
    }

    assertOrgAccess(org, incident, 'Incident');

    return reply.send(incident);
  });

  // ── Create incident manually ──────────────────────────────────────────
  app.post('/api/incidents', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as {
      title: string;
      summary?: string;
      priority?: IncidentPriority;
      source?: string;
      repoFullName?: string;
      branch?: string;
      commitSha?: string;
    };

    if (!body.title) {
      return reply.code(400).send({ error: 'title is required' });
    }

    const org = getOrgScope(request);
    const incident = await prisma.incident.create({
      data: withOrg(org, {
        title: body.title,
        summary: body.summary ?? null,
        priority: body.priority ?? 'P2',
        source: body.source ?? 'manual',
        repoFullName: body.repoFullName ?? null,
        branch: body.branch ?? null,
        commitSha: body.commitSha ?? null,
      }),
    });

    await persistEvent(prisma, {
      type: 'incident.created',
      data: {
        incidentId: incident.id,
        source: incident.source,
        priority: incident.priority as IncidentPriority,
        title: incident.title,
      },
    });

    return reply.code(201).send(incident);
  });

  // ── Update incident status ────────────────────────────────────────────
  app.patch('/api/incidents/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      status?: string;
      priority?: string;
      summary?: string;
    };

    const existing = await prisma.incident.findUnique({ where: { id } });
    if (!existing) {
      return reply.code(404).send({ error: 'Incident not found' });
    }

    const data: Record<string, unknown> = {};
    if (body.status) data.status = body.status;
    if (body.priority) data.priority = body.priority;
    if (body.summary !== undefined) data.summary = body.summary;

    const updated = await prisma.incident.update({ where: { id }, data });

    if (body.status && body.status !== existing.status) {
      await persistEvent(prisma, {
        type: 'incident.updated',
        data: {
          incidentId: id,
          status: updated.status as any,
          previousStatus: existing.status as any,
        },
      });
    }

    return reply.send(updated);
  });
}

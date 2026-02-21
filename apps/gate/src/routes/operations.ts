/**
 * Operation routes (was Incident routes).
 *
 * CRUD for operations + manual creation + routing controls.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db/client.js';
import { persistEvent } from '../events/bus.js';
import { getOrgScope, assertOrgAccess, withOrg } from '../middleware/org-scope.js';
import type { OperationPriority } from '@wooblay/types';

export async function operationRoutes(app: FastifyInstance): Promise<void> {
  // ── List operations ──────────────────────────────────────────────────
  const listHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    const org = getOrgScope(request);
    const query = request.query as {
      status?: string;
      priority?: string;
      routingStatus?: string;
      limit?: string;
      offset?: string;
    };

    const where: Record<string, unknown> = { ...org.filter };
    if (query.status) where.status = query.status;
    if (query.priority) where.priority = query.priority;
    if (query.routingStatus) where.routingStatus = query.routingStatus;

    const [operations, total] = await Promise.all([
      prisma.operation.findMany({
        where,
        orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
        take: Math.min(Number(query.limit) || 50, 100),
        skip: Number(query.offset) || 0,
        include: { runs: { orderBy: { attempt: 'desc' }, take: 1 } },
      }),
      prisma.operation.count({ where }),
    ]);

    return reply.send({ operations, incidents: operations, total });
  };

  app.get('/api/operations', listHandler);
  app.get('/api/incidents', listHandler);

  // ── Get single operation ─────────────────────────────────────────────
  const getHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    const org = getOrgScope(request);
    const { id } = request.params as { id: string };

    const operation = await prisma.operation.findUnique({
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

    if (!operation) {
      return reply.code(404).send({ error: 'Operation not found' });
    }

    assertOrgAccess(org, operation, 'Incident');

    return reply.send(operation);
  };

  app.get('/api/operations/:id', getHandler);
  app.get('/api/incidents/:id', getHandler);

  // ── Create operation manually ────────────────────────────────────────
  const createHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as {
      title: string;
      summary?: string;
      priority?: OperationPriority;
      source?: string;
      intent?: string;
      instanceId?: string;
      repoFullName?: string;
      branch?: string;
      commitSha?: string;
    };

    if (!body.title) {
      return reply.code(400).send({ error: 'title is required' });
    }

    const org = getOrgScope(request);
    const operation = await prisma.operation.create({
      data: withOrg(org, {
        title: body.title,
        summary: body.summary ?? null,
        priority: body.priority ?? 'P2',
        source: body.source ?? 'manual',
        intent: body.intent ?? 'custom',
        instanceId: body.instanceId ?? null,
        routingStatus: body.instanceId ? 'manual' : 'pending',
        repoFullName: body.repoFullName ?? null,
        branch: body.branch ?? null,
        commitSha: body.commitSha ?? null,
      }),
    });

    await persistEvent(prisma, {
      type: 'operation.created',
      data: {
        operationId: operation.id,
        source: operation.source,
        priority: operation.priority as OperationPriority,
        title: operation.title,
      },
    });

    return reply.code(201).send(operation);
  };

  app.post('/api/operations', createHandler);
  app.post('/api/incidents', createHandler);

  // ── Update operation status ──────────────────────────────────────────
  const updateHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      status?: string;
      priority?: string;
      summary?: string;
    };

    const existing = await prisma.operation.findUnique({ where: { id } });
    if (!existing) {
      return reply.code(404).send({ error: 'Operation not found' });
    }

    const data: Record<string, unknown> = {};
    if (body.status) data.status = body.status;
    if (body.priority) data.priority = body.priority;
    if (body.summary !== undefined) data.summary = body.summary;

    const updated = await prisma.operation.update({ where: { id }, data });

    if (body.status && body.status !== existing.status) {
      await persistEvent(prisma, {
        type: 'operation.updated',
        data: {
          operationId: id,
          status: updated.status as any,
          previousStatus: existing.status as any,
        },
      });
    }

    return reply.send(updated);
  };

  app.patch('/api/operations/:id', updateHandler);
  app.patch('/api/incidents/:id', updateHandler);

  // ── Route operation to an agent ──────────────────────────────────────
  app.post('/api/operations/:id/route', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { instanceId: string };

    if (!body.instanceId) {
      return reply.code(400).send({ error: 'instanceId is required' });
    }

    const operation = await prisma.operation.findUnique({ where: { id } });
    if (!operation) {
      return reply.code(404).send({ error: 'Operation not found' });
    }

    const instance = await prisma.instance.findUnique({ where: { id: body.instanceId } });
    if (!instance) {
      return reply.code(404).send({ error: 'Instance not found' });
    }

    const updated = await prisma.operation.update({
      where: { id },
      data: {
        instanceId: body.instanceId,
        routingStatus: 'manual',
        routingReason: `Manually assigned to ${instance.name}`,
        routingConfidence: 1.0,
      },
    });

    await persistEvent(prisma, {
      type: 'operation.routed',
      data: {
        operationId: id,
        instanceId: body.instanceId,
        confidence: 1.0,
        status: 'manual' as const,
      },
    });

    return reply.send(updated);
  });

  // ── Approve AI-suggested routing ─────────────────────────────────────
  app.post('/api/operations/:id/approve-routing', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    const operation = await prisma.operation.findUnique({ where: { id } });
    if (!operation) {
      return reply.code(404).send({ error: 'Operation not found' });
    }

    if (!operation.instanceId) {
      return reply.code(400).send({ error: 'Operation has no suggested routing to approve' });
    }

    const updated = await prisma.operation.update({
      where: { id },
      data: { routingStatus: 'approved' },
    });

    await persistEvent(prisma, {
      type: 'operation.routed',
      data: {
        operationId: id,
        instanceId: operation.instanceId,
        confidence: operation.routingConfidence ?? 0,
        status: 'approved' as const,
      },
    });

    return reply.send(updated);
  });

  // ── Dismiss an unrouted operation ────────────────────────────────────
  app.post('/api/operations/:id/dismiss', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    const operation = await prisma.operation.findUnique({ where: { id } });
    if (!operation) {
      return reply.code(404).send({ error: 'Operation not found' });
    }

    const updated = await prisma.operation.update({
      where: { id },
      data: { status: 'closed' },
    });

    return reply.send(updated);
  });
}

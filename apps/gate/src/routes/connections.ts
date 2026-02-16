/**
 * Connection routes.
 *
 * Manage external service connections (GitHub first).
 * Connections store credential references used by the Tool Gateway.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db/client.js';
import { getOrgScope, assertOrgAccess, withOrg } from '../middleware/org-scope.js';
import { envelopeEncrypt } from '../services/vault.js';

export async function connectionRoutes(app: FastifyInstance): Promise<void> {
  // ── List connections ──────────────────────────────────────────────────
  app.get('/api/connections', async (request: FastifyRequest, reply: FastifyReply) => {
    const org = getOrgScope(request);
    const connections = await prisma.connection.findMany({
      where: { ...org.filter },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        provider: true,
        name: true,
        status: true,
        scopes: true,
        metadata: true,
        createdAt: true,
        updatedAt: true,
        // NEVER return credentialRef to the client
      },
    });

    return reply.send(connections);
  });

  // ── Create connection ─────────────────────────────────────────────────
  app.post('/api/connections', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as {
      provider: string;
      name: string;
      credential: string;
      scopes?: string[];
      metadata?: Record<string, unknown>;
    };

    if (!body.provider || !body.name || !body.credential) {
      return reply.code(400).send({ error: 'provider, name, and credential are required' });
    }

    if (body.provider !== 'github') {
      return reply.code(400).send({ error: 'Only "github" provider is supported in MVP' });
    }

    // Envelope-encrypt the credential before storage
    const org = getOrgScope(request);
    const encryptedCred = envelopeEncrypt(body.credential);
    const connection = await prisma.connection.create({
      data: withOrg(org, {
        provider: body.provider,
        name: body.name,
        credentialRef: encryptedCred,
        scopes: JSON.stringify(body.scopes ?? ['repo']),
        metadata: body.metadata ? JSON.stringify(body.metadata) : null,
      }),
    });

    return reply.code(201).send({
      id: connection.id,
      provider: connection.provider,
      name: connection.name,
      status: connection.status,
      createdAt: connection.createdAt,
    });
  });

  // ── Revoke connection ─────────────────────────────────────────────────
  app.post('/api/connections/:id/revoke', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    const connection = await prisma.connection.update({
      where: { id },
      data: { status: 'revoked', credentialRef: '' },
    });

    return reply.send({
      id: connection.id,
      status: connection.status,
    });
  });

  // ── Delete connection ─────────────────────────────────────────────────
  app.delete('/api/connections/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    await prisma.connection.delete({ where: { id } });
    return reply.code(204).send();
  });

  // ── Test connection (verify credential works) ─────────────────────────
  app.post('/api/connections/:id/test', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    const connection = await prisma.connection.findUnique({ where: { id } });
    if (!connection) {
      return reply.code(404).send({ error: 'Connection not found' });
    }

    if (connection.provider === 'github') {
      try {
        const res = await fetch('https://api.github.com/user', {
          headers: {
            Authorization: `Bearer ${connection.credentialRef}`,
            Accept: 'application/vnd.github+json',
          },
        });
        if (res.ok) {
          const user = await res.json() as { login: string };
          return reply.send({ success: true, user: user.login });
        }
        return reply.send({ success: false, error: `GitHub API returned ${res.status}` });
      } catch (err: any) {
        return reply.send({ success: false, error: err.message });
      }
    }

    return reply.send({ success: false, error: 'Unknown provider' });
  });
}

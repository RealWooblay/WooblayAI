/**
 * API Key routes — create, list, revoke external API keys.
 *
 * API keys let external agents (OpenAI GPTs, Claude MCP, LangChain, etc.)
 * call the Wooblay gateway without a Wooblay-hosted run. The key resolves
 * to an org, and the gateway runs the same pipeline: scope → simulate → execute.
 *
 * Keys are stored as SHA-256 hashes. The plaintext is returned ONCE at creation.
 */

import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db/client.js';
import { resolveOrgIdForRequest } from '../middleware/org-resolve.js';
import { persistEvent } from '../events/bus.js';

const KEY_PREFIX = 'wbl_ak_';

function generateApiKey(): string {
  return KEY_PREFIX + randomBytes(32).toString('base64url');
}

function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export async function apiKeyRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/api-keys — list active API keys for the org.
   * Returns metadata only (never the key itself).
   */
  app.get('/api/api-keys', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = await resolveOrgIdForRequest(prisma, request);
    if (!orgId) {
      return reply.code(403).send({ error: 'Organization required to manage API keys' });
    }

    const keys = await prisma.apiKey.findMany({
      where: { orgId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        label: true,
        userId: true,
        prefix: true,
        scopes: true,
        active: true,
        lastUsedAt: true,
        expiresAt: true,
        createdAt: true,
      },
    });

    return reply.send(keys);
  });

  /**
   * POST /api/api-keys — create a new API key.
   *
   * Returns the plaintext key ONCE. After this, only the prefix is available.
   */
  app.post('/api/api-keys', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = await resolveOrgIdForRequest(prisma, request);
    if (!orgId) {
      return reply.code(403).send({ error: 'Organization required to create API keys' });
    }

    const body = request.body as {
      name: string;
      label?: string;
      expiresInDays?: number;
    };

    if (!body.name || body.name.trim().length === 0) {
      return reply.code(400).send({ error: 'name is required' });
    }

    const rawKey = generateApiKey();
    const keyHash = hashKey(rawKey);
    const prefix = rawKey.slice(0, KEY_PREFIX.length + 8);

    const expiresAt = body.expiresInDays
      ? new Date(Date.now() + body.expiresInDays * 24 * 60 * 60 * 1000)
      : null;

    const userId = request.user?.clerkId ?? null;

    const apiKey = await prisma.apiKey.create({
      data: {
        orgId,
        userId: userId?.startsWith('apikey:') ? null : userId,
        label: body.label?.trim() || null,
        name: body.name.trim(),
        keyHash,
        prefix,
        expiresAt,
      },
    });

    await persistEvent(prisma, {
      type: 'api_key.created' as any,
      data: { apiKeyId: apiKey.id, orgId, name: body.name.trim(), label: apiKey.label } as any,
    });

    return reply.code(201).send({
      id: apiKey.id,
      name: apiKey.name,
      label: apiKey.label,
      prefix,
      key: rawKey, // Only time the plaintext is returned
      expiresAt: apiKey.expiresAt,
      createdAt: apiKey.createdAt,
      scopes: JSON.parse(apiKey.scopes),
    });
  });

  /**
   * DELETE /api/api-keys/:id — revoke an API key.
   */
  app.delete('/api/api-keys/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = await resolveOrgIdForRequest(prisma, request);
    if (!orgId) {
      return reply.code(403).send({ error: 'Organization required' });
    }

    const { id } = request.params as { id: string };

    const apiKey = await prisma.apiKey.findUnique({ where: { id } });
    if (!apiKey || apiKey.orgId !== orgId) {
      return reply.code(404).send({ error: 'API key not found' });
    }

    if (apiKey.revokedAt) {
      return reply.code(400).send({ error: 'Key already revoked' });
    }

    await prisma.apiKey.update({
      where: { id },
      data: { revokedAt: new Date() },
    });

    await persistEvent(prisma, {
      type: 'api_key.revoked',
      data: { apiKeyId: id, orgId },
    });

    return reply.send({ revoked: true });
  });
}

// ── Key Validation (used by gateway) ────────────────────────────────────

export interface ApiKeyValidation {
  valid: boolean;
  orgId?: string;
  apiKeyId?: string;
  reason?: string;
}

/**
 * Validate a raw API key. Returns the org it belongs to.
 * Updates lastUsedAt on success.
 */
export async function validateApiKey(rawKey: string): Promise<ApiKeyValidation> {
  if (!rawKey.startsWith(KEY_PREFIX)) {
    return { valid: false, reason: 'Invalid key format' };
  }

  const keyHash = hashKey(rawKey);

  const apiKey = await prisma.apiKey.findUnique({ where: { keyHash } });
  if (!apiKey) {
    return { valid: false, reason: 'Key not found' };
  }

  if (apiKey.revokedAt) {
    return { valid: false, reason: 'Key has been revoked' };
  }

  if (!apiKey.active) {
    return { valid: false, reason: 'API key paused (kill switch active)' };
  }

  if (apiKey.expiresAt && new Date() > apiKey.expiresAt) {
    return { valid: false, reason: 'Key has expired' };
  }

  // Update last used (non-blocking)
  prisma.apiKey.update({
    where: { id: apiKey.id },
    data: { lastUsedAt: new Date() },
  }).catch(() => {});

  return {
    valid: true,
    orgId: apiKey.orgId,
    apiKeyId: apiKey.id,
  };
}

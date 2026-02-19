/**
 * Connection routes.
 *
 * Manage external service connections (GitHub, AWS, GCP).
 * Each connection stores encrypted credentials and powers:
 *   - Sensing: inbound webhooks that create operations
 *   - Execution: outbound actions via the three-layer secure execution engine
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db/client.js';
import { resolveOrgIdForRequest } from '../middleware/org-resolve.js';
import { envelopeEncrypt, envelopeDecrypt, isEncrypted } from '../services/vault.js';
import { resolveGitHubToken } from '../services/github-app.js';
import { parseScopeBoundaries, describeScopeBoundaries } from '../engine/scope.js';

export async function connectionRoutes(app: FastifyInstance): Promise<void> {
  // ── List connections (with dual-role info) ───────────────────────────
  app.get('/api/connections', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = await resolveOrgIdForRequest(prisma, request);
      const connections = await prisma.connection.findMany({
        where: orgId ? { orgId } : {},
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          provider: true,
          name: true,
          status: true,
          scopes: true,
          metadata: true,
          sensorEnabled: true,
          sensorConfig: true,
          scopeBoundaries: true,
          webhookSecret: true,
          createdAt: true,
          updatedAt: true,
          // NEVER return credentialRef to the client
        },
      });

      const enriched = connections.map((c) => {
        const boundaries = parseScopeBoundaries(c.scopeBoundaries);
        return {
          ...c,
          webhookSecret: undefined, // Don't leak secret in list view
          sensing: {
            enabled: c.sensorEnabled,
            config: c.sensorConfig ? (() => { try { return JSON.parse(c.sensorConfig!); } catch { return null; } })() : null,
          },
          execution: {
            scopeBoundaries: describeScopeBoundaries(boundaries),
            note: 'Any action can be executed through this provider. The gate enforces policy on every call.',
          },
        };
      });

      return reply.send(enriched);
    } catch (err: any) {
      request.log.error({ err }, 'Failed to list connections');
      return reply.code(500).send({ error: 'Failed to list connections', detail: err.message });
    }
  });

  // ── Create connection ─────────────────────────────────────────────────
  app.post('/api/connections', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
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

      // Normalize provider name: lowercase, alphanumeric + hyphens only
      const provider = body.provider.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
      if (!provider || provider.length > 64) {
        return reply.code(400).send({ error: 'provider must be 1-64 chars, lowercase alphanumeric + hyphens' });
      }

      const orgId = await resolveOrgIdForRequest(prisma, request);

      // Provider-specific credential handling. Known providers get tailored
      // storage; any other provider uses generic envelope encryption.
      let encryptedCred: string;
      let metadata: string | null = null;

      if (provider === 'github') {
        encryptedCred = envelopeEncrypt(body.credential);
      } else if (provider === 'aws') {
        // For AWS, credential = access key ID, metadata stores encrypted secret key
        const awsMeta = body.metadata as { awsSecretAccessKey?: string; region?: string } | undefined;
        encryptedCred = body.credential; // Access Key ID (not secret)
        metadata = JSON.stringify({
          awsAccessKeyId: body.credential,
          awsSecretAccessKey: awsMeta?.awsSecretAccessKey ? envelopeEncrypt(awsMeta.awsSecretAccessKey) : '',
          region: awsMeta?.region ?? 'us-east-1',
        });
      } else if (provider === 'gcp') {
        // For GCP, credential = service account JSON key (entire content)
        encryptedCred = envelopeEncrypt(body.credential);
        metadata = JSON.stringify({
          gcpServiceAccountKey: envelopeEncrypt(body.credential),
          project: (body.metadata as { project?: string } | undefined)?.project ?? null,
        });
      } else {
        encryptedCred = envelopeEncrypt(body.credential);
      }

      const connection = await prisma.connection.create({
        data: {
          ...(orgId ? { orgId } : {}),
          provider,
          name: body.name,
          credentialRef: encryptedCred,
          scopes: JSON.stringify(body.scopes ?? (provider === 'github' ? ['repo'] : ['*'])),
          metadata,
        },
      });

      return reply.code(201).send({
        id: connection.id,
        provider: connection.provider,
        name: connection.name,
        status: connection.status,
        createdAt: connection.createdAt,
      });
    } catch (err: any) {
      request.log.error({ err }, 'Failed to create connection');
      return reply.code(500).send({ error: 'Failed to create connection', detail: err.message });
    }
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
        const token = await resolveGitHubToken(prisma, id);
        const res = await fetch('https://api.github.com/user', {
          headers: {
            Authorization: `Bearer ${token}`,
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

    if (connection.provider === 'aws') {
      try {
        const meta = connection.metadata ? JSON.parse(connection.metadata) : {};
        if (!meta.awsAccessKeyId || !meta.awsSecretAccessKey) {
          return reply.send({ success: false, error: 'AWS credentials not found in connection metadata' });
        }
        let secretKey = meta.awsSecretAccessKey;
        if (isEncrypted(secretKey)) secretKey = envelopeDecrypt(secretKey);
        const region = meta.region ?? 'us-east-1';

        // Test with STS GetCallerIdentity (always available, no extra permissions needed)
        const endpoint = `https://sts.${region}.amazonaws.com/?Action=GetCallerIdentity&Version=2011-06-15`;
        const res = await fetch(endpoint, {
          headers: {
            'X-Amz-Security-Token': '',
          },
        });
        // STS without proper signing will return 403, but we can verify the key ID format
        // For a proper test, use the AWS SDK, but for MVP we just verify the key format
        if (meta.awsAccessKeyId.startsWith('AKIA') && secretKey.length >= 30) {
          return reply.send({ success: true, user: `Access Key: ${meta.awsAccessKeyId.slice(0, 8)}...` });
        }
        return reply.send({ success: false, error: 'AWS key format appears invalid' });
      } catch (err: any) {
        return reply.send({ success: false, error: err.message });
      }
    }

    if (connection.provider === 'gcp') {
      try {
        const meta = connection.metadata ? JSON.parse(connection.metadata) : {};
        if (!meta.gcpServiceAccountKey) {
          return reply.send({ success: false, error: 'GCP service account key not found in connection metadata' });
        }
        let keyJson = meta.gcpServiceAccountKey;
        if (isEncrypted(keyJson)) keyJson = envelopeDecrypt(keyJson);
        const parsed = JSON.parse(keyJson);
        if (parsed.type === 'service_account' && parsed.client_email && parsed.private_key) {
          return reply.send({
            success: true,
            user: `Service Account: ${parsed.client_email}`,
            project: parsed.project_id ?? meta.project ?? null,
          });
        }
        return reply.send({ success: false, error: 'GCP key JSON missing required fields (type, client_email, private_key)' });
      } catch (err: any) {
        return reply.send({ success: false, error: `Failed to parse GCP key: ${err.message}` });
      }
    }

    return reply.send({ success: false, error: `Provider "${connection.provider}" does not support testing yet` });
  });

  // ── Update scope boundaries ──────────────────────────────────────────
  app.patch('/api/connections/:id/scope-boundaries', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { scopeBoundaries: Record<string, { allowed: string[]; blocked: string[] }> };

    if (!body.scopeBoundaries || typeof body.scopeBoundaries !== 'object') {
      return reply.code(400).send({ error: 'scopeBoundaries object is required' });
    }

    // Validate structure
    for (const [action, boundary] of Object.entries(body.scopeBoundaries)) {
      if (!Array.isArray(boundary.allowed) || !Array.isArray(boundary.blocked)) {
        return reply.code(400).send({
          error: `Invalid boundary for "${action}": allowed and blocked must be arrays`,
        });
      }
    }

    const connection = await prisma.connection.update({
      where: { id },
      data: { scopeBoundaries: JSON.stringify(body.scopeBoundaries) },
    });

    return reply.send({
      id: connection.id,
      scopeBoundaries: describeScopeBoundaries(parseScopeBoundaries(connection.scopeBoundaries)),
    });
  });

  // ── Connection Secrets ──────────────────────────────────────────────
  // Secrets are user-defined key-value pairs with two visibility modes:
  //   - "agent": Injected as env var into agent container (fast, for API testing)
  //   - "exec_only": Only injected into ephemeral secure exec containers (safe, for deploy creds)

  /** Set secrets on a connection (full replace) */
  app.put('/api/connections/:id/secrets', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { secrets: { key: string; value: string; mode: 'agent' | 'exec_only' }[] };

    if (!Array.isArray(body.secrets)) {
      return reply.code(400).send({ error: 'secrets must be an array of { key, value, mode }' });
    }

    for (const s of body.secrets) {
      if (!s.key || typeof s.key !== 'string') {
        return reply.code(400).send({ error: 'Each secret must have a key (string)' });
      }
      if (!s.value || typeof s.value !== 'string') {
        return reply.code(400).send({ error: `Secret "${s.key}" must have a value (string)` });
      }
      if (s.mode !== 'agent' && s.mode !== 'exec_only') {
        return reply.code(400).send({ error: `Secret "${s.key}" mode must be "agent" or "exec_only"` });
      }
    }

    const encrypted = body.secrets.map((s) => ({
      key: s.key,
      encryptedValue: envelopeEncrypt(s.value),
      mode: s.mode,
    }));

    await prisma.connection.update({
      where: { id },
      data: { secrets: JSON.stringify(encrypted) },
    });

    return reply.send({
      secrets: encrypted.map((s) => ({ key: s.key, mode: s.mode })),
    });
  });

  /** Add or update a single secret (append, doesn't replace others) */
  app.post('/api/connections/:id/secrets', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { key: string; value: string; mode: 'agent' | 'exec_only' };

    if (!body.key || !body.value || (body.mode !== 'agent' && body.mode !== 'exec_only')) {
      return reply.code(400).send({ error: 'key (string), value (string), and mode ("agent"|"exec_only") are required' });
    }

    const connection = await prisma.connection.findUnique({ where: { id }, select: { secrets: true } });
    if (!connection) return reply.code(404).send({ error: 'Connection not found' });

    const existing: { key: string; encryptedValue: string; mode: string }[] = connection.secrets
      ? JSON.parse(connection.secrets)
      : [];

    // Remove existing entry with same key (upsert behavior)
    const filtered = existing.filter((s) => s.key !== body.key);
    filtered.push({
      key: body.key,
      encryptedValue: envelopeEncrypt(body.value),
      mode: body.mode,
    });

    await prisma.connection.update({
      where: { id },
      data: { secrets: JSON.stringify(filtered) },
    });

    return reply.code(201).send({
      secrets: filtered.map((s) => ({ key: s.key, mode: s.mode })),
    });
  });

  /** List secret names + modes (never returns values) */
  app.get('/api/connections/:id/secrets', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    const connection = await prisma.connection.findUnique({
      where: { id },
      select: { secrets: true },
    });

    if (!connection) {
      return reply.code(404).send({ error: 'Connection not found' });
    }

    const secrets: { key: string; mode: string }[] = connection.secrets
      ? (JSON.parse(connection.secrets) as { key: string; mode: string }[]).map((s) => ({ key: s.key, mode: s.mode }))
      : [];

    return reply.send({ secrets });
  });

  /** Delete a single secret by key */
  app.delete('/api/connections/:id/secrets/:key', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id, key } = request.params as { id: string; key: string };

    const connection = await prisma.connection.findUnique({
      where: { id },
      select: { secrets: true },
    });

    if (!connection) {
      return reply.code(404).send({ error: 'Connection not found' });
    }

    const existing: { key: string; encryptedValue: string; mode: string }[] = connection.secrets
      ? JSON.parse(connection.secrets)
      : [];

    const filtered = existing.filter((s) => s.key !== key);
    await prisma.connection.update({
      where: { id },
      data: { secrets: JSON.stringify(filtered) },
    });

    return reply.code(204).send();
  });

  /** List all secret names + modes across all connections in the org (for agent tools) */
  app.get('/api/connections/secrets/names', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = await resolveOrgIdForRequest(prisma, request);
    const connections = await prisma.connection.findMany({
      where: { ...(orgId ? { orgId } : {}), status: 'active' },
      select: { id: true, provider: true, name: true, secrets: true },
    });

    const allSecrets = connections.flatMap((c) => {
      const secrets: { key: string; mode: string }[] = c.secrets
        ? (JSON.parse(c.secrets) as { key: string; mode: string }[]).map((s) => ({ key: s.key, mode: s.mode }))
        : [];
      return secrets.map((s) => ({
        key: s.key,
        mode: s.mode,
        provider: c.provider,
        connectionName: c.name,
        connectionId: c.id,
      }));
    });

    return reply.send({ secrets: allSecrets });
  });

  // ── Connected providers (replaces hardcoded action list) ────────────
  app.get('/api/connections/providers', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = await resolveOrgIdForRequest(prisma, request);
    const connections = await prisma.connection.findMany({
      where: { ...(orgId ? { orgId } : {}), status: 'active' },
      select: {
        id: true,
        provider: true,
        name: true,
        scopeBoundaries: true,
      },
    });

    const providers = connections.map((c) => ({
      id: c.id,
      provider: c.provider,
      name: c.name,
      scopeBoundaries: describeScopeBoundaries(parseScopeBoundaries(c.scopeBoundaries)),
    }));

    return reply.send({
      providers,
      note: 'Any action can be executed through any connected provider. Policy is enforced dynamically by the gate.',
    });
  });
}

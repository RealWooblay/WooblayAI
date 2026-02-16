/**
 * Tool Gateway routes.
 *
 * The gateway is the ONLY path for agents to reach external services.
 * Agents send capability tokens + action requests; the gateway validates,
 * retrieves real credentials, executes, and returns results.
 *
 * Features:
 * - Signed capability token verification (ed25519)
 * - Idempotency keys — retries return cached result, never double-execute
 * - Post-action verification
 * - Cost attribution
 *
 * The agent NEVER sees the underlying credentials.
 */

import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db/client.js';
import { validateCapability } from '../engine/capability.js';
import { executeGitHubAction, type GitHubAction } from '../services/github-gateway.js';
import { persistEvent } from '../events/bus.js';
import { verifyExecution } from '../engine/verify.js';
import { emitRunEvent } from '../engine/run-events.js';
import { redactSecrets } from '../services/vault.js';
import { recordGatewayCost } from '../engine/cost-attribution.js';
import { canonicalJson } from '@wooblay/crypto';

// ── Idempotency ─────────────────────────────────────────────────────────

const IDEMPOTENCY_SUCCESS_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours for success
const IDEMPOTENCY_ERROR_TTL_MS = 60 * 1000;              // 60 seconds for errors

function computeIdempotencyKey(capabilityId: string, action: string, params: unknown): string {
  const actionHash = createHash('sha256')
    .update(action + '|' + canonicalJson(params))
    .digest('hex');
  return createHash('sha256')
    .update(capabilityId + '|' + actionHash)
    .digest('hex');
}

export async function gatewayRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /api/gateway/execute
   *
   * Primary gateway endpoint. Validates capability token, checks idempotency,
   * resolves the connection, executes the action, records spend, returns result.
   */
  app.post('/api/gateway/execute', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as {
      capabilityToken: string;
      action: string;
      params: Record<string, unknown>;
      proposalId?: string;
    };

    if (!body.capabilityToken || !body.action) {
      return reply.code(400).send({ error: 'capabilityToken and action are required' });
    }

    // 1. Validate capability token (signature + claims + DB check)
    const validation = await validateCapability(prisma, body.capabilityToken, body.action);
    if (!validation.valid || !validation.capability) {
      await persistEvent(prisma, {
        type: 'gateway.bypass_attempt',
        data: {
          runId: undefined,
          target: body.action,
          blocked: true,
        },
      });
      return reply.code(403).send({
        error: 'Capability validation failed',
        reason: validation.reason,
      });
    }

    const capability = validation.capability;
    const scope = validation.scope ?? {};
    const runOrgId = validation.runOrgId ?? null;

    // 2. Idempotency check — if we've already executed this exact request, replay
    const idempotencyKey = computeIdempotencyKey(capability.id, body.action, body.params);
    const existingKey = await prisma.idempotencyKey.findUnique({
      where: { key: idempotencyKey },
    });

    if (existingKey && new Date() < existingKey.expiresAt) {
      request.log.info({ idempotencyKey }, 'Replaying idempotent response');
      return reply.code(existingKey.statusCode).send(JSON.parse(existingKey.responseBody));
    }

    // 3. Determine provider from action class
    const provider = body.action.split(':')[0];

    if (provider !== 'github') {
      return reply.code(400).send({ error: `Unsupported provider: ${provider}. Only GitHub is supported in MVP.` });
    }

    // 4. Find active connection for the provider — HARD org-scoped
    //    If the run has an orgId, the connection MUST belong to the same org.
    //    This prevents cross-org capability replay.
    const orgFilter = runOrgId ? { orgId: runOrgId } : {};
    const connection = await prisma.connection.findFirst({
      where: { provider, status: 'active', ...orgFilter },
    });

    // Double-check: if connection has an orgId, it must match the run's org
    if (connection && connection.orgId && runOrgId && connection.orgId !== runOrgId) {
      await persistEvent(prisma, {
        type: 'gateway.bypass_attempt',
        data: { runId: capability.runId, target: body.action, blocked: true },
      });
      return reply.code(403).send({
        error: 'Cross-org access denied: capability run and connection belong to different organizations',
      });
    }

    if (!connection) {
      return reply.code(404).send({ error: `No active ${provider} connection found. Add one in Connections settings.` });
    }

    // 5. Validate scope constraints
    if (scope.repo) {
      const requestedRepo = `${body.params.owner}/${body.params.repo}`;
      if (scope.repo !== requestedRepo && scope.repo !== '*') {
        return reply.code(403).send({
          error: `Capability scoped to repo "${scope.repo}", but action targets "${requestedRepo}"`,
        });
      }
    }

    // 6. Execute via GitHub gateway
    const result = await executeGitHubAction(prisma, connection.id, {
      action: body.action as GitHubAction,
      params: body.params,
    });

    // 7. Record actual cost attribution
    await recordGatewayCost(prisma, capability.runId, body.action);

    // 8. Emit gateway execution event on the run timeline
    await emitRunEvent(prisma, capability.runId, 'gateway_exec', {
      capabilityId: capability.id,
      actionClass: body.action,
      success: result.success,
      error: result.error ? redactSecrets(result.error) : undefined,
    });

    await persistEvent(prisma, {
      type: 'gateway.executed',
      data: {
        capabilityId: capability.id,
        runId: capability.runId,
        actionClass: body.action,
        success: result.success,
      },
    });

    if (!result.success) {
      const errorResponse = {
        error: 'Gateway execution failed',
        detail: redactSecrets(result.error ?? ''),
      };

      // Cache the error response for idempotency
      await cacheIdempotencyResult(idempotencyKey, capability.id, body.action, body.params, 502, errorResponse);

      return reply.code(502).send(errorResponse);
    }

    // 9. Post-action verification
    let verification = null;
    if (body.proposalId) {
      try {
        verification = await verifyExecution(prisma, {
          proposalId: body.proposalId,
          runId: capability.runId,
          capabilityId: capability.id,
          actionClass: body.action,
          params: body.params,
          executionResult: result.data,
          connectionId: connection.id,
        });
      } catch (err: any) {
        request.log.warn(err, 'Post-action verification failed');
      }
    }

    const successResponse = {
      success: true,
      data: result.data,
      capabilityUsedCount: capability.usedCount + 1,
      capabilityMaxUses: capability.maxUses,
      verification: verification ?? undefined,
    };

    // Cache the success response for idempotency
    await cacheIdempotencyResult(idempotencyKey, capability.id, body.action, body.params, 200, successResponse);

    return reply.send(successResponse);
  });

  /**
   * POST /api/gateway/bypass-report
   *
   * Called by the network enforcer when an agent attempts to bypass the gateway.
   * Logs the attempt and quarantines the run.
   */
  app.post('/api/gateway/bypass-report', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as {
      runId?: string;
      target: string;
      sourceIp?: string;
    };

    await persistEvent(prisma, {
      type: 'gateway.bypass_attempt',
      data: {
        runId: body.runId,
        target: body.target,
        blocked: true,
      },
    });

    if (body.runId) {
      const { quarantineRun } = await import('../engine/orchestrator.js');
      try {
        await quarantineRun(prisma, body.runId, `Bypass attempt to ${body.target}`);
      } catch {
        // Run may already be in terminal state
      }
    }

    request.log.warn(`Gateway bypass attempt: ${body.target} from ${body.sourceIp ?? 'unknown'}`);
    return reply.send({ logged: true });
  });
}

// ── Helpers ─────────────────────────────────────────────────────────────

async function cacheIdempotencyResult(
  key: string,
  capabilityId: string,
  action: string,
  params: unknown,
  statusCode: number,
  response: unknown,
): Promise<void> {
  const actionHash = createHash('sha256')
    .update(action + '|' + canonicalJson(params))
    .digest('hex');

  // Success = long TTL (24h). Errors = short TTL (60s) so transient
  // failures don't lock users out.
  const isSuccess = statusCode >= 200 && statusCode < 300;
  const ttl = isSuccess ? IDEMPOTENCY_SUCCESS_TTL_MS : IDEMPOTENCY_ERROR_TTL_MS;

  try {
    await prisma.idempotencyKey.upsert({
      where: { key },
      create: {
        key,
        capabilityId,
        actionHash,
        statusCode,
        responseBody: JSON.stringify(response),
        expiresAt: new Date(Date.now() + ttl),
      },
      update: {
        statusCode,
        responseBody: JSON.stringify(response),
        expiresAt: new Date(Date.now() + ttl),
      },
    });
  } catch {
    // Non-critical — idempotency is a safety net, not required for correctness
  }
}

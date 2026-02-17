/**
 * Tool Gateway routes — Three-Layer Secure Execution.
 *
 * The gateway is the ONLY path for agents to reach external services.
 * Every action goes through the three-layer security moat:
 *
 *   1. Policy Gate + Scope Boundaries — "Should this happen?"
 *   2. Pre-execution Simulation       — "Will it do what it claims?"
 *   3. Ephemeral Secure Execution     — "Execute safely, verify it worked"
 *
 * The agent NEVER sees the underlying credentials.
 */

import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db/client.js';
import { validateCapability } from '../engine/capability.js';
import { persistEvent } from '../events/bus.js';
import { verifyExecution } from '../engine/verify.js';
import { emitRunEvent } from '../engine/run-events.js';
import { redactSecrets } from '../services/vault.js';
import { recordGatewayCost } from '../engine/cost-attribution.js';
import { canonicalJson } from '@wooblay/crypto';
import { getActionDefinition, listActions } from '../engine/action-registry.js';
import { parseScopeBoundaries, checkScope } from '../engine/scope.js';
import { simulateAction, supportsSimulation } from '../engine/simulate.js';
import { executeSecureAction } from '../engine/secure-exec.js';

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

    // ── LAYER 0: Action Registry validation ────────────────────────────
    const actionDef = getActionDefinition(body.action);
    if (!actionDef) {
      const supported = listActions().map((a) => a.action).join(', ');
      return reply.code(400).send({
        error: `Unknown action: ${body.action}`,
        supportedActions: supported,
      });
    }

    // For exec:run, the agent specifies which provider's credentials to use
    const effectiveProvider = body.action === 'exec:run' && body.params.provider
      ? String(body.params.provider)
      : actionDef.provider;

    // Find active connection for the provider — HARD org-scoped
    const orgFilter = runOrgId ? { orgId: runOrgId } : {};
    const connection = await prisma.connection.findFirst({
      where: { provider: effectiveProvider, status: 'active', ...orgFilter },
    });

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
      return reply.code(404).send({
        error: `No active ${effectiveProvider} connection found. Add one on the Connections page.`,
      });
    }

    // ── LAYER 1: Scope Boundaries ────────────────────────────────────
    const scopeBoundaries = parseScopeBoundaries(connection.scopeBoundaries);
    const scopeResult = checkScope(scopeBoundaries, body.action, body.params);

    await emitRunEvent(prisma, capability.runId, 'scope_check', {
      action: body.action,
      allowed: scopeResult.allowed,
      reason: scopeResult.reason,
      connectionId: connection.id,
    });

    if (!scopeResult.allowed) {
      const scopeError = {
        error: 'Action blocked by scope boundary',
        reason: scopeResult.reason,
        action: body.action,
      };
      await cacheIdempotencyResult(idempotencyKey, capability.id, body.action, body.params, 403, scopeError);
      return reply.code(403).send(scopeError);
    }

    // Also check capability-level scope (repo constraint from token)
    if (scope.repo) {
      const requestedRepo = `${body.params.owner}/${body.params.repo}`;
      if (scope.repo !== requestedRepo && scope.repo !== '*') {
        return reply.code(403).send({
          error: `Capability scoped to repo "${scope.repo}", but action targets "${requestedRepo}"`,
        });
      }
    }

    // ── LAYER 2: Pre-execution Simulation ────────────────────────────
    let simulationResult = null;
    if (supportsSimulation(body.action)) {
      try {
        simulationResult = await simulateAction(prisma, {
          actionSpec: { action: body.action, params: body.params },
          connectionId: connection.id,
          runId: capability.runId,
        });

        if (!simulationResult.passed) {
          const simError = {
            error: 'Pre-execution simulation failed — action not executed',
            simulation: {
              strategy: simulationResult.strategy,
              summary: simulationResult.summary,
              details: simulationResult.details,
              durationMs: simulationResult.durationMs,
            },
          };
          await cacheIdempotencyResult(idempotencyKey, capability.id, body.action, body.params, 403, simError);
          return reply.code(403).send(simError);
        }
      } catch (err: any) {
        request.log.warn(err, 'Simulation failed (non-blocking)');
      }
    }

    // ── LAYER 3: Ephemeral Secure Execution ──────────────────────────
    const execResult = await executeSecureAction(prisma, {
      actionSpec: { action: body.action, params: body.params },
      connectionId: connection.id,
      runId: capability.runId,
    });

    // Record cost attribution
    await recordGatewayCost(prisma, capability.runId, body.action);

    // Emit gateway execution event
    await emitRunEvent(prisma, capability.runId, 'gateway_exec', {
      capabilityId: capability.id,
      actionClass: body.action,
      success: execResult.success,
      containerId: execResult.containerId,
      durationMs: execResult.durationMs,
      error: execResult.error ? redactSecrets(execResult.error) : undefined,
    });

    await persistEvent(prisma, {
      type: 'gateway.executed',
      data: {
        capabilityId: capability.id,
        runId: capability.runId,
        actionClass: body.action,
        success: execResult.success,
        containerId: execResult.containerId,
      },
    });

    if (!execResult.success) {
      const errorResponse = {
        error: 'Secure execution failed',
        detail: redactSecrets(execResult.error ?? ''),
        containerId: execResult.containerId,
        exitCode: execResult.exitCode,
        stderr: redactSecrets(execResult.stderr.slice(0, 2000)),
        simulation: simulationResult ? {
          strategy: simulationResult.strategy,
          passed: simulationResult.passed,
          summary: simulationResult.summary,
        } : undefined,
      };
      await cacheIdempotencyResult(idempotencyKey, capability.id, body.action, body.params, 502, errorResponse);
      return reply.code(502).send(errorResponse);
    }

    // Post-action verification
    let verification = null;
    if (body.proposalId) {
      try {
        verification = await verifyExecution(prisma, {
          proposalId: body.proposalId,
          runId: capability.runId,
          capabilityId: capability.id,
          actionClass: body.action,
          params: body.params,
          executionResult: {
            stdout: execResult.stdout,
            exitCode: execResult.exitCode,
            containerId: execResult.containerId,
          },
          connectionId: connection.id,
        });
      } catch (err: any) {
        request.log.warn(err, 'Post-action verification failed');
      }
    }

    const successResponse = {
      success: true,
      data: {
        stdout: execResult.stdout,
        stderr: execResult.stderr,
        exitCode: execResult.exitCode,
        containerId: execResult.containerId,
        durationMs: execResult.durationMs,
        description: execResult.description,
      },
      simulation: simulationResult ? {
        strategy: simulationResult.strategy,
        passed: simulationResult.passed,
        summary: simulationResult.summary,
        durationMs: simulationResult.durationMs,
      } : undefined,
      capabilityUsedCount: capability.usedCount + 1,
      capabilityMaxUses: capability.maxUses,
      verification: verification ?? undefined,
    };

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

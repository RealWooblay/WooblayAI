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
 *
 * Two auth modes:
 *   - Capability token (Wooblay-hosted agents) — existing flow
 *   - API key (external agents: OpenAI GPTs, Claude MCP, etc.) — new flow
 *     API key resolves to an org, then runs the same pipeline.
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
import { getActionDefinition } from '../engine/action-registry.js';
import { parseScopeBoundaries, checkScope } from '../engine/scope.js';
import { simulateAction } from '../engine/simulate.js';
import { executeSecureAction } from '../engine/secure-exec.js';
import { classifyRisk, classifyCategory } from '../engine/risk.js';
import { validateApiKey } from './api-keys.js';
import { Decision } from '@wooblay/types';

// ── Idempotency ─────────────────────────────────────────────────────────

const IDEMPOTENCY_SUCCESS_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours for success
const IDEMPOTENCY_ERROR_TTL_MS = 60 * 1000;              // 60 seconds for errors

function computeIdempotencyKey(callerId: string, action: string, params: unknown): string {
  const actionHash = createHash('sha256')
    .update(action + '|' + canonicalJson(params))
    .digest('hex');
  return createHash('sha256')
    .update(callerId + '|' + actionHash)
    .digest('hex');
}

// ── Auth Resolution ─────────────────────────────────────────────────────

interface GatewayAuth {
  mode: 'capability' | 'api_key';
  orgId: string | null;
  runId: string | null;
  callerId: string; // capability.id or apiKey.id — for idempotency + audit
  scope: Record<string, unknown>;
  capability?: any; // Only set for capability mode
}

async function resolveGatewayAuth(
  request: FastifyRequest,
  body: { capabilityToken?: string; action: string },
): Promise<{ auth: GatewayAuth } | { error: string; statusCode: number }> {
  // Path 1: Capability token (Wooblay-hosted agents)
  if (body.capabilityToken) {
    const validation = await validateCapability(prisma, body.capabilityToken, body.action);
    if (!validation.valid || !validation.capability) {
      return { error: `Capability validation failed: ${validation.reason}`, statusCode: 403 };
    }
    return {
      auth: {
        mode: 'capability',
        orgId: validation.runOrgId ?? null,
        runId: validation.capability.runId,
        callerId: validation.capability.id,
        scope: validation.scope ?? {},
        capability: validation.capability,
      },
    };
  }

  // Path 2: API key (external agents)
  const authHeader = request.headers.authorization;
  if (authHeader?.startsWith('Bearer wbl_ak_')) {
    const rawKey = authHeader.slice('Bearer '.length);
    const keyValidation = await validateApiKey(rawKey);
    if (!keyValidation.valid) {
      return { error: `API key validation failed: ${keyValidation.reason}`, statusCode: 403 };
    }
    return {
      auth: {
        mode: 'api_key',
        orgId: keyValidation.orgId ?? null,
        runId: null,
        callerId: keyValidation.apiKeyId!,
        scope: {},
      },
    };
  }

  return { error: 'Authentication required. Provide capabilityToken in body or Bearer API key in Authorization header.', statusCode: 401 };
}

export async function gatewayRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /api/gateway/execute
   *
   * Primary gateway endpoint. Accepts either:
   *   - capabilityToken (body) — Wooblay-hosted agents
   *   - Authorization: Bearer wbl_ak_xxx — external agents (OpenAI GPTs, Claude MCP, etc.)
   *
   * Both paths run the same three-layer moat.
   */
  app.post('/api/gateway/execute', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as {
      capabilityToken?: string;
      action: string;
      params: Record<string, unknown>;
      proposalId?: string;
    };

    if (!body.action) {
      return reply.code(400).send({ error: 'action is required' });
    }

    // ── Authenticate ──────────────────────────────────────────────────
    const authResult = await resolveGatewayAuth(request, body);
    if ('error' in authResult) {
      await persistEvent(prisma, {
        type: 'gateway.auth_failed',
        data: { target: body.action, reason: authResult.error },
      });
      return reply.code(authResult.statusCode).send({ error: authResult.error });
    }

    const auth = authResult.auth;

    // ── Idempotency ───────────────────────────────────────────────────
    const idempotencyKey = computeIdempotencyKey(auth.callerId, body.action, body.params);
    const existingKey = await prisma.idempotencyKey.findUnique({
      where: { key: idempotencyKey },
    });

    if (existingKey && new Date() < existingKey.expiresAt) {
      request.log.info({ idempotencyKey }, 'Replaying idempotent response');
      return reply.code(existingKey.statusCode).send(JSON.parse(existingKey.responseBody));
    }

    // ── LAYER 0: Action validation ─────────────────────────────────
    // The action registry is optional — known actions get convenience
    // shortcuts, unknown actions fall through to generic execution.
    const actionDef = getActionDefinition(body.action);

    // External agents (API key) cannot use actions that require a workspace.
    // For unknown actions, check if params explicitly request a workspace.
    const needsWorkspace = actionDef
      ? actionDef.mountWorkspace
      : Boolean(body.params.mountWorkspace);

    if (auth.mode === 'api_key' && needsWorkspace) {
      return reply.code(422).send({
        error: `This action requires an agent workspace and cannot be called from an external API key.`,
        detail: `"${body.action}" needs a local workspace with files. Use a Wooblay-hosted agent, or restructure as an API-based action.`,
        action: body.action,
      });
    }

    // Resolve provider: params.provider > action def > default
    const effectiveProvider = body.params.provider
      ? String(body.params.provider)
      : actionDef?.provider ?? 'generic';

    // Find active connection for the provider — HARD org-scoped
    const orgFilter = auth.orgId ? { orgId: auth.orgId } : {};
    const connection = await prisma.connection.findFirst({
      where: { provider: effectiveProvider, status: 'active', ...orgFilter },
    });

    if (connection && connection.orgId && auth.orgId && connection.orgId !== auth.orgId) {
      await persistEvent(prisma, {
        type: 'gateway.bypass_attempt',
        data: { runId: auth.runId ?? undefined, target: body.action, blocked: true },
      });
      return reply.code(403).send({
        error: 'Cross-org access denied: caller and connection belong to different organizations',
      });
    }

    if (!connection) {
      return reply.code(404).send({
        error: `No active ${effectiveProvider} connection found. Add one on the Connections page.`,
      });
    }

    // ── POLICY CHECK (API key callers) ───────────────────────────────
    // For API key callers there's no run-level policy; create a synthetic
    // agent + tool call record and evaluate org-level policies.
    if (auth.mode === 'api_key') {
      const riskTier = classifyRisk(body.action, body.params);
      const category = classifyCategory(body.action, body.params);
      const externalPubkey = `apikey:${auth.callerId}`;

      // Ensure the synthetic agent exists and is allowlisted
      const existingAgent = await prisma.agent.findUnique({ where: { pubkey: externalPubkey } });
      if (!existingAgent) {
        await prisma.agent.create({
          data: { pubkey: externalPubkey, name: `External API Key`, allowlisted: true, status: 'active' },
        });
      }

      // Create a temporary tool call record for policy evaluation
      const syntheticToolCall = await prisma.toolCall.create({
        data: {
          agentPubkey: externalPubkey,
          toolName: body.action,
          args: canonicalJson(body.params),
          riskTier,
          category,
          adapter: 'external-api-key',
        },
      });

      const { evaluatePolicy } = await import('../engine/policy.js');
      const policyResult = await evaluatePolicy(prisma, syntheticToolCall);

      if (policyResult.decision === Decision.DENY) {
        await persistEvent(prisma, {
          type: 'gateway.policy_denied',
          data: {
            apiKeyId: auth.callerId,
            action: body.action,
            riskTier,
            category,
            policyRuleId: policyResult.ruleId,
          },
        });
        return reply.code(403).send({
          error: 'Action denied by policy',
          riskTier,
          category,
          policyRule: policyResult.ruleId,
          reason: policyResult.reason,
        });
      }

      await persistEvent(prisma, {
        type: 'gateway.policy_passed',
        data: {
          apiKeyId: auth.callerId,
          action: body.action,
          riskTier,
          category,
          decision: policyResult.decision,
        },
      });
    }

    // ── LAYER 1: Scope Boundaries ────────────────────────────────────
    const scopeBoundaries = parseScopeBoundaries(connection.scopeBoundaries);
    const scopeResult = checkScope(scopeBoundaries, body.action, body.params);

    if (auth.runId) {
      await emitRunEvent(prisma, auth.runId, 'scope_check', {
        action: body.action,
        allowed: scopeResult.allowed,
        reason: scopeResult.reason,
        connectionId: connection.id,
      });
    }

    if (!scopeResult.allowed) {
      const scopeError = {
        error: 'Action blocked by scope boundary',
        reason: scopeResult.reason,
        action: body.action,
      };
      await cacheIdempotencyResult(idempotencyKey, auth.callerId, body.action, body.params, 403, scopeError);
      return reply.code(403).send(scopeError);
    }

    // Also check capability-level scope (repo constraint from token) — only for capability auth
    const scopeRepo = auth.scope?.repo as string | undefined;
    if (auth.mode === 'capability' && scopeRepo) {
      const requestedRepo = `${body.params.owner}/${body.params.repo}`;
      if (scopeRepo !== requestedRepo && scopeRepo !== '*') {
        return reply.code(403).send({
          error: `Capability scoped to repo "${scopeRepo}", but action targets "${requestedRepo}"`,
        });
      }
    }

    // ── LAYER 2: Pre-execution Simulation ────────────────────────────
    // For simulation + secure-exec, a runId is needed for event tracking.
    // For API-key callers without a real run, use the apiKey ID as a fallback.
    const effectiveRunId = auth.runId ?? auth.callerId;

    // Credential actions ALWAYS get simulated (sandbox + AI intent verification)
    let simulationResult = null;
    try {
      simulationResult = await simulateAction(prisma, {
        actionSpec: { action: body.action, params: body.params },
        connectionId: connection.id,
        runId: effectiveRunId,
        statedIntent: body.action,
      });

      if (!simulationResult.passed) {
        const simError = {
          error: 'Pre-execution simulation failed — intent mismatch detected',
          simulation: {
            strategy: simulationResult.strategy,
            summary: simulationResult.summary,
            details: simulationResult.details,
            aiAnalysis: simulationResult.aiAnalysis,
            durationMs: simulationResult.durationMs,
          },
        };
        await cacheIdempotencyResult(idempotencyKey, auth.callerId, body.action, body.params, 403, simError);
        return reply.code(403).send(simError);
      }
    } catch (err: any) {
      request.log.warn(err, 'Simulation failed (non-blocking, allowing through)');
    }

    // ── LAYER 3: Ephemeral Secure Execution ──────────────────────────
    const execResult = await executeSecureAction(prisma, {
      actionSpec: { action: body.action, params: body.params },
      connectionId: connection.id,
      runId: effectiveRunId,
    });

    // Record cost attribution (only for capability-based callers with real runs)
    if (auth.runId) {
      await recordGatewayCost(prisma, auth.runId, body.action);
    }

    // Emit events
    if (auth.runId) {
      await emitRunEvent(prisma, auth.runId, 'gateway_exec', {
        capabilityId: auth.callerId,
        actionClass: body.action,
        success: execResult.success,
        containerId: execResult.containerId,
        durationMs: execResult.durationMs,
        error: execResult.error ? redactSecrets(execResult.error) : undefined,
      });
    }

    await persistEvent(prisma, {
      type: 'gateway.executed',
      data: {
        callerId: auth.callerId,
        authMode: auth.mode,
        runId: auth.runId ?? undefined,
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
      await cacheIdempotencyResult(idempotencyKey, auth.callerId, body.action, body.params, 502, errorResponse);
      return reply.code(502).send(errorResponse);
    }

    // Post-action verification (capability-mode only — external callers don't have proposals)
    let verification = null;
    if (body.proposalId && auth.runId) {
      try {
        verification = await verifyExecution(prisma, {
          proposalId: body.proposalId,
          runId: auth.runId,
          capabilityId: auth.callerId,
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
      ...(auth.mode === 'capability' && auth.capability ? {
        capabilityUsedCount: auth.capability.usedCount + 1,
        capabilityMaxUses: auth.capability.maxUses,
      } : {}),
      verification: verification ?? undefined,
    };

    await cacheIdempotencyResult(idempotencyKey, auth.callerId, body.action, body.params, 200, successResponse);
    return reply.send(successResponse);
  });

  /**
   * GET /api/gateway/capabilities
   *
   * Returns what the caller can do — based on their connected providers.
   * Does NOT return a hardcoded action list. Instead tells the agent
   * which providers are connected and that any action/command can be
   * executed through those providers.
   */
  app.get('/api/gateway/capabilities', async (request: FastifyRequest, reply: FastifyReply) => {
    // Resolve org from API key or Clerk session
    let orgId: string | null = null;
    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith('Bearer wbl_ak_')) {
      const keyValidation = await validateApiKey(authHeader.slice('Bearer '.length));
      if (keyValidation.valid) orgId = keyValidation.orgId ?? null;
    } else if ((request as any).user?.orgId) {
      orgId = (request as any).user.orgId;
    }

    // Get connected providers for this org
    const connections = orgId
      ? await prisma.connection.findMany({
          where: { orgId, status: 'active' },
          select: { provider: true, name: true },
        })
      : [];

    return reply.send({
      providers: connections.map((c) => ({ provider: c.provider, name: c.name })),
      usage: {
        endpoint: 'POST /api/gateway/execute',
        auth: 'Authorization: Bearer <your-api-key>',
        body: {
          action: '<any action name — used for policy matching and audit>',
          params: {
            command: '<the command to execute>',
            provider: '<which connection to use for credentials>',
            image: '<optional docker image, defaults to node:20-slim>',
            env: '<optional extra env vars>',
          },
        },
        note: 'Any action can be executed. The action name is used for policy evaluation and audit trail. Provide a command and the provider whose credentials you need.',
      },
    });
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
  callerId: string,
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
        capabilityId: callerId,
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

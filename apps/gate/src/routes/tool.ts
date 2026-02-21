/**
 * Tool execution route.
 *
 * POST /api/tool/execute — The primary Gate endpoint. Receives a tool call
 * request, classifies its risk, evaluates policy, and returns one of:
 *   - EXECUTE  (proceed immediately)
 *   - DENY     (blocked by policy)
 *   - PENDING_APPROVAL (human review required)
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ToolExecuteRequestSchema } from '@wooblay/schemas';
import { canonicalJson } from '@wooblay/crypto';
import type { ToolExecuteRequest, DecisionTrail } from '@wooblay/types';
import { Decision } from '@wooblay/types';
import { prisma } from '../db/client.js';
import { classifyRisk, classifyCategory, classifyWithAI } from '../engine/risk.js';
import { evaluatePolicy } from '../engine/policy.js';
import { createReceipt } from '../engine/receipt.js';
import { createApproval } from '../services/approval.js';
import { validateBody } from '../middleware/validate.js';
import { describeToolCall, explainWhyFlagged } from '../engine/analysis.js';
import { detectFlags } from '../engine/flags.js';
import { getActionDefinition } from '../engine/action-registry.js';
import { parseScopeBoundaries, checkScope } from '../engine/scope.js';
import { simulateAction, simulateLocalAction, shouldSimulate, verifyMcpToolResult, verifyMcpPreExecution } from '../engine/simulate.js';
import { executeSecureAction } from '../engine/secure-exec.js';
import { reportExecution } from '../services/execution.js';
import { emitRunEvent } from '../engine/run-events.js';
import { redactSecrets } from '../services/vault.js';
import { getOrgScope } from '../middleware/org-scope.js';
import type { SimulationThreshold } from '../types/simulation.js';

/** Default decision trail when none is provided by the agent. */
const defaultTrail: DecisionTrail = {
  plan_summary: 'No plan provided',
  reason_summary: 'No reason provided',
  inputs_used: [],
  citations: [],
};

/** Read org simulation threshold from settings. Defaults to 'high'. */
async function getOrgSimulationThreshold(orgId: string | null): Promise<SimulationThreshold> {
  if (!orgId) return 'high';
  try {
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { settings: true },
    });
    if (org?.settings) {
      const settings = JSON.parse(org.settings);
      const valid: SimulationThreshold[] = ['critical_only', 'high', 'medium', 'all'];
      if (valid.includes(settings.simulationThreshold)) return settings.simulationThreshold;
    }
  } catch { /* default */ }
  return 'high';
}

export async function toolRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/api/tool/execute',
    { preHandler: validateBody(ToolExecuteRequestSchema) },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as ToolExecuteRequest;

      try {
        // 0. Auto-register agent if not found (managed runtime self-registration)
        //    In a managed runtime, the adapter plugin is trusted and runs in-process.
        const existingAgent = await prisma.agent.findUnique({
          where: { pubkey: body.agentPubkey },
        });
        if (!existingAgent) {
          await prisma.agent.create({
            data: {
              pubkey: body.agentPubkey,
              name: body.adapter ?? body.agentPubkey,
              allowlisted: true,
              status: 'active',
            },
          });
          request.log.info(`Auto-registered agent: ${body.agentPubkey} (adapter: ${body.adapter})`);
        }

        // 1. Classify risk tier and business category
        //    Layer 1: Structural (fast, deterministic) — the baseline
        const structuralRisk = classifyRisk(body.toolName, body.args);
        const structuralCategory = classifyCategory(body.toolName, body.args);

        //    Layer 2: AI (smart, contextual) — can ESCALATE, never downgrade
        //    This is what catches `cat /etc/shadow`, suspicious downloads, etc.
        //    without us having to hardcode every possible sensitive path.
        let riskTier = structuralRisk;
        let category = structuralCategory;
        let aiDescription: string | null = null;
        let aiWhyReview: string | null = null;

        try {
          const aiResult = await classifyWithAI(body.toolName, body.args, structuralRisk, structuralCategory);
          if (aiResult) {
            riskTier = aiResult.riskTier;
            category = aiResult.category;
            aiDescription = aiResult.description || null;
            aiWhyReview = aiResult.whyReview || null;
            if (riskTier !== structuralRisk || category !== structuralCategory) {
              request.log.info(
                `[AI] Reclassified: ${structuralRisk}/${structuralCategory} → ${riskTier}/${category} — ${aiResult.reasoning}`,
              );
            }
          }
        } catch (err) {
          request.log.warn(err, 'AI classification failed, using structural fallback');
        }

        // 2. Canonicalize args for storage
        const argsCanonical = canonicalJson(body.args);

        // 3. Create the ToolCall record
        const toolCall = await prisma.toolCall.create({
          data: {
            taskId: body.taskId ?? null,
            sessionId: body.sessionId ?? null,
            agentPubkey: body.agentPubkey,
            toolName: body.toolName,
            args: argsCanonical,
            riskTier,
            category,
            adapter: body.adapter ?? null,
          },
        });

        // 3b. Resolve instance for this agent (for role-aware flag detection)
        // MVP: match by most recently active running instance
        const agentInstance = await prisma.instance.findFirst({
          where: { status: 'running' },
          orderBy: { updatedAt: 'desc' },
          select: { id: true },
        });

        // 3c. Run flag detection async (non-blocking)
        detectFlags(prisma, {
          toolCallId: toolCall.id,
          agentPubkey: body.agentPubkey,
          toolName: body.toolName,
          args: argsCanonical,
          riskTier,
          category,
          instanceId: agentInstance?.id ?? null,
        }).catch((err) => request.log.warn(err, 'Flag detection failed'));

        // 4. Evaluate policy (instance-specific rules override globals)
        const policyDecision = await evaluatePolicy(prisma, toolCall, agentInstance?.id ?? null);
        const decisionTrail = body.decisionTrail ?? defaultTrail;

        // 4b. Human-readable enrichment
        //     AI descriptions take priority — they understand context, not just syntax.
        //     Regex fallback exists for when AI is unavailable.
        const parsedArgs = typeof body.args === 'string' ? JSON.parse(body.args) : body.args;
        const description = aiDescription || describeToolCall(body.toolName, parsedArgs);
        const whyFlagged = aiWhyReview
          || explainWhyFlagged(riskTier, body.toolName, policyDecision.decision, parsedArgs);

        // 5. Handle the decision
        switch (policyDecision.decision) {
          case Decision.ALLOW: {
            // Policy says ALLOW — now check if Layer 2 (simulation) should trigger.
            // This is dynamic: based on the AI risk tier and the org's threshold setting.
            const org = getOrgScope(request);
            const simThreshold = await getOrgSimulationThreshold(org.orgId ?? null);
            const needsSim = shouldSimulate(riskTier, simThreshold, false);

            let simResult = null;
            if (needsSim) {
              try {
                const syntheticRunId = `gate-${toolCall.id}`;
                simResult = await simulateLocalAction(prisma, {
                  toolName: body.toolName,
                  args: parsedArgs,
                  riskTier,
                  aiDescription: aiDescription ?? undefined,
                  runId: syntheticRunId,
                });

                if (!simResult.passed) {
                  // Simulation failed (intent mismatch) — block the action
                  const receipt = await createReceipt(prisma, {
                    toolCallId: toolCall.id,
                    agentPubkey: body.agentPubkey,
                    toolName: body.toolName,
                    riskTier,
                    policyDecision: 'DENY',
                    policyRuleId: policyDecision.ruleId ?? null,
                    decisionTrail,
                  });

                  return reply.code(200).send({
                    decision: 'DENY',
                    toolCallId: toolCall.id,
                    receiptId: receipt.id,
                    reason: `Simulation blocked: ${simResult.summary}`,
                    description,
                    whyFlagged: simResult.summary,
                    riskTier,
                    simulation: {
                      strategy: simResult.strategy,
                      passed: false,
                      summary: simResult.summary,
                      aiAnalysis: simResult.aiAnalysis,
                    },
                  });
                }
              } catch (err: any) {
                request.log.error(err, 'Simulation failed — blocking action (fail-closed)');
                const receipt = await createReceipt(prisma, {
                  toolCallId: toolCall.id,
                  agentPubkey: body.agentPubkey,
                  toolName: body.toolName,
                  riskTier,
                  policyDecision: 'DENY',
                  policyRuleId: policyDecision.ruleId ?? null,
                  decisionTrail,
                });
                return reply.code(200).send({
                  decision: 'DENY',
                  toolCallId: toolCall.id,
                  receiptId: receipt.id,
                  reason: 'Simulation failed (timeout or error). Action blocked for safety.',
                  description,
                  whyFlagged: err?.message ?? 'Simulation failed',
                  riskTier,
                });
              }
            }

            // ALLOW → EXECUTE
            const receipt = await createReceipt(prisma, {
              toolCallId: toolCall.id,
              agentPubkey: body.agentPubkey,
              toolName: body.toolName,
              riskTier,
              policyDecision: policyDecision.decision,
              policyRuleId: policyDecision.ruleId ?? null,
              decisionTrail,
            });

            return reply.code(200).send({
              decision: 'EXECUTE',
              toolCallId: toolCall.id,
              receiptId: receipt.id,
              reason: policyDecision.reason,
              description,
              riskTier,
              simulation: simResult ? {
                strategy: simResult.strategy,
                passed: simResult.passed,
                summary: simResult.summary,
              } : undefined,
            });
          }

          case Decision.DENY: {
            // DENY → blocked
            const receipt = await createReceipt(prisma, {
              toolCallId: toolCall.id,
              agentPubkey: body.agentPubkey,
              toolName: body.toolName,
              riskTier,
              policyDecision: policyDecision.decision,
              policyRuleId: policyDecision.ruleId ?? null,
              decisionTrail,
            });

            return reply.code(200).send({
              decision: 'DENY',
              toolCallId: toolCall.id,
              receiptId: receipt.id,
              reason: policyDecision.reason,
              description,
              whyFlagged,
              riskTier,
            });
          }

          case Decision.APPROVE: {
            // APPROVE → human review required
            const approval = await createApproval(prisma, toolCall.id);

            return reply.code(200).send({
              decision: 'PENDING_APPROVAL',
              toolCallId: toolCall.id,
              approvalId: approval.id,
              reason: policyDecision.reason,
              description,
              whyFlagged,
              riskTier,
            });
          }

          default:
            return reply.code(500).send({ error: 'Unknown policy decision' });
        }
      } catch (err) {
        request.log.error(err, 'Tool execution failed');
        return reply.code(500).send({ error: 'Internal server error' });
      }
    },
  );

  /**
   * POST /api/tool/structured-execute
   *
   * Called by the OpenClaw plugin's structured_action tool AFTER policy approval.
   * Runs the full three-layer moat: scope check → simulation → secure execution.
   * The agent never sees credentials — this endpoint resolves them from the vault.
   */
  app.post('/api/tool/structured-execute', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as {
      action: string;
      params: Record<string, unknown>;
      agentPubkey?: string;
      adapter?: string;
    };

    if (!body.action || !body.params) {
      return reply.code(400).send({ error: 'action and params are required' });
    }

    // Look up optional convenience shortcut — NOT a gatekeeper
    const actionDef = getActionDefinition(body.action);

    // Connection resolution: direct IDs (from MCP proxy) or provider-based lookup
    const org = getOrgScope(request);
    let connection;

    const directConnectionIds = body.params.connectionIds;
    if (Array.isArray(directConnectionIds) && directConnectionIds.length > 0) {
      const ids = directConnectionIds.map(String);
      const matches = await prisma.connection.findMany({
        where: { id: { in: ids }, status: 'active', ...org.filter },
      });
      if (matches.length !== ids.length) {
        return reply.code(404).send({
          error: 'One or more connection IDs not found or not accessible.',
        });
      }
      connection = matches[0];
    } else {
      // Provider-based lookup: params.provider > action def > default
      const effectiveProvider = body.params.provider
        ? String(body.params.provider)
        : actionDef?.provider ?? 'generic';

      connection = await prisma.connection.findFirst({
        where: { provider: effectiveProvider, status: 'active', ...org.filter },
      });

      if (!connection) {
        return reply.code(404).send({
          error: `No active ${effectiveProvider} connection found. Add one on the Connections page.`,
        });
      }
    }

    // Layer 1: Scope check
    const scopeBoundaries = parseScopeBoundaries(connection.scopeBoundaries);
    const scopeResult = checkScope(scopeBoundaries, body.action, body.params);
    if (!scopeResult.allowed) {
      return reply.code(403).send({
        success: false,
        error: 'Action blocked by scope boundary',
        reason: scopeResult.reason,
      });
    }

    // ── MCP tool calls → L3 executor + L2 post-verification ──────────
    // MCP flow: L1 (policy) → L3 (secure exec) → L2 (AI result verification)
    //
    // L2 is POST-execution for MCP because sandbox simulation can't work
    // (MCP servers need real credentials + network). Instead, after L3
    // returns the result, AI verifies that the output matches the expected
    // behaviour of the tool + args. Mismatches raise audit flags.
    //
    // Credential resolution merges ALL linked connections — env var names
    // are controlled by connection secrets[].key, so any MCP server's
    // expected env vars are satisfied without hardcoding.
    if (body.action === 'mcp:tool-call') {
      const { resolveMultiConnectionCredentials, executeMcpToolCall } = await import('../engine/secure-exec.js');

      // Resolve all connection IDs — from the proxy's connectionIds param,
      // or falling back to the single connection resolved above.
      const allConnectionIds = Array.isArray(directConnectionIds) && directConnectionIds.length > 0
        ? directConnectionIds.map(String)
        : [connection.id];

      let credentials: Record<string, string>;
      try {
        credentials = await resolveMultiConnectionCredentials(prisma, allConnectionIds);
      } catch (err: any) {
        return reply.code(500).send({
          success: false,
          error: `Credential resolution failed: ${redactSecrets(err.message)}`,
        });
      }

      const serverCommand = String(body.params.serverCommand ?? '');
      const toolName = String(body.params.toolName ?? '');
      const toolArgs = (body.params.toolArgs ?? {}) as Record<string, unknown>;

      if (!serverCommand || !toolName) {
        return reply.code(400).send({
          success: false,
          error: 'mcp:tool-call requires serverCommand and toolName in params',
        });
      }

      // ── L2 PRE-EXECUTION: Verify server+tool+credential safety ────
      // This runs BEFORE any credentials leave the vault.
      // If the AI or rule engine determines the combination is unsafe
      // (e.g., GitHub token going to an unknown package), execution is
      // BLOCKED and credentials are never exposed.
      const credentialEnvVars = Object.keys(credentials).filter(k =>
        !['MCP_SERVER_CMD', 'MCP_TOOL_NAME', 'MCP_TOOL_ARGS'].includes(k),
      );

      try {
        const preCheck = await verifyMcpPreExecution(prisma, {
          serverCommand,
          toolName,
          toolArgs,
          credentialEnvVars,
        });

        if (!preCheck.safe) {
          request.log.warn({
            serverCommand, toolName, credentialEnvVars,
            threatLevel: preCheck.threatLevel,
            concerns: preCheck.concerns,
          }, 'MCP L2 pre-execution check BLOCKED — credentials NOT injected');

          return reply.code(403).send({
            success: false,
            error: 'Pre-execution security check failed — credentials were NOT exposed',
            verification: {
              stage: 'pre-execution',
              safe: false,
              threatLevel: preCheck.threatLevel,
              reasoning: preCheck.reasoning,
              concerns: preCheck.concerns,
              durationMs: preCheck.durationMs,
            },
          });
        }

        request.log.info({
          serverCommand, toolName, threatLevel: preCheck.threatLevel,
        }, 'MCP L2 pre-execution check PASSED — proceeding to L3');
      } catch (err: any) {
        // Fail-closed: if pre-exec check errors, block execution
        request.log.error(err, 'MCP L2 pre-execution check failed — blocking (fail-closed)');
        return reply.code(503).send({
          success: false,
          error: 'Pre-execution security check failed (error). Credentials NOT exposed.',
        });
      }

      try {
        // ── L3: Secure Execution ──────────────────────────────────────
        const mcpResult = await executeMcpToolCall(prisma, {
          serverCommand,
          toolName,
          toolArgs,
          credentials,
          image: body.params.image ? String(body.params.image) : undefined,
        });

        // ── Record Execution (makes it visible in Activity + Admin) ──
        // The proxy's callGate stores the prefixed name (e.g. "github__search_repositories")
        // while body.params.toolName is bare ("search_repositories"). Search for both.
        const recentToolCall = await prisma.toolCall.findFirst({
          where: {
            OR: [
              { toolName: toolName },
              { toolName: { contains: toolName } },
            ],
            execution: null,
          },
          orderBy: { createdAt: 'desc' },
        });

        if (recentToolCall) {
          await reportExecution(prisma, {
            toolCallId: recentToolCall.id,
            status: mcpResult.success ? 'SUCCESS' : 'FAILED',
            stdout: redactSecrets(mcpResult.stdout.slice(0, 5000)),
            stderr: redactSecrets(mcpResult.stderr.slice(0, 2000)),
            exitCode: mcpResult.exitCode,
            durationMs: mcpResult.durationMs,
          }).catch((err: any) => request.log.warn(err, 'Failed to record MCP execution'));
        }

        // ── L2: Post-Execution Intent Verification (optional) ─────────
        // Adds ~2s latency + 1 AI call per execution. Pre-exec L2 already
        // validated the server+creds combo. Post-exec is belt-and-suspenders.
        // Disable with MCP_POST_VERIFY=false to halve AI cost per call.
        const postVerifyEnabled = process.env['MCP_POST_VERIFY'] !== 'false';
        let verification = null;
        if (mcpResult.success && postVerifyEnabled) {
          try {
            verification = await verifyMcpToolResult(prisma, {
              toolName,
              toolArgs,
              serverCommand,
              stdout: mcpResult.stdout,
              stderr: mcpResult.stderr,
              exitCode: mcpResult.exitCode,
              durationMs: mcpResult.durationMs,
            });

            // Flag mismatch as audit anomaly
            if (!verification.passed && recentToolCall) {
              await prisma.auditFlag.create({
                data: {
                  toolCallId: recentToolCall.id,
                  severity: 'HIGH',
                  category: 'intent_mismatch',
                  title: `MCP result mismatch: ${toolName}`,
                  description: verification.summary,
                },
              }).catch((err: any) => request.log.warn(err, 'Failed to create audit flag'));
            }
          } catch (err: any) {
            request.log.warn(err, 'MCP L2 verification failed (non-blocking)');
          }
        }

        return reply.send({
          success: mcpResult.success,
          stdout: mcpResult.stdout,
          stderr: mcpResult.stderr,
          exitCode: mcpResult.exitCode,
          durationMs: mcpResult.durationMs,
          containerId: mcpResult.containerId,
          error: mcpResult.error ? redactSecrets(mcpResult.error) : undefined,
          verification: verification ? {
            passed: verification.passed,
            strategy: verification.strategy,
            summary: verification.summary,
            durationMs: verification.durationMs,
          } : undefined,
        });
      } catch (err: any) {
        request.log.error(err, 'MCP L3 execution failed');
        return reply.code(500).send({
          success: false,
          error: `MCP execution failed: ${redactSecrets(err.message)}`,
        });
      }
    }

    // ── Generic structured actions → simulation + secure exec ───────────
    // Layer 2: Simulation — credential actions ALWAYS get simulated
    let simulationResult = null;
    const syntheticRunId = `agent-${Date.now()}`;
    try {
      simulationResult = await simulateAction(prisma, {
        actionSpec: { action: body.action, params: body.params },
        connectionId: connection.id,
        runId: syntheticRunId,
        statedIntent: body.action,
      });
      if (!simulationResult.passed) {
        return reply.code(403).send({
          success: false,
          error: 'Pre-execution simulation failed — intent mismatch detected',
          simulation: {
            strategy: simulationResult.strategy,
            summary: simulationResult.summary,
            details: simulationResult.details,
            aiAnalysis: simulationResult.aiAnalysis,
          },
        });
      }
    } catch (err: any) {
      request.log.error(err, 'Simulation failed — blocking action (fail-closed)');
      return reply.code(503).send({
        success: false,
        error: 'Simulation failed (timeout or error). Action blocked for safety.',
        detail: err?.message ?? 'Simulation failed',
      });
    }

    // Layer 3: Secure execution
    const execResult = await executeSecureAction(prisma, {
      actionSpec: { action: body.action, params: body.params },
      connectionId: connection.id,
      runId: syntheticRunId,
    });

    return reply.send({
      success: execResult.success,
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
      } : undefined,
      error: execResult.error ? redactSecrets(execResult.error) : undefined,
    });
  });

  /**
   * POST /api/tool/probe-mcp — Auto-detect env var requirements for an MCP server.
   *
   * Runs the server command in an ephemeral container with NO credentials.
   * Parses error output to detect which env vars the server expects.
   * Returns detected var names so the UI can prompt the user for values.
   */
  app.post('/api/tool/probe-mcp', async (request: FastifyRequest, reply: FastifyReply) => {
    const { serverCommand } = request.body as { serverCommand?: string };
    if (!serverCommand || typeof serverCommand !== 'string') {
      return reply.code(400).send({ error: 'serverCommand is required' });
    }

    try {
      const { probeMcpServer } = await import('../engine/secure-exec.js');
      const result = await probeMcpServer(serverCommand.trim());
      return reply.send(result);
    } catch (err: any) {
      request.log.error(err, 'MCP probe failed');
      return reply.code(500).send({ error: `Probe failed: ${err.message}` });
    }
  });

  /**
   * GET /api/tool/scan-image?image=... — Advisory image safety scanner.
   * Returns trust classification for a Docker image. Never blocks.
   */
  app.get('/api/tool/scan-image', async (request: FastifyRequest, reply: FastifyReply) => {
    const { image } = request.query as { image?: string };
    if (!image) return reply.code(400).send({ error: 'image query parameter required' });

    const { scanImage } = await import('../engine/action-registry.js');
    return reply.send(scanImage(image));
  });
}

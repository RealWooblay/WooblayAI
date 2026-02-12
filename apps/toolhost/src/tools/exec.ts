import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { GateClient } from '@wooblay/gate-client';
import { sign, canonicalJson } from '@wooblay/crypto';
import type { ToolExecuteRequest, ToolExecuteResponse } from '@wooblay/types';

import { getAgentIdentity } from '../identity/agent.js';
import { classifyRisk } from '../risk/classifier.js';
import { spawnCommand } from '../sandbox/spawn.js';
import { waitForApproval } from '../gate/approval-waiter.js';

const TOOL_NAME = 'wooblay_exec';

/**
 * Register the `wooblay_exec` tool on the MCP server.
 *
 * This tool executes shell commands with full Gate supervision:
 * risk classification, policy evaluation, approval workflows,
 * and execution reporting.
 */
export function registerExecTool(
  server: McpServer,
  gateClient: GateClient,
): void {
  server.tool(
    TOOL_NAME,
    'Execute a shell command with Wooblay supervision. Commands are risk-classified and may require human approval.',
    {
      command: z.string().describe('The shell command to execute'),
      cwd: z
        .string()
        .optional()
        .describe('Working directory for the command'),
      timeout: z
        .number()
        .optional()
        .describe('Timeout in milliseconds (default: 30000)'),
    },
    async (args) => {
      try {
        const identity = getAgentIdentity();
        const riskTier = classifyRisk(TOOL_NAME, args);

        // Build canonical request payload
        const requestPayload: ToolExecuteRequest = {
          toolName: TOOL_NAME,
          args: { command: args.command, cwd: args.cwd, timeout: args.timeout },
          agentPubkey: identity.publicKey,
          requestSignature: '', // placeholder, set below
          adapter: 'mcp-toolhost',
        };

        // Sign the request
        const payloadToSign = {
          toolName: requestPayload.toolName,
          args: requestPayload.args,
          agentPubkey: requestPayload.agentPubkey,
        };
        requestPayload.requestSignature = sign(
          payloadToSign,
          identity.privateKey,
        );

        // Submit to Gate for policy evaluation
        let gateResponse: ToolExecuteResponse;
        try {
          gateResponse = await gateClient.toolExecute(requestPayload);
        } catch (err) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Gate error: ${err instanceof Error ? err.message : String(err)}`,
              },
            ],
            isError: true,
          };
        }

        // Handle Gate decision
        switch (gateResponse.decision) {
          case 'EXECUTE':
            return await executeCommand(gateClient, gateResponse.toolCallId, args);

          case 'DENY':
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `Command denied by policy: ${gateResponse.reason ?? 'No reason provided'}`,
                },
              ],
              isError: true,
            };

          case 'PENDING_APPROVAL': {
            if (!gateResponse.approvalId) {
              return {
                content: [
                  {
                    type: 'text' as const,
                    text: 'Approval required but no approval ID returned by Gate.',
                  },
                ],
                isError: true,
              };
            }

            // Poll for human approval
            let approval;
            try {
              approval = await waitForApproval(
                gateClient,
                gateResponse.approvalId,
              );
            } catch (err) {
              return {
                content: [
                  {
                    type: 'text' as const,
                    text: `Approval timed out: ${err instanceof Error ? err.message : String(err)}`,
                  },
                ],
                isError: true,
              };
            }

            if (approval.status === 'APPROVED') {
              return await executeCommand(
                gateClient,
                gateResponse.toolCallId,
                args,
              );
            }

            return {
              content: [
                {
                  type: 'text' as const,
                  text: `Command denied by approver: ${approval.reason ?? 'No reason provided'}`,
                },
              ],
              isError: true,
            };
          }

          default:
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `Unknown Gate decision: ${String(gateResponse.decision)}`,
                },
              ],
              isError: true,
            };
        }
      } catch (err) {
        // Top-level safety net: tool calls should never crash the server
        console.error(`[${TOOL_NAME}] Unhandled error:`, err);
        return {
          content: [
            {
              type: 'text' as const,
              text: `Internal error: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}

// ── Helpers ──────────────────────────────────────────────────────────

async function executeCommand(
  gateClient: GateClient,
  toolCallId: string,
  args: { command: string; cwd?: string; timeout?: number },
) {
  const result = await spawnCommand(args.command, {
    cwd: args.cwd,
    timeout: args.timeout,
  });

  // Report execution result back to Gate
  try {
    await gateClient.reportExecution({
      toolCallId,
      status: result.timedOut
        ? 'timeout'
        : result.exitCode === 0
          ? 'completed'
          : 'failed',
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode ?? undefined,
      durationMs: result.durationMs,
    });
  } catch (err) {
    console.error(
      `[${TOOL_NAME}] Failed to report execution:`,
      err instanceof Error ? err.message : err,
    );
  }

  // Format output for the agent
  const parts: string[] = [];

  if (result.timedOut) {
    parts.push(`[TIMEOUT after ${result.durationMs}ms]`);
  }

  if (result.stdout) {
    parts.push(result.stdout);
  }

  if (result.stderr) {
    parts.push(`[stderr]\n${result.stderr}`);
  }

  if (!result.stdout && !result.stderr) {
    parts.push(
      result.exitCode === 0
        ? 'Command completed successfully (no output).'
        : `Command exited with code ${result.exitCode} (no output).`,
    );
  }

  return {
    content: [
      {
        type: 'text' as const,
        text: parts.join('\n'),
      },
    ],
    isError: result.exitCode !== 0,
  };
}

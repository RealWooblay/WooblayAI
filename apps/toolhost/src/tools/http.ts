import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { GateClient } from '@wooblay/gate-client';
import { sign } from '@wooblay/crypto';
import type { ToolExecuteRequest, ToolExecuteResponse } from '@wooblay/types';

import { getAgentIdentity } from '../identity/agent.js';
import { classifyRisk } from '../risk/classifier.js';
import { waitForApproval } from '../gate/approval-waiter.js';

const TOOL_NAME = 'wooblay_http';

/**
 * Register the `wooblay_http` tool on the MCP server.
 *
 * Executes HTTP requests with full Gate supervision:
 * risk classification, policy evaluation, and approval workflows.
 */
export function registerHttpTool(
  server: McpServer,
  gateClient: GateClient,
): void {
  server.tool(
    TOOL_NAME,
    'Make an HTTP request with Wooblay supervision. GET requests are classified as READ; mutating methods as WRITE.',
    {
      url: z.string().describe('The URL to request'),
      method: z
        .string()
        .optional()
        .describe('HTTP method (default: GET)'),
      headers: z
        .record(z.string())
        .optional()
        .describe('Request headers as key-value pairs'),
      body: z
        .string()
        .optional()
        .describe('Request body (string)'),
    },
    async (args) => {
      try {
        const identity = getAgentIdentity();
        const riskTier = classifyRisk(TOOL_NAME, {
          ...args,
          method: args.method ?? 'GET',
        });

        // Build canonical request payload
        const requestPayload: ToolExecuteRequest = {
          toolName: TOOL_NAME,
          args: {
            url: args.url,
            method: args.method ?? 'GET',
            headers: args.headers,
            body: args.body,
          },
          agentPubkey: identity.publicKey,
          requestSignature: '',
          adapter: 'mcp-toolhost',
        };

        const payloadToSign = {
          toolName: requestPayload.toolName,
          args: requestPayload.args,
          agentPubkey: requestPayload.agentPubkey,
        };
        requestPayload.requestSignature = sign(
          payloadToSign,
          identity.privateKey,
        );

        // Submit to Gate
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
            return await executeHttpRequest(
              gateClient,
              gateResponse.toolCallId,
              args,
            );

          case 'DENY':
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `HTTP request denied by policy: ${gateResponse.reason ?? 'No reason provided'}`,
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
              return await executeHttpRequest(
                gateClient,
                gateResponse.toolCallId,
                args,
              );
            }

            return {
              content: [
                {
                  type: 'text' as const,
                  text: `HTTP request denied by approver: ${approval.reason ?? 'No reason provided'}`,
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

// ── HTTP execution ──────────────────────────────────────────────────

async function executeHttpRequest(
  gateClient: GateClient,
  toolCallId: string,
  args: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) {
  const method = (args.method ?? 'GET').toUpperCase();
  const startTime = Date.now();

  try {
    const response = await fetch(args.url, {
      method,
      headers: args.headers,
      body: method !== 'GET' && method !== 'HEAD' ? args.body : undefined,
    });

    const responseBody = await response.text();
    const durationMs = Date.now() - startTime;

    // Report execution to Gate
    try {
      await gateClient.reportExecution({
        toolCallId,
        status: 'completed',
        stdout: responseBody,
        exitCode: response.ok ? 0 : 1,
        durationMs,
      });
    } catch (err) {
      console.error(
        `[${TOOL_NAME}] Failed to report execution:`,
        err instanceof Error ? err.message : err,
      );
    }

    // Format response for the agent
    const headerLines = [...response.headers.entries()]
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n');

    const output = [
      `HTTP ${response.status} ${response.statusText}`,
      headerLines,
      '',
      responseBody,
    ].join('\n');

    return {
      content: [
        {
          type: 'text' as const,
          text: output,
        },
      ],
      isError: !response.ok,
    };
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const errorMessage = err instanceof Error ? err.message : String(err);

    // Report failed execution to Gate
    try {
      await gateClient.reportExecution({
        toolCallId,
        status: 'failed',
        stderr: errorMessage,
        exitCode: -1,
        durationMs,
      });
    } catch (reportErr) {
      console.error(
        `[${TOOL_NAME}] Failed to report execution:`,
        reportErr instanceof Error ? reportErr.message : reportErr,
      );
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: `HTTP request failed: ${errorMessage}`,
        },
      ],
      isError: true,
    };
  }
}

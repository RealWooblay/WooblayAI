import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { GateClient } from '@wooblay/gate-client';
import { sign } from '@wooblay/crypto';
import type { ToolExecuteRequest, ToolExecuteResponse } from '@wooblay/types';

import { getAgentIdentity } from '../identity/agent.js';
import { classifyRisk } from '../risk/classifier.js';
import { waitForApproval } from '../gate/approval-waiter.js';

const TOOL_NAME = 'wooblay_browser';

/**
 * Register the `wooblay_browser` tool on the MCP server.
 *
 * Stub implementation – goes through the full Gate supervision flow
 * but actual browser automation is not yet implemented.
 */
export function registerBrowserTool(
  server: McpServer,
  gateClient: GateClient,
): void {
  server.tool(
    TOOL_NAME,
    'Perform a browser action with Wooblay supervision. Currently a stub — execution returns a placeholder message.',
    {
      action: z
        .enum(['navigate', 'click', 'type', 'screenshot'])
        .describe('The browser action to perform'),
      url: z.string().optional().describe('URL to navigate to'),
      selector: z
        .string()
        .optional()
        .describe('CSS selector for click/type actions'),
      text: z
        .string()
        .optional()
        .describe('Text to type into the selected element'),
    },
    async (args) => {
      try {
        const identity = getAgentIdentity();
        const riskTier = classifyRisk(TOOL_NAME, args);

        // Build canonical request payload
        const requestPayload: ToolExecuteRequest = {
          toolName: TOOL_NAME,
          args: {
            action: args.action,
            url: args.url,
            selector: args.selector,
            text: args.text,
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
            return stubBrowserResult(gateClient, gateResponse.toolCallId, args);

          case 'DENY':
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `Browser action denied by policy: ${gateResponse.reason ?? 'No reason provided'}`,
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
              return stubBrowserResult(
                gateClient,
                gateResponse.toolCallId,
                args,
              );
            }

            return {
              content: [
                {
                  type: 'text' as const,
                  text: `Browser action denied by approver: ${approval.reason ?? 'No reason provided'}`,
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

// ── Stub execution ──────────────────────────────────────────────────

async function stubBrowserResult(
  gateClient: GateClient,
  toolCallId: string,
  args: { action: string; url?: string; selector?: string; text?: string },
) {
  const message =
    `Browser tool not yet implemented. ` +
    `Requested action: ${args.action}` +
    (args.url ? `, url: ${args.url}` : '') +
    (args.selector ? `, selector: ${args.selector}` : '') +
    (args.text ? `, text: ${args.text}` : '');

  // Report stub execution to Gate
  try {
    await gateClient.reportExecution({
      toolCallId,
      status: 'completed',
      stdout: message,
      exitCode: 0,
      durationMs: 0,
    });
  } catch (err) {
    console.error(
      `[${TOOL_NAME}] Failed to report execution:`,
      err instanceof Error ? err.message : err,
    );
  }

  return {
    content: [
      {
        type: 'text' as const,
        text: message,
      },
    ],
  };
}

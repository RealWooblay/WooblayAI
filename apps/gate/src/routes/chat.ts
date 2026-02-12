/**
 * Chat proxy routes.
 *
 * Proxies chat messages to the OpenClaw Gateway WebSocket so the
 * Wooblay UI (or any HTTP client) can talk to the agent without Telegram.
 *
 * POST /api/chat/send    — Send a message to the agent (default or by instanceId)
 * GET  /api/chat/status   — Check if the agent gateway is reachable
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db/client.js';
import WebSocket from 'ws';

// ── Default WebSocket connection to OpenClaw Gateway ─────────────────────────

const DEFAULT_GATEWAY_WS = process.env['OPENCLAW_GATEWAY_WS'] ?? 'ws://wooblay-agent:18789';
const DEFAULT_GATEWAY_TOKEN = process.env['OPENCLAW_GATEWAY_TOKEN'] ?? '';

interface WsResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

/**
 * Resolve gateway URL and token for a given instanceId.
 * If instanceId is null / "default", returns the default (main agent).
 * Otherwise looks up the Instance record for its gateway endpoint.
 */
async function resolveGateway(instanceId?: string | null): Promise<{ url: string; token: string }> {
  if (!instanceId || instanceId === 'default') {
    return { url: DEFAULT_GATEWAY_WS, token: DEFAULT_GATEWAY_TOKEN };
  }

  try {
    const instance = await prisma.instance.findUnique({ where: { id: instanceId } });
    if (!instance) {
      return { url: DEFAULT_GATEWAY_WS, token: DEFAULT_GATEWAY_TOKEN };
    }

    const config = instance.configJson ? JSON.parse(instance.configJson) : {};
    // Instance agent containers are on the agent_net, accessible by container name
    const wsUrl = `ws://wooblay-agent-${instance.name}:18789`;
    return { url: wsUrl, token: config.gatewayToken ?? '' };
  } catch {
    return { url: DEFAULT_GATEWAY_WS, token: DEFAULT_GATEWAY_TOKEN };
  }
}

/**
 * Opens a short-lived WebSocket to the OpenClaw Gateway, authenticates,
 * sends a request, and returns the result. Closes the connection after.
 */
async function gwRequest(
  gwUrl: string,
  gwToken: string,
  method: string,
  params: Record<string, unknown>,
  timeoutMs = 15_000,
): Promise<WsResult> {
  return new Promise<WsResult>((resolve) => {
    const timer = setTimeout(() => {
      try { ws.close(); } catch {}
      resolve({ ok: false, error: 'Gateway request timed out' });
    }, timeoutMs);

    let reqId = 0;
    let connectReqId = '';
    let methodReqId = '';
    let authenticated = false;

    const ws = new WebSocket(gwUrl);

    function send(data: Record<string, unknown>) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
      }
    }

    ws.on('open', () => {
      // Wait for connect.challenge from Gateway
    });

    ws.on('message', (raw: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(raw.toString());

        // Step 1: Challenge -> authenticate
        if (msg.type === 'event' && msg.event === 'connect.challenge') {
          reqId++;
          connectReqId = String(reqId);
          send({
            type: 'req',
            id: connectReqId,
            method: 'connect',
            params: {
              client: {
                id: 'gateway-client',
                mode: 'backend',
                version: '1.0.0',
                displayName: 'Wooblay Chat Proxy',
                platform: 'linux',
              },
              role: 'operator',
              scopes: ['operator.read', 'operator.write'],
              minProtocol: 3,
              maxProtocol: 3,
              auth: gwToken ? { token: gwToken } : undefined,
              caps: ['chat'],
            },
          });
          return;
        }

        // Step 2: Connect response
        if (msg.type === 'res' && msg.id === connectReqId) {
          if (msg.ok) {
            authenticated = true;
            reqId++;
            methodReqId = String(reqId);
            send({ type: 'req', id: methodReqId, method, params });
          } else {
            clearTimeout(timer);
            ws.close();
            resolve({ ok: false, error: `Auth failed: ${JSON.stringify(msg.error)}` });
          }
          return;
        }

        // Step 3: Method response
        if (msg.type === 'res' && msg.id === methodReqId) {
          clearTimeout(timer);
          ws.close();
          if (msg.ok) {
            resolve({ ok: true, data: msg.result ?? msg.data ?? true });
          } else {
            resolve({ ok: false, error: `Gateway error: ${JSON.stringify(msg.error)}` });
          }
          return;
        }
      } catch {
        // Ignore parse errors for non-relevant messages
      }
    });

    ws.on('error', () => {
      clearTimeout(timer);
      resolve({ ok: false, error: 'Gateway WebSocket connection failed' });
    });

    ws.on('close', () => {
      clearTimeout(timer);
      if (!authenticated) {
        resolve({ ok: false, error: 'Gateway connection closed before authentication' });
      }
    });
  });
}

// ── Routes ───────────────────────────────────────────────────────────────────

export async function chatRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /api/chat/send — Send a message to the agent.
   *
   * Body: { message: string, agentId?: string, instanceId?: string }
   * Returns: { ok: boolean, result?: unknown, error?: string }
   */
  app.post('/api/chat/send', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { message?: string; agentId?: string; instanceId?: string };

    if (!body.message || typeof body.message !== 'string') {
      return reply.code(400).send({ error: 'Missing "message" string in body' });
    }

    request.log.info({ msg: body.message, agentId: body.agentId, instanceId: body.instanceId }, 'Chat: sending message to agent');

    try {
      const gw = await resolveGateway(body.instanceId);
      const result = await gwRequest(gw.url, gw.token, 'chat.send', {
        message: body.message,
        agentId: body.agentId ?? 'main',
      });

      if (result.ok) {
        return reply.send({
          ok: true,
          message: 'Message sent to agent',
          result: result.data,
        });
      } else {
        return reply.code(502).send({
          ok: false,
          error: result.error ?? 'Failed to send message to agent',
        });
      }
    } catch (err: any) {
      request.log.error(err, 'Chat: failed to send message');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });

  /**
   * GET /api/chat/status — Check if the agent gateway is reachable.
   *
   * Query: ?instanceId=... (optional, defaults to main agent)
   * Returns: { reachable: boolean, gateway: string }
   */
  app.get('/api/chat/status', async (request: FastifyRequest, reply: FastifyReply) => {
    const { instanceId } = request.query as { instanceId?: string };

    try {
      const gw = await resolveGateway(instanceId);
      const result = await gwRequest(gw.url, gw.token, 'wooblay.status', {}, 5_000);

      return reply.send({
        reachable: result.ok,
        gateway: gw.url,
        details: result.ok ? result.data : result.error,
      });
    } catch (err: any) {
      return reply.send({
        reachable: false,
        gateway: DEFAULT_GATEWAY_WS,
        error: err.message,
      });
    }
  });
}

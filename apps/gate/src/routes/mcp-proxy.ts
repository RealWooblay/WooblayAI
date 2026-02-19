/**
 * MCP Proxy reverse-proxy route.
 *
 * External clients (Cursor, Claude Desktop, custom agents) connect to:
 *   GET  /mcp/:instanceId/sse       → SSE stream from MCP proxy container
 *   POST /mcp/:instanceId/messages  → JSON-RPC messages to the proxy
 *
 * Auth: Bearer API key (wbl_ak_...) validated against the org.
 * The Gate translates the API key into the instance's internal GATEWAY_TOKEN
 * before forwarding to the proxy container on the Docker network.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db/client.js';
import { validateApiKey } from './api-keys.js';

async function resolveProxyTarget(
  instanceId: string,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<{ internalUrl: string; gatewayToken: string } | null> {
  const instance = await prisma.instance.findUnique({ where: { id: instanceId } });
  if (!instance) {
    reply.code(404).send({ error: 'Instance not found' });
    return null;
  }

  let gatewayToken = '';
  try {
    const config = instance.configJson ? JSON.parse(instance.configJson) : {};
    gatewayToken = config.gatewayToken ?? '';
  } catch { /* no config */ }

  if (!gatewayToken) {
    request.log.error({ instanceId }, 'Instance has no gateway token');
    reply.code(500).send({ error: 'Instance not configured' });
    return null;
  }

  const proxyHost = `wooblay-mcp-proxy-${instance.name}`;
  return {
    internalUrl: `http://${proxyHost}:3100`,
    gatewayToken,
  };
}

async function authenticateApiKey(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<boolean> {
  const authHeader = request.headers['authorization'] ?? '';
  const token = typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : '';

  if (!token) {
    reply.code(401).send({ error: 'Authorization required. Use: Authorization: Bearer wbl_ak_...' });
    return false;
  }

  const validation = await validateApiKey(token);
  if (!validation.valid) {
    reply.code(401).send({ error: `Invalid API key: ${validation.reason}` });
    return false;
  }

  return true;
}

export async function mcpProxyRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /mcp/:instanceId/sse — SSE connection to the MCP proxy.
   * Streams tool list and events. The client connects here.
   */
  app.get('/mcp/:instanceId/sse', async (request: FastifyRequest, reply: FastifyReply) => {
    const { instanceId } = request.params as { instanceId: string };

    if (!(await authenticateApiKey(request, reply))) return;

    const target = await resolveProxyTarget(instanceId, request, reply);
    if (!target) return;

    const upstreamUrl = `${target.internalUrl}/sse`;

    try {
      const controller = new AbortController();
      request.raw.on('close', () => controller.abort());

      const upstream = await fetch(upstreamUrl, {
        headers: {
          'Authorization': `Bearer ${target.gatewayToken}`,
          'Accept': 'text/event-stream',
        },
        signal: controller.signal,
      });

      if (!upstream.ok) {
        const body = await upstream.text().catch(() => '');
        request.log.warn({ instanceId, status: upstream.status, body: body.slice(0, 200) }, 'Upstream proxy error');
        return reply.code(upstream.status).send({ error: 'MCP proxy unavailable', detail: body.slice(0, 200) });
      }

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      const reader = upstream.body?.getReader();
      if (!reader) {
        reply.raw.end();
        return;
      }

      const pump = async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            reply.raw.write(value);
          }
        } catch (err: any) {
          if (err.name !== 'AbortError') {
            request.log.warn({ instanceId, err: err.message }, 'SSE stream error');
          }
        } finally {
          reply.raw.end();
        }
      };

      pump();
      return reply;
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      request.log.error({ instanceId, err: err.message }, 'Failed to connect to MCP proxy');
      return reply.code(502).send({ error: 'Cannot reach MCP proxy container' });
    }
  });

  /**
   * POST /mcp/:instanceId/messages — Forward JSON-RPC messages to the proxy.
   */
  app.post('/mcp/:instanceId/messages', async (request: FastifyRequest, reply: FastifyReply) => {
    const { instanceId } = request.params as { instanceId: string };
    const sessionId = (request.query as { sessionId?: string }).sessionId;

    if (!(await authenticateApiKey(request, reply))) return;

    const target = await resolveProxyTarget(instanceId, request, reply);
    if (!target) return;

    const upstreamUrl = `${target.internalUrl}/messages${sessionId ? `?sessionId=${sessionId}` : ''}`;

    try {
      const upstream = await fetch(upstreamUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${target.gatewayToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request.body),
        signal: AbortSignal.timeout(30_000),
      });

      const responseBody = await upstream.text();
      return reply.code(upstream.status).type(upstream.headers.get('content-type') ?? 'application/json').send(responseBody);
    } catch (err: any) {
      request.log.error({ instanceId, err: err.message }, 'Failed to forward message to MCP proxy');
      return reply.code(502).send({ error: 'Cannot reach MCP proxy container' });
    }
  });
}

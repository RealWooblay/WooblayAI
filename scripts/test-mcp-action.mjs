#!/usr/bin/env node
/**
 * Test a real MCP action: connect to Wooblay proxy, list tools, optionally call one.
 * MCP over SSE returns 202 for POSTs; the actual JSON-RPC response comes back on the SSE stream.
 *
 * Usage:
 *   node scripts/test-mcp-action.mjs <BASE_URL> <INSTANCE_ID> <API_KEY>                    # list tools
 *   node scripts/test-mcp-action.mjs <BASE_URL> <INSTANCE_ID> <API_KEY> <TOOL> [JSON_ARGS]   # call tool
 */

const BASE_URL = process.argv[2];
const INSTANCE_ID = process.argv[3];
const API_KEY = process.argv[4];
const TOOL_NAME = process.argv[5];
const TOOL_ARGS_JSON = process.argv[6] || '{}';

if (!BASE_URL || !INSTANCE_ID || !API_KEY) {
  console.error('Usage: node scripts/test-mcp-action.mjs <BASE_URL> <INSTANCE_ID> <API_KEY> [TOOL_NAME] [TOOL_ARGS_JSON]');
  process.exit(1);
}

const SSE_URL = `${BASE_URL}/mcp/${INSTANCE_ID}/sse`;
const headers = {
  Authorization: `Bearer ${API_KEY}`,
  Accept: 'text/event-stream',
};

// Pending JSON-RPC responses by id (resolve when we see the response on SSE)
const pending = new Map();

// 1) Open SSE and drain stream; capture sessionId and any JSON-RPC responses
let sessionId = null;
const sseRes = await fetch(SSE_URL, { headers, signal: AbortSignal.timeout(10000) });
if (!sseRes.ok) {
  console.error('SSE failed:', sseRes.status, await sseRes.text());
  process.exit(1);
}
const reader = sseRes.body.getReader();
const dec = new TextDecoder();
let buf = '';
const drain = (async () => {
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      if (!sessionId) {
        const m = buf.match(/data:\s*\/messages\?sessionId=([a-fA-F0-9-]+)/m);
        if (m) sessionId = m[1];
      }
      // Parse SSE events: "event: message" + "data: {...}" or bare "data: {...}"
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.startsWith('data:')) {
          const data = line.slice(5).trim();
          if (!data || data.startsWith('/messages?')) continue;
          try {
            const json = JSON.parse(data);
            if (json != null && typeof json.id !== 'undefined') {
              const resolve = pending.get(json.id);
              if (resolve) {
                pending.delete(json.id);
                resolve(json);
              }
            }
          } catch (_) {}
        }
      }
    }
  } catch (_) {}
})();

// Wait for sessionId
for (let i = 0; i < 100; i++) {
  await new Promise((r) => setTimeout(r, 50));
  if (sessionId) break;
}
if (!sessionId) {
  console.error('Could not get sessionId from SSE stream');
  process.exit(1);
}

const messagesUrl = `${BASE_URL}/mcp/${INSTANCE_ID}/messages?sessionId=${sessionId}`;
const msgHeaders = { ...headers, 'Content-Type': 'application/json' };

async function sendJsonRpc(method, params = {}) {
  const id = Math.floor(Math.random() * 1e9);
  const body = { jsonrpc: '2.0', id, method, params };
  const p = new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      if (pending.delete(id)) reject(new Error(`Timeout waiting for response to ${method}`));
    }, 25000);
    pending.set(id, (response) => {
      clearTimeout(t);
      resolve(response);
    });
  });
  const r = await fetch(messagesUrl, {
    method: 'POST',
    headers: msgHeaders,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  const text = await r.text();
  if (!r.ok && r.status !== 202) {
    pending.delete(id);
    return { error: `HTTP ${r.status}`, body: text };
  }
  return p;
}

// 2) Initialize
await sendJsonRpc('initialize', {
  protocolVersion: '2024-11-05',
  capabilities: {},
  clientInfo: { name: 'test-mcp-action', version: '0.1.0' },
});
await sendJsonRpc('notifications/initialized');

// 3) List tools
const listRes = await sendJsonRpc('tools/list');
const tools = listRes.result?.tools ?? [];
console.log('Tools available:', tools.length);
tools.forEach((t) => console.log('  -', t.name, ':', (t.description || '').slice(0, 60)));

if (!TOOL_NAME) {
  console.log('\nTo call a tool: node scripts/test-mcp-action.mjs BASE_URL INSTANCE_ID API_KEY <tool_name> [args_json]');
  process.exit(0);
}

// 4) Call tool
let args;
try {
  args = JSON.parse(TOOL_ARGS_JSON);
} catch {
  args = {};
}
const callRes = await sendJsonRpc('tools/call', { name: TOOL_NAME, arguments: args });
console.log('\nTool call result:', JSON.stringify(callRes, null, 2));

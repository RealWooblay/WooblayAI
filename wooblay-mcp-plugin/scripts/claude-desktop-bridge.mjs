#!/usr/bin/env node
/**
 * Claude Desktop bridge: stdio (what Claude spawns) ↔ Wooblay SSE.
 * Claude Desktop only supports command+args MCP; this process connects to your
 * Wooblay SSE URL and forwards JSON-RPC so Wooblay tools work in Claude.
 *
 * Usage:
 *   node claude-desktop-bridge.mjs <SSE_URL> <API_KEY>
 *   node claude-desktop-bridge.mjs https://wooblay.com/mcp/YOUR_INSTANCE_ID/sse YOUR_API_KEY
 *
 * Claude Desktop config (no "url" key — use command so it launches):
 *   "wooblay": {
 *     "command": "node",
 *     "args": ["/absolute/path/to/wooblay-mcp-plugin/scripts/claude-desktop-bridge.mjs",
 *              "https://wooblay.com/mcp/YOUR_INSTANCE_ID/sse",
 *              "YOUR_API_KEY"]
 *   }
 */

const SSE_URL = process.argv[2];
const API_KEY = process.argv[3];

if (!SSE_URL || !API_KEY) {
  process.stderr.write('Usage: node claude-desktop-bridge.mjs <SSE_URL> <API_KEY>\n');
  process.stderr.write('Example: node claude-desktop-bridge.mjs https://wooblay.com/mcp/INSTANCE_ID/sse wbl_ak_...\n');
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${API_KEY}`,
  Accept: 'text/event-stream',
};

const pending = new Map();
let messagesUrl = null;
let sseReader = null;
let sseAbort = null;

function writeOut(msg) {
  const line = typeof msg === 'string' ? msg : JSON.stringify(msg);
  if (line.includes('\n')) {
    process.stderr.write('Bridge: message contained newline, dropping\n');
    return;
  }
  process.stdout.write(line + '\n');
}

async function connectSSE() {
  if (sseAbort) sseAbort();
  messagesUrl = null;
  const controller = new AbortController();
  sseAbort = () => controller.abort();
  const res = await fetch(SSE_URL, { headers, signal: controller.signal });
  if (!res.ok) {
    process.stderr.write(`Bridge: SSE failed ${res.status} ${await res.text()}\n`);
    process.exit(1);
  }
  sseReader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const origin = new URL(SSE_URL).origin;
  (async () => {
    try {
      while (true) {
        const { done, value } = await sseReader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        if (!messagesUrl) {
          const m = buf.match(/data:\s*(\/[^\s?]+\?sessionId=[a-fA-F0-9-]+)/m);
          if (m) messagesUrl = origin + m[1];
        }
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (!data || data.includes('/messages?')) continue;
          try {
            const json = JSON.parse(data);
            if (json != null && typeof json.id !== 'undefined') {
              const resolve = pending.get(json.id);
              if (resolve) {
                pending.delete(json.id);
                resolve(json);
              } else {
                writeOut(json);
              }
            } else if (json != null) {
              writeOut(json);
            }
          } catch (_) {}
        }
      }
    } catch (e) {
      if (e?.name !== 'AbortError') process.stderr.write(`Bridge: SSE read error ${e?.message}\n`);
    }
  })();
  for (let i = 0; i < 150; i++) {
    await new Promise((r) => setTimeout(r, 100));
    if (messagesUrl) break;
  }
  if (!messagesUrl) {
    process.stderr.write('Bridge: could not get messages URL from SSE\n');
    process.exit(1);
  }
}

async function sendToWooblay(body, retried = false) {
  const id = body.id;
  const p = id != null ? new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      if (pending.delete(id)) reject(new Error('Timeout'));
    }, 60000);
    pending.set(id, (resp) => {
      clearTimeout(t);
      resolve(resp);
    });
  }) : Promise.resolve(null);
  const r = await fetch(messagesUrl, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const text = await r.text();
  if (r.status === 404 && text.includes('Session not found') && !retried) {
    if (id != null) pending.delete(id);
    process.stderr.write('Bridge: session expired, reconnecting...\n');
    await connectSSE();
    return sendToWooblay(body, true);
  }
  if (!r.ok && r.status !== 202) {
    if (id != null) pending.delete(id);
    writeOut({ jsonrpc: '2.0', id, error: { code: -32603, message: `Wooblay HTTP ${r.status}: ${text.slice(0, 200)}` } });
    return;
  }
  const out = await p;
  if (out) writeOut(out);
}

await connectSSE();

const rl = await import('readline');
const iface = rl.createInterface({ input: process.stdin, terminal: false });
iface.on('line', (line) => {
  if (!line.trim()) return;
  try {
    const msg = JSON.parse(line);
    sendToWooblay(msg).catch((err) => {
      const id = msg?.id ?? null;
      writeOut({ jsonrpc: '2.0', id, error: { code: -32603, message: String(err?.message || err) } });
    });
  } catch (_) {
    process.stderr.write('Bridge: invalid JSON from stdin\n');
  }
});

#!/usr/bin/env node
/**
 * Test the Wooblay MCP endpoint (auth + instance resolution).
 * Usage:
 *   WOOBLAY_GATE_URL=http://localhost:4800 \
 *   WOOBLAY_INSTANCE_ID=your_instance_id \
 *   WOOBLAY_API_KEY=wbl_ak_xxx \
 *   node scripts/test-mcp-connection.mjs
 *
 * Expect: 401 (no/invalid key), 404 (instance not found), or 200/502 (SSE stream or proxy down).
 */

const gateUrl = (process.env.WOOBLAY_GATE_URL || 'http://localhost:4800').replace(/\/$/, '');
const instanceId = process.env.WOOBLAY_INSTANCE_ID || 'fake-id';
const apiKey = process.env.WOOBLAY_API_KEY || '';

const url = `${gateUrl}/mcp/${instanceId}/sse`;

async function main() {
  console.log('Testing Wooblay MCP endpoint...');
  console.log('  URL:', url);
  console.log('  Auth:', apiKey ? `Bearer ${apiKey.slice(0, 12)}...` : '(none)');
  console.log('');

  // No auth
  const r1 = await fetch(url, { redirect: 'manual' }).catch((e) => ({ ok: false, status: 0, error: e.message }));
  const status1 = r1.status || (r1.error && 'CONN_REFUSED');
  console.log('  No auth:     ', status1, status1 === 401 ? '(expected)' : status1 === 0 ? '(is the Gate running?)' : '');

  if (!apiKey) {
    console.log('\nSet WOOBLAY_API_KEY to test with auth.');
    return;
  }

  // With auth
  const r2 = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
    redirect: 'manual',
  }).catch((e) => ({ ok: false, status: 0, error: e.message }));
  const status2 = r2.status || (r2.error && 'CONN_REFUSED');
  let note = '';
  if (status2 === 401) note = '(invalid key?)';
  else if (status2 === 404) note = '(instance not found – create one in Wooblay UI)';
  else if (status2 === 200) note = '(SSE connected – plugin config is valid)';
  else if (status2 === 502) note = '(proxy not running – start instance)';
  else if (status2 === 0) note = '(is the Gate running?)';
  console.log('  With API key:', status2, note);

  if (status2 === 200) {
    console.log('\n✓ MCP endpoint is reachable. In Cursor: add .cursor/mcp.json (or use generate-mcp-config.mjs --write), restart Cursor, then use a tool.');
  }
}

main();

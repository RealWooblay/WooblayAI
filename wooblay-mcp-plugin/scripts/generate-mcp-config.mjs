#!/usr/bin/env node
/**
 * Generate Cursor MCP config from environment and optionally write to Wooblay repo .cursor/mcp.json.
 *
 * Env:
 *   WOOBLAY_GATE_URL   — e.g. http://localhost:4800 or https://gate.wooblay.io
 *   WOOBLAY_INSTANCE_ID — instance CUID from Wooblay UI (Instance detail)
 *   WOOBLAY_API_KEY    — wbl_ak_... from Wooblay Dashboard → API keys
 *
 * Usage:
 *   WOOBLAY_GATE_URL=http://localhost:4800 WOOBLAY_INSTANCE_ID=clxxx WOOBLAY_API_KEY=wbl_ak_xxx node scripts/generate-mcp-config.mjs
 *   WOOBLAY_GATE_URL=... WOOBLAY_INSTANCE_ID=... WOOBLAY_API_KEY=... node scripts/generate-mcp-config.mjs --write
 *
 * --write  Write to ../.cursor/mcp.json (Wooblay repo root). Otherwise print to stdout.
 */

const gateUrl = (process.env.WOOBLAY_GATE_URL || 'http://localhost:4800').replace(/\/$/, '');
const instanceId = process.env.WOOBLAY_INSTANCE_ID || 'YOUR_INSTANCE_ID';
const apiKey = process.env.WOOBLAY_API_KEY || 'YOUR_API_KEY';
const write = process.argv.includes('--write');

const config = {
  mcpServers: {
    wooblay: {
      url: `${gateUrl}/mcp/${instanceId}/sse`,
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    },
  },
};

const json = JSON.stringify(config, null, 2);

if (write) {
  const fs = await import('fs');
  // From wooblay-mcp-plugin/scripts/, ../../ is Wooblay repo root
  const path = new URL('../../.cursor/mcp.json', import.meta.url);
  const dir = new URL('../../.cursor', import.meta.url);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path, json + '\n', 'utf8');
  console.error('Wrote', path.pathname);
} else {
  console.log(json);
  if (!process.env.WOOBLAY_INSTANCE_ID || !process.env.WOOBLAY_API_KEY) {
    console.error('');
    console.error('Set WOOBLAY_GATE_URL, WOOBLAY_INSTANCE_ID, WOOBLAY_API_KEY and run again.');
    console.error('Use --write to write to ../../.cursor/mcp.json (Wooblay repo root)');
  }
}

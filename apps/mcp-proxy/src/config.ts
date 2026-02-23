/**
 * Configuration loader for the MCP Proxy.
 *
 * Reads from environment:
 *   GATE_URL             — Gate API base URL
 *   INSTANCE_ID          — Instance DB id (cuid) for status API and fetchConfigFromGate
 *   MCP_SERVERS_JSON_B64 — Base64-encoded JSON array of McpServerConfigEntry (preferred)
 *   MCP_SERVERS_JSON     — Fallback: raw JSON
 */

import type { ProxyConfig, McpServerConfigEntry } from './types.js';

function parseServersFromEnv(): McpServerConfigEntry[] {
  const b64 = process.env['MCP_SERVERS_JSON_B64'];
  if (b64) {
    try {
      const json = Buffer.from(b64, 'base64').toString('utf-8');
      const servers = JSON.parse(json);
      if (Array.isArray(servers)) return servers;
    } catch (err) {
      process.stderr.write(`[config] Failed to parse MCP_SERVERS_JSON_B64: ${err}\n`);
    }
  }
  const raw = process.env['MCP_SERVERS_JSON'];
  if (raw) {
    try {
      const servers = JSON.parse(raw);
      if (Array.isArray(servers)) return servers;
    } catch (err) {
      process.stderr.write(`[config] Failed to parse MCP_SERVERS_JSON: ${err}\n`);
    }
  }
  return [];
}

export function loadConfig(): ProxyConfig {
  const gateUrl = process.env['GATE_URL'] ?? 'http://localhost:4800';
  const instanceId = process.env['INSTANCE_ID'] ?? '';

  if (!instanceId) {
    process.stderr.write('[config] WARNING: INSTANCE_ID not set\n');
  }

  const servers = parseServersFromEnv();
  if (servers.length > 0) {
    process.stderr.write(`[config] Loaded ${servers.length} MCP server(s) from env\n`);
  }

  return { gateUrl, instanceId, servers };
}

/**
 * Fetch MCP server configs from the Gate API.
 * Used for config reload on SIGHUP when env-based config is stale.
 */
export async function fetchConfigFromGate(gateUrl: string, instanceId: string): Promise<McpServerConfigEntry[]> {
  try {
    const token = process.env['GATEWAY_TOKEN'] ?? '';
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`${gateUrl}/api/instances/${instanceId}/mcp-servers`, {
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      process.stderr.write(`[config] Gate returned ${res.status} for MCP servers\n`);
      return [];
    }
    return await res.json() as McpServerConfigEntry[];
  } catch (err) {
    process.stderr.write(`[config] Failed to fetch from Gate: ${err}\n`);
    return [];
  }
}

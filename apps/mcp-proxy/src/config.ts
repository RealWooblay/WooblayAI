/**
 * Configuration loader for the MCP Proxy.
 *
 * Reads from environment:
 *   GATE_URL          — Gate API base URL
 *   INSTANCE_ID       — Instance this proxy belongs to
 *   MCP_SERVERS_JSON  — JSON array of McpServerConfigEntry
 *
 * Falls back to fetching from Gate API if MCP_SERVERS_JSON is not set.
 */

import type { ProxyConfig, McpServerConfigEntry } from './types.js';

export function loadConfig(): ProxyConfig {
  const gateUrl = process.env['GATE_URL'] ?? 'http://localhost:4800';
  const instanceId = process.env['INSTANCE_ID'] ?? '';

  if (!instanceId) {
    process.stderr.write('[config] WARNING: INSTANCE_ID not set\n');
  }

  let servers: McpServerConfigEntry[] = [];

  const serversJson = process.env['MCP_SERVERS_JSON'];
  if (serversJson) {
    try {
      servers = JSON.parse(serversJson);
      if (!Array.isArray(servers)) {
        process.stderr.write('[config] MCP_SERVERS_JSON is not an array, ignoring\n');
        servers = [];
      }
    } catch (err) {
      process.stderr.write(`[config] Failed to parse MCP_SERVERS_JSON: ${err}\n`);
    }
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

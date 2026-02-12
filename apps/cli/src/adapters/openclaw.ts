import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync } from 'node:fs';
import { BACKUPS_DIR } from '../config/paths.js';
import type { IntegrationAdapter } from './types.js';

const OPENCLAW_DIR = join(homedir(), '.openclaw');
const OPENCLAW_CONFIG = join(OPENCLAW_DIR, 'openclaw.json');

/**
 * OpenClaw adapter – patches ~/.openclaw/openclaw.json to:
 *   - Add tools.deny list to block dangerous tools
 *   - Add Wooblay MCP server to agents.list[].mcp.servers[]
 */
export class OpenClawAdapter implements IntegrationAdapter {
  readonly name = 'openclaw';
  readonly configPath = OPENCLAW_CONFIG;

  async detect(): Promise<{ installed: boolean; configExists: boolean; version?: string }> {
    // Check if openclaw binary is on PATH (simplified check)
    const configExists = existsSync(OPENCLAW_CONFIG);
    const installed = existsSync(OPENCLAW_DIR);
    return { installed, configExists };
  }

  async backup(): Promise<string> {
    mkdirSync(BACKUPS_DIR, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = join(BACKUPS_DIR, `openclaw-${timestamp}.json`);

    if (existsSync(OPENCLAW_CONFIG)) {
      copyFileSync(OPENCLAW_CONFIG, backupPath);
    }

    return backupPath;
  }

  async enable(opts: { gateUrl: string }): Promise<{ success: boolean; message: string }> {
    if (!existsSync(OPENCLAW_CONFIG)) {
      return { success: false, message: `Config not found at ${OPENCLAW_CONFIG}` };
    }

    try {
      const raw = readFileSync(OPENCLAW_CONFIG, 'utf-8');
      const config = JSON.parse(raw) as Record<string, unknown>;

      // Add tools.deny list
      const tools = (config['tools'] as Record<string, unknown>) ?? {};
      tools['deny'] = ['exec', 'process', 'browser', 'canvas'];
      config['tools'] = tools;

      // Add MCP server to agents
      const agents = (config['agents'] as Record<string, unknown>) ?? {};
      const list = (agents['list'] as Array<Record<string, unknown>>) ?? [{}];

      for (const agent of list) {
        const mcp = (agent['mcp'] as Record<string, unknown>) ?? {};
        const servers = (mcp['servers'] as Array<Record<string, unknown>>) ?? [];

        // Remove existing wooblay server if present
        const filtered = servers.filter(
          (s) => (s['name'] as string) !== 'wooblay-gate',
        );

        filtered.push({
          name: 'wooblay-gate',
          url: `${opts.gateUrl}/mcp`,
          transport: 'sse',
        });

        mcp['servers'] = filtered;
        agent['mcp'] = mcp;
      }

      agents['list'] = list;
      config['agents'] = agents;

      writeFileSync(OPENCLAW_CONFIG, JSON.stringify(config, null, 2) + '\n', 'utf-8');
      return { success: true, message: 'OpenClaw config patched with Wooblay MCP server' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, message: `Failed to patch config: ${msg}` };
    }
  }

  async disable(backupPath: string): Promise<void> {
    if (!existsSync(backupPath)) {
      throw new Error(`Backup not found at ${backupPath}`);
    }
    copyFileSync(backupPath, OPENCLAW_CONFIG);
  }

  async restart(): Promise<{ success: boolean; message: string }> {
    // Placeholder – actual restart logic would kill/spawn the process
    return { success: false, message: 'OpenClaw restart is not yet implemented' };
  }

  async status(): Promise<{ healthy: boolean; message: string }> {
    const configExists = existsSync(OPENCLAW_CONFIG);
    if (!configExists) {
      return { healthy: false, message: 'OpenClaw config not found' };
    }

    try {
      const raw = readFileSync(OPENCLAW_CONFIG, 'utf-8');
      const config = JSON.parse(raw) as Record<string, unknown>;
      const agents = (config['agents'] as Record<string, unknown>) ?? {};
      const list = (agents['list'] as Array<Record<string, unknown>>) ?? [];

      const hasWooblay = list.some((agent) => {
        const mcp = (agent['mcp'] as Record<string, unknown>) ?? {};
        const servers = (mcp['servers'] as Array<Record<string, unknown>>) ?? [];
        return servers.some((s) => (s['name'] as string) === 'wooblay-gate');
      });

      return hasWooblay
        ? { healthy: true, message: 'Wooblay MCP server is configured in OpenClaw' }
        : { healthy: false, message: 'Wooblay MCP server not found in OpenClaw config' };
    } catch {
      return { healthy: false, message: 'Failed to read OpenClaw config' };
    }
  }
}

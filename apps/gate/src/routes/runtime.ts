/**
 * Runtime configuration routes.
 *
 * Manages environment variables and runtime configuration for the
 * managed Wooblay + Agent instance. In production, secrets are stored
 * via AWS Secrets Manager; in dev, they're written to .env files.
 *
 * GET  /api/runtime/config   — returns current config (secrets redacted)
 * POST /api/runtime/config   — update config values
 * POST /api/runtime/restart  — restart the agent container
 * GET  /api/runtime/status    — runtime health status
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

// Config variables that the UI can read/write
interface RuntimeConfigVar {
  key: string;
  label: string;
  description: string;
  type: 'string' | 'number' | 'boolean';
  secret: boolean;       // If true, value is redacted in GET response
  defaultValue: string;
  category: 'agent' | 'gate' | 'security' | 'channel';
}

const CONFIG_SCHEMA: RuntimeConfigVar[] = [
  // ── Agent ────────────────────────────────────────────────────────────────
  {
    key: 'ANTHROPIC_API_KEY',
    label: 'Anthropic API Key',
    description: 'API key for the Anthropic Claude model used by the agent.',
    type: 'string',
    secret: true,
    defaultValue: '',
    category: 'agent',
  },
  {
    key: 'OPENCLAW_MODEL',
    label: 'Agent Model',
    description: 'Primary LLM model for the agent (e.g. claude-sonnet-4-20250514).',
    type: 'string',
    secret: false,
    defaultValue: 'claude-sonnet-4-20250514',
    category: 'agent',
  },
  // ── Channels ─────────────────────────────────────────────────────────────
  {
    key: 'TELEGRAM_ENABLED',
    label: 'Telegram Enabled',
    description: 'Enable Telegram bot channel for the agent.',
    type: 'boolean',
    secret: false,
    defaultValue: 'false',
    category: 'channel',
  },
  {
    key: 'TELEGRAM_BOT_TOKEN',
    label: 'Telegram Bot Token',
    description: 'Bot token from @BotFather for the Telegram channel.',
    type: 'string',
    secret: true,
    defaultValue: '',
    category: 'channel',
  },
  {
    key: 'TELEGRAM_ALLOWED_USERS',
    label: 'Telegram Allowed Users',
    description: 'Comma-separated Telegram user IDs allowed to message the bot.',
    type: 'string',
    secret: false,
    defaultValue: '',
    category: 'channel',
  },
  // ── Gate ──────────────────────────────────────────────────────────────────
  {
    key: 'APPROVAL_TIMEOUT_MS',
    label: 'Approval Timeout (ms)',
    description: 'How long (ms) the bridge waits for Gate approval before deferring to 24h window.',
    type: 'number',
    secret: false,
    defaultValue: '100000',
    category: 'gate',
  },
  {
    key: 'APPROVAL_TTL_SECONDS',
    label: 'Approval TTL (seconds)',
    description: 'How long a pending approval stays open before expiring. Default: 86400 (24 hours).',
    type: 'number',
    secret: false,
    defaultValue: '86400',
    category: 'gate',
  },
  {
    key: 'WOOBLAY_TOOL_FILTER',
    label: 'Tool Filter',
    description: 'Which tool calls to route through Gate: "all" or "risky".',
    type: 'string',
    secret: false,
    defaultValue: 'risky',
    category: 'gate',
  },
  {
    key: 'GATE_PORT',
    label: 'Gate Port',
    description: 'Port the Gate server listens on.',
    type: 'number',
    secret: false,
    defaultValue: '4800',
    category: 'gate',
  },
  {
    key: 'NODE_ENV',
    label: 'Environment',
    description: 'Node environment mode (production, development).',
    type: 'string',
    secret: false,
    defaultValue: 'production',
    category: 'gate',
  },
];

function getEnvFilePath(): string {
  // In managed runtime, the .env file is at the project root
  return process.env['RUNTIME_ENV_FILE'] ?? join(process.cwd(), '.env');
}

function readEnvFile(): Record<string, string> {
  const path = getEnvFilePath();
  if (!existsSync(path)) return {};

  const content = readFileSync(path, 'utf-8');
  const vars: Record<string, string> = {};

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    // Remove surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    vars[key] = value;
  }

  return vars;
}

function writeEnvFile(vars: Record<string, string>) {
  const path = getEnvFilePath();
  const lines = Object.entries(vars)
    .filter(([, v]) => v !== '')
    .map(([k, v]) => `${k}=${v}`);
  writeFileSync(path, lines.join('\n') + '\n', 'utf-8');
}

function redactSecret(value: string): string {
  if (!value || value.length < 8) return '****';
  return value.slice(0, 4) + '****' + value.slice(-4);
}

export async function runtimeRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/runtime/config — Returns current configuration with secrets redacted.
   */
  app.get('/api/runtime/config', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const envVars = readEnvFile();

      const config = CONFIG_SCHEMA.map((schema) => {
        const rawValue = envVars[schema.key] ?? process.env[schema.key] ?? schema.defaultValue;
        return {
          ...schema,
          value: schema.secret ? redactSecret(rawValue) : rawValue,
          isSet: !!(envVars[schema.key] || process.env[schema.key]),
        };
      });

      return reply.send({
        schema: CONFIG_SCHEMA.map((s) => ({ key: s.key, label: s.label, description: s.description, type: s.type, secret: s.secret, category: s.category })),
        values: config,
      });
    } catch (err) {
      _request.log.error(err, 'Failed to read runtime config');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  // Keys that require an agent restart to take effect
  const RESTART_KEYS = new Set([
    'ANTHROPIC_API_KEY', 'OPENCLAW_MODEL',
    'TELEGRAM_ENABLED', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_ALLOWED_USERS',
    'WOOBLAY_TOOL_FILTER',
  ]);

  /**
   * POST /api/runtime/config — Update one or more config values.
   * Body: { updates: Record<string, string>, autoRestart?: boolean }
   *
   * When autoRestart is true (default) and any critical key changes,
   * the agent container is automatically restarted.
   */
  app.post('/api/runtime/config', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { updates: Record<string, string>; autoRestart?: boolean };

    if (!body.updates || typeof body.updates !== 'object') {
      return reply.code(400).send({ error: 'Missing "updates" object in body' });
    }

    const shouldAutoRestart = body.autoRestart !== false; // default true

    try {
      const envVars = readEnvFile();

      // Only allow updates to known config keys
      const allowedKeys = new Set(CONFIG_SCHEMA.map((s) => s.key));
      const appliedUpdates: Record<string, boolean> = {};
      let needsRestart = false;

      for (const [key, value] of Object.entries(body.updates)) {
        if (!allowedKeys.has(key)) continue;
        // Skip if value is the redacted placeholder
        if (value.includes('****')) continue;
        envVars[key] = String(value);
        appliedUpdates[key] = true;
        if (RESTART_KEYS.has(key)) needsRestart = true;
      }

      writeEnvFile(envVars);

      // Auto-restart agent if critical settings changed
      let restarted = false;
      if (needsRestart && shouldAutoRestart) {
        try {
          const composeFile = process.env['COMPOSE_FILE'] ?? '/opt/wooblay/docker-compose.yml';
          const projectDir = composeFile.replace(/\/[^/]+$/, '');
          execSync(`cd "${projectDir}" && docker compose --env-file .env up -d --force-recreate agent`, {
            timeout: 60_000,
            stdio: 'pipe',
          });
          restarted = true;
        } catch (restartErr: any) {
          request.log.error(restartErr, 'Auto-restart failed after config update');
        }
      }

      return reply.send({
        updated: Object.keys(appliedUpdates),
        restarted,
        message: restarted
          ? `Updated ${Object.keys(appliedUpdates).length} config value(s) and restarted agent.`
          : `Updated ${Object.keys(appliedUpdates).length} config value(s).${needsRestart && !restarted ? ' Restart the agent for changes to take effect.' : ''}`,
      });
    } catch (err) {
      request.log.error(err, 'Failed to update runtime config');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * POST /api/runtime/restart — Restart the agent container.
   * This is a best-effort operation; it requires docker-compose on the host.
   */
  app.post('/api/runtime/restart', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const composeFile = process.env['COMPOSE_FILE'] ?? '/opt/wooblay/docker-compose.yml';

      // Check if docker compose is available
      try {
        execSync('docker compose version', { timeout: 5000, stdio: 'pipe' });
      } catch {
        return reply.code(503).send({
          error: 'Docker Compose not available on this host. Cannot restart containers.',
          manual: 'SSH into the instance and run: docker compose restart agent',
        });
      }

      // Recreate the agent service so it picks up .env changes
      const projectDir = composeFile.replace(/\/[^/]+$/, '');
      execSync(`cd "${projectDir}" && docker compose --env-file .env up -d --force-recreate agent`, {
        timeout: 60_000,
        stdio: 'pipe',
      });

      return reply.send({
        restarted: true,
        message: 'Agent container restarted successfully.',
      });
    } catch (err: any) {
      request.log.error(err, 'Failed to restart runtime');
      return reply.code(500).send({
        error: `Restart failed: ${err.message}`,
      });
    }
  });

  /**
   * GET /api/runtime/status — Runtime health and component status.
   */
  app.get('/api/runtime/status', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const uptime = process.uptime();
      const memUsage = process.memoryUsage();

      // Try to get docker container status
      let containers: { name: string; status: string; uptime: string }[] = [];
      try {
        const output = execSync('docker ps --format "{{.Names}}|{{.Status}}"', {
          timeout: 5000,
          stdio: 'pipe',
        }).toString();

        containers = output
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((line) => {
            const [name, status] = line.split('|');
            return { name, status, uptime: status };
          });
      } catch {
        // Docker not available, that's OK
      }

      return reply.send({
        gate: {
          uptime: Math.round(uptime),
          memoryMB: Math.round(memUsage.heapUsed / 1024 / 1024),
          nodeVersion: process.version,
        },
        containers,
        environment: process.env['NODE_ENV'] ?? 'development',
      });
    } catch (err) {
      _request.log.error(err, 'Failed to get runtime status');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });
}

/**
 * Instance management routes.
 *
 * Manages deployed agent runtime instances. Each instance is an isolated
 * agent container running via Docker Compose with its own config and environment.
 *
 * GET    /api/instances              — List all instances
 * POST   /api/instances              — Create (provision) new instance
 * GET    /api/instances/:id          — Instance detail + status
 * PATCH  /api/instances/:id          — Update config
 * POST   /api/instances/:id/start    — Start instance container
 * POST   /api/instances/:id/stop     — Stop instance container
 * POST   /api/instances/:id/restart  — Restart instance
 * DELETE /api/instances/:id          — Teardown instance
 * GET    /api/instances/:id/logs     — Container logs
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db/client.js';
import { config } from '../config.js';
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { exec, execSync } from 'child_process';
import { randomBytes } from 'crypto';

/**
 * Helper to resolve the current user's DB id from the Clerk-provided clerkUserId.
 * Returns null if not in platform mode or user doesn't exist.
 */
async function resolveUserId(request: FastifyRequest): Promise<string | null> {
  if (!config.PLATFORM_MODE) return null;
  const clerkId = request.clerkUserId;
  if (!clerkId) return null;
  const user = await prisma.user.findUnique({ where: { clerkId }, select: { id: true } });
  return user?.id ?? null;
}

/**
 * In platform mode, verify the requesting user owns the instance.
 * In instance mode, always returns true (no multi-user).
 */
async function checkInstanceOwnership(
  request: FastifyRequest,
  reply: FastifyReply,
  instanceId: string,
): Promise<{ instance: NonNullable<Awaited<ReturnType<typeof prisma.instance.findUnique>>> } | null> {
  const instance = await prisma.instance.findUnique({ where: { id: instanceId } });
  if (!instance) {
    reply.code(404).send({ error: 'Instance not found' });
    return null;
  }

  if (config.PLATFORM_MODE) {
    const userId = await resolveUserId(request);
    if (userId && instance.userId && instance.userId !== userId) {
      reply.code(403).send({ error: 'Access denied' });
      return null;
    }
  }

  return { instance };
}

// Base directory for per-instance configs
const INSTANCES_DIR = process.env['INSTANCES_DIR'] ?? '/opt/wooblay/instances';
const GATE_INTERNAL_URL = process.env['GATE_INTERNAL_URL'] ?? 'http://172.21.0.20:4800';
const BASE_AGENT_IMAGE = process.env['AGENT_IMAGE'] ?? 'wooblay-openclaw:latest';

// Docker compose project name (derived from /opt/wooblay -> "wooblay")
const COMPOSE_PROJECT = process.env['COMPOSE_PROJECT_NAME'] ?? 'wooblay';

// Port allocation: each instance gets a unique port on agent_net
// Base starts at 18800 and increments per instance
let nextPort = 18800;

function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

function getInstanceDir(instanceId: string): string {
  return join(INSTANCES_DIR, instanceId);
}

function writeInstanceEnv(dir: string, config: Record<string, string>) {
  const lines = Object.entries(config)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${v}`);
  writeFileSync(join(dir, '.env'), lines.join('\n') + '\n', 'utf-8');
}

// Subdir inside instance dir where agent state (sessions, memory, skills) is persisted
// so stop/start does not lose context. Mounted at /home/agent/.openclaw in the container.
const AGENT_STATE_DIR = 'agent-state';

const MCP_PROXY_IMAGE = process.env['MCP_PROXY_IMAGE'] ?? 'wooblay/mcp-proxy:latest';

interface McpServerForCompose {
  id: string;
  name: string;
  transport: string;
  source: string;
  args?: string | null;
  connectionIds: string;
  enabled: boolean;
}

function writeInstanceCompose(
  dir: string,
  instanceName: string,
  _port: number,
  mcpServers?: McpServerForCompose[],
  gatewayToken?: string,
  instanceType: 'agent' | 'proxy' = 'agent',
) {
  const agentNetName = `${COMPOSE_PROJECT}_agent_net`;
  const enabledServers = (mcpServers ?? []).filter(s => s.enabled);
  const hasMcpProxy = enabledServers.length > 0 || instanceType === 'proxy';

  if (hasMcpProxy) {
    const serversJson = JSON.stringify(enabledServers.map(s => ({
      id: s.id,
      name: s.name,
      transport: s.transport,
      source: s.source,
      args: s.args ? JSON.parse(s.args) : null,
      connectionIds: JSON.parse(s.connectionIds),
      enabled: true,
    })));

    writeFileSync(join(dir, '.env.mcp-proxy'), [
      `GATE_URL=${GATE_INTERNAL_URL}`,
      `INSTANCE_ID=${instanceName}`,
      `INSTANCE_NAME=${instanceName}`,
      `MCP_SERVERS_JSON=${serversJson}`,
      ...(gatewayToken ? [`GATEWAY_TOKEN=${gatewayToken}`] : []),
    ].join('\n') + '\n', 'utf-8');
  }

  const proxyService = `
  mcp-proxy-${instanceName}:
    image: ${MCP_PROXY_IMAGE}
    container_name: wooblay-mcp-proxy-${instanceName}
    restart: unless-stopped
    env_file:
      - .env.mcp-proxy
    expose:
      - "3100"
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
    read_only: true
    tmpfs:
      - /tmp:size=64M
    networks:
      - agent_net
    dns:
      - 8.8.8.8
    deploy:
      resources:
        limits:
          memory: 512M`;

  if (instanceType === 'proxy') {
    const compose = `# Auto-generated by Wooblay Gate for proxy instance: ${instanceName}
services:${proxyService}

networks:
  agent_net:
    external: true
    name: ${agentNetName}
`;
    writeFileSync(join(dir, 'docker-compose.yml'), compose.trim() + '\n', 'utf-8');
    return;
  }

  // Agent instance — full compose with optional proxy sidecar
  let compose = `# Auto-generated by Wooblay Gate for instance: ${instanceName}
# agent-state is persisted on host so stop/start keeps memory/sessions
services:
  agent-${instanceName}:
    image: ${BASE_AGENT_IMAGE}
    container_name: wooblay-agent-${instanceName}
    restart: unless-stopped
    env_file:
      - .env
    environment:
      GATE_URL: "${GATE_INTERNAL_URL}"
      INSTANCE_NAME: "${instanceName}"
    cap_drop:
      - ALL
    cap_add:
      - NET_BIND_SERVICE
    security_opt:
      - no-new-privileges:true
    tmpfs:
      - /tmp:size=256M
    volumes:
      - ./${AGENT_STATE_DIR}:/home/agent/.openclaw
    networks:
      - agent_net
    dns:
      - 8.8.8.8
    deploy:
      resources:
        limits:
          memory: 1536M`;

  if (hasMcpProxy) {
    const envPath = join(dir, '.env');
    const existingEnv = readFileSync(envPath, 'utf-8');
    if (!existingEnv.includes('MCP_PROXY_URL=')) {
      writeFileSync(envPath, existingEnv.trimEnd() + `\nMCP_PROXY_URL=http://wooblay-mcp-proxy-${instanceName}:3100/sse\n`, 'utf-8');
    }

    compose += `
    depends_on:
      - mcp-proxy-${instanceName}
${proxyService}`;
  }

  compose += `

networks:
  agent_net:
    external: true
    name: ${agentNetName}
`;
  writeFileSync(join(dir, 'docker-compose.yml'), compose.trim() + '\n', 'utf-8');
}

function ensureAgentStateDir(dir: string): void {
  const stateDir = join(dir, AGENT_STATE_DIR);
  if (!existsSync(stateDir)) {
    mkdirSync(stateDir, { recursive: true });
  }
  const skillsDir = join(stateDir, 'skills');
  if (!existsSync(skillsDir)) {
    mkdirSync(skillsDir, { recursive: true });
  }
}

export async function instanceRoutes(app: FastifyInstance): Promise<void> {
  // Ensure instances directory exists
  if (!existsSync(INSTANCES_DIR)) {
    try { mkdirSync(INSTANCES_DIR, { recursive: true }); } catch { }
  }

  /**
   * GET /api/instances — List all instances.
   */
  app.get('/api/instances', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = await resolveUserId(request);
      const instances = await prisma.instance.findMany({
        orderBy: { createdAt: 'desc' },
        ...(userId ? { where: { userId } } : {}),
      });

      // Enrich with live container status if possible
      let containerStatuses: Record<string, string> = {};
      try {
        const output = execSync('docker ps -a --format "{{.Names}}|{{.Status}}"', {
          timeout: 5000, stdio: 'pipe',
        }).toString();
        for (const line of output.trim().split('\n').filter(Boolean)) {
          const [name, status] = line.split('|');
          if (name) containerStatuses[name] = status;
        }
      } catch { }

      const enriched = instances.map((inst: typeof instances[number]) => {
        const containerKey = inst.instanceType === 'proxy'
          ? `wooblay-mcp-proxy-${inst.name}`
          : `wooblay-agent-${inst.name}`;
        return {
          ...inst,
          liveStatus: containerStatuses[containerKey] ?? null,
        };
      });

      return reply.send(enriched);
    } catch (err) {
      request.log.error(err, 'Failed to list instances');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * POST /api/instances — Create (provision) a new agent instance.
   */
  app.post('/api/instances', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as {
      name: string;
      instanceType?: 'agent' | 'proxy';
      agentRuntime?: string;
      model?: string;
      anthropicApiKey?: string;
      telegramBotToken?: string;
      telegramAllowedUsers?: string;
      telegramEnabled?: boolean;
      githubToken?: string;
      policyPreset?: string;
      configOverrides?: Record<string, string>;
      role?: string;
      goal?: string;
      awsAccessKeyId?: string;
      awsSecretAccessKey?: string;
      awsRegion?: string;
      gcpServiceAccountKey?: string;
      gcpProjectId?: string;
    };

    if (!body.name || typeof body.name !== 'string') {
      return reply.code(400).send({ error: 'Missing "name" field' });
    }

    const instanceType = body.instanceType === 'proxy' ? 'proxy' : 'agent';
    const userId = await resolveUserId(request);
    const name = body.name.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 32);

    try {
      const existing = await prisma.instance.findUnique({ where: { name } });
      if (existing) {
        return reply.code(409).send({ error: `Instance "${name}" already exists` });
      }

      const port = nextPort++;
      const gatewayToken = generateToken();

      if (instanceType === 'proxy') {
        const instance = await prisma.instance.create({
          data: {
            name,
            userId: userId ?? undefined,
            instanceType: 'proxy',
            status: 'provisioning',
            agentRuntime: 'proxy-only',
            model: 'none',
            configJson: JSON.stringify({ port, gatewayToken, syncToken: generateToken() }),
            endpoint: `http://wooblay-mcp-proxy-${name}:3100/sse`,
          },
        });

        const dir = getInstanceDir(instance.id);
        mkdirSync(dir, { recursive: true });
        writeInstanceEnv(dir, { GATE_URL: GATE_INTERNAL_URL, INSTANCE_NAME: name });
        writeInstanceCompose(dir, name, port, [], gatewayToken, 'proxy');

        try {
          execSync(`cd "${dir}" && docker compose up -d`, { timeout: 90_000, stdio: 'pipe' });
          let containerId: string | null = null;
          try {
            containerId = execSync(
              `docker ps -q --filter "name=wooblay-mcp-proxy-${name}"`,
              { timeout: 5000, stdio: 'pipe' },
            ).toString().trim() || null;
          } catch { }
          await prisma.instance.update({ where: { id: instance.id }, data: { status: 'running', containerId } });
        } catch (startErr: any) {
          request.log.error(startErr, `Failed to start proxy instance ${name}`);
          await prisma.instance.update({ where: { id: instance.id }, data: { status: 'error' } });
        }

        const updated = await prisma.instance.findUnique({ where: { id: instance.id } });
        return reply.code(201).send(updated ?? instance);
      }

      // Agent instance — full flow
      const instance = await prisma.instance.create({
        data: {
          name,
          userId: userId ?? undefined,
          instanceType: 'agent',
          status: 'provisioning',
          agentRuntime: body.agentRuntime ?? 'openclaw',
          model: body.model ?? 'claude-sonnet-4-20250514',
          role: body.role ?? null,
          configJson: JSON.stringify({
            port,
            gatewayToken,
            syncToken: generateToken(),
            anthropicApiKey: body.anthropicApiKey ? '***SET***' : '',
            githubPat: body.githubToken ? '***SET***' : '',
            telegramEnabled: body.telegramEnabled ?? false,
            telegramAllowedUsers: body.telegramAllowedUsers ?? '',
            policyPreset: body.policyPreset ?? 'balanced',
            goal: body.goal ?? '',
            ...body.configOverrides,
          }),
          telegramBot: body.telegramEnabled ? 'configured' : null,
          githubPat: !!body.githubToken,
          endpoint: `http://wooblay-agent-${name}:${port}`,
        },
      });

      const dir = getInstanceDir(instance.id);
      mkdirSync(dir, { recursive: true });

      const goalFromConfig = body.configOverrides?.goal ?? '';
      const envConfig: Record<string, string> = {
        OPENCLAW_GATEWAY_TOKEN: gatewayToken,
        GATE_URL: GATE_INTERNAL_URL,
        WOOBLAY_TOOL_FILTER: 'risky',
        OPENCLAW_MODEL: body.model ?? 'claude-sonnet-4-20250514',
        TELEGRAM_ENABLED: String(body.telegramEnabled ?? false),
        INSTANCE_NAME: name,
        ...(body.role ? { OPENCLAW_AGENT_ROLE: body.role } : {}),
        ...(goalFromConfig ? { OPENCLAW_AGENT_GOAL: goalFromConfig } : {}),
        ...(body.anthropicApiKey ? { ANTHROPIC_API_KEY: body.anthropicApiKey } : {}),
        ...(body.telegramBotToken ? { TELEGRAM_BOT_TOKEN: body.telegramBotToken } : {}),
        ...(body.telegramAllowedUsers ? { TELEGRAM_ALLOWED_USERS: body.telegramAllowedUsers } : {}),
        ...(body.githubToken ? { GITHUB_TOKEN: body.githubToken } : {}),
        ...(body.awsAccessKeyId ? { AWS_ACCESS_KEY_ID: body.awsAccessKeyId } : {}),
        ...(body.awsSecretAccessKey ? { AWS_SECRET_ACCESS_KEY: body.awsSecretAccessKey } : {}),
        ...(body.awsRegion ? { AWS_DEFAULT_REGION: body.awsRegion } : {}),
        ...(body.gcpServiceAccountKey ? { GCP_SERVICE_ACCOUNT_KEY: body.gcpServiceAccountKey } : {}),
        ...(body.gcpProjectId ? { GCP_PROJECT_ID: body.gcpProjectId } : {}),
        ...(body.configOverrides ?? {}),
      };

      writeInstanceEnv(dir, envConfig);
      ensureAgentStateDir(dir);
      writeInstanceCompose(dir, name, port, undefined, gatewayToken, 'agent');

      try {
        execSync(`cd "${dir}" && docker compose up -d`, { timeout: 90_000, stdio: 'pipe' });
        let containerId: string | null = null;
        try {
          containerId = execSync(
            `docker ps -q --filter "name=wooblay-agent-${name}"`,
            { timeout: 5000, stdio: 'pipe' },
          ).toString().trim() || null;
        } catch { }
        await prisma.instance.update({ where: { id: instance.id }, data: { status: 'running', containerId } });
        request.log.info(`Instance ${name} started successfully`);
        const updated = await prisma.instance.findUnique({ where: { id: instance.id } });
        return reply.code(201).send(updated ?? instance);
      } catch (startErr: any) {
        request.log.error(startErr, `Failed to start instance ${name}`);
        await prisma.instance.update({ where: { id: instance.id }, data: { status: 'error' } });
        const errInstance = await prisma.instance.findUnique({ where: { id: instance.id } });
        return reply.code(201).send(errInstance ?? instance);
      }
    } catch (err) {
      request.log.error(err, 'Failed to create instance');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/instances/:id — Instance detail.
   */
  app.get('/api/instances/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    try {
      const check = await checkInstanceOwnership(request, reply, id);
      if (!check) return;
      const { instance } = check;

      const containerPrefix = instance.instanceType === 'proxy'
        ? `wooblay-mcp-proxy-${instance.name}`
        : `wooblay-agent-${instance.name}`;
      let liveStatus: string | null = null;
      try {
        liveStatus = execSync(
          `docker ps -a --filter "name=${containerPrefix}" --format "{{.Status}}"`,
          { timeout: 5000, stdio: 'pipe' },
        ).toString().trim() || null;
      } catch { }

      const { configJson: _cj, secrets: _s, ...safeInstance } = instance;
      return reply.send({ ...safeInstance, liveStatus });
    } catch (err) {
      request.log.error(err, 'Failed to get instance');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * PATCH /api/instances/:id — Update instance config.
   */
  app.patch('/api/instances/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Partial<{
      name: string;
      model: string;
      agentRuntime: string;
      anthropicApiKey: string;
      telegramBotToken: string;
      telegramAllowedUsers: string;
      telegramEnabled: boolean;
      githubToken: string;
      configOverrides: Record<string, string>;
      role: string;
      goal: string;
      awsAccessKeyId: string;
      awsSecretAccessKey: string;
      awsRegion: string;
      gcpServiceAccountKey: string;
      gcpProjectId: string;
    }>;

    try {
      const instance = await prisma.instance.findUnique({ where: { id } });
      if (!instance) return reply.code(404).send({ error: 'Instance not found' });

      // Update DB record
      const updateData: Record<string, unknown> = {};
      if (body.model) updateData.model = body.model;
      if (body.agentRuntime) updateData.agentRuntime = body.agentRuntime;
      if (body.role !== undefined) updateData.role = body.role || null;
      if (body.telegramEnabled !== undefined) {
        updateData.telegramBot = body.telegramEnabled ? 'configured' : null;
      }

      // Merge config
      const existingConfig = instance.configJson ? JSON.parse(instance.configJson) : {};
      const newConfig = {
        ...existingConfig,
        ...(body.model ? { model: body.model } : {}),
        ...(body.telegramEnabled !== undefined ? { telegramEnabled: body.telegramEnabled } : {}),
        ...(body.telegramAllowedUsers ? { telegramAllowedUsers: body.telegramAllowedUsers } : {}),
        ...(body.goal !== undefined ? { goal: body.goal } : {}),
        ...(body.configOverrides ?? {}),
      };
      updateData.configJson = JSON.stringify(newConfig);

      const updated = await prisma.instance.update({
        where: { id },
        data: updateData,
      });

      // Update the instance's .env file if it exists — merge with existing values
      const dir = getInstanceDir(id);
      if (existsSync(dir)) {
        // Read existing .env to preserve secrets not being updated
        const existingEnv: Record<string, string> = {};
        const envPath = join(dir, '.env');
        if (existsSync(envPath)) {
          const lines = readFileSync(envPath, 'utf-8').split('\n');
          for (const line of lines) {
            const idx = line.indexOf('=');
            if (idx > 0) {
              existingEnv[line.slice(0, idx)] = line.slice(idx + 1);
            }
          }
        }

        // Merge: existing values as base, overlay with new values
        const effectiveRole = body.role !== undefined ? (body.role || '') : (instance.role ?? '');
        const effectiveGoal = body.goal ?? newConfig.goal ?? '';
        // Check for evolved SOUL content stored from previous sessions
        const evolvedSoul = newConfig.evolvedSoul ?? '';

        const envConfig: Record<string, string> = {
          ...existingEnv,
          OPENCLAW_GATEWAY_TOKEN: existingEnv['OPENCLAW_GATEWAY_TOKEN'] ?? existingConfig.gatewayToken ?? generateToken(),
          GATE_URL: GATE_INTERNAL_URL,
          WOOBLAY_TOOL_FILTER: 'risky',
          OPENCLAW_MODEL: body.model ?? instance.model,
          TELEGRAM_ENABLED: String(body.telegramEnabled ?? existingConfig.telegramEnabled ?? false),
          INSTANCE_NAME: instance.name,
          // Hybrid identity: role seeds SOUL.md, evolved soul restores previous session
          ...(effectiveRole ? { OPENCLAW_AGENT_ROLE: effectiveRole } : {}),
          ...(effectiveGoal ? { OPENCLAW_AGENT_GOAL: effectiveGoal } : {}),
          ...(evolvedSoul ? { OPENCLAW_AGENT_SOUL: evolvedSoul } : {}),
          ...(body.anthropicApiKey ? { ANTHROPIC_API_KEY: body.anthropicApiKey } : {}),
          ...(body.telegramBotToken ? { TELEGRAM_BOT_TOKEN: body.telegramBotToken } : {}),
          ...(body.telegramAllowedUsers ? { TELEGRAM_ALLOWED_USERS: body.telegramAllowedUsers } : {}),
          ...(body.githubToken ? { GITHUB_TOKEN: body.githubToken } : {}),
          // Cloud provider credentials
          ...(body.awsAccessKeyId ? { AWS_ACCESS_KEY_ID: body.awsAccessKeyId } : {}),
          ...(body.awsSecretAccessKey ? { AWS_SECRET_ACCESS_KEY: body.awsSecretAccessKey } : {}),
          ...(body.awsRegion ? { AWS_DEFAULT_REGION: body.awsRegion } : {}),
          ...(body.gcpServiceAccountKey ? { GCP_SERVICE_ACCOUNT_KEY: body.gcpServiceAccountKey } : {}),
          ...(body.gcpProjectId ? { GCP_PROJECT_ID: body.gcpProjectId } : {}),
          ...(body.configOverrides ?? {}),
        };
        writeInstanceEnv(dir, envConfig);

        // ── Hot-inject vs restart ────────────────────────────────────────
        // A running agent may have hours of deep context. Restarting kills
        // all memory, sub-agents, and conversation state.
        //
        // What ACTUALLY works via docker exec:
        //   - File writes (AWS creds, GCP key, git config) — SDKs re-read
        //     these files on every request, so changes take effect immediately.
        //
        // What DOES NOT work via docker exec:
        //   - `export VAR=X` — only sets the var in that exec shell session,
        //     not in the running OpenClaw process (PID 1). Dies on exit.
        //   - openclaw.json edits — OpenClaw reads config at startup and
        //     caches it in memory. File changes are ignored until restart.
        //
        // Strategy:
        //   1. File-based creds → hot-inject (works, no restart)
        //   2. Env-var-only creds (Anthropic key) → requires restart
        //   3. Model / Telegram → requires restart (openclaw.json is cached)
        //   4. Role / Goal → DB + .env only; SOUL.md edited via Profile tab UI
        //
        // .env is ALWAYS updated so next cold start picks up everything.

        const containerName = `wooblay-agent-${instance.name}`;

        // These require restart because they need env vars or openclaw.json reload
        const needsRestart = !!(body.model || body.anthropicApiKey ||
          body.telegramBotToken || body.telegramEnabled !== undefined);

        if (instance.status === 'running') {
          // ── File-based hot-inject (reliably works) ─────────────────────
          // All credential values are base64-encoded before embedding in shell
          // commands to prevent injection via malicious credential strings.
          const b64 = (s: string) => Buffer.from(s, 'utf-8').toString('base64');
          const hotInjectCmds: string[] = [];

          // AWS credentials → write ~/.aws/credentials + config
          // AWS SDK reads these files on every API call — no restart needed
          if (body.awsAccessKeyId || body.awsSecretAccessKey) {
            const keyId = body.awsAccessKeyId ?? existingEnv['AWS_ACCESS_KEY_ID'] ?? '';
            const secret = body.awsSecretAccessKey ?? existingEnv['AWS_SECRET_ACCESS_KEY'] ?? '';
            const region = body.awsRegion ?? existingEnv['AWS_DEFAULT_REGION'] ?? 'us-east-1';
            if (keyId && secret) {
              const awsCreds = `[default]\naws_access_key_id = ${keyId}\naws_secret_access_key = ${secret}\n`;
              const awsConfig = `[default]\nregion = ${region}\noutput = json\n`;
              hotInjectCmds.push(
                `mkdir -p /root/.aws`,
                `echo '${b64(awsCreds)}' | base64 -d > /root/.aws/credentials`,
                `echo '${b64(awsConfig)}' | base64 -d > /root/.aws/config`,
              );
            }
          }

          // GCP credentials → write /root/gcp-key.json
          // Google SDK reads GOOGLE_APPLICATION_CREDENTIALS file path on every call.
          if (body.gcpServiceAccountKey) {
            hotInjectCmds.push(
              `echo '${b64(body.gcpServiceAccountKey)}' | base64 -d > /root/gcp-key.json`,
            );
          }

          // GitHub token → update git credential helper (writes to ~/.gitconfig)
          // git reads this config file on every git operation — no restart needed
          if (body.githubToken) {
            const gitHelper = `#!/bin/sh\necho "username=token"\necho "password=${body.githubToken}"`;
            hotInjectCmds.push(
              `echo '${b64(gitHelper)}' | base64 -d > /root/.git-credential-helper.sh`,
              `chmod +x /root/.git-credential-helper.sh`,
              `git config --global credential.helper /root/.git-credential-helper.sh`,
            );
          }

          // Role / Goal → saved to DB + .env. The actual SOUL.md / IDENTITY.md
          // files are edited directly via the Profile tab in the UI, which uses
          // the /files/write API (base64 pipe into container). No shell escaping.

          // Execute file-based hot-inject
          if (hotInjectCmds.length > 0) {
            try {
              const script = hotInjectCmds.join(' && ');
              execSync(`docker exec "${containerName}" sh -c '${script.replace(/'/g, "'\\''")}'`, {
                timeout: 10_000, stdio: 'pipe',
              });
              request.log.info(`Instance ${instance.name} — hot-injected file-based credentials (no restart, memory preserved)`);
            } catch (injectErr: any) {
              request.log.error(injectErr, `Failed to hot-inject credentials into ${instance.name}`);
            }
          }

          // ── Restart only if truly unavoidable ──────────────────────────
          if (needsRestart) {
            try {
              execSync(`cd "${dir}" && docker compose up -d --force-recreate`, {
                timeout: 60_000, stdio: 'pipe',
              });
              request.log.info(`Instance ${instance.name} restarted (model/anthropic-key/telegram change requires restart)`);
            } catch (restartErr: any) {
              request.log.error(restartErr, `Failed to restart instance ${instance.name}`);
            }
          } else {
            request.log.info(`Instance ${instance.name} updated — no restart needed`);
          }
        }
      }

      return reply.send(updated);
    } catch (err) {
      request.log.error(err, 'Failed to update instance');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * POST /api/instances/:id/start — Start instance container.
   * If instance dir is missing (e.g. after host migration), re-provision from DB then start.
   */
  app.post('/api/instances/:id/start', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    try {
      const instance = await prisma.instance.findUnique({ where: { id } });
      if (!instance) return reply.code(404).send({ error: 'Instance not found' });

      // Fetch MCP server configs for compose generation
      const mcpServers = await prisma.mcpServerConfig.findMany({
        where: { instanceId: id, enabled: true },
      });

      const isProxy = instance.instanceType === 'proxy';
      const containerName = isProxy
        ? `wooblay-mcp-proxy-${instance.name}`
        : `wooblay-agent-${instance.name}`;

      const dir = getInstanceDir(id);
      if (!existsSync(dir)) {
        let parsedConfig: { port?: number; gatewayToken?: string; goal?: string;[k: string]: unknown } = {};
        try {
          if (instance.configJson) parsedConfig = JSON.parse(instance.configJson) as typeof parsedConfig;
        } catch { }
        const port = parsedConfig.port ?? nextPort++;
        mkdirSync(dir, { recursive: true });

        if (isProxy) {
          const gwToken = (parsedConfig.gatewayToken as string) ?? generateToken();
          writeInstanceEnv(dir, { GATE_URL: GATE_INTERNAL_URL, INSTANCE_NAME: instance.name });
          writeInstanceCompose(dir, instance.name, port, mcpServers, gwToken, 'proxy');
        } else {
          ensureAgentStateDir(dir);
          const envConfig: Record<string, string> = {
            OPENCLAW_GATEWAY_TOKEN: (parsedConfig.gatewayToken as string) ?? generateToken(),
            GATE_URL: GATE_INTERNAL_URL,
            WOOBLAY_TOOL_FILTER: 'risky',
            OPENCLAW_MODEL: instance.model ?? 'claude-sonnet-4-20250514',
            TELEGRAM_ENABLED: String((parsedConfig.telegramEnabled as boolean) ?? false),
            INSTANCE_NAME: instance.name,
            ...(instance.role ? { OPENCLAW_AGENT_ROLE: instance.role } : {}),
            ...(parsedConfig.goal ? { OPENCLAW_AGENT_GOAL: String(parsedConfig.goal) } : {}),
            ...(typeof parsedConfig.anthropicApiKey === 'string' && parsedConfig.anthropicApiKey && parsedConfig.anthropicApiKey !== '***SET***' ? { ANTHROPIC_API_KEY: parsedConfig.anthropicApiKey } : {}),
            ...(typeof parsedConfig.githubToken === 'string' ? { GITHUB_TOKEN: parsedConfig.githubToken } : {}),
            ...(typeof parsedConfig.telegramBotToken === 'string' ? { TELEGRAM_BOT_TOKEN: parsedConfig.telegramBotToken } : {}),
            ...(typeof parsedConfig.telegramAllowedUsers === 'string' ? { TELEGRAM_ALLOWED_USERS: parsedConfig.telegramAllowedUsers } : {}),
            ...(typeof parsedConfig.awsAccessKeyId === 'string' ? { AWS_ACCESS_KEY_ID: parsedConfig.awsAccessKeyId } : {}),
            ...(typeof parsedConfig.awsSecretAccessKey === 'string' ? { AWS_SECRET_ACCESS_KEY: parsedConfig.awsSecretAccessKey } : {}),
            ...(typeof parsedConfig.awsRegion === 'string' ? { AWS_DEFAULT_REGION: parsedConfig.awsRegion } : {}),
            ...(typeof parsedConfig.gcpServiceAccountKey === 'string' ? { GCP_SERVICE_ACCOUNT_KEY: parsedConfig.gcpServiceAccountKey } : {}),
            ...(typeof parsedConfig.gcpProjectId === 'string' ? { GCP_PROJECT_ID: parsedConfig.gcpProjectId } : {}),
          };
          const instanceGwToken = (parsedConfig.gatewayToken as string) ?? generateToken();
          writeInstanceEnv(dir, envConfig);
          writeInstanceCompose(dir, instance.name, port, mcpServers, instanceGwToken, 'agent');
        }
        request.log.info({ instanceId: id, name: instance.name }, 'Re-provisioned instance dir (was missing after migration)');
      } else {
        if (!isProxy) ensureAgentStateDir(dir);
        let gwToken: string | undefined;
        try {
          const envContent = readFileSync(join(dir, '.env'), 'utf-8');
          const match = envContent.match(/OPENCLAW_GATEWAY_TOKEN=(.+)/);
          if (match) gwToken = match[1].trim();
        } catch { /* use undefined */ }
        writeInstanceCompose(dir, instance.name, 0, mcpServers, gwToken, isProxy ? 'proxy' : 'agent');
      }

      if (!isProxy) ensureAgentStateDir(dir);
      try {
        execSync(`docker rm -f "${containerName}" 2>/dev/null || true`, { timeout: 10_000, stdio: 'pipe' });
      } catch { /* ignore */ }

      await prisma.instance.update({ where: { id }, data: { status: 'provisioning' } });

      // Run compose up in background so we don't block the HTTP response
      const doStart = async () => {
        try {
          execSync(`cd "${dir}" && docker compose up -d`, { timeout: 120_000, stdio: 'pipe' });
        } catch (upErr: any) {
          request.log.error(upErr, `docker compose up -d failed for ${instance.name}`);
          await prisma.instance.update({ where: { id }, data: { status: 'error' } }).catch(() => {});
          return;
        }

        // Poll for container readiness (up to 30s)
        let containerId: string | null = null;
        for (let attempt = 0; attempt < 6; attempt++) {
          await new Promise((r) => setTimeout(r, 5000));
          try {
            const out = execSync(
              `docker ps -q --filter "name=^${containerName}$" --filter "status=running"`,
              { timeout: 5000, stdio: 'pipe' },
            ).toString().trim();
            if (out) { containerId = out; break; }
          } catch { /* retry */ }
        }

        if (containerId) {
          await prisma.instance.update({ where: { id }, data: { status: 'running', containerId } });
          request.log.info(`Instance ${instance.name} started successfully`);
        } else {
          request.log.warn(`Instance ${instance.name} — container not running after start`);
          await prisma.instance.update({ where: { id }, data: { status: 'error' } }).catch(() => {});
        }
      };

      doStart().catch(async (err) => {
        request.log.error(err, `Start failed for ${instance.name}`);
        await prisma.instance.update({ where: { id }, data: { status: 'error' } }).catch(() => {});
      });

      return reply.send({ ok: true, message: `Instance ${instance.name} starting` });
    } catch (err: any) {
      request.log.error(err, 'Failed to start instance');
      return reply.code(500).send({ error: `Start failed: ${err.message}` });
    }
  });

  /**
   * POST /api/instances/:id/stop — Stop instance container.
   * Uses a grace period (SIGTERM then wait) so the agent can flush session/memory to disk
   * before exit. State is stored in the agent-state volume and restored on next start.
   */
  app.post('/api/instances/:id/stop', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    try {
      const instance = await prisma.instance.findUnique({ where: { id } });
      if (!instance) return reply.code(404).send({ error: 'Instance not found' });

      await prisma.instance.update({
        where: { id },
        data: { status: 'stopped', containerId: null },
      });

      const isProxy = instance.instanceType === 'proxy';
      const dir = getInstanceDir(id);

      if (isProxy) {
        exec(`cd "${dir}" && docker compose stop -t 5`, { timeout: 15_000 }, (err) => {
          if (err) request.log.warn({ name: instance.name, err: err.message }, 'Proxy stop warning');
        });
      } else {
        const containerName = `wooblay-agent-${instance.name}`;
        const proxyName = `wooblay-mcp-proxy-${instance.name}`;
        exec(`docker stop -t 25 "${containerName}" 2>/dev/null; docker stop -t 5 "${proxyName}" 2>/dev/null`, { timeout: 40_000 }, (err) => {
          if (err) request.log.warn({ containerName, err: err.message }, 'Background stop warning');
        });
      }

      return reply.send({ ok: true, message: `Instance ${instance.name} stopping` });
    } catch (err: any) {
      request.log.error(err, 'Failed to stop instance');
      return reply.code(500).send({ error: `Stop failed: ${err.message}` });
    }
  });

  /**
   * POST /api/instances/:id/restart — Restart instance container.
   */
  app.post('/api/instances/:id/restart', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    try {
      const instance = await prisma.instance.findUnique({ where: { id } });
      if (!instance) return reply.code(404).send({ error: 'Instance not found' });

      const dir = getInstanceDir(id);
      if (!existsSync(dir)) {
        return reply.code(400).send({ error: 'Instance directory not found' });
      }

      await prisma.instance.update({ where: { id }, data: { status: 'restarting' } });

      const containerName = instance.instanceType === 'proxy'
        ? `wooblay-mcp-proxy-${instance.name}`
        : `wooblay-agent-${instance.name}`;

      const doRestart = async () => {
        try {
          execSync(`cd "${dir}" && docker compose stop -t 15`, { timeout: 30_000, stdio: 'pipe' });
        } catch {
          request.log.warn({ containerName }, 'Graceful stop timed out — force killing');
          try {
            execSync(`cd "${dir}" && docker compose kill`, { timeout: 10_000, stdio: 'pipe' });
          } catch { /* best effort */ }
        }

        try {
          execSync(`cd "${dir}" && docker compose up -d`, { timeout: 120_000, stdio: 'pipe' });
        } catch (upErr) {
          request.log.error(upErr, `docker compose up -d failed for ${instance.name}`);
          await prisma.instance.update({ where: { id }, data: { status: 'error' } }).catch(() => {});
          return;
        }

        // Poll for container readiness (up to 30s)
        let containerId: string | null = null;
        for (let attempt = 0; attempt < 6; attempt++) {
          await new Promise((r) => setTimeout(r, 5000));
          try {
            const out = execSync(
              `docker ps -q --filter "name=^${containerName}$" --filter "status=running"`,
              { timeout: 5000, stdio: 'pipe' },
            ).toString().trim();
            if (out) { containerId = out; break; }
          } catch { /* retry */ }
        }

        if (containerId) {
          await prisma.instance.update({ where: { id }, data: { status: 'running', containerId } });
          request.log.info(`Instance ${instance.name} restarted successfully`);
        } else {
          request.log.warn(`Instance ${instance.name} — container not running after restart`);
          await prisma.instance.update({ where: { id }, data: { status: 'error' } }).catch(() => {});
        }
      };

      doRestart().catch(async (err) => {
        request.log.error(err, `Restart failed for ${instance.name}`);
        await prisma.instance.update({ where: { id }, data: { status: 'error' } }).catch(() => {});
      });

      return reply.send({ ok: true, message: `Instance ${instance.name} restarting` });
    } catch (err: any) {
      request.log.error(err, 'Failed to restart instance');
      return reply.code(500).send({ error: `Restart failed: ${err.message}` });
    }
  });

  /**
   * DELETE /api/instances/:id — Teardown instance.
   */
  app.delete('/api/instances/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    try {
      const instance = await prisma.instance.findUnique({ where: { id } });
      if (!instance) return reply.code(404).send({ error: 'Instance not found' });

      // Stop and remove agent + proxy sidecar containers
      const containerName = `wooblay-agent-${instance.name}`;
      const proxyName = `wooblay-mcp-proxy-${instance.name}`;
      try {
        execSync(
          `docker stop "${containerName}" "${proxyName}" 2>/dev/null; docker rm "${containerName}" "${proxyName}" 2>/dev/null`,
          { timeout: 15_000, stdio: 'pipe' },
        );
      } catch { }

      // Clean up instance directory
      const dir = getInstanceDir(id);
      if (existsSync(dir)) {
        try { rmSync(dir, { recursive: true, force: true }); } catch { }
      }

      await prisma.instance.delete({ where: { id } });

      return reply.code(204).send();
    } catch (err) {
      request.log.error(err, 'Failed to delete instance');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/instances/:id/logs — Get container logs.
   */
  app.get('/api/instances/:id/logs', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const { tail } = request.query as { tail?: string };

    try {
      const check = await checkInstanceOwnership(request, reply, id);
      if (!check) return;
      const { instance } = check;

      const tailNum = tail ? parseInt(tail, 10) : 100;
      let logs = '';

      try {
        logs = execSync(
          `docker logs --tail ${tailNum} wooblay-agent-${instance.name} 2>&1`,
          { timeout: 10_000, stdio: 'pipe' },
        ).toString();
      } catch (err: any) {
        logs = err.stdout?.toString() ?? err.stderr?.toString() ?? 'No logs available';
      }

      return reply.send({ logs });
    } catch (err) {
      request.log.error(err, 'Failed to get instance logs');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  // ── Instance Secrets (agent-visible env vars) ─────────────────────────

  /**
   * GET /api/instances/:id/secrets — List instance env var keys (values are never returned).
   */
  app.get('/api/instances/:id/secrets', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const ownerCheck = await checkInstanceOwnership(request, reply, id);
      if (!ownerCheck) return;
      const instance = await prisma.instance.findUnique({ where: { id }, select: { secrets: true } });
      if (!instance) return reply.code(404).send({ error: 'Instance not found' });

      let secrets: { key: string }[] = [];
      if (instance.secrets) {
        try {
          const parsed = JSON.parse(instance.secrets) as { key: string; encryptedValue: string }[];
          secrets = parsed.map(s => ({ key: s.key }));
        } catch { /* ignore corrupt data */ }
      }

      return reply.send({ secrets });
    } catch (err: any) {
      request.log.error({ err }, 'Failed to list instance secrets');
      return reply.code(500).send({ error: 'Failed to list secrets', detail: err.message });
    }
  });

  /**
   * POST /api/instances/:id/secrets — Add an env var to the instance.
   * Body: { key: string, value: string }
   */
  app.post('/api/instances/:id/secrets', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const ownerCheck = await checkInstanceOwnership(request, reply, id);
      if (!ownerCheck) return;

      const body = request.body as { key?: string; value?: string };

      if (!body.key || !body.value) {
        return reply.code(400).send({ error: 'key and value are required' });
      }

      const normalizedKey = body.key.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
      if (!normalizedKey) return reply.code(400).send({ error: 'Invalid key name' });

      const instance = await prisma.instance.findUnique({ where: { id }, select: { secrets: true } });
      if (!instance) return reply.code(404).send({ error: 'Instance not found' });

      let secrets: { key: string; encryptedValue: string }[] = [];
      if (instance.secrets) {
        try { secrets = JSON.parse(instance.secrets); } catch { /* ignore */ }
      }

      // Upsert — replace if key already exists
      secrets = secrets.filter(s => s.key !== normalizedKey);

      // Import envelope encrypt
      const { envelopeEncrypt } = await import('../services/vault.js');
      secrets.push({ key: normalizedKey, encryptedValue: envelopeEncrypt(body.value) });

      await prisma.instance.update({
        where: { id },
        data: { secrets: JSON.stringify(secrets) },
      });

      return reply.code(201).send({ key: normalizedKey });
    } catch (err: any) {
      request.log.error({ err }, 'Failed to add instance secret');
      return reply.code(500).send({ error: 'Failed to add secret', detail: err.message });
    }
  });

  /**
   * DELETE /api/instances/:id/secrets/:key — Remove an env var.
   */
  app.delete('/api/instances/:id/secrets/:key', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id, key } = request.params as { id: string; key: string };
      const ownerCheck = await checkInstanceOwnership(request, reply, id);
      if (!ownerCheck) return;

      const instance = await prisma.instance.findUnique({ where: { id }, select: { secrets: true } });
      if (!instance) return reply.code(404).send({ error: 'Instance not found' });

      let secrets: { key: string; encryptedValue: string }[] = [];
      if (instance.secrets) {
        try { secrets = JSON.parse(instance.secrets); } catch { /* ignore */ }
      }

      const before = secrets.length;
      secrets = secrets.filter(s => s.key !== key);
      if (secrets.length === before) {
        return reply.code(404).send({ error: `Secret ${key} not found` });
      }

      await prisma.instance.update({
        where: { id },
        data: { secrets: JSON.stringify(secrets) },
      });

      return reply.code(204).send();
    } catch (err: any) {
      request.log.error({ err }, 'Failed to delete instance secret');
      return reply.code(500).send({ error: 'Failed to delete secret', detail: err.message });
    }
  });

  // ── MCP Server Configs ─────────────────────────────────────────────────
  // Per-instance MCP server configurations. The proxy connects to each,
  // discovers tools, and gates every call. Credentials are resolved from
  // vault Connections at L3 exec time — never stored here, never exposed
  // to the agent. Only connection IDs (references) are stored.

  /**
   * GET /api/instances/:id/mcp-servers — List configured MCP servers.
   */
  app.get('/api/instances/:id/mcp-servers', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const check = await checkInstanceOwnership(request, reply, id);
      if (!check) return;

      const servers = await prisma.mcpServerConfig.findMany({
        where: { instanceId: id },
        orderBy: { createdAt: 'asc' },
      });

      // Resolve connection names for display
      const allConnectionIds = [...new Set(servers.flatMap(s => {
        try { return JSON.parse(s.connectionIds) as string[]; } catch { return []; }
      }))];
      const connections = allConnectionIds.length > 0
        ? await prisma.connection.findMany({
            where: { id: { in: allConnectionIds } },
            select: { id: true, name: true, provider: true, status: true },
          })
        : [];
      const connMap = new Map(connections.map(c => [c.id, c]));

      return reply.send(servers.map(s => {
        const connIds: string[] = (() => { try { return JSON.parse(s.connectionIds); } catch { return []; } })();
        return {
          ...s,
          connectionIds: connIds,
          connections: connIds.map(cid => connMap.get(cid)).filter(Boolean),
          args: s.args ? JSON.parse(s.args) : null,
        };
      }));
    } catch (err: any) {
      request.log.error(err, 'Failed to list MCP servers');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * POST /api/instances/:id/mcp-servers — Add an MCP server config.
   * Body: { name, transport, source, args?, connectionIds?, enabled? }
   */
  app.post('/api/instances/:id/mcp-servers', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const check = await checkInstanceOwnership(request, reply, id);
      if (!check) return;

      const body = request.body as {
        name?: string;
        transport?: string;
        source?: string;
        args?: string[];
        connectionIds?: string[];
        enabled?: boolean;
      };

      if (!body.name || !body.transport || !body.source) {
        return reply.code(400).send({ error: 'name, transport, and source are required' });
      }

      if (!['stdio', 'sse'].includes(body.transport)) {
        return reply.code(400).send({ error: 'transport must be "stdio" or "sse"' });
      }

      // ── Input validation: prevent injection and SSRF ────────────────
      const name = body.name.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
      if (!name || name.length > 64 || /^-|-$|--/.test(name)) {
        return reply.code(400).send({ error: 'name must be 1-64 chars, lowercase alphanumeric + hyphens, no leading/trailing/double hyphens' });
      }

      const source = body.source.trim();
      if (body.transport === 'sse') {
        // SSRF prevention: only allow HTTPS URLs for SSE transport
        let url: URL;
        try { url = new URL(source); } catch {
          return reply.code(400).send({ error: 'SSE source must be a valid URL' });
        }
        if (url.protocol !== 'https:') {
          return reply.code(400).send({ error: 'SSE source must use HTTPS' });
        }
        // Block private/internal IPs
        const host = url.hostname;
        if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.local') ||
            host.startsWith('10.') || host.startsWith('192.168.') ||
            /^172\.(1[6-9]|2\d|3[01])\./.test(host)) {
          return reply.code(400).send({ error: 'SSE source must be a public URL (no internal/private addresses)' });
        }
      } else {
        // stdio: validate source is a known-safe npm package pattern or an absolute path
        // Prevent shell injection — only allow: alphanumeric, @, /, -, _, .
        if (!/^[a-zA-Z0-9@/_.\-\s]+$/.test(source)) {
          return reply.code(400).send({ error: 'stdio source contains disallowed characters. Use an npm package name (e.g. npx @modelcontextprotocol/server-github) or absolute path.' });
        }
        // Block obvious shell injection attempts
        if (/[;&|`$(){}[\]!#~<>\\'"]/g.test(source)) {
          return reply.code(400).send({ error: 'stdio source contains shell metacharacters' });
        }
      }

      // Validate args don't contain shell metacharacters
      if (body.args) {
        for (const arg of body.args) {
          if (/[;&|`$(){}[\]!#~<>\\]/g.test(arg)) {
            return reply.code(400).send({ error: `Argument contains disallowed shell characters: ${arg.slice(0, 20)}` });
          }
        }
      }

      // Validate referenced connections exist and are active
      const connectionIds = body.connectionIds ?? [];
      if (connectionIds.length > 0) {
        const existing = await prisma.connection.findMany({
          where: { id: { in: connectionIds }, status: 'active' },
          select: { id: true },
        });
        const found = new Set(existing.map(c => c.id));
        const missing = connectionIds.filter(cid => !found.has(cid));
        if (missing.length > 0) {
          return reply.code(400).send({
            error: `Connection(s) not found or inactive: ${missing.join(', ')}. Add them on the Credentials page first.`,
          });
        }
      }

      const server = await prisma.mcpServerConfig.create({
        data: {
          instanceId: id,
          name,
          transport: body.transport,
          source,
          args: body.args ? JSON.stringify(body.args) : null,
          connectionIds: JSON.stringify(connectionIds),
          enabled: body.enabled ?? true,
        },
      });

      request.log.info({ instanceId: id, serverId: server.id, name: server.name }, 'MCP server config added');

      return reply.code(201).send({
        ...server,
        connectionIds,
        args: server.args ? JSON.parse(server.args) : null,
      });
    } catch (err: any) {
      if (err.code === 'P2002') {
        return reply.code(409).send({ error: 'MCP server with this name already exists for this instance' });
      }
      request.log.error(err, 'Failed to add MCP server');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * PATCH /api/instances/:id/mcp-servers/:serverId — Update MCP server config.
   */
  app.patch('/api/instances/:id/mcp-servers/:serverId', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id, serverId } = request.params as { id: string; serverId: string };
      const check = await checkInstanceOwnership(request, reply, id);
      if (!check) return;

      const existing = await prisma.mcpServerConfig.findFirst({
        where: { id: serverId, instanceId: id },
      });
      if (!existing) return reply.code(404).send({ error: 'MCP server config not found' });

      const body = request.body as {
        name?: string;
        transport?: string;
        source?: string;
        args?: string[];
        connectionIds?: string[];
        enabled?: boolean;
      };

      if (body.transport && !['stdio', 'sse'].includes(body.transport)) {
        return reply.code(400).send({ error: 'transport must be "stdio" or "sse"' });
      }

      // Validate name if provided
      if (body.name !== undefined) {
        const name = body.name.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
        if (!name || name.length > 64 || /^-|-$|--/.test(name)) {
          return reply.code(400).send({ error: 'name must be 1-64 chars, lowercase alphanumeric + hyphens' });
        }
        body.name = name;
      }

      // Validate source if provided
      if (body.source !== undefined) {
        const transport = body.transport ?? existing.transport;
        const source = body.source.trim();
        if (transport === 'sse') {
          let url: URL;
          try { url = new URL(source); } catch {
            return reply.code(400).send({ error: 'SSE source must be a valid URL' });
          }
          if (url.protocol !== 'https:') {
            return reply.code(400).send({ error: 'SSE source must use HTTPS' });
          }
          const host = url.hostname;
          if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.local') ||
              host.startsWith('10.') || host.startsWith('192.168.') ||
              /^172\.(1[6-9]|2\d|3[01])\./.test(host)) {
            return reply.code(400).send({ error: 'SSE source must be a public URL (no internal/private addresses)' });
          }
        } else {
          if (!/^[a-zA-Z0-9@/_.\-\s]+$/.test(source)) {
            return reply.code(400).send({ error: 'stdio source contains disallowed characters' });
          }
          if (/[;&|`$(){}[\]!#~<>\\'"]/g.test(source)) {
            return reply.code(400).send({ error: 'stdio source contains shell metacharacters' });
          }
        }
      }

      // Validate args if provided
      if (body.args) {
        for (const arg of body.args) {
          if (/[;&|`$(){}[\]!#~<>\\]/g.test(arg)) {
            return reply.code(400).send({ error: `Argument contains disallowed shell characters: ${arg.slice(0, 20)}` });
          }
        }
      }

      // Validate new connection references
      if (body.connectionIds && body.connectionIds.length > 0) {
        const conns = await prisma.connection.findMany({
          where: { id: { in: body.connectionIds }, status: 'active' },
          select: { id: true },
        });
        const found = new Set(conns.map(c => c.id));
        const missing = body.connectionIds.filter(cid => !found.has(cid));
        if (missing.length > 0) {
          return reply.code(400).send({ error: `Connection(s) not found or inactive: ${missing.join(', ')}` });
        }
      }

      const updated = await prisma.mcpServerConfig.update({
        where: { id: serverId },
        data: {
          ...(body.name !== undefined && { name: body.name.trim() }),
          ...(body.transport !== undefined && { transport: body.transport }),
          ...(body.source !== undefined && { source: body.source.trim() }),
          ...(body.args !== undefined && { args: JSON.stringify(body.args) }),
          ...(body.connectionIds !== undefined && { connectionIds: JSON.stringify(body.connectionIds) }),
          ...(body.enabled !== undefined && { enabled: body.enabled }),
        },
      });

      return reply.send({
        ...updated,
        connectionIds: JSON.parse(updated.connectionIds),
        args: updated.args ? JSON.parse(updated.args) : null,
      });
    } catch (err: any) {
      if (err.code === 'P2002') {
        return reply.code(409).send({ error: 'MCP server with this name already exists for this instance' });
      }
      request.log.error(err, 'Failed to update MCP server');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * DELETE /api/instances/:id/mcp-servers/:serverId — Remove MCP server config.
   */
  app.delete('/api/instances/:id/mcp-servers/:serverId', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id, serverId } = request.params as { id: string; serverId: string };
      const check = await checkInstanceOwnership(request, reply, id);
      if (!check) return;

      const existing = await prisma.mcpServerConfig.findFirst({
        where: { id: serverId, instanceId: id },
      });
      if (!existing) return reply.code(404).send({ error: 'MCP server config not found' });

      await prisma.mcpServerConfig.delete({ where: { id: serverId } });

      request.log.info({ instanceId: id, serverId, name: existing.name }, 'MCP server config removed');
      return reply.code(204).send();
    } catch (err: any) {
      request.log.error(err, 'Failed to delete MCP server');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  // ── ClawHub Skills ──────────────────────────────────────────────────────
  // Community-developed OpenClaw skills. Installed into the agent container
  // via `clawhub` CLI. Skills take effect on the next OpenClaw session
  // (restart or hot-reload).

  /**
   * GET /api/instances/:id/skills — List installed skills.
   * Reads the skills directory from the host-mounted volume. Works even when the
   * agent container is stopped — skills are persisted on the host filesystem.
   */
  app.get('/api/instances/:id/skills', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const check = await checkInstanceOwnership(request, reply, id);
      if (!check) return;

      const skillsDir = join(getInstanceDir(id), AGENT_STATE_DIR, 'skills');
      if (!existsSync(skillsDir)) return reply.send([]);

      let entries: string[];
      try {
        const { readdirSync, statSync } = await import('fs');
        entries = readdirSync(skillsDir).filter(name => {
          try { return statSync(join(skillsDir, name)).isDirectory(); } catch { return false; }
        });
      } catch {
        return reply.send([]);
      }

      const skills: Array<{
        name: string;
        description: string;
        metadata: Record<string, unknown> | null;
        path: string;
      }> = [];

      for (const name of entries) {
        const skillMdPath = join(skillsDir, name, 'SKILL.md');
        let content = '';
        try {
          content = readFileSync(skillMdPath, 'utf-8').slice(0, 4096);
        } catch { continue; }

        // Parse YAML frontmatter
        let description = '';
        let metadata: Record<string, unknown> | null = null;
        const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
        if (fmMatch) {
          const fm = fmMatch[1];
          const descMatch = fm.match(/^description:\s*(.+)$/m);
          if (descMatch) description = descMatch[1].trim();
          const metaMatch = fm.match(/^metadata:\s*(.+)$/m);
          if (metaMatch) {
            try { metadata = JSON.parse(metaMatch[1]); } catch { /* ignore */ }
          }
        }

        skills.push({ name, description, metadata, path: `/home/agent/.openclaw/skills/${name}/SKILL.md` });
      }

      return reply.send(skills);
    } catch (err: any) {
      request.log.error(err, 'Failed to list skills');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * POST /api/instances/:id/skills/install — Install a skill from ClawHub.
   * Requires a running container (clawhub CLI runs inside it).
   * Body: { slug: string, version?: string }
   */
  app.post('/api/instances/:id/skills/install', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const check = await checkInstanceOwnership(request, reply, id);
      if (!check) return;
      const { instance } = check;

      if (instance.status !== 'running') {
        return reply.code(400).send({ error: 'Agent must be running to install skills. Start the agent first.' });
      }

      const body = request.body as { slug?: string; version?: string };
      if (!body.slug || typeof body.slug !== 'string') {
        return reply.code(400).send({ error: 'slug is required' });
      }

      // Sanitize slug — only allow safe characters
      const slug = body.slug.trim().toLowerCase();
      if (!/^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/.test(slug) || slug.length > 128) {
        return reply.code(400).send({ error: 'Invalid skill slug' });
      }

      const containerName = `wooblay-agent-${instance.name}`;

      // Build the clawhub install command
      let cmd = `clawhub install "${slug}" --no-input`;
      if (body.version) {
        const ver = body.version.trim();
        if (!/^[0-9]+\.[0-9]+\.[0-9]+[a-zA-Z0-9._-]*$/.test(ver)) {
          return reply.code(400).send({ error: 'Invalid version format' });
        }
        cmd += ` --version "${ver}"`;
      }
      cmd += ' --force';

      // Run as agent user inside the container, in the skills directory
      const fullCmd = `docker exec -u agent -w /home/agent/.openclaw/skills "${containerName}" sh -c '${cmd.replace(/'/g, "'\\''")}'`;

      let output = '';
      try {
        output = execSync(fullCmd, { timeout: 60_000, stdio: 'pipe' }).toString();
      } catch (err: any) {
        const stderr = err.stderr?.toString() ?? err.stdout?.toString() ?? '';
        request.log.warn({ slug, stderr }, 'clawhub install failed');
        return reply.code(400).send({
          error: 'Failed to install skill',
          detail: stderr.slice(0, 500) || 'Unknown error — check container logs',
        });
      }

      request.log.info({ instanceId: id, slug, version: body.version }, 'Skill installed from ClawHub');
      return reply.code(201).send({ ok: true, slug, output: output.slice(0, 500) });
    } catch (err: any) {
      request.log.error(err, 'Failed to install skill');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * DELETE /api/instances/:id/skills/:name — Remove an installed skill.
   * Works even when the container is stopped (reads from host volume).
   */
  app.delete('/api/instances/:id/skills/:name', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id, name: skillName } = request.params as { id: string; name: string };
      const check = await checkInstanceOwnership(request, reply, id);
      if (!check) return;

      // Validate skill name — prevent path traversal
      if (!/^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/.test(skillName) || skillName.length > 128) {
        return reply.code(400).send({ error: 'Invalid skill name' });
      }

      const skillPath = join(getInstanceDir(id), AGENT_STATE_DIR, 'skills', skillName);

      if (!existsSync(skillPath)) {
        return reply.code(404).send({ error: `Skill '${skillName}' not found` });
      }

      rmSync(skillPath, { recursive: true, force: true });

      request.log.info({ instanceId: id, skillName }, 'Skill removed');
      return reply.code(204).send();
    } catch (err: any) {
      request.log.error(err, 'Failed to remove skill');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/clawhub/search?q=... — Search ClawHub skill registry.
   * Proxies to the ClawHub public API for skill discovery.
   */
  app.get('/api/clawhub/search', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { q, limit } = request.query as { q?: string; limit?: string };
      if (!q || q.trim().length < 2) {
        return reply.code(400).send({ error: 'Query must be at least 2 characters' });
      }

      const searchLimit = Math.min(parseInt(limit ?? '20', 10) || 20, 50);
      const registryUrl = process.env['CLAWHUB_REGISTRY'] ?? 'https://registry.clawhub.ai';

      const url = `${registryUrl}/api/search?q=${encodeURIComponent(q.trim())}&limit=${searchLimit}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);

      try {
        const res = await fetch(url, {
          signal: controller.signal,
          headers: { 'User-Agent': 'wooblay-gate/1.0' },
        });
        clearTimeout(timeout);

        if (!res.ok) {
          const body = await res.text().catch(() => '');
          request.log.warn({ status: res.status, body: body.slice(0, 200) }, 'ClawHub search failed');
          return reply.code(502).send({ error: 'ClawHub registry returned an error', status: res.status });
        }

        const data = await res.json();
        return reply.send(data);
      } catch (fetchErr: any) {
        clearTimeout(timeout);
        if (fetchErr.name === 'AbortError') {
          return reply.code(504).send({ error: 'ClawHub registry timed out' });
        }
        request.log.warn({ err: fetchErr.message }, 'ClawHub registry unreachable');
        return reply.code(502).send({ error: 'Could not reach ClawHub registry' });
      }
    } catch (err: any) {
      request.log.error(err, 'ClawHub search error');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });
}

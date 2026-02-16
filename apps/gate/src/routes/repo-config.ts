/**
 * Repo Config routes.
 *
 * Per-repo QA recipe configuration: install/test/build commands,
 * timeouts, env vars, risky paths. Supports manual UI config and
 * auto-detection from wooblay.yml in the repo root.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db/client.js';

export async function repoConfigRoutes(app: FastifyInstance): Promise<void> {
  // ── List repo configs ─────────────────────────────────────────────────
  app.get('/api/repo-configs', async (_request: FastifyRequest, reply: FastifyReply) => {
    const configs = await prisma.repoConfig.findMany({
      orderBy: { updatedAt: 'desc' },
    });
    return reply.send(configs.map(serializeConfig));
  });

  // ── Get config for a repo ─────────────────────────────────────────────
  app.get('/api/repo-configs/:repoFullName', async (request: FastifyRequest, reply: FastifyReply) => {
    const { repoFullName } = request.params as { repoFullName: string };
    const decoded = decodeURIComponent(repoFullName);

    const config = await prisma.repoConfig.findUnique({
      where: { repoFullName: decoded },
    });

    if (!config) {
      // Return sensible defaults
      return reply.send({
        repoFullName: decoded,
        installCmd: null,
        testCmd: null,
        buildCmd: null,
        lintCmd: null,
        timeoutSeconds: 300,
        envVars: {},
        riskyPaths: [],
        branch: 'main',
        source: 'default',
        exists: false,
      });
    }

    return reply.send({ ...serializeConfig(config), exists: true });
  });

  // ── Create or update repo config ──────────────────────────────────────
  app.put('/api/repo-configs/:repoFullName', async (request: FastifyRequest, reply: FastifyReply) => {
    const { repoFullName } = request.params as { repoFullName: string };
    const decoded = decodeURIComponent(repoFullName);
    const body = request.body as {
      installCmd?: string;
      testCmd?: string;
      buildCmd?: string;
      lintCmd?: string;
      timeoutSeconds?: number;
      envVars?: Record<string, string>;
      riskyPaths?: string[];
      branch?: string;
    };

    const config = await prisma.repoConfig.upsert({
      where: { repoFullName: decoded },
      create: {
        repoFullName: decoded,
        installCmd: body.installCmd ?? null,
        testCmd: body.testCmd ?? null,
        buildCmd: body.buildCmd ?? null,
        lintCmd: body.lintCmd ?? null,
        timeoutSeconds: body.timeoutSeconds ?? 300,
        envVars: body.envVars ? JSON.stringify(body.envVars) : null,
        riskyPaths: body.riskyPaths ? JSON.stringify(body.riskyPaths) : null,
        branch: body.branch ?? 'main',
        source: 'manual',
      },
      update: {
        installCmd: body.installCmd ?? undefined,
        testCmd: body.testCmd ?? undefined,
        buildCmd: body.buildCmd ?? undefined,
        lintCmd: body.lintCmd ?? undefined,
        timeoutSeconds: body.timeoutSeconds ?? undefined,
        envVars: body.envVars ? JSON.stringify(body.envVars) : undefined,
        riskyPaths: body.riskyPaths ? JSON.stringify(body.riskyPaths) : undefined,
        branch: body.branch ?? undefined,
        source: 'manual',
      },
    });

    return reply.send(serializeConfig(config));
  });

  // ── Import from wooblay.yml ───────────────────────────────────────────
  app.post('/api/repo-configs/:repoFullName/import', async (request: FastifyRequest, reply: FastifyReply) => {
    const { repoFullName } = request.params as { repoFullName: string };
    const decoded = decodeURIComponent(repoFullName);
    const body = request.body as { wooblayYml: string };

    if (!body.wooblayYml) {
      return reply.code(400).send({ error: 'wooblayYml content is required' });
    }

    try {
      const parsed = parseWooblayYml(body.wooblayYml);

      const config = await prisma.repoConfig.upsert({
        where: { repoFullName: decoded },
        create: { repoFullName: decoded, ...parsed, source: 'wooblay_yml' },
        update: { ...parsed, source: 'wooblay_yml' },
      });

      return reply.send(serializeConfig(config));
    } catch (err: any) {
      return reply.code(400).send({ error: `Failed to parse wooblay.yml: ${err.message}` });
    }
  });

  // ── Delete repo config ────────────────────────────────────────────────
  app.delete('/api/repo-configs/:repoFullName', async (request: FastifyRequest, reply: FastifyReply) => {
    const { repoFullName } = request.params as { repoFullName: string };
    const decoded = decodeURIComponent(repoFullName);

    await prisma.repoConfig.delete({ where: { repoFullName: decoded } }).catch(() => {});
    return reply.code(204).send();
  });
}

// ── wooblay.yml parser ──────────────────────────────────────────────────

function parseWooblayYml(content: string): Record<string, unknown> {
  // Simple key: value parser for wooblay.yml
  // Format:
  //   install: npm ci
  //   test: npm test
  //   build: npm run build
  //   lint: npm run lint
  //   timeout: 300
  //   branch: main
  //   risky_paths:
  //     - src/auth/
  //     - migrations/
  const result: Record<string, unknown> = {};
  const lines = content.split('\n');
  let currentList: string[] | null = null;
  let currentKey: string | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    if (trimmed.startsWith('- ') && currentList !== null) {
      currentList.push(trimmed.slice(2).trim());
      continue;
    }

    // Flush current list
    if (currentList !== null && currentKey !== null) {
      result[currentKey] = JSON.stringify(currentList);
      currentList = null;
      currentKey = null;
    }

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;

    const key = trimmed.slice(0, colonIdx).trim();
    const value = trimmed.slice(colonIdx + 1).trim();

    const keyMap: Record<string, string> = {
      install: 'installCmd',
      test: 'testCmd',
      build: 'buildCmd',
      lint: 'lintCmd',
      timeout: 'timeoutSeconds',
      branch: 'branch',
      risky_paths: 'riskyPaths',
    };

    const dbKey = keyMap[key] ?? key;

    if (!value) {
      // Start of a list
      currentList = [];
      currentKey = dbKey;
    } else if (dbKey === 'timeoutSeconds') {
      result[dbKey] = parseInt(value, 10) || 300;
    } else {
      result[dbKey] = value;
    }
  }

  // Flush remaining list
  if (currentList !== null && currentKey !== null) {
    result[currentKey] = JSON.stringify(currentList);
  }

  return result;
}

// ── Serialization ───────────────────────────────────────────────────────

function serializeConfig(config: any) {
  return {
    ...config,
    envVars: config.envVars ? JSON.parse(config.envVars) : {},
    riskyPaths: config.riskyPaths ? JSON.parse(config.riskyPaths) : [],
  };
}

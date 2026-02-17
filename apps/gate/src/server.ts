/**
 * Wooblay Gate — main entry point.
 *
 * Bootstraps the Fastify server, registers all middleware and route modules,
 * and starts listening on the configured port.
 *
 * Supports two modes:
 *   - **platform** (PLATFORM_MODE=true): Central SaaS API with Clerk auth, user management,
 *     billing, instance orchestration, and synced receipt aggregation.
 *   - **instance** (default): Per-tenant runtime with agent signature auth, policy eval,
 *     tool gating, and local receipts.
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';

import { config } from './config.js';
import { authPlugin } from './middleware/auth.js';
import { clerkAuthPlugin } from './middleware/clerk-auth.js';
import { rateLimitPlugin } from './middleware/rate-limit.js';
import { registerStatic } from './static.js';

// Route modules — shared (both modes)
import { healthRoutes } from './routes/health.js';
import { toolRoutes } from './routes/tool.js';
import { approvalRoutes } from './routes/approvals.js';
import { receiptRoutes } from './routes/receipts.js';
import { statsRoutes } from './routes/stats.js';
import { executionRoutes } from './routes/executions.js';
import { activityRoutes } from './routes/activity.js';
import { instanceRoutes } from './routes/instances.js';
import { policyRoutes } from './routes/policies.js';
import { flagRoutes } from './routes/flags.js';
import { auditRoutes } from './routes/audit.js';
import { missionRoutes } from './routes/mission.js';
import { webhookRoutes } from './routes/webhooks.js';
import { aiAnalysisRoutes } from './routes/ai-analysis.js';
import { workspaceRoutes } from './routes/workspace.js';

// MVP route modules
import { operationRoutes } from './routes/operations.js';
import { runRoutes } from './routes/runs.js';
import { proposalRoutes } from './routes/proposals.js';
import { gatewayRoutes } from './routes/gateway.js';
import { sensorRoutes } from './routes/sensors.js';
import { insightsRoutes } from './routes/insights.js';
import { caseFileRoutes } from './routes/case-file.js';
import { connectionRoutes } from './routes/connections.js';
import { repoConfigRoutes } from './routes/repo-config.js';
import { verificationRoutes } from './routes/verifications.js';
import { workspaceRunnerRoutes } from './routes/workspace-runner.js';
import { apiKeyRoutes } from './routes/api-keys.js';

// Route modules — platform mode only
import { userRoutes } from './routes/users.js';
import { syncRoutes } from './routes/sync.js';
import { sseRoutes } from './routes/sse.js';

/**
 * Build and configure the Fastify application.
 * Exported for testing — call `buildApp()` then `app.inject(...)`.
 */
export async function buildApp() {
  const app = Fastify({
    logger: {
      level: config.NODE_ENV === 'production' ? 'info' : 'debug',
    },
  });

  // ── Global plugins ──────────────────────────────────────────────────
  await app.register(cors, {
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Agent-Pubkey', 'X-Request-Signature'],
  });

  // ── Middleware ───────────────────────────────────────────────────────
  // Rate limiting (all API routes)
  await app.register(rateLimitPlugin);
  // Agent signature auth (instance mode — agent-to-gate requests)
  await app.register(authPlugin);
  // Clerk JWT auth (platform mode — browser-to-API requests)
  await app.register(clerkAuthPlugin);

  // ── Routes (both modes) ─────────────────────────────────────────────
  await app.register(healthRoutes);
  await app.register(toolRoutes);
  await app.register(approvalRoutes);
  await app.register(receiptRoutes);
  await app.register(statsRoutes);
  await app.register(executionRoutes);
  await app.register(activityRoutes);
  // Workspace routes BEFORE instance routes (more specific /files path first)
  await app.register(workspaceRoutes);
  await app.register(instanceRoutes);
  await app.register(policyRoutes);
  await app.register(flagRoutes);
  await app.register(auditRoutes);
  await app.register(missionRoutes);
  await app.register(webhookRoutes);
  await app.register(aiAnalysisRoutes);

  // ── MVP Routes ────────────────────────────────────────────────────────
  await app.register(operationRoutes);
  await app.register(runRoutes);
  await app.register(proposalRoutes);
  await app.register(gatewayRoutes);
  await app.register(sensorRoutes);
  await app.register(insightsRoutes);
  await app.register(caseFileRoutes);
  await app.register(connectionRoutes);
  await app.register(repoConfigRoutes);
  await app.register(verificationRoutes);
  await app.register(workspaceRunnerRoutes);
  await app.register(apiKeyRoutes);

  // ── Routes (platform mode only) ─────────────────────────────────────
  await app.register(userRoutes);
  await app.register(syncRoutes);
  await app.register(sseRoutes);

  // ── Static UI ───────────────────────────────────────────────────────
  await registerStatic(app);

  return app;
}

// ── Start ───────────────────────────────────────────────────────────────

import { prisma } from './db/client.js';

async function start() {
  const app = await buildApp();

  // Seed default policies if the table is empty
  try {
    const { seedDefaultPolicies } = await import('./db/seed-policies.js');
    const seeded = await seedDefaultPolicies(prisma);
    if (seeded > 0) {
      console.log(`[seed] Created ${seeded} default policy rules (balanced preset)`);
    }
  } catch (err) {
    console.error('[seed] Failed to seed default policies:', err);
  }

  // Seed default beta coupon in platform mode
  if (config.PLATFORM_MODE) {
    try {
      const { seedDefaultCoupon } = await import('./db/seed-coupons.js');
      const created = await seedDefaultCoupon(prisma);
      if (created) {
        console.log('[seed] Created default beta coupon: WOOBLAY-BETA-2026');
      }
    } catch (err) {
      console.error('[seed] Failed to seed default coupon:', err);
    }
  }


  try {
    await app.listen({ port: config.PORT, host: '0.0.0.0' });
    app.log.info(`Wooblay Gate listening on port ${config.PORT}`);
  } catch (err) {
    app.log.fatal(err, 'Failed to start Wooblay Gate');
    process.exit(1);
  }
}

start();

/**
 * Wooblay Gate — main entry point.
 *
 * Bootstraps the Fastify server, registers all middleware and route modules,
 * and starts listening on the configured port.
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';

import { config } from './config.js';
import { authPlugin } from './middleware/auth.js';
import { registerStatic } from './static.js';

// Route modules (MVP only)
import { healthRoutes } from './routes/health.js';
import { toolRoutes } from './routes/tool.js';
import { approvalRoutes } from './routes/approvals.js';
import { receiptRoutes } from './routes/receipts.js';
import { statsRoutes } from './routes/stats.js';
import { executionRoutes } from './routes/executions.js';
import { activityRoutes } from './routes/activity.js';
import { instanceRoutes } from './routes/instances.js';

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
  await app.register(cors, { origin: true });

  // ── Middleware ───────────────────────────────────────────────────────
  await app.register(authPlugin);

  // ── Routes (MVP) ────────────────────────────────────────────────────
  await app.register(healthRoutes);
  await app.register(toolRoutes);
  await app.register(approvalRoutes);
  await app.register(receiptRoutes);
  await app.register(statsRoutes);
  await app.register(executionRoutes);
  await app.register(activityRoutes);
  await app.register(instanceRoutes);

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

  try {
    await app.listen({ port: config.PORT, host: '0.0.0.0' });
    app.log.info(`Wooblay Gate listening on port ${config.PORT}`);
  } catch (err) {
    app.log.fatal(err, 'Failed to start Wooblay Gate');
    process.exit(1);
  }
}

start();

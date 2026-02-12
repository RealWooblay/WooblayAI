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

// Route modules
import { healthRoutes } from './routes/health.js';
import { toolRoutes } from './routes/tool.js';
import { approvalRoutes } from './routes/approvals.js';
import { receiptRoutes } from './routes/receipts.js';
import { policyRoutes } from './routes/policies.js';
import { agentRoutes } from './routes/agents.js';
import { scoreRoutes } from './routes/scores.js';
import { statsRoutes } from './routes/stats.js';
import { checkpointRoutes } from './routes/checkpoints.js';
import { eventRoutes } from './routes/events.js';
import { auditRoutes } from './routes/audit.js';
import { adapterRoutes } from './routes/adapters.js';
import { executionRoutes } from './routes/executions.js';
import { analysisRoutes } from './routes/analysis.js';
import { activityRoutes } from './routes/activity.js';
import { sessionRoutes } from './routes/sessions.js';
import { runtimeRoutes } from './routes/runtime.js';
import { chatRoutes } from './routes/chat.js';
import { instanceRoutes } from './routes/instances.js';
import { githubWebhookRoutes } from './routes/github-webhook.js';
import { githubApiRoutes } from './routes/github-api.js';

// Analyzer event listeners
import { eventBus } from './events/bus.js';
import { analyzeReceipt, analyzeTask } from './engine/analyzer/index.js';

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

  // ── Routes ──────────────────────────────────────────────────────────
  await app.register(healthRoutes);
  await app.register(toolRoutes);
  await app.register(approvalRoutes);
  await app.register(receiptRoutes);
  await app.register(policyRoutes);
  await app.register(agentRoutes);
  await app.register(scoreRoutes);
  await app.register(statsRoutes);
  await app.register(checkpointRoutes);
  await app.register(eventRoutes);
  await app.register(auditRoutes);
  await app.register(adapterRoutes);
  await app.register(executionRoutes);
  await app.register(analysisRoutes);
  await app.register(activityRoutes);
  await app.register(sessionRoutes);
  await app.register(runtimeRoutes);

  // ── Chat proxy ──────────────────────────────────────────────────
  await app.register(chatRoutes);

  // ── Instance management ────────────────────────────────────────
  await app.register(instanceRoutes);

  // ── GitHub App ────────────────────────────────────────────────────
  await app.register(githubWebhookRoutes);
  await app.register(githubApiRoutes);

  // ── Static UI ───────────────────────────────────────────────────────
  await registerStatic(app);

  return app;
}

// ── Start ───────────────────────────────────────────────────────────────

import { prisma } from './db/client.js';

function registerAnalyzerListeners() {
  // On receipt.created → run receipt-level analysis
  eventBus.on('receipt.created', (event) => {
    if (event.type !== 'receipt.created') return;
    const { receiptId } = event.data;
    analyzeReceipt(prisma, receiptId).catch((err) => {
      console.error('[analyzer] Receipt analysis failed for', receiptId, err);
    });
  });

  // On score.created → run task-level analysis
  eventBus.on('score.created', (event) => {
    if (event.type !== 'score.created') return;
    const { taskId, agentPubkey } = event.data;
    analyzeTask(prisma, taskId, agentPubkey).catch((err) => {
      console.error('[analyzer] Task analysis failed for', taskId, err);
    });
  });
}

async function start() {
  const app = await buildApp();

  // Register analyzer event listeners
  registerAnalyzerListeners();

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

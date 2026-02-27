#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { setup } from './commands/setup.js';
import { status } from './commands/status.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));

const program = new Command();

program
  .name('wooblay')
  .description('Wooblay CLI – configure agents, check status, manage integrations')
  .version(pkg.version);

// ── Setup (default command) ─────────────────────────────────────────
program
  .command('setup', { isDefault: true })
  .description('Configure all detected AI agents to use Wooblay (one command, all agents)')
  .option('--api-key <key>', 'Wooblay API key (wbl_ak_...)')
  .option('--endpoint <url>', 'Wooblay Gate URL', 'https://gate.wooblay.com')
  .option('--instance-id <id>', 'Proxy instance ID')
  .action(async (opts) => {
    await setup({ apiKey: opts.apiKey, endpoint: opts.endpoint, instanceId: opts.instanceId });
  });

// ── Status ──────────────────────────────────────────────────────────
program
  .command('status')
  .description('Check Gate health status')
  .option('--tenant <name>', 'Tenant name (defaults to local)')
  .action(async (opts) => {
    await status(opts);
  });

// ── Init (local dev setup) ──────────────────────────────────────────
program
  .command('init')
  .description('Initialize local development environment')
  .action(async () => {
    const { init } = await import('./commands/init.js');
    await init();
  });

// ── Dev ─────────────────────────────────────────────────────────────
program
  .command('dev')
  .description('Start local development environment')
  .option('--sqlite', 'Use SQLite instead of Postgres')
  .action(async (opts) => {
    const { dev } = await import('./commands/dev.js');
    await dev(opts);
  });

// ── Enable adapter integration ──────────────────────────────────────
program
  .command('enable <framework>')
  .description('Enable Wooblay supervision for an agent framework (openclaw, mcp, generic)')
  .option('--gate-url <url>', 'Wooblay Gate URL', 'http://localhost:4800')
  .action(async (framework, opts) => {
    const { enable } = await import('./commands/enable.js');
    await enable(framework, { gateUrl: opts.gateUrl });
  });

// ── Disable adapter integration ────────────────────────────────────
program
  .command('disable <framework>')
  .description('Disable Wooblay supervision for an agent framework')
  .action(async (framework) => {
    const { disable } = await import('./commands/disable.js');
    await disable(framework);
  });

// ── Deploy a secure runtime to EC2 ──────────────────────────────────
program
  .command('deploy')
  .description('Build, push, and provision a secure agent runtime on EC2')
  .requiredOption('--runtime <name>', 'Runtime manifest name (e.g. openclaw)', 'openclaw')
  .requiredOption('--tenant <name>', 'Tenant name (lowercase, alphanumeric + hyphens)')
  .option('--region <region>', 'AWS region', 'us-east-1')
  .option('--instance-type <type>', 'EC2 instance type', 't4g.medium')
  .option('--skip-build', 'Skip Docker image build', false)
  .option('--skip-push', 'Skip pushing images to ECR', false)
  .option('--dry-run', 'Plan only, do not create resources', false)
  .action(async (opts) => {
    const { deploy } = await import('./commands/deploy.js');
    await deploy({
      runtime: opts.runtime,
      tenant: opts.tenant,
      region: opts.region,
      instanceType: opts.instanceType,
      skipBuild: opts.skipBuild,
      skipPush: opts.skipPush,
      dryRun: opts.dryRun,
    });
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(chalk.red('Error:'), err instanceof Error ? err.message : err);
  process.exit(1);
});

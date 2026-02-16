#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import { provision } from './commands/provision.js';
import { deprovision } from './commands/deprovision.js';
import { instances } from './commands/instances.js';
import { status } from './commands/status.js';
import { init } from './commands/init.js';
import { dev } from './commands/dev.js';
import { enable } from './commands/enable.js';
import { disable } from './commands/disable.js';
import { deploy } from './commands/deploy.js';

const program = new Command();

program
  .name('wooblay')
  .description('Wooblay CLI – provision, manage, and monitor agent runtimes')
  .version('0.1.0');

// ── Provision a new tenant ──────────────────────────────────────────
program
  .command('provision')
  .description('Provision a new tenant environment')
  .requiredOption('--tenant <name>', 'Tenant name')
  .option('--agent <runtime>', 'Agent runtime to use', 'openclaw')
  .option('--region <region>', 'AWS region', 'us-east-1')
  .action(async (opts) => {
    await provision(opts);
  });

// ── Deprovision a tenant ────────────────────────────────────────────
program
  .command('deprovision')
  .description('Tear down a tenant environment')
  .requiredOption('--tenant <name>', 'Tenant name')
  .action(async (opts) => {
    await deprovision(opts);
  });

// ── List instances ──────────────────────────────────────────────────
program
  .command('instances')
  .description('List all provisioned tenants')
  .action(async () => {
    await instances();
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
    await init();
  });

// ── Dev ─────────────────────────────────────────────────────────────
program
  .command('dev')
  .description('Start local development environment')
  .option('--sqlite', 'Use SQLite instead of Postgres')
  .action(async (opts) => {
    await dev(opts);
  });

// ── Enable adapter integration ──────────────────────────────────────
program
  .command('enable <framework>')
  .description('Enable Wooblay supervision for an agent framework (openclaw, mcp, generic)')
  .option('--gate-url <url>', 'Wooblay Gate URL', 'http://localhost:4800')
  .action(async (framework, opts) => {
    await enable(framework, { gateUrl: opts.gateUrl });
  });

// ── Disable adapter integration ────────────────────────────────────
program
  .command('disable <framework>')
  .description('Disable Wooblay supervision for an agent framework')
  .action(async (framework) => {
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

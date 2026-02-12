import chalk from 'chalk';

export interface DevOpts {
  sqlite?: boolean;
}

export async function dev(opts: DevOpts): Promise<void> {
  console.log(chalk.bold.cyan('\n🚀 Wooblay – Local Development\n'));

  if (opts.sqlite) {
    console.log(chalk.yellow('  Using SQLite mode (no Docker required)\n'));
    console.log(chalk.gray('  Set environment variable:'));
    console.log(chalk.white('    export DATABASE_URL="file:./wooblay.db"\n'));
  } else {
    // ── Step 1: Postgres via Docker ────────────────────────────────────
    console.log(chalk.yellow('→ Step 1: Start Postgres\n'));
    console.log(chalk.white('  docker-compose -f docker/docker-compose.yml up -d postgres'));
    console.log(chalk.gray('  Postgres will be available at localhost:5432\n'));
  }

  // ── Step 2: Gate dev server ──────────────────────────────────────────
  console.log(chalk.yellow('→ Step 2: Start Gate dev server\n'));
  console.log(chalk.white('  pnpm --filter @wooblay/gate dev'));
  console.log(chalk.gray('  Gate will be available at http://localhost:4800\n'));

  // ── Step 3: UI dev server ────────────────────────────────────────────
  console.log(chalk.yellow('→ Step 3: Start UI dev server\n'));
  console.log(chalk.white('  pnpm --filter @wooblay/ui dev'));
  console.log(chalk.gray('  UI will be available at http://localhost:5173\n'));

  // ── Tip ──────────────────────────────────────────────────────────────
  console.log(chalk.gray('─'.repeat(60)));
  console.log(chalk.gray('  Tip: Run each command in a separate terminal, or use:'));
  console.log(chalk.white('    pnpm dev'));
  console.log(chalk.gray('  to start all services via Turborepo.\n'));
}

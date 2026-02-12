import chalk from 'chalk';

export interface StatusOpts {
  tenant?: string;
}

export async function status(opts: StatusOpts): Promise<void> {
  const tenant = opts.tenant;
  const baseUrl = tenant
    ? `https://${tenant}.wooblay.run`
    : 'http://localhost:4800';

  console.log(chalk.bold.cyan('\n🏥 Wooblay – Gate Health Check\n'));
  console.log(chalk.gray(`  Target: ${chalk.white(baseUrl)}`));

  try {
    const res = await fetch(`${baseUrl}/health`, {
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      console.log(chalk.red(`\n  ✗ Gate returned HTTP ${res.status}`));
      process.exitCode = 1;
      return;
    }

    const data = (await res.json()) as {
      status: string;
      version: string;
      timestamp: string;
    };

    console.log(chalk.green(`\n  ✓ Gate is healthy`));
    console.log(chalk.gray(`    Status:    ${chalk.white(data.status)}`));
    console.log(chalk.gray(`    Version:   ${chalk.white(data.version)}`));
    console.log(chalk.gray(`    Timestamp: ${chalk.white(data.timestamp)}`));
    console.log();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(chalk.red(`\n  ✗ Could not reach Gate at ${baseUrl}/health`));
    console.log(chalk.gray(`    ${message}`));
    console.log(chalk.gray(`\n  Make sure Gate is running. Try: pnpm --filter @wooblay/gate dev\n`));
    process.exitCode = 1;
  }
}

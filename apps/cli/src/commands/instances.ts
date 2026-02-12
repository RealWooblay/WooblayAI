import chalk from 'chalk';

export async function instances(): Promise<void> {
  console.log(chalk.bold.cyan('\n📋 Wooblay – Tenant Instances\n'));

  // Placeholder data – will be replaced with actual ECS/Terraform state queries
  const placeholder = [
    { name: 'demo',    status: 'running', region: 'us-east-1', url: 'https://demo.wooblay.run' },
    { name: 'staging', status: 'running', region: 'us-east-1', url: 'https://staging.wooblay.run' },
  ];

  console.log(chalk.gray('  Name       Status     Region       URL'));
  console.log(chalk.gray('  ─────────  ─────────  ───────────  ──────────────────────────────'));

  for (const t of placeholder) {
    const statusColor = t.status === 'running' ? chalk.green : chalk.yellow;
    console.log(
      `  ${chalk.white(t.name.padEnd(9))}  ${statusColor(t.status.padEnd(9))}  ${chalk.gray(t.region.padEnd(11))}  ${chalk.cyan(t.url)}`,
    );
  }

  console.log(chalk.gray('\n⚠  This is placeholder data. Actual instance listing TBD.\n'));
}

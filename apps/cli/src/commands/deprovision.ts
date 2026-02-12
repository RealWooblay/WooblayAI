import chalk from 'chalk';

export interface DeprovisionOpts {
  tenant: string;
}

export async function deprovision(opts: DeprovisionOpts): Promise<void> {
  const { tenant } = opts;

  console.log(chalk.bold.red('\n🗑  Wooblay – Deprovision Tenant\n'));
  console.log(chalk.gray(`  Tenant: ${chalk.white(tenant)}`));

  console.log(chalk.yellow('\n→ Planned teardown steps:'));
  console.log(chalk.gray(`  1. Scale ECS service to 0 for tenant "${tenant}"`));
  console.log(chalk.gray(`  2. Delete ECS service and task definition`));
  console.log(chalk.gray(`  3. Remove ALB listener rule for ${tenant}.wooblay.run`));
  console.log(chalk.gray(`  4. Delete target group`));
  console.log(chalk.gray(`  5. Remove secrets from AWS Secrets Manager`));
  console.log(chalk.gray(`  6. Drop database: wooblay_${tenant}`));
  console.log(chalk.gray(`  7. Drop database role: wooblay_${tenant}_user`));
  console.log(chalk.gray(`  8. Run: terraform destroy -var="tenant_name=${tenant}"`));
  console.log(chalk.gray(`  9. Clean up per-tenant security group`));

  console.log(chalk.gray('\n⚠  Actual teardown is TBD – this is a dry-run preview.'));
  console.log(chalk.bold.yellow('\n✓ Deprovision plan complete.\n'));
}

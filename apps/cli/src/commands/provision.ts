import chalk from 'chalk';
import { generateKeyPair } from '@wooblay/crypto';

export interface ProvisionOpts {
  tenant: string;
  agent: string;
  region: string;
}

export async function provision(opts: ProvisionOpts): Promise<void> {
  const { tenant, agent, region } = opts;

  console.log(chalk.bold.cyan('\n🔧 Wooblay – Provision Tenant\n'));
  console.log(chalk.gray(`  Tenant:  ${chalk.white(tenant)}`));
  console.log(chalk.gray(`  Agent:   ${chalk.white(agent)}`));
  console.log(chalk.gray(`  Region:  ${chalk.white(region)}`));

  // ── Step 1: Generate signing keys ──────────────────────────────────
  console.log(chalk.yellow('\n→ Generating tenant signing keys...'));
  const serverKeys = generateKeyPair();
  const toolhostKeys = generateKeyPair();

  console.log(chalk.green('  ✓ Server keypair generated'));
  console.log(chalk.gray(`    Public key:  ${serverKeys.publicKey.slice(0, 32)}...`));
  console.log(chalk.green('  ✓ Toolhost keypair generated'));
  console.log(chalk.gray(`    Public key:  ${toolhostKeys.publicKey.slice(0, 32)}...`));

  // ── Step 2: Describe what would happen ─────────────────────────────
  console.log(chalk.yellow('\n→ Planned provisioning steps:'));
  console.log(chalk.gray(`  1. Create Postgres database: wooblay_${tenant}`));
  console.log(chalk.gray(`  2. Create DB role: wooblay_${tenant}_user`));
  console.log(chalk.gray(`  3. Store secrets in AWS Secrets Manager`));
  console.log(chalk.gray(`  4. Run: terraform apply -var="tenant_name=${tenant}" -var="agent_runtime_image=${agent}-wooblay:latest"`));
  console.log(chalk.gray(`  5. Create ALB rule for ${tenant}.wooblay.run`));
  console.log(chalk.gray(`  6. Deploy ECS service with agent-runtime + gate containers`));

  // ── Step 3: Output keys and instructions (MVP) ─────────────────────
  console.log(chalk.yellow('\n→ Generated keys (store securely):'));
  console.log(chalk.gray('  Server:'));
  console.log(chalk.white(`    PUBLIC_KEY=${serverKeys.publicKey}`));
  console.log(chalk.white(`    PRIVATE_KEY=${serverKeys.privateKey}`));
  console.log(chalk.gray('  Toolhost:'));
  console.log(chalk.white(`    TOOLHOST_PUBLIC_KEY=${toolhostKeys.publicKey}`));
  console.log(chalk.white(`    TOOLHOST_PRIVATE_KEY=${toolhostKeys.privateKey}`));

  // ── Step 4: Tenant URL placeholder ─────────────────────────────────
  console.log(chalk.yellow('\n→ Tenant URL (once deployed):'));
  console.log(chalk.cyan(`  https://${tenant}.wooblay.run`));
  console.log(chalk.cyan(`  https://${tenant}.wooblay.run/health`));

  console.log(chalk.gray('\n⚠  Actual Terraform execution is TBD – keys above are real and can be used for local dev.'));
  console.log(chalk.bold.green('\n✓ Provisioning plan complete.\n'));
}

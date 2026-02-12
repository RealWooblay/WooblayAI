/**
 * wooblay deploy – Build, push, and provision a secure runtime on EC2.
 *
 * This command:
 *   1. Reads the runtime manifest (runtimes/<runtime>.yaml)
 *   2. Builds Docker images for Gate + Agent runtime
 *   3. Pushes images to ECR
 *   4. Runs Terraform to provision a hardened EC2 instance
 *   5. Outputs the tenant URL and health status
 *
 * Usage:
 *   wooblay deploy --runtime openclaw --tenant my-client
 */

import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import chalk from 'chalk';

interface DeployOptions {
  runtime: string;
  tenant: string;
  region: string;
  instanceType: string;
  skipBuild: boolean;
  skipPush: boolean;
  dryRun: boolean;
}

function run(cmd: string, opts?: { cwd?: string; silent?: boolean }): string {
  try {
    const result = execSync(cmd, {
      cwd: opts?.cwd,
      encoding: 'utf-8',
      stdio: opts?.silent ? 'pipe' : 'inherit',
    });
    return result?.toString().trim() ?? '';
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Command failed: ${cmd}\n${msg}`);
  }
}

function runCapture(cmd: string, opts?: { cwd?: string }): string {
  return run(cmd, { ...opts, silent: true });
}

export async function deploy(opts: DeployOptions): Promise<void> {
  const { runtime, tenant, region, instanceType, skipBuild, skipPush, dryRun } = opts;

  console.log(chalk.bold('\n=== Wooblay Deploy ==='));
  console.log(`  Runtime:  ${chalk.cyan(runtime)}`);
  console.log(`  Tenant:   ${chalk.cyan(tenant)}`);
  console.log(`  Region:   ${chalk.cyan(region)}`);
  console.log(`  Instance: ${chalk.cyan(instanceType)}`);
  if (dryRun) console.log(chalk.yellow('  [DRY RUN — no resources will be created]'));
  console.log('');

  // ── Find project root ────────────────────────────────────────────────
  const projectRoot = findProjectRoot();
  if (!projectRoot) {
    console.error(chalk.red('Could not find project root (looking for pnpm-workspace.yaml)'));
    process.exit(1);
  }

  // ── Step 1: Read runtime manifest ────────────────────────────────────
  console.log(chalk.bold('Step 1: Reading runtime manifest...'));
  const manifestPath = join(projectRoot, 'runtimes', `${runtime}.yaml`);
  if (!existsSync(manifestPath)) {
    console.error(chalk.red(`Runtime manifest not found: ${manifestPath}`));
    console.error(chalk.dim(`Available runtimes: ls ${join(projectRoot, 'runtimes')}/*.yaml`));
    process.exit(1);
  }
  console.log(chalk.green(`  ✓ Found ${manifestPath}`));

  // ── Step 2: Verify AWS CLI ───────────────────────────────────────────
  console.log(chalk.bold('\nStep 2: Verifying AWS credentials...'));
  try {
    const identity = runCapture('aws sts get-caller-identity --output json');
    const account = JSON.parse(identity);
    console.log(chalk.green(`  ✓ AWS Account: ${account.Account}`));
    console.log(chalk.green(`  ✓ Identity:    ${account.Arn}`));
  } catch {
    console.error(chalk.red('  ✗ AWS CLI not configured. Run: aws configure'));
    process.exit(1);
  }

  // Get account ID
  const accountId = runCapture('aws sts get-caller-identity --query Account --output text');
  const ecrBase = `${accountId}.dkr.ecr.${region}.amazonaws.com`;

  // ── Step 3: Build Docker images ──────────────────────────────────────
  const gateImage = `${ecrBase}/wooblay-gate:${tenant}-latest`;
  const agentImage = `${ecrBase}/openclaw-wooblay:${tenant}-latest`;

  if (!skipBuild) {
    console.log(chalk.bold('\nStep 3: Building Docker images...'));

    console.log('  Building Gate image...');
    run(`docker build -f docker/gate/Dockerfile -t ${gateImage} .`, { cwd: projectRoot });
    console.log(chalk.green('  ✓ Gate image built'));

    console.log('  Building Agent runtime image...');
    run(`docker build -f docker/runtimes/${runtime}/Dockerfile -t ${agentImage} .`, { cwd: projectRoot });
    console.log(chalk.green('  ✓ Agent image built'));
  } else {
    console.log(chalk.dim('\nStep 3: Skipping build (--skip-build)'));
  }

  // ── Step 4: Push to ECR ──────────────────────────────────────────────
  if (!skipPush) {
    console.log(chalk.bold('\nStep 4: Pushing images to ECR...'));

    // Authenticate with ECR
    run(`aws ecr get-login-password --region ${region} | docker login --username AWS --password-stdin ${ecrBase}`, {
      cwd: projectRoot,
    });
    console.log(chalk.green('  ✓ ECR authenticated'));

    run(`docker push ${gateImage}`, { cwd: projectRoot });
    console.log(chalk.green('  ✓ Gate image pushed'));

    run(`docker push ${agentImage}`, { cwd: projectRoot });
    console.log(chalk.green('  ✓ Agent image pushed'));
  } else {
    console.log(chalk.dim('\nStep 4: Skipping push (--skip-push)'));
  }

  // ── Step 5: Generate signing keys if needed ──────────────────────────
  console.log(chalk.bold('\nStep 5: Generating tenant signing keys...'));
  let serverPrivateKey: string;
  let serverPublicKey: string;

  try {
    // Try to read existing keys from the local .env
    const envPath = join(projectRoot, '.env');
    const envContent = existsSync(envPath) ? readFileSync(envPath, 'utf-8') : '';
    const privMatch = envContent.match(/WOOBLAY_SERVER_PRIVATE_KEY=(.+)/);
    const pubMatch = envContent.match(/WOOBLAY_SERVER_PUBLIC_KEY=(.+)/);

    if (privMatch && pubMatch) {
      serverPrivateKey = privMatch[1].trim();
      serverPublicKey = pubMatch[1].trim();
      console.log(chalk.green('  ✓ Using signing keys from .env'));
    } else {
      // Generate new keys using node crypto
      const keyScript = `
        const { generateKeyPairSync } = require('crypto');
        const { publicKey, privateKey } = generateKeyPairSync('ed25519');
        const pub = publicKey.export({ type: 'spki', format: 'der' }).toString('hex');
        const priv = privateKey.export({ type: 'pkcs8', format: 'der' }).toString('hex');
        console.log(JSON.stringify({ pub, priv }));
      `;
      const keyJson = runCapture(`node -e "${keyScript.replace(/\n/g, ' ')}"`);
      const keys = JSON.parse(keyJson);
      serverPrivateKey = keys.priv;
      serverPublicKey = keys.pub;
      console.log(chalk.green('  ✓ Generated new ed25519 signing keys'));
    }
  } catch (err) {
    console.error(chalk.red('  ✗ Failed to generate signing keys'));
    throw err;
  }

  // ── Step 6: Run Terraform ────────────────────────────────────────────
  console.log(chalk.bold('\nStep 6: Provisioning EC2 instance via Terraform...'));
  const runtimeTfDir = join(projectRoot, 'infra', 'runtime');

  if (!existsSync(runtimeTfDir)) {
    console.error(chalk.red(`Terraform directory not found: ${runtimeTfDir}`));
    process.exit(1);
  }

  // First, get base infrastructure outputs
  console.log('  Getting base infrastructure outputs...');
  const baseTfDir = join(projectRoot, 'infra', 'base');

  let baseOutputs: Record<string, string>;
  try {
    const outputJson = runCapture(`terraform output -json`, { cwd: baseTfDir });
    const parsed = JSON.parse(outputJson);
    baseOutputs = Object.fromEntries(
      Object.entries(parsed).map(([k, v]: [string, any]) => [k, v.value])
    );
    console.log(chalk.green('  ✓ Base outputs loaded'));
  } catch {
    console.error(chalk.red('  ✗ Could not read base Terraform outputs.'));
    console.error(chalk.dim('    Run: cd infra/base && terraform init && terraform apply'));
    process.exit(1);
  }

  // Initialize Terraform
  run('terraform init', { cwd: runtimeTfDir });

  // Build tfvars
  const privateSubnetIds = baseOutputs['private_subnet_ids'] as unknown;
  const publicSubnetIds = baseOutputs['public_subnet_ids'] as unknown;
  const firstPrivateSubnet = Array.isArray(privateSubnetIds) ? privateSubnetIds[0] : '';

  const tfVars = [
    `-var="tenant_name=${tenant}"`,
    `-var="aws_region=${region}"`,
    `-var="vpc_id=${baseOutputs['vpc_id']}"`,
    `-var="private_subnet_id=${firstPrivateSubnet}"`,
    `-var='public_subnet_ids=${JSON.stringify(publicSubnetIds)}'`,
    `-var="runtime_security_group_id=${baseOutputs['runtime_security_group_id']}"`,
    `-var="alb_arn=${baseOutputs['alb_arn']}"`,
    `-var="alb_http_listener_arn=${baseOutputs['alb_http_listener_arn']}"`,
    `-var="kms_key_arn=${baseOutputs['kms_key_arn']}"`,
    `-var="log_group_name=${baseOutputs['log_group_name']}"`,
    `-var="gate_image=${gateImage}"`,
    `-var="agent_image=${agentImage}"`,
    `-var="instance_type=${instanceType}"`,
    `-var="server_private_key=${serverPrivateKey}"`,
    `-var="server_public_key=${serverPublicKey}"`,
    `-var="tool_filter=risky"`,
  ];

  const tfVarString = tfVars.join(' ');

  if (dryRun) {
    console.log(chalk.yellow('\n  [DRY RUN] Would run:'));
    console.log(chalk.dim(`    terraform plan ${tfVarString}`));
    run(`terraform plan ${tfVarString}`, { cwd: runtimeTfDir });
  } else {
    console.log('  Applying Terraform...');
    run(`terraform apply -auto-approve ${tfVarString}`, { cwd: runtimeTfDir });
    console.log(chalk.green('  ✓ EC2 instance provisioned'));

    // Get outputs
    console.log(chalk.bold('\n=== Deployment Complete ==='));
    try {
      const tenantUrl = runCapture('terraform output -raw tenant_url', { cwd: runtimeTfDir });
      const healthUrl = runCapture('terraform output -raw health_url', { cwd: runtimeTfDir });
      const instanceId = runCapture('terraform output -raw instance_id', { cwd: runtimeTfDir });
      const ssmCmd = runCapture('terraform output -raw ssm_command', { cwd: runtimeTfDir });

      console.log(`  Tenant URL:    ${chalk.cyan(tenantUrl)}`);
      console.log(`  Health Check:  ${chalk.cyan(healthUrl)}`);
      console.log(`  Instance ID:   ${chalk.cyan(instanceId)}`);
      console.log(`  SSM Access:    ${chalk.dim(ssmCmd)}`);
      console.log('');
      console.log(chalk.green('  The instance is bootstrapping. It may take 2-3 minutes'));
      console.log(chalk.green('  for the Gate to become healthy and the UI to be accessible.'));
    } catch {
      console.log(chalk.yellow('  Outputs not yet available. Check with:'));
      console.log(chalk.dim(`    cd ${runtimeTfDir} && terraform output`));
    }
  }
}

function findProjectRoot(): string | null {
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

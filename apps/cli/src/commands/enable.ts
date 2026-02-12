import chalk from 'chalk';
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';

const GATE_URL_DEFAULT = 'http://localhost:4800';

interface EnableOptions {
  gateUrl?: string;
}

/**
 * Enable Wooblay supervision for a specific agent framework.
 *
 * Supported modes:
 *   openclaw  - Install the Wooblay plugin into a local OpenClaw instance
 *   mcp       - Start the MCP Tool Host sidecar
 *   generic   - Print HTTP SDK integration instructions
 */
export async function enable(framework: string, opts?: EnableOptions): Promise<void> {
  const gateUrl = opts?.gateUrl ?? GATE_URL_DEFAULT;

  switch (framework.toLowerCase()) {
    case 'openclaw':
      return enableOpenClaw(gateUrl);
    case 'mcp':
      return enableMcp(gateUrl);
    case 'generic':
    case 'http':
      return enableGeneric(gateUrl);
    default:
      console.log(chalk.red(`\n  Unknown framework: "${framework}"\n`));
      console.log(chalk.gray('  Supported frameworks:'));
      console.log(chalk.white('    openclaw') + chalk.gray('  — Native plugin (before_tool_call hooks)'));
      console.log(chalk.white('    mcp') + chalk.gray('      — MCP Tool Host sidecar'));
      console.log(chalk.white('    generic') + chalk.gray('  — HTTP SDK integration docs'));
      console.log();
      process.exit(1);
  }
}

// ─── OpenClaw ────────────────────────────────────────────────────────────────

async function enableOpenClaw(gateUrl: string): Promise<void> {
  console.log(chalk.bold.cyan('\n  Enabling Wooblay for OpenClaw\n'));

  // 1. Detect OpenClaw installation
  const openclawHome = join(homedir(), '.openclaw');
  const openclawConfig = join(openclawHome, 'openclaw.json');

  if (!existsSync(openclawHome)) {
    console.log(chalk.red('  ✗ OpenClaw not found at ~/.openclaw'));
    console.log(chalk.gray('    Install OpenClaw first: https://docs.openclaw.ai/install'));
    console.log(chalk.gray('    Or use "wooblay provision" for a managed Runtime instance.\n'));
    process.exit(1);
  }

  console.log(chalk.green('  ✓ OpenClaw detected at ~/.openclaw'));

  // 2. Back up existing config
  if (existsSync(openclawConfig)) {
    const backupPath = `${openclawConfig}.wooblay-backup`;
    copyFileSync(openclawConfig, backupPath);
    console.log(chalk.green(`  ✓ Config backed up to ${backupPath}`));
  }

  // 3. Install the Wooblay plugin into extensions
  const extensionsDir = join(openclawHome, 'extensions', 'wooblay');
  const adapterPkgDir = findAdapterPackage();

  if (adapterPkgDir) {
    // Copy from local monorepo (development mode)
    mkdirSync(extensionsDir, { recursive: true });
    console.log(chalk.gray(`  → Copying plugin from ${adapterPkgDir}...`));
    try {
      execSync(`cp -r "${adapterPkgDir}/"* "${extensionsDir}/"`, { stdio: 'pipe' });
      console.log(chalk.green('  ✓ Plugin installed to ~/.openclaw/extensions/wooblay'));
    } catch {
      console.log(chalk.yellow('  ⚠ Could not copy plugin files. Trying npm install...'));
      tryNpmInstall(extensionsDir);
    }
  } else {
    // Install from npm (production mode)
    tryNpmInstall(extensionsDir);
  }

  // 4. Update OpenClaw config to enable the plugin
  const config = existsSync(openclawConfig)
    ? JSON.parse(readFileSync(openclawConfig, 'utf-8'))
    : {};

  if (!config.plugins) config.plugins = {};
  config.plugins.enabled = true;
  if (!config.plugins.entries) config.plugins.entries = {};
  config.plugins.entries.wooblay = {
    enabled: true,
    config: {
      gateUrl,
      toolFilter: 'risky',
    },
  };

  writeFileSync(openclawConfig, JSON.stringify(config, null, 2), 'utf-8');
  console.log(chalk.green('  ✓ OpenClaw config updated with Wooblay plugin'));

  // 5. Try to restart the gateway
  console.log(chalk.gray('  → Attempting to restart OpenClaw gateway...'));
  try {
    execSync('openclaw gateway restart', { stdio: 'pipe', timeout: 10_000 });
    console.log(chalk.green('  ✓ Gateway restarted'));
  } catch {
    console.log(chalk.yellow('  ⚠ Could not restart gateway automatically.'));
    console.log(chalk.gray('    Please restart manually: openclaw gateway restart'));
  }

  console.log(chalk.bold.green('\n  ✓ Wooblay supervision enabled for OpenClaw!'));
  console.log(chalk.gray(`    Gate URL: ${gateUrl}`));
  console.log(chalk.gray('    Integration: Native plugin (before_tool_call / after_tool_call)'));
  console.log(chalk.gray('    All risky tool calls will be routed through Wooblay Gate.'));
  console.log(chalk.gray('    Open the dashboard: http://localhost:5173\n'));
}

// ─── MCP ─────────────────────────────────────────────────────────────────────

async function enableMcp(gateUrl: string): Promise<void> {
  console.log(chalk.bold.cyan('\n  Enabling Wooblay MCP Tool Host\n'));
  console.log(chalk.gray('  The MCP Tool Host exposes wooblay_exec, wooblay_browser, and'));
  console.log(chalk.gray('  wooblay_http tools via the Model Context Protocol (stdio transport).'));
  console.log(chalk.gray('  Any MCP-compatible agent can use these tools.\n'));

  console.log(chalk.white('  Start the Tool Host:'));
  console.log(chalk.cyan('    pnpm --filter @wooblay/toolhost dev'));
  console.log();
  console.log(chalk.white('  Configure your MCP client to connect:'));
  console.log(chalk.gray('    Transport: stdio'));
  console.log(chalk.gray(`    Gate URL:  ${gateUrl}`));
  console.log(chalk.gray('    Tools:     wooblay_exec, wooblay_browser, wooblay_http'));
  console.log();
  console.log(chalk.gray('  See: https://docs.wooblay.run/integrations/mcp\n'));
}

// ─── Generic HTTP ────────────────────────────────────────────────────────────

async function enableGeneric(gateUrl: string): Promise<void> {
  console.log(chalk.bold.cyan('\n  Wooblay HTTP SDK Integration\n'));
  console.log(chalk.gray('  Any agent framework can integrate with Wooblay by calling'));
  console.log(chalk.gray('  the Gate REST API directly.\n'));

  console.log(chalk.white('  Endpoint:'));
  console.log(chalk.cyan(`    POST ${gateUrl}/api/tool/execute`));
  console.log();
  console.log(chalk.white('  Request body:'));
  console.log(chalk.gray(`    {`));
  console.log(chalk.gray(`      "toolName": "exec",`));
  console.log(chalk.gray(`      "args": { "command": "ls -la" },`));
  console.log(chalk.gray(`      "agentPubkey": "<your-ed25519-pubkey>",`));
  console.log(chalk.gray(`      "requestSignature": "<ed25519-signature>",`));
  console.log(chalk.gray(`      "adapter": "http-sdk"`));
  console.log(chalk.gray(`    }`));
  console.log();
  console.log(chalk.white('  Response:'));
  console.log(chalk.gray(`    { "decision": "EXECUTE"|"DENY"|"PENDING_APPROVAL", ... }`));
  console.log();
  console.log(chalk.white('  Generate signing keys:'));
  console.log(chalk.cyan('    wooblay init'));
  console.log();
  console.log(chalk.gray('  See: https://docs.wooblay.run/integrations/http-sdk\n'));
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function findAdapterPackage(): string | null {
  // Look for the adapter in the monorepo (development mode)
  const candidates = [
    join(process.cwd(), 'packages', 'adapters', 'openclaw'),
    join(process.cwd(), '..', 'packages', 'adapters', 'openclaw'),
  ];

  for (const dir of candidates) {
    if (existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'openclaw.plugin.json'))) {
      return dir;
    }
  }
  return null;
}

function tryNpmInstall(extensionsDir: string): void {
  try {
    mkdirSync(extensionsDir, { recursive: true });
    execSync('openclaw plugins install @wooblay/openclaw-adapter', {
      stdio: 'pipe',
      timeout: 60_000,
    });
    console.log(chalk.green('  ✓ Plugin installed via openclaw plugins'));
  } catch {
    console.log(chalk.yellow('  ⚠ Could not install plugin via npm.'));
    console.log(chalk.gray('    You may need to install manually:'));
    console.log(chalk.gray('    openclaw plugins install @wooblay/openclaw-adapter'));
  }
}

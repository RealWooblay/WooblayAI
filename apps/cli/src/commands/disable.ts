import chalk from 'chalk';
import { existsSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';

/**
 * Disable Wooblay supervision for a specific agent framework.
 *
 * For OpenClaw: restores config backup and removes the plugin.
 * For MCP/Generic: prints instructions.
 */
export async function disable(framework: string): Promise<void> {
  switch (framework.toLowerCase()) {
    case 'openclaw':
      return disableOpenClaw();
    case 'mcp':
      return disableMcp();
    case 'generic':
    case 'http':
      return disableGeneric();
    default:
      console.log(chalk.red(`\n  Unknown framework: "${framework}"\n`));
      console.log(chalk.gray('  Supported frameworks: openclaw, mcp, generic'));
      console.log();
      process.exit(1);
  }
}

async function disableOpenClaw(): Promise<void> {
  console.log(chalk.bold.yellow('\n  Disabling Wooblay for OpenClaw\n'));

  const openclawHome = join(homedir(), '.openclaw');
  const openclawConfig = join(openclawHome, 'openclaw.json');
  const backupPath = `${openclawConfig}.wooblay-backup`;

  // 1. Restore config backup if available
  if (existsSync(backupPath)) {
    copyFileSync(backupPath, openclawConfig);
    console.log(chalk.green('  ✓ Config restored from backup'));
  } else if (existsSync(openclawConfig)) {
    // Remove Wooblay plugin entry from config
    try {
      const config = JSON.parse(readFileSync(openclawConfig, 'utf-8'));
      if (config.plugins?.entries?.wooblay) {
        delete config.plugins.entries.wooblay;
        writeFileSync(openclawConfig, JSON.stringify(config, null, 2), 'utf-8');
        console.log(chalk.green('  ✓ Removed Wooblay plugin from config'));
      }
    } catch {
      console.log(chalk.yellow('  ⚠ Could not update config'));
    }
  }

  // 2. Remove the plugin extension directory
  const extensionsDir = join(openclawHome, 'extensions', 'wooblay');
  if (existsSync(extensionsDir)) {
    rmSync(extensionsDir, { recursive: true, force: true });
    console.log(chalk.green('  ✓ Removed plugin from ~/.openclaw/extensions/wooblay'));
  }

  // 3. Try to restart gateway
  console.log(chalk.gray('  → Attempting to restart OpenClaw gateway...'));
  try {
    execSync('openclaw gateway restart', { stdio: 'pipe', timeout: 10_000 });
    console.log(chalk.green('  ✓ Gateway restarted'));
  } catch {
    console.log(chalk.yellow('  ⚠ Could not restart gateway automatically.'));
    console.log(chalk.gray('    Please restart manually: openclaw gateway restart'));
  }

  console.log(chalk.bold.green('\n  ✓ Wooblay supervision disabled for OpenClaw.\n'));
}

async function disableMcp(): Promise<void> {
  console.log(chalk.bold.yellow('\n  Disabling Wooblay MCP Tool Host\n'));
  console.log(chalk.gray('  Stop the MCP Tool Host process:'));
  console.log(chalk.cyan('    pkill -f "@wooblay/toolhost"'));
  console.log(chalk.gray('  Or press Ctrl+C in the terminal running the Tool Host.\n'));
}

async function disableGeneric(): Promise<void> {
  console.log(chalk.bold.yellow('\n  Disabling Wooblay HTTP SDK Integration\n'));
  console.log(chalk.gray('  Remove the Wooblay API calls from your agent code.'));
  console.log(chalk.gray('  No cleanup required on the Wooblay side.\n'));
}

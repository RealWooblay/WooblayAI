import chalk from 'chalk';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, platform } from 'node:os';
import { execSync } from 'node:child_process';

const WOOBLAY_DASHBOARD = process.env.WOOBLAY_URL ?? 'https://app.wooblay.com';

interface SetupOptions {
  apiKey?: string;
  endpoint?: string;
  instanceId?: string;
  agents?: string;
}

interface AgentConfig {
  name: string;
  configPath: string;
  detected: boolean;
}

export async function setup(opts: SetupOptions): Promise<void> {
  console.log(chalk.bold.cyan('\n  Wooblay Setup\n'));
  console.log(chalk.gray('  Configure all your AI agents to use Wooblay in one shot.\n'));

  const apiKey = opts.apiKey ?? process.env.WOOBLAY_API_KEY;
  const endpoint = opts.endpoint ?? process.env.WOOBLAY_GATE_URL ?? 'https://gate.wooblay.com';
  const instanceId = opts.instanceId ?? process.env.WOOBLAY_INSTANCE_ID;

  if (!apiKey) {
    console.log(chalk.yellow('  No API key found.\n'));
    console.log(chalk.white('  Get your API key from the Wooblay dashboard:'));
    console.log(chalk.cyan(`    ${WOOBLAY_DASHBOARD}\n`));
    openBrowser(WOOBLAY_DASHBOARD);
    console.log(chalk.gray('  Then run again with:'));
    console.log(chalk.white(`    npx @wooblaymcp/cli setup --api-key wbl_ak_YOUR_KEY --endpoint ${endpoint}\n`));
    return;
  }

  if (!apiKey.startsWith('wbl_ak_') || apiKey.length < 20) {
    console.log(chalk.red('  Invalid API key format.'));
    console.log(chalk.gray('  API keys start with wbl_ak_ and are at least 20 characters.\n'));
    return;
  }

  if (!instanceId) {
    console.log(chalk.yellow('  No instance ID found.\n'));
    console.log(chalk.white('  You need a proxy instance ID from the Wooblay dashboard.'));
    console.log(chalk.gray('  Create one at Setup → Deploy Firewall, then run:'));
    console.log(chalk.white(`    npx @wooblaymcp/cli setup --api-key ${apiKey.slice(0, 12)}... --instance-id YOUR_INSTANCE_ID --endpoint ${endpoint}\n`));
    return;
  }

  try {
    new URL(endpoint);
  } catch {
    console.log(chalk.red(`  Invalid endpoint URL: ${endpoint}`));
    console.log(chalk.gray('  Must be a valid URL like https://gate.wooblay.com\n'));
    return;
  }

  const sseUrl = `${endpoint.replace(/\/$/, '')}/mcp/${instanceId}/sse`;

  console.log(chalk.gray(`  Endpoint: ${sseUrl}`));
  console.log(chalk.gray(`  API Key:  ${apiKey.slice(0, 12)}...${apiKey.slice(-4)}\n`));

  const allAgents = detectAgents();

  // Filter by --agents flag if provided (comma-separated: cursor,claude,vscode)
  const agentFilter = opts.agents
    ? new Set(opts.agents.split(',').map((a) => a.trim().toLowerCase()))
    : null;

  const AGENT_ALIASES: Record<string, string> = {
    cursor: 'Cursor',
    claude: 'Claude Desktop',
    'claude-desktop': 'Claude Desktop',
    vscode: 'VS Code',
    'vs-code': 'VS Code',
  };

  const agents = agentFilter
    ? allAgents.filter((a) => {
        const nameLC = a.name.toLowerCase();
        return Array.from(agentFilter).some(
          (f) => nameLC.includes(f) || AGENT_ALIASES[f]?.toLowerCase() === nameLC,
        );
      })
    : allAgents;

  if (agentFilter && agents.length === 0) {
    console.log(chalk.yellow(`  No matching agents for: ${opts.agents}`));
    console.log(chalk.gray('  Valid names: cursor, claude, vscode'));
    console.log(chalk.gray('  Example: --agents cursor,claude\n'));
    return;
  }

  const detected = agents.filter((a) => a.detected);

  if (detected.length === 0) {
    console.log(chalk.yellow('  No supported agents detected on this machine.\n'));
    console.log(chalk.gray('  Supported agents:'));
    console.log(chalk.gray('    - Cursor (~/.cursor/mcp.json)'));
    console.log(chalk.gray('    - Claude Desktop (platform-specific config)'));
    console.log(chalk.gray('    - VS Code (~/.vscode/mcp.json)'));
    console.log(chalk.gray('\n  You can manually add Wooblay to any MCP-compatible agent:'));
    printManualConfig(sseUrl, apiKey);
    return;
  }

  console.log(chalk.white(`  Detected ${detected.length} agent${detected.length > 1 ? 's' : ''}:\n`));

  let configured = 0;
  for (const agent of detected) {
    const ok = configureAgent(agent, sseUrl, apiKey);
    if (ok) configured++;
  }

  console.log();
  if (configured > 0) {
    console.log(chalk.bold.green(`  ${configured} agent${configured > 1 ? 's' : ''} configured.`));
    console.log(chalk.gray('  Restart your agents for changes to take effect.\n'));
  }

  if (configured < detected.length) {
    console.log(chalk.gray('  Manual config for agents that could not be auto-configured:'));
    printManualConfig(sseUrl, apiKey);
  }
}

function detectAgents(): AgentConfig[] {
  const home = homedir();
  const os = platform();

  const agents: AgentConfig[] = [];

  // Cursor — global config
  const cursorPath = join(home, '.cursor', 'mcp.json');
  agents.push({
    name: 'Cursor',
    configPath: cursorPath,
    detected: existsSync(join(home, '.cursor')),
  });

  // Claude Desktop — OS-specific
  let claudePath: string;
  if (os === 'darwin') {
    claudePath = join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  } else if (os === 'win32') {
    claudePath = join(home, 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json');
  } else {
    claudePath = join(home, '.config', 'claude', 'claude_desktop_config.json');
  }
  const claudeDir = join(claudePath, '..');
  agents.push({
    name: 'Claude Desktop',
    configPath: claudePath,
    detected: existsSync(claudeDir) || existsSync(claudePath),
  });

  // VS Code — global settings (MCP in user-level mcp.json)
  const vscodePath = join(home, '.vscode', 'mcp.json');
  agents.push({
    name: 'VS Code',
    configPath: vscodePath,
    detected: existsSync(join(home, '.vscode')),
  });

  return agents;
}

function configureAgent(agent: AgentConfig, sseUrl: string, apiKey: string): boolean {
  try {
    const dir = join(agent.configPath, '..');
    mkdirSync(dir, { recursive: true });

    let config: Record<string, any> = {};
    if (existsSync(agent.configPath)) {
      const raw = readFileSync(agent.configPath, 'utf-8').trim();
      if (raw) {
        try {
          config = JSON.parse(raw);
        } catch {
          console.log(chalk.yellow(`    ${agent.name}: existing config has invalid JSON — creating backup`));
          writeFileSync(agent.configPath + '.bak', raw, 'utf-8');
          config = {};
        }
      }
    }

    if (!config.mcpServers) config.mcpServers = {};

    const existing = config.mcpServers.wooblay;
    if (existing?.url === sseUrl && existing?.headers?.Authorization === `Bearer ${apiKey}`) {
      console.log(chalk.gray(`    ${agent.name}: already configured (skipped)`));
      return true;
    }

    config.mcpServers.wooblay = {
      url: sseUrl,
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    };

    writeFileSync(agent.configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    const verb = existing ? 'updated' : 'configured';
    console.log(chalk.green(`    ${agent.name}: ${verb} at ${agent.configPath}`));
    return true;
  } catch (err: any) {
    console.log(chalk.red(`    ${agent.name}: failed — ${err.message}`));
    return false;
  }
}

function printManualConfig(sseUrl: string, apiKey: string): void {
  console.log(chalk.gray('\n  Add to your MCP config (mcp.json or equivalent):'));
  console.log(chalk.white(`    {`));
  console.log(chalk.white(`      "mcpServers": {`));
  console.log(chalk.white(`        "wooblay": {`));
  console.log(chalk.white(`          "url": "${sseUrl}",`));
  console.log(chalk.white(`          "headers": {`));
  console.log(chalk.white(`            "Authorization": "Bearer ${apiKey.slice(0, 12)}..."`));
  console.log(chalk.white(`          }`));
  console.log(chalk.white(`        }`));
  console.log(chalk.white(`      }`));
  console.log(chalk.white(`    }\n`));
}

function openBrowser(url: string): void {
  try {
    const os = platform();
    if (os === 'darwin') {
      execSync(`open "${url}"`, { stdio: 'ignore' });
    } else if (os === 'win32') {
      execSync(`start "" "${url}"`, { stdio: 'ignore' });
    } else {
      execSync(`xdg-open "${url}"`, { stdio: 'ignore' });
    }
    console.log(chalk.gray(`  Opening ${url} in your browser...\n`));
  } catch {
    // Browser open is best-effort
  }
}

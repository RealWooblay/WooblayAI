#!/usr/bin/env node

/**
 * MCP Executor — runs a single MCP tool call in an ephemeral container.
 *
 * 1. Resolves the MCP server command to a runnable binary
 * 2. Starts the upstream MCP server as a child process (stdio transport)
 * 3. Connects as an MCP client
 * 4. Calls a single tool with provided args
 * 5. Prints the result as JSON to stdout
 * 6. Exits (container auto-destroyed by --rm)
 *
 * Reads tool params from env vars (set by secure-exec via --env-file):
 *   MCP_SERVER_CMD  — e.g. "npx -y @modelcontextprotocol/server-github"
 *   MCP_TOOL_NAME   — e.g. "search_repositories"
 *   MCP_TOOL_ARGS   — JSON string, e.g. '{"query":"wooblay"}'
 *
 * Credentials are injected as env vars by the secure-exec engine.
 * This script never logs credentials — only the tool result.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { execSync } from 'node:child_process';
import { readFileSync, existsSync, readdirSync } from 'node:fs';

const TIMEOUT_MS = 90_000;
const INSTALL_DIR = '/tmp/mcp-pkg';

/**
 * Resolve a server command string into a { cmd, args } pair that will
 * definitely be executable — even on a read-only filesystem with tmpfs.
 *
 * Strategy:
 *   1. Not npx → pass through as-is (e.g. "node server.js")
 *   2. "npx -y @scope/pkg" → npm-install to /tmp, read the package.json
 *      bin field, run the entry point via `node` (no execute-bit needed,
 *      works on any MCP package without pre-installing anything)
 */
function resolveServerCommand(serverStr) {
  const parts = serverStr.trim().split(/\s+/).filter(Boolean);

  if (parts[0] !== 'npx') {
    return { cmd: parts[0], args: parts.slice(1) };
  }

  const cleaned = parts.slice(1).filter(a => a !== '-y' && a !== '--yes');
  const pkg = cleaned[0];
  const extraArgs = cleaned.slice(1);

  if (!pkg) {
    return { cmd: parts[0], args: parts.slice(1) };
  }

  // Install the package to /tmp and resolve the bin entry point
  try {
    process.stderr.write(`[executor] Installing ${pkg}...\n`);
    execSync(`npm install --prefix ${INSTALL_DIR} ${pkg} 2>&1`, {
      timeout: 60_000,
      env: { ...process.env, npm_config_fund: 'false', npm_config_audit: 'false' },
    });

    const pkgDir = `${INSTALL_DIR}/node_modules/${pkg}`;
    if (existsSync(`${pkgDir}/package.json`)) {
      const pj = JSON.parse(readFileSync(`${pkgDir}/package.json`, 'utf8'));
      const binEntry = typeof pj.bin === 'string'
        ? pj.bin
        : pj.bin ? Object.values(pj.bin)[0] : null;

      if (binEntry) {
        const entryPoint = `${pkgDir}/${binEntry}`;
        process.stderr.write(`[executor] Resolved → node ${entryPoint}\n`);
        return { cmd: 'node', args: [entryPoint, ...extraArgs] };
      }
    }

    // Fallback: chmod the .bin/ entries and use directly
    const binDir = `${INSTALL_DIR}/node_modules/.bin`;
    if (existsSync(binDir)) {
      const bins = readdirSync(binDir);
      if (bins.length) {
        execSync(`chmod +x ${binDir}/* 2>/dev/null || true`);
        return { cmd: `${binDir}/${bins[0]}`, args: extraArgs };
      }
    }
  } catch (e) {
    process.stderr.write(`[executor] Install failed: ${e.message}\n`);
  }

  process.stderr.write(`[executor] Falling back to npx\n`);
  return { cmd: parts[0], args: parts.slice(1) };
}

async function main() {
  const serverStr = process.env.MCP_SERVER_CMD;
  const toolName = process.env.MCP_TOOL_NAME;
  const argsStr = process.env.MCP_TOOL_ARGS || '{}';

  if (!serverStr || !toolName) {
    process.stderr.write('Missing MCP_SERVER_CMD or MCP_TOOL_NAME env vars\n');
    process.exit(1);
  }

  process.stderr.write(`[executor] uid=${process.getuid()} serverCmd="${serverStr}"\n`);

  const { cmd: serverCmd, args: serverArgs } = resolveServerCommand(serverStr);
  process.stderr.write(`[executor] Resolved → cmd="${serverCmd}" args=${JSON.stringify(serverArgs)}\n`);

  let toolArgs;
  try {
    toolArgs = JSON.parse(argsStr);
  } catch {
    process.stderr.write(`Invalid JSON in MCP_TOOL_ARGS: ${argsStr}\n`);
    process.exit(1);
  }

  const timeout = setTimeout(() => {
    process.stderr.write(`Timeout: MCP tool call exceeded ${TIMEOUT_MS}ms\n`);
    process.exit(124);
  }, TIMEOUT_MS);

  let transport;
  try {
    transport = new StdioClientTransport({
      command: serverCmd,
      args: serverArgs,
      env: { ...process.env },
    });

    const client = new Client({ name: 'wooblay-executor', version: '1.0.0' });
    await client.connect(transport);

    const result = await client.callTool({
      name: toolName,
      arguments: toolArgs,
    });

    clearTimeout(timeout);

    process.stdout.write(JSON.stringify(result) + '\n');
    await client.close();
    process.exit(0);
  } catch (err) {
    clearTimeout(timeout);
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`MCP executor error: ${msg}\n`);
    process.stdout.write(JSON.stringify({ content: [{ type: 'text', text: `Error: ${msg}` }], isError: true }) + '\n');
    process.exit(1);
  }
}

main();

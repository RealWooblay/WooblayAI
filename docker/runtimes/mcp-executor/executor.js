#!/usr/bin/env node

/**
 * MCP Executor — runs a single MCP tool call in an ephemeral container.
 *
 * 1. Starts the upstream MCP server as a child process (stdio transport)
 * 2. Connects as an MCP client
 * 3. Calls a single tool with provided args
 * 4. Prints the result as JSON to stdout
 * 5. Exits (container auto-destroyed by --rm)
 *
 * Reads tool params from env vars (set by secure-exec via --env-file):
 *   MCP_SERVER_CMD  — e.g. "npx @modelcontextprotocol/server-github"
 *   MCP_TOOL_NAME   — e.g. "search_repositories"
 *   MCP_TOOL_ARGS   — JSON string, e.g. '{"query":"wooblay"}'
 *
 * Credentials are injected as env vars by the secure-exec engine.
 * This script never logs credentials — only the tool result.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const TIMEOUT_MS = 90_000;

async function main() {
  const serverStr = process.env.MCP_SERVER_CMD;
  const toolName = process.env.MCP_TOOL_NAME;
  const argsStr = process.env.MCP_TOOL_ARGS || '{}';

  if (!serverStr || !toolName) {
    process.stderr.write('Missing MCP_SERVER_CMD or MCP_TOOL_NAME env vars\n');
    process.exit(1);
  }

  const serverParts = serverStr.split(/\s+/);
  const serverCmd = serverParts[0];
  const serverArgs = serverParts.slice(1);
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

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
 * Credentials are injected as env vars by the secure-exec engine.
 * This script never logs credentials — only the tool result.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { parseArgs } from 'node:util';

const TIMEOUT_MS = 90_000;

async function main() {
  const { values } = parseArgs({
    options: {
      server: { type: 'string' },
      tool: { type: 'string' },
      args: { type: 'string', default: '{}' },
    },
    strict: true,
  });

  if (!values.server || !values.tool) {
    process.stderr.write('Usage: executor.js --server <cmd> --tool <name> --args <json>\n');
    process.exit(1);
  }

  const serverParts = values.server.split(/\s+/);
  const serverCmd = serverParts[0];
  const serverArgs = serverParts.slice(1);
  let toolArgs;

  try {
    toolArgs = JSON.parse(values.args);
  } catch {
    process.stderr.write(`Invalid JSON args: ${values.args}\n`);
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
      name: values.tool,
      arguments: toolArgs,
    });

    clearTimeout(timeout);

    // Output result as JSON on stdout — this is what secure-exec captures
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

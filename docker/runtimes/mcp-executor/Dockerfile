# ─────────────────────────────────────────────────────────────────────────────
# MCP Executor — Ephemeral container for isolated MCP tool execution (Layer 3)
#
# For each credentialed MCP tool call, secure-exec:
#   1. Spins up this container with vault creds as env vars
#   2. Runs executor.js which starts the MCP server, calls one tool
#   3. Captures stdout (the tool result)
#   4. Destroys the container
#
# The agent NEVER sees credentials. They exist only inside this
# ephemeral container for the duration of one tool call, then are gone.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-slim

RUN apt-get update -qq && \
    apt-get install -y --no-install-recommends git curl && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /opt/wooblay

# package.json enables ESM ("type":"module") and installs the MCP SDK locally
# so `import '@modelcontextprotocol/sdk/...'` resolves from node_modules here.
COPY package.json /opt/wooblay/package.json
RUN npm install --omit=dev && npm cache clean --force

COPY executor.js /opt/wooblay/mcp-executor.js

# Pre-install popular MCP servers globally so npx finds them instantly.
RUN npm install -g \
    @modelcontextprotocol/server-github \
    @modelcontextprotocol/server-filesystem \
    @modelcontextprotocol/server-fetch \
    2>/dev/null || true && \
    npm cache clean --force

USER node
WORKDIR /tmp

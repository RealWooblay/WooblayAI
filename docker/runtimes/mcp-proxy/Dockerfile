# ─────────────────────────────────────────────────────────────────────────────
# Wooblay MCP Proxy — security membrane between agents and upstream MCP servers
#
# Runs as a sidecar alongside agent containers. Exposes a single SSE endpoint
# that agents connect to. Discovers tools from upstream MCP servers, gates
# every tool call through the Wooblay Gate, and routes credentialed tools
# to Layer 3 ephemeral execution.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-slim

RUN apt-get update -qq && \
    apt-get install -y --no-install-recommends curl && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY apps/mcp-proxy/package.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY apps/mcp-proxy/dist ./dist

USER node
EXPOSE 3100

HEALTHCHECK --interval=15s --timeout=3s --start-period=10s \
    CMD curl -f http://localhost:3100/health || exit 1

ENTRYPOINT ["node", "dist/server.js"]

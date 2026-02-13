# ─────────────────────────────────────────────────────────────────────────────
# OpenClaw Runtime with Wooblay Supervision (v7 — Unrestricted + Hook Monitor)
#
# Strategy:
#   1. OpenClaw runs UNRESTRICTED — full access to all tools incl. sub-agents
#   2. Hook (handler.ts) monitors ALL tool events → audit log in Wooblay Gate
#   3. Plugin also registers gated_* extras for optional blocking workflow
#   4. No deny list, no allow list — OpenClaw is OpenClaw
# ─────────────────────────────────────────────────────────────────────────────
FROM alpine/openclaw:main

# Switch to root for package installation
USER root

# Install utilities (Debian-based image)
RUN apt-get update -qq && \
    apt-get install -y --no-install-recommends \
      curl && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Create working directories
RUN mkdir -p /opt/wooblay \
    /root/.openclaw/extensions/wooblay

# ── Wooblay Plugin (OpenClaw extension) ──────────────────────────────────
COPY packages/adapters/openclaw/plugin/openclaw.plugin.json /root/.openclaw/extensions/wooblay/openclaw.plugin.json
COPY packages/adapters/openclaw/plugin/index.ts /root/.openclaw/extensions/wooblay/index.ts

# ── Entrypoint ─────────────────────────────────────────────────────────────
COPY docker/runtimes/openclaw/entrypoint.sh /opt/wooblay/entrypoint.sh
RUN chmod +x /opt/wooblay/entrypoint.sh

# ── Environment ───────────────────────────────────────────────────────────
ENV GATE_URL="http://localhost:4800"
ENV OPENCLAW_GATEWAY_TOKEN=""

EXPOSE 18789

ENTRYPOINT ["/opt/wooblay/entrypoint.sh"]

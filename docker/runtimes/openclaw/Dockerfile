# ─────────────────────────────────────────────────────────────────────────────
# OpenClaw Runtime with Wooblay Supervision (v5 — Gated Tools)
#
# Strategy:
#   1. Plugin registers gated_exec, gated_write, gated_edit, gated_web_fetch
#   2. OpenClaw config denies built-in risky tools (exec, write, etc.)
#   3. Every gated tool call → Wooblay Gate API → policy decision → execute/block
#   4. Plugin lives at ~/.openclaw/extensions/wooblay/
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

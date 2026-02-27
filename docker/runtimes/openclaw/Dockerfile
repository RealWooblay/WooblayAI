# ─────────────────────────────────────────────────────────────────────────────
# OpenClaw Runtime with Wooblay Gate Enforcement
#
# The agent has FULL access to all tools — no capability restrictions.
# Every risky action routes through Wooblay Gate for policy evaluation:
#   AI risk classification → policy rules → ALLOW / DENY / PENDING_APPROVAL
#
# Enforcement layers:
#   1. Plugin overrides built-in tool names (exec, write, edit, etc.)
#      so every call goes through Gate before executing.
#   2. Hook handler is the fail-safe — if a tool call somehow bypasses
#      the plugin, the hook checks Gate and throws on DENY.
#
# Gate is the ONLY decision maker. No static allowlists or denylists.
# Policy is dynamic — controlled from the Wooblay dashboard.
# ─────────────────────────────────────────────────────────────────────────────
FROM alpine/openclaw:main

USER root

RUN apt-get update -qq && \
    apt-get install -y --no-install-recommends curl && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# ClawHub CLI for community skill management (search, install, update)
RUN npm i -g clawhub

RUN mkdir -p /opt/wooblay \
    /home/agent/.openclaw/extensions/wooblay

# ── Wooblay Plugin — install from npm, then copy into place ──────────────
RUN npm i -g @wooblay/openclaw-adapter && \
    cp $(npm root -g)/@wooblay/openclaw-adapter/dist/plugin/openclaw.plugin.json /opt/wooblay/plugin/openclaw.plugin.json && \
    cp $(npm root -g)/@wooblay/openclaw-adapter/dist/plugin/index.js /opt/wooblay/plugin/index.js

# ── Permissive exec-approvals — OpenClaw doesn't block anything itself ───
# Gate handles all policy decisions, not OpenClaw's approval system.
COPY docker/runtimes/openclaw/exec-approvals.json /opt/wooblay/exec-approvals.json

# ── Entrypoint ───────────────────────────────────────────────────────────
COPY docker/runtimes/openclaw/entrypoint.sh /opt/wooblay/entrypoint.sh
RUN chmod +x /opt/wooblay/entrypoint.sh

ENV GATE_URL="http://localhost:4800"
ENV OPENCLAW_GATEWAY_TOKEN=""

EXPOSE 18789

ENTRYPOINT ["/opt/wooblay/entrypoint.sh"]

#!/bin/bash
set -euo pipefail

echo "=== Wooblay OpenClaw Runtime ==="
echo "  Gate URL:     ${GATE_URL}"
echo "  Model:        ${OPENCLAW_MODEL:-claude-sonnet-4-20250514}"
echo "  Enforcement:  All actions route through Wooblay Gate (plugin + hook)"
echo "  Capabilities: UNRESTRICTED — Gate decides policy, not static config"

# ── Gateway token ─────────────────────────────────────────────────────────
if [ -z "${OPENCLAW_GATEWAY_TOKEN:-}" ]; then
  export OPENCLAW_GATEWAY_TOKEN=$(head -c 32 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 32)
fi
echo "  Token:        ${OPENCLAW_GATEWAY_TOKEN:0:8}... (internal)"

# ── Build agents list JSON ────────────────────────────────────────────────
OPENCLAW_MODEL="${OPENCLAW_MODEL:-claude-sonnet-4-20250514}"
if [ -n "${OPENCLAW_AGENTS_JSON:-}" ]; then
  AGENTS_LIST="${OPENCLAW_AGENTS_JSON}"
  echo "  Agents:       custom config"
else
  AGENTS_LIST="[{\"id\":\"main\",\"name\":\"default\",\"model\":\"${OPENCLAW_MODEL}\"}]"
  echo "  Agents:       single (main) with model ${OPENCLAW_MODEL}"
fi

# ── Credentials ───────────────────────────────────────────────────────────
echo "  GitHub:       Secure Execution (credentials managed by Gate)"
echo "  AWS:          Secure Execution (credentials managed by Gate)"
echo "  GCP:          Secure Execution (credentials managed by Gate)"

# ── Channels ──────────────────────────────────────────────────────────────
TELEGRAM_ENABLED="${TELEGRAM_ENABLED:-false}"
TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
TELEGRAM_ALLOWED_USERS="${TELEGRAM_ALLOWED_USERS:-}"

if [ "${TELEGRAM_ENABLED}" = "true" ] && [ -n "${TELEGRAM_BOT_TOKEN}" ]; then
  ALLOW_FROM="[]"
  if [ -n "${TELEGRAM_ALLOWED_USERS}" ]; then
    ALLOW_FROM="[$(echo "${TELEGRAM_ALLOWED_USERS}" | sed 's/[[:space:]]//g')]"
  fi
  CHANNELS_CONFIG="{\"telegram\":{\"enabled\":true,\"botToken\":\"${TELEGRAM_BOT_TOKEN}\",\"dmPolicy\":\"allowlist\",\"allowFrom\":${ALLOW_FROM}}}"
  echo "  Telegram:     ENABLED (users: ${TELEGRAM_ALLOWED_USERS:-any})"
else
  CHANNELS_CONFIG="{}"
  echo "  Telegram:     disabled"
fi

# ── Identity: Seed SOUL.md + IDENTITY.md ──────────────────────────────────
INSTANCE_NAME="${INSTANCE_NAME:-agent}"
OPENCLAW_AGENT_ROLE="${OPENCLAW_AGENT_ROLE:-}"
OPENCLAW_AGENT_SOUL="${OPENCLAW_AGENT_SOUL:-}"
OPENCLAW_AGENT_GOAL="${OPENCLAW_AGENT_GOAL:-}"

mkdir -p /root/clawd

if [ -n "${OPENCLAW_AGENT_SOUL}" ]; then
  echo "${OPENCLAW_AGENT_SOUL}" > /root/clawd/SOUL.md
  echo "  Identity:     restored evolved SOUL.md (${#OPENCLAW_AGENT_SOUL} chars)"
elif [ -n "${OPENCLAW_AGENT_ROLE}" ]; then
  cat > /root/clawd/SOUL.md << SOULEOF
# Soul

You are **${INSTANCE_NAME}**, an AI agent supervised by Wooblay.

## Role
${OPENCLAW_AGENT_ROLE}

## Principles
- Stay within your assigned role. Actions outside it may be flagged or denied.
- Every risky action (file writes, shell commands, network requests) goes through
  Wooblay Gate for AI risk classification and policy evaluation.
- If an action is denied, do not attempt workarounds. Explain to the user why it was blocked.
- You may evolve this file as you learn more about your task.

## Goal
${OPENCLAW_AGENT_GOAL:-Work according to your role. Await instructions from your supervisor.}
SOULEOF
  echo "  Identity:     seeded SOUL.md from role: ${OPENCLAW_AGENT_ROLE:0:50}..."
else
  echo "  Identity:     no role set (agent will self-discover)"
fi

if [ -n "${OPENCLAW_AGENT_ROLE}" ] || [ -n "${OPENCLAW_AGENT_SOUL}" ]; then
  cat > /root/clawd/IDENTITY.md << IDEOF
# Identity — ${INSTANCE_NAME}

- **Name:** ${INSTANCE_NAME}
- **Role:** ${OPENCLAW_AGENT_ROLE:-not set}
- **Goal:** ${OPENCLAW_AGENT_GOAL:-awaiting instructions}
- **Supervisor:** Wooblay Gate (all risky actions are policy-gated)
- **Session:** This file was generated at startup. You may update it as you work.
IDEOF
  echo "  Identity:     wrote IDENTITY.md"
fi

# ── Create agent user (non-root) ──────────────────────────────────────────
# The agent runs as uid 1000. This is NOT capability restriction — the agent
# can still do anything through the gate (exec, write, delete, curl, etc.).
# This protects the GATE ITSELF: the plugin, hook, and config files are
# owned by root and read-only to the agent. The agent cannot modify the
# enforcement mechanism — same principle as a firewall on a separate VLAN.
AGENT_HOME="/home/agent"
id -u agent &>/dev/null 2>&1 || useradd -u 1000 -m -d "${AGENT_HOME}" -s /bin/bash agent

# Move identity files to agent home
if [ -d /root/clawd ]; then
  cp -r /root/clawd "${AGENT_HOME}/clawd"
  chown -R agent:agent "${AGENT_HOME}/clawd"
fi

# ── Install plugin + config (root-owned, agent-readable) ─────────────────
# These files are the enforcement mechanism. Agent can read them but not modify.
OPENCLAW_DIR="${AGENT_HOME}/.openclaw"
mkdir -p "${OPENCLAW_DIR}/extensions/wooblay"

cp /opt/wooblay/plugin/openclaw.plugin.json "${OPENCLAW_DIR}/extensions/wooblay/openclaw.plugin.json"
cp /opt/wooblay/plugin/index.ts "${OPENCLAW_DIR}/extensions/wooblay/index.ts"
cp /opt/wooblay/exec-approvals.json "${OPENCLAW_DIR}/exec-approvals.json"

# ── Generate OpenClaw config ──────────────────────────────────────────────
echo "→ Writing OpenClaw config..."

cat > "${OPENCLAW_DIR}/openclaw.json" << JSONEOF
{
  "gateway": {
    "mode": "local",
    "auth": {
      "token": "${OPENCLAW_GATEWAY_TOKEN}"
    },
    "remote": {
      "token": "${OPENCLAW_GATEWAY_TOKEN}"
    }
  },
  "plugins": {
    "enabled": true,
    "entries": {
      "wooblay": {
        "enabled": true,
        "config": {
          "gateUrl": "${GATE_URL}"
        }
      },
      "telegram": {
        "enabled": ${TELEGRAM_ENABLED}
      }
    }
  },
  "agents": {
    "list": ${AGENTS_LIST}
  },
  "channels": ${CHANNELS_CONFIG}
}
JSONEOF

echo "  OK: ${OPENCLAW_DIR}/openclaw.json"
echo "      Agent has full tool access — no capability restrictions"
echo "      Plugin overrides exec/write/edit/web_fetch → routes through Gate"
echo "      Hook monitors ALL tool events → blocks on DENY (fail-safe)"

# ── Lock down ONLY Wooblay enforcement files ─────────────────────────────
# The Wooblay plugin, config, and exec-approvals are the enforcement mechanism.
# These are root-owned and read-only — agent cannot modify the firewall.
#
# EVERYTHING ELSE in .openclaw is agent-writable:
#   - Other plugins (user-installed OpenClaw extensions)
#   - MCP server configs
#   - Custom tool definitions
#   - Session data, caches, etc.
#
# We protect the gate, not the agent's capabilities.
chown root:root "${OPENCLAW_DIR}/extensions/wooblay/openclaw.plugin.json"
chown root:root "${OPENCLAW_DIR}/extensions/wooblay/index.ts"
chown root:root "${OPENCLAW_DIR}/exec-approvals.json"
chown root:root "${OPENCLAW_DIR}/openclaw.json"
chmod 444 "${OPENCLAW_DIR}/extensions/wooblay/openclaw.plugin.json"
chmod 444 "${OPENCLAW_DIR}/extensions/wooblay/index.ts"
chmod 444 "${OPENCLAW_DIR}/exec-approvals.json"
chmod 444 "${OPENCLAW_DIR}/openclaw.json"

# Agent owns everything else — free to install plugins, MCP servers, tools
chown agent:agent "${OPENCLAW_DIR}"
chown agent:agent "${OPENCLAW_DIR}/extensions"
chown -R agent:agent "${AGENT_HOME}/clawd" 2>/dev/null || true
mkdir -p "${AGENT_HOME}/workspace"
chown -R agent:agent "${AGENT_HOME}/workspace"

# ── Install user-provided MCP servers ─────────────────────────────────────
# Users can pass MCP server config as a JSON env var. This gets written to
# a file the agent can read. MCP servers extend what tools are available —
# all tool calls still go through Gate regardless of source.
if [ -n "${OPENCLAW_MCP_SERVERS:-}" ]; then
  echo "${OPENCLAW_MCP_SERVERS}" > "${OPENCLAW_DIR}/mcp-servers.json"
  chown agent:agent "${OPENCLAW_DIR}/mcp-servers.json"
  echo "  MCP:          custom servers configured"
fi

# ── Install user-provided plugins ─────────────────────────────────────────
# Users can mount additional plugins at /opt/user-plugins/
# Each subdirectory becomes an OpenClaw extension.
if [ -d /opt/user-plugins ]; then
  for plugin_dir in /opt/user-plugins/*/; do
    plugin_name=$(basename "$plugin_dir")
    if [ "$plugin_name" = "wooblay" ]; then
      echo "  WARN: Skipping user plugin named 'wooblay' — cannot override enforcement plugin"
      continue
    fi
    cp -r "$plugin_dir" "${OPENCLAW_DIR}/extensions/${plugin_name}"
    chown -R agent:agent "${OPENCLAW_DIR}/extensions/${plugin_name}"
    echo "  Plugin:       installed user plugin '${plugin_name}'"
  done
fi

# ── Verify plugin ─────────────────────────────────────────────────────────
if [ -f "${OPENCLAW_DIR}/extensions/wooblay/index.ts" ]; then
  echo "  OK: Wooblay plugin installed (root-owned, agent-immutable)"
else
  echo "  FATAL: Wooblay plugin not found — actions will NOT go through Gate"
  exit 1
fi

# ── Wait for Wooblay Gate ─────────────────────────────────────────────────
echo "→ Waiting for Wooblay Gate..."
for i in $(seq 1 30); do
  if curl -sf "${GATE_URL}/health" > /dev/null 2>&1; then
    echo "  OK: Gate is healthy"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "  WARN: Gate not available after 60s — gated tools will BLOCK all actions (fail-safe)"
  fi
  sleep 2
done

# ── Run doctor --fix (as agent user) ──────────────────────────────────────
echo "→ Running OpenClaw doctor --fix..."
su -s /bin/bash agent -c "HOME=${AGENT_HOME} node /app/openclaw.mjs doctor --fix" 2>&1 || echo "  WARN: doctor --fix had non-zero exit (may be ok)"

# ── Start OpenClaw Gateway (drops to non-root) ───────────────────────────
echo ""
echo "→ Starting OpenClaw gateway as agent (uid 1000)..."
echo "  Agent has full capabilities — Wooblay Gate enforces policy dynamically"
echo "  Agent CANNOT modify: plugin, hook, openclaw.json, exec-approvals (root-owned)"
if [ "${TELEGRAM_ENABLED}" = "true" ]; then
  echo "  Telegram bot active"
fi
echo ""

# Drop to non-root. Agent can do anything through the gate, but cannot
# modify the gate itself. This is exec (replaces shell) — no way back to root.
exec su -s /bin/bash agent -c "HOME=${AGENT_HOME} exec node /app/openclaw.mjs gateway"

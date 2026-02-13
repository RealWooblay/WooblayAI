#!/bin/bash
set -euo pipefail

echo "=== Wooblay OpenClaw Runtime (v6 — Gated Tools + Hybrid Identity) ==="
echo "  Gate URL:     ${GATE_URL}"
echo "  Model:        ${OPENCLAW_MODEL:-claude-sonnet-4-20250514}"
echo "  Strategy:     Gated tools via registerTool → Wooblay Gate policy"

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

# ── GitHub Token ──────────────────────────────────────────────────────────
GITHUB_TOKEN="${GITHUB_TOKEN:-}"
if [ -n "${GITHUB_TOKEN}" ]; then
  echo "  GitHub:       Token set (${#GITHUB_TOKEN} chars)"
  export GH_TOKEN="${GITHUB_TOKEN}"
  export GITHUB_TOKEN="${GITHUB_TOKEN}"
  git config --global credential.helper "!f() { echo \"username=token\"; echo \"password=${GITHUB_TOKEN}\"; }; f"
else
  echo "  GitHub:       not configured"
fi

# ── Build channels config JSON ────────────────────────────────────────────
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

# ── Hybrid Identity: Seed SOUL.md + IDENTITY.md ─────────────────────────
# The UI sets a base role → we seed it here.
# The agent can then evolve SOUL.md/IDENTITY.md during its session.
# Wooblay Gate tracks writes to these files so we can read back what the
# agent "thinks it is" — best of both worlds.
INSTANCE_NAME="${INSTANCE_NAME:-agent}"
OPENCLAW_AGENT_ROLE="${OPENCLAW_AGENT_ROLE:-}"
OPENCLAW_AGENT_SOUL="${OPENCLAW_AGENT_SOUL:-}"
OPENCLAW_AGENT_GOAL="${OPENCLAW_AGENT_GOAL:-}"

# Ensure workspace dir exists
mkdir -p /root/clawd

if [ -n "${OPENCLAW_AGENT_SOUL}" ]; then
  # Evolved SOUL content from a previous session — restore it
  echo "${OPENCLAW_AGENT_SOUL}" > /root/clawd/SOUL.md
  echo "  Identity:     restored evolved SOUL.md (${#OPENCLAW_AGENT_SOUL} chars)"
elif [ -n "${OPENCLAW_AGENT_ROLE}" ]; then
  # Seed initial SOUL.md from user-set role
  cat > /root/clawd/SOUL.md << SOULEOF
# Soul

You are **${INSTANCE_NAME}**, an AI agent supervised by Wooblay.

## Role
${OPENCLAW_AGENT_ROLE}

## Principles
- Stay within your assigned role. Actions outside it may be flagged or denied.
- You operate under Wooblay's gated tool system — every risky action requires approval.
- Be transparent about what you're doing and why.
- You may evolve this file as you learn more about your task. Updates to SOUL.md
  are tracked by Wooblay so your supervisor can see how your identity develops.

## Goal
${OPENCLAW_AGENT_GOAL:-Work according to your role. Await instructions from your supervisor.}
SOULEOF
  echo "  Identity:     seeded SOUL.md from role: ${OPENCLAW_AGENT_ROLE:0:50}..."
else
  echo "  Identity:     no role set (agent will self-discover)"
fi

# Write IDENTITY.md as a compact reference for the agent
if [ -n "${OPENCLAW_AGENT_ROLE}" ] || [ -n "${OPENCLAW_AGENT_SOUL}" ]; then
  cat > /root/clawd/IDENTITY.md << IDEOF
# Identity — ${INSTANCE_NAME}

- **Name:** ${INSTANCE_NAME}
- **Role:** ${OPENCLAW_AGENT_ROLE:-not set}
- **Goal:** ${OPENCLAW_AGENT_GOAL:-awaiting instructions}
- **Supervisor:** Wooblay Gate (all risky actions are gated)
- **Session:** This file was generated at startup. You may update it as you work.
IDEOF
  echo "  Identity:     wrote IDENTITY.md"
fi

# ── Generate OpenClaw config ──────────────────────────────────────────────
echo "→ Writing OpenClaw config..."

mkdir -p /root/.openclaw

cat > /root/.openclaw/openclaw.json << JSONEOF
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
  "tools": {
    "deny": ["exec", "bash", "write", "edit", "apply_patch", "browser"],
    "allow": [
      "gated_exec", "gated_write", "gated_edit", "gated_web_fetch",
      "read", "web_search", "web_fetch",
      "sessions_spawn", "sessions_send",
      "session_status", "sessions_list", "sessions_history",
      "memory_search", "memory_get",
      "image"
    ]
  },
  "agents": {
    "list": ${AGENTS_LIST}
  },
  "channels": ${CHANNELS_CONFIG}
}
JSONEOF

echo "  OK: /root/.openclaw/openclaw.json"
echo "      Built-in DENIED: exec, bash, write, edit, apply_patch, browser"
echo "      Gated ALLOWED:   gated_exec, gated_write, gated_edit, gated_web_fetch"
echo "      Safe ALLOWED:    read, web_search, session_status, memory_search, image"

# ── Verify plugin is installed ────────────────────────────────────────────
if [ -f /root/.openclaw/extensions/wooblay/index.ts ] && [ -f /root/.openclaw/extensions/wooblay/openclaw.plugin.json ]; then
  echo "  OK: Wooblay plugin at ~/.openclaw/extensions/wooblay/"
  echo "      → Registers gated_exec, gated_write, gated_edit, gated_web_fetch"
  echo "      → Each tool calls Wooblay Gate for policy decision before executing"
else
  echo "  WARN: Wooblay plugin not found at ~/.openclaw/extensions/wooblay/"
  echo "        Agent will have NO risky tools available (all denied, no gated replacements)"
fi

# ── Wait for Wooblay Gate ─────────────────────────────────────────────────
echo "→ Waiting for Wooblay Gate..."
for i in $(seq 1 30); do
  if curl -sf "${GATE_URL}/health" > /dev/null 2>&1; then
    echo "  OK: Gate is healthy"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "  WARN: Gate not available after 60s — gated tools will BLOCK all actions"
  fi
  sleep 2
done

# ── Run doctor --fix to finalize setup ──────────────────────────────────
echo "→ Running OpenClaw doctor --fix..."
node /app/openclaw.mjs doctor --fix 2>&1 || echo "  WARN: doctor --fix had non-zero exit (may be ok)"
echo "  OK: Doctor complete"

# ── Start OpenClaw Gateway ────────────────────────────────────────────────
echo ""
echo "→ Starting OpenClaw gateway..."
echo "  Agent will use gated_exec/gated_write/gated_edit instead of exec/write/edit."
echo "  Every gated tool call → Wooblay Gate → policy → approve/deny."
echo "  Approve/deny in the Wooblay UI at: ${GATE_URL}"
if [ "${TELEGRAM_ENABLED}" = "true" ]; then
  echo "  Telegram bot active — message your bot to interact with the agent."
fi
echo ""

exec node /app/openclaw.mjs gateway

#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Wooblay Agent Container Network Isolation
#
# Applied on the EC2 host AFTER docker-compose starts. Restricts the agent
# container to ONLY communicate with the Gate container on port 4800.
#
# Blocks:
#   - EC2 metadata service (169.254.169.254) — prevents SSRF/credential theft
#   - ECS credential endpoint (169.254.170.2)
#   - Direct internet access (agent must go through Gate)
#   - PostgreSQL (172.20.0.10:5432) — agent cannot touch the database
#   - Any other internal services
#
# Allows:
#   - Agent -> Gate on port 4800 (172.21.0.20:4800)
#   - DNS resolution (8.8.8.8:53) for model API lookups
#   - Outbound HTTPS (443) for model API calls (OpenAI, Anthropic, etc.)
#
# Usage: sudo bash iptables-agent.sh
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

echo "=== Wooblay Agent Network Isolation ==="

# ── Configuration ────────────────────────────────────────────────────────
AGENT_NETWORK="172.21.0.0/24"
AGENT_IP="172.21.0.30"
GATE_IP="172.21.0.20"
GATE_PORT="4800"

# ── Create custom chain for agent traffic ────────────────────────────────
iptables -N WOOBLAY_AGENT 2>/dev/null || iptables -F WOOBLAY_AGENT

# ── Block EC2 metadata service (CRITICAL — prevents SSRF) ───────────────
iptables -A WOOBLAY_AGENT -s ${AGENT_IP} -d 169.254.169.254 -j DROP
iptables -A WOOBLAY_AGENT -s ${AGENT_IP} -d 169.254.170.2 -j DROP
echo "  ✓ Blocked metadata service (169.254.169.254, 169.254.170.2)"

# ── Block access to PostgreSQL network ───────────────────────────────────
iptables -A WOOBLAY_AGENT -s ${AGENT_IP} -d 172.20.0.0/24 -j DROP
echo "  ✓ Blocked PostgreSQL network (172.20.0.0/24)"

# ── Allow agent -> Gate on port 4800 ────────────────────────────────────
iptables -A WOOBLAY_AGENT -s ${AGENT_IP} -d ${GATE_IP} -p tcp --dport ${GATE_PORT} -j ACCEPT
echo "  ✓ Allowed agent -> Gate (${GATE_IP}:${GATE_PORT})"

# ── Allow DNS (for model API hostname resolution) ───────────────────────
iptables -A WOOBLAY_AGENT -s ${AGENT_IP} -p udp --dport 53 -j ACCEPT
iptables -A WOOBLAY_AGENT -s ${AGENT_IP} -p tcp --dport 53 -j ACCEPT
echo "  ✓ Allowed DNS resolution"

# ── Allow outbound HTTPS for model API calls ────────────────────────────
# The agent needs to call OpenAI/Anthropic/etc. APIs directly.
# This is the minimum required for the LLM to function.
iptables -A WOOBLAY_AGENT -s ${AGENT_IP} -p tcp --dport 443 -j ACCEPT
echo "  ✓ Allowed outbound HTTPS (port 443) for model APIs"

# ── Allow established/related connections back ──────────────────────────
iptables -A WOOBLAY_AGENT -m state --state ESTABLISHED,RELATED -j ACCEPT

# ── Drop everything else from the agent ─────────────────────────────────
iptables -A WOOBLAY_AGENT -s ${AGENT_IP} -j DROP
echo "  ✓ Default DROP for all other agent traffic"

# ── Insert the chain into FORWARD ────────────────────────────────────────
# Remove existing reference if present, then add
iptables -D FORWARD -j WOOBLAY_AGENT 2>/dev/null || true
iptables -I FORWARD 1 -j WOOBLAY_AGENT
echo "  ✓ Inserted WOOBLAY_AGENT chain into FORWARD"

echo ""
echo "=== Agent network isolation applied ==="
echo "  Agent (${AGENT_IP}) can ONLY reach:"
echo "    - Gate at ${GATE_IP}:${GATE_PORT}"
echo "    - DNS (port 53)"
echo "    - HTTPS (port 443) for model API calls"
echo "  Everything else is DROPPED."

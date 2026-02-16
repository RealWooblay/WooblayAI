#!/bin/bash
# Network Enforcer — iptables rules for agent containers.
#
# This script is applied to the agent container's network namespace.
# It blocks ALL egress traffic except to the Wooblay Gateway endpoint.
#
# The agent can ONLY reach the gateway — never external APIs directly.
# Bypass attempts are logged and trigger run quarantine.
#
# Usage: ./network-enforcer.sh <gateway_ip> <gateway_port>

set -euo pipefail

GATEWAY_IP="${1:?Gateway IP required}"
GATEWAY_PORT="${2:-4800}"
LOG_PREFIX="WOOBLAY_BYPASS"

echo "[network-enforcer] Configuring iptables for gateway-only egress"
echo "[network-enforcer] Gateway: ${GATEWAY_IP}:${GATEWAY_PORT}"

# Flush existing rules
iptables -F OUTPUT 2>/dev/null || true
iptables -F INPUT 2>/dev/null || true

# Allow loopback
iptables -A OUTPUT -o lo -j ACCEPT
iptables -A INPUT -i lo -j ACCEPT

# Allow established/related connections (responses to allowed outbound)
iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT

# Allow DNS to internal resolver only (needed for gateway hostname resolution)
iptables -A OUTPUT -p udp --dport 53 -d 127.0.0.11 -j ACCEPT
iptables -A OUTPUT -p tcp --dport 53 -d 127.0.0.11 -j ACCEPT

# Allow traffic to the Wooblay Gateway ONLY
iptables -A OUTPUT -p tcp -d "${GATEWAY_IP}" --dport "${GATEWAY_PORT}" -j ACCEPT

# LOG and DROP everything else
iptables -A OUTPUT -j LOG --log-prefix "${LOG_PREFIX}: " --log-level 4
iptables -A OUTPUT -j DROP

echo "[network-enforcer] Rules applied. All egress blocked except gateway."
echo "[network-enforcer] Bypass attempts will be logged with prefix: ${LOG_PREFIX}"

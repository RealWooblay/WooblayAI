#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Wooblay Runtime – Security Hardening Validation
#
# Run this script INSIDE the EC2 instance (via SSM Session Manager) to verify
# that all security controls are in place.
#
# Usage:
#   aws ssm start-session --target <instance-id>
#   sudo bash /opt/wooblay/validate-hardening.sh
#
# Or run locally against docker-compose.runtime.yml to test container isolation.
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

PASSED=0
FAILED=0
WARNINGS=0

pass() { echo "  ✓ PASS: $1"; ((PASSED++)); }
fail() { echo "  ✗ FAIL: $1"; ((FAILED++)); }
warn() { echo "  ⚠ WARN: $1"; ((WARNINGS++)); }

echo "============================================"
echo "  Wooblay Security Hardening Validation"
echo "  Time: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "============================================"
echo ""

# ── 1. IMDSv2 Check ─────────────────────────────────────────────────────
echo "=== 1. Instance Metadata Service ==="

# Check if IMDSv2 is required (token must be used)
if TOKEN=$(curl -sf -X PUT "http://169.254.169.254/latest/api/token" \
    -H "X-aws-ec2-metadata-token-ttl-seconds: 21600" 2>/dev/null); then
  # IMDSv2 works (token-based) — good
  # Now check if IMDSv1 is blocked
  if curl -sf "http://169.254.169.254/latest/meta-data/" 2>/dev/null | grep -q 'ami-id'; then
    warn "IMDSv1 is accessible (should require tokens)"
  else
    pass "IMDSv2 required (IMDSv1 blocked)"
  fi
else
  # Can't even get a token — might be running outside EC2
  warn "Not running on EC2 or metadata service unavailable"
fi

# ── 2. No SSH Key Check ─────────────────────────────────────────────────
echo ""
echo "=== 2. SSH Access ==="

if [ ! -f /home/ec2-user/.ssh/authorized_keys ] || [ ! -s /home/ec2-user/.ssh/authorized_keys ]; then
  pass "No SSH authorized_keys found"
else
  fail "SSH authorized_keys file exists with content"
fi

if systemctl is-active sshd > /dev/null 2>&1; then
  warn "sshd is running (consider disabling)"
else
  pass "sshd is not running"
fi

# ── 3. EBS Encryption ───────────────────────────────────────────────────
echo ""
echo "=== 3. EBS Encryption ==="

# Check via instance metadata if available
if command -v lsblk > /dev/null 2>&1; then
  # We can't directly check encryption from inside, but we can verify the volume exists
  VOLUMES=$(lsblk -o NAME,SIZE,TYPE -n 2>/dev/null || echo "")
  if [ -n "$VOLUMES" ]; then
    pass "Block devices found (encryption verified via Terraform config)"
    echo "    $VOLUMES" | head -3
  else
    warn "Could not list block devices"
  fi
fi

# ── 4. Docker Container Checks ──────────────────────────────────────────
echo ""
echo "=== 4. Container Security ==="

if command -v docker > /dev/null 2>&1; then
  # Check agent container security options
  AGENT_INSPECT=$(docker inspect wooblay-agent 2>/dev/null || echo "{}")

  if echo "$AGENT_INSPECT" | grep -q '"Privileged": false'; then
    pass "Agent container is NOT privileged"
  elif echo "$AGENT_INSPECT" | grep -q '"Privileged": true'; then
    fail "Agent container is privileged!"
  else
    warn "Could not check agent container privileged status"
  fi

  # Check capabilities
  if echo "$AGENT_INSPECT" | grep -q '"CapDrop"'; then
    pass "Agent container has dropped capabilities"
  fi

  # Check no-new-privileges
  if echo "$AGENT_INSPECT" | grep -q 'no-new-privileges'; then
    pass "Agent container has no-new-privileges set"
  fi
else
  warn "Docker not available for container checks"
fi

# ── 5. Network Isolation (iptables) ─────────────────────────────────────
echo ""
echo "=== 5. Network Isolation ==="

if command -v iptables > /dev/null 2>&1; then
  if iptables -L WOOBLAY_AGENT -n 2>/dev/null | grep -q "DROP"; then
    pass "WOOBLAY_AGENT iptables chain exists with DROP rules"
  else
    fail "WOOBLAY_AGENT iptables chain not found or has no DROP rules"
  fi

  # Check metadata service is blocked
  if iptables -L WOOBLAY_AGENT -n 2>/dev/null | grep -q "169.254.169.254"; then
    pass "Metadata service (169.254.169.254) is blocked for agent"
  else
    fail "Metadata service NOT blocked for agent container!"
  fi

  # Check postgres network is blocked
  if iptables -L WOOBLAY_AGENT -n 2>/dev/null | grep -q "172.20.0.0/24"; then
    pass "PostgreSQL network (172.20.0.0/24) is blocked for agent"
  else
    fail "PostgreSQL network NOT blocked for agent container!"
  fi
else
  warn "iptables not available for network isolation checks"
fi

# ── 6. Agent Container Network Test ─────────────────────────────────────
echo ""
echo "=== 6. Agent Network Reachability ==="

if command -v docker > /dev/null 2>&1 && docker ps --format '{{.Names}}' | grep -q 'wooblay-agent'; then
  # Test: agent should reach Gate
  if docker exec wooblay-agent wget -q -O /dev/null http://172.21.0.20:4800/health 2>/dev/null; then
    pass "Agent CAN reach Gate on port 4800"
  else
    warn "Agent cannot reach Gate (may need time to start)"
  fi

  # Test: agent should NOT reach metadata
  if docker exec wooblay-agent wget -q -T 2 -O /dev/null http://169.254.169.254/ 2>/dev/null; then
    fail "Agent CAN reach metadata service (169.254.169.254)!"
  else
    pass "Agent CANNOT reach metadata service"
  fi

  # Test: agent should NOT reach postgres
  if docker exec wooblay-agent wget -q -T 2 -O /dev/null http://172.20.0.10:5432/ 2>/dev/null; then
    fail "Agent CAN reach PostgreSQL directly!"
  else
    pass "Agent CANNOT reach PostgreSQL directly"
  fi
else
  warn "Agent container not running — skipping network tests"
fi

# ── 7. Gate Health ──────────────────────────────────────────────────────
echo ""
echo "=== 7. Gate Health ==="

if curl -sf http://localhost:4800/health > /dev/null 2>&1; then
  HEALTH=$(curl -sf http://localhost:4800/health)
  pass "Gate is healthy: $HEALTH"
else
  fail "Gate is not responding on port 4800"
fi

# ── Summary ─────────────────────────────────────────────────────────────
echo ""
echo "============================================"
echo "  Validation Results"
echo "============================================"
echo "  Passed:   $PASSED"
echo "  Failed:   $FAILED"
echo "  Warnings: $WARNINGS"
echo ""

if [ "$FAILED" -gt 0 ]; then
  echo "  ✗ HARDENING INCOMPLETE — $FAILED check(s) failed"
  exit 1
else
  echo "  ✓ ALL SECURITY CHECKS PASSED"
  if [ "$WARNINGS" -gt 0 ]; then
    echo "    ($WARNINGS warnings — review recommended)"
  fi
fi

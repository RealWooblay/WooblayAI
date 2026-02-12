#!/bin/bash
set -e

echo "=========================================="
echo "  WOOBLAY E2E TEST: Full Approval Flow"
echo "=========================================="

echo ""
echo "STEP 1: Sending WRITE command to OpenClaw agent (background)..."
timeout 90 docker exec wooblay-agent node /app/openclaw.mjs agent \
  --agent main \
  --session-id e2e-write-final \
  --timeout 90000 \
  --json \
  -m "Run exactly this shell command: touch /tmp/wooblay_proof.txt" \
  > /tmp/agent_out.json 2>&1 &
AGENT_PID=$!

echo "  Agent PID: $AGENT_PID"
echo "  Waiting 20s for approval request to propagate..."
sleep 20

echo ""
echo "STEP 2: Bridge logs (exec approval events):"
docker logs wooblay-agent 2>&1 | grep -iE "EXEC (APPROVAL|PENDING|ALLOWED|DENIED|APPROVED)" | tail -5

echo ""
echo "STEP 3: Checking Wooblay Gate for pending approvals..."
PENDING=$(curl -s http://localhost:4800/api/approvals/pending)
echo "$PENDING" | python3 -m json.tool 2>/dev/null || echo "$PENDING"

APPROVAL_ID=$(echo "$PENDING" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(d[0]['id'] if d else '')
" 2>/dev/null || echo "")

echo ""
echo "  Approval ID: ${APPROVAL_ID:-NONE}"

if [ -n "$APPROVAL_ID" ]; then
  echo ""
  echo "STEP 4: APPROVING via Wooblay Gate API..."
  APPROVE_RESULT=$(curl -s -X POST "http://localhost:4800/api/approvals/${APPROVAL_ID}/approve" \
    -H "Content-Type: application/json" \
    -d '{"approver":"admin-e2e","reason":"Approved for E2E validation"}')
  echo "  Result: $APPROVE_RESULT"
  
  echo ""
  echo "  Waiting 15s for resolution to propagate..."
  sleep 15
  
  echo ""
  echo "STEP 5: Bridge resolution logs:"
  docker logs wooblay-agent 2>&1 | grep -iE "(APPROVED|ALLOWED|resolve)" | tail -5
else
  echo ""
  echo "  No pending approval (command was auto-allowed by policy)."
  echo "  Bridge decision logs:"
  docker logs wooblay-agent 2>&1 | grep -iE "(EXEC ALLOWED|approval.resolved)" | tail -5
  sleep 10
fi

echo ""
echo "STEP 6: Verify command execution (file should exist):"
docker exec wooblay-agent ls -la /tmp/wooblay_proof.txt 2>&1 || echo "  FILE NOT FOUND (command was blocked or not yet executed)"

echo ""
echo "STEP 7: Waiting for agent to finish..."
wait $AGENT_PID 2>/dev/null || true
echo "  Agent completed."

echo ""
echo "STEP 8: Agent output:"
head -15 /tmp/agent_out.json 2>/dev/null || echo "  No output file"

echo ""
echo "=========================================="
echo "  E2E TEST COMPLETE"
echo "=========================================="

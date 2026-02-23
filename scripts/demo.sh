#!/bin/bash
# Wooblay MVP Demo Script
#
# Simulates the full loop:
# 1. Create a GitHub connection
# 2. Simulate a GitHub CI failure webhook
# 3. Show the incident created by the sensor
# 4. Create a run for the incident
# 5. Create a proposal with evidence
# 6. Approve the proposal
# 7. Mint a capability token
# 8. Execute via the gateway
# 9. Export and verify the case file
#
# Prerequisites:
#   - Gate server running on localhost:4800
#   - Database migrated
#
# Usage:
#   ./scripts/demo.sh [--api-base http://localhost:4800]

set -euo pipefail

API_BASE="${1:-http://localhost:4800}"
BOLD='\033[1m'
GREEN='\033[32m'
YELLOW='\033[33m'
CYAN='\033[36m'
RESET='\033[0m'

step() {
  echo ""
  echo -e "${BOLD}${CYAN}──── Step $1: $2${RESET}"
  echo ""
}

ok() {
  echo -e "  ${GREEN}✓ $1${RESET}"
}

# ──────────────────────────────────────────────────────────────────────────────

echo -e "${BOLD}╔══════════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}║           Wooblay MVP Demo                      ║${RESET}"
echo -e "${BOLD}╚══════════════════════════════════════════════════╝${RESET}"

# Step 1: Create a GitHub connection
step 1 "Create GitHub Connection"
CONN=$(curl -s -X POST "${API_BASE}/api/connections" \
  -H "Content-Type: application/json" \
  -d '{"provider":"github","name":"Demo GitHub","credential":"ghp_demo_token_not_real","scopes":["repo"]}')
CONN_ID=$(echo "$CONN" | jq -r '.id')
ok "Connection created: $CONN_ID"

# Step 2: Simulate GitHub CI failure webhook
step 2 "Simulate GitHub CI Failure Webhook"
WEBHOOK_RESULT=$(curl -s -X POST "${API_BASE}/api/webhooks/github" \
  -H "Content-Type: application/json" \
  -H "X-GitHub-Event: check_run" \
  -d '{
    "action": "completed",
    "check_run": {
      "id": 12345,
      "name": "CI / test",
      "conclusion": "failure",
      "status": "completed",
      "head_sha": "abc123def456789",
      "check_suite": {
        "id": 99999,
        "head_branch": "main",
        "head_sha": "abc123def456789"
      }
    },
    "repository": {
      "full_name": "wooblay/demo-repo",
      "default_branch": "main"
    }
  }')
INCIDENT_ID=$(echo "$WEBHOOK_RESULT" | jq -r '.incidentId')
RUN_ID=$(echo "$WEBHOOK_RESULT" | jq -r '.runId')
SENSOR=$(echo "$WEBHOOK_RESULT" | jq -r '.sensor')
ok "Sensor matched: $SENSOR"
ok "Incident created: $INCIDENT_ID"
ok "Run auto-created: $RUN_ID"

# Step 3: View incident
step 3 "View Incident"
INCIDENT=$(curl -s "${API_BASE}/api/incidents/${INCIDENT_ID}")
echo "  Title: $(echo "$INCIDENT" | jq -r '.title')"
echo "  Priority: $(echo "$INCIDENT" | jq -r '.priority')"
echo "  Status: $(echo "$INCIDENT" | jq -r '.status')"
echo "  Source: $(echo "$INCIDENT" | jq -r '.source')"
ok "Incident details retrieved"

# Step 4: Transition run to running
step 4 "Start Run"
curl -s -X POST "${API_BASE}/api/runs/${RUN_ID}/transition" \
  -H "Content-Type: application/json" \
  -d '{"status":"scheduled"}' > /dev/null
curl -s -X POST "${API_BASE}/api/runs/${RUN_ID}/transition" \
  -H "Content-Type: application/json" \
  -d '{"status":"running"}' > /dev/null
ok "Run transitioned: pending → scheduled → running"

# Step 5: Create a proposal
step 5 "Create Proposal (Agent wants to push a fix)"
PROPOSAL=$(curl -s -X POST "${API_BASE}/api/proposals" \
  -H "Content-Type: application/json" \
  -d "{
    \"runId\": \"${RUN_ID}\",
    \"actionClass\": \"github:file:write\",
    \"toolName\": \"github_write_file\",
    \"args\": {\"owner\":\"wooblay\",\"repo\":\"demo-repo\",\"path\":\"src/fix.ts\",\"content\":\"// fix\"},
    \"riskClass\": \"medium\",
    \"compensatingAction\": \"Revert commit via git revert\"
  }")
PROPOSAL_ID=$(echo "$PROPOSAL" | jq -r '.id')
ok "Proposal created: $PROPOSAL_ID"

# Step 6: Approve the proposal
step 6 "Approve Proposal (Human review)"
APPROVED=$(curl -s -X POST "${API_BASE}/api/proposals/${PROPOSAL_ID}/approve" \
  -H "Content-Type: application/json" \
  -d '{"approver":"jack@wooblay.com"}')
ok "Proposal approved by $(echo "$APPROVED" | jq -r '.approver')"

# Step 7: Mint capability token
step 7 "Mint Capability Token"
CAP=$(curl -s -X POST "${API_BASE}/api/capabilities" \
  -H "Content-Type: application/json" \
  -d "{
    \"runId\": \"${RUN_ID}\",
    \"actionClass\": \"github:file:write\",
    \"scope\": {\"provider\":\"github\",\"repo\":\"wooblay/demo-repo\"},
    \"ttlMs\": 900000,
    \"maxUses\": 5
  }")
CAP_TOKEN=$(echo "$CAP" | jq -r '.token')
ok "Capability minted: ${CAP_TOKEN:0:20}..."
echo "  Expires: $(echo "$CAP" | jq -r '.expiresAt')"
echo "  Max uses: $(echo "$CAP" | jq -r '.maxUses')"

# Step 8: Execute via Gateway (will fail since demo token isn't real, but shows the flow)
step 8 "Execute via Tool Gateway"
GATEWAY_RESULT=$(curl -s -X POST "${API_BASE}/api/gateway/execute" \
  -H "Content-Type: application/json" \
  -d "{
    \"capabilityToken\": \"${CAP_TOKEN}\",
    \"action\": \"github:file:write\",
    \"params\": {\"owner\":\"wooblay\",\"repo\":\"demo-repo\",\"path\":\"src/fix.ts\",\"content\":\"// fix\",\"message\":\"fix: patch CI failure\"}
  }")
echo "  Gateway result: $(echo "$GATEWAY_RESULT" | jq -r '.success // .error')"
ok "Gateway executed (credential-shielded — agent never saw the GitHub token)"

# Step 9: View run timeline
step 9 "View Run Timeline"
EVENTS=$(curl -s "${API_BASE}/api/runs/${RUN_ID}/events")
EVENT_COUNT=$(echo "$EVENTS" | jq 'length')
ok "Timeline has $EVENT_COUNT events"
echo "$EVENTS" | jq -r '.[] | "  [\(.sequenceNum)] \(.type): \(.data | fromjson | tostring | .[0:80])"' 2>/dev/null || true

# Step 10: Export Case File
step 10 "Export & Verify Case File"
CASE_FILE=$(curl -s "${API_BASE}/api/case-files/${RUN_ID}")
echo "  Receipts: $(echo "$CASE_FILE" | jq '.integrity.receiptCount')"
echo "  Evidence: $(echo "$CASE_FILE" | jq '.integrity.evidenceCount')"
echo "  Proposals: $(echo "$CASE_FILE" | jq '.integrity.proposalCount')"
echo "  Content hash: $(echo "$CASE_FILE" | jq -r '.integrity.contentHash' | head -c 16)..."
ok "Case file exported"

# Step 11: Check insights
step 11 "View Insights"
SUMMARY=$(curl -s "${API_BASE}/api/insights/summary?days=30")
echo "  Incidents: $(echo "$SUMMARY" | jq '.incidents.total')"
echo "  Runs: $(echo "$SUMMARY" | jq '.runs.total')"
echo "  Proposals: $(echo "$SUMMARY" | jq '.proposals.total')"
echo "  Intervention rate: $(echo "$SUMMARY" | jq '.interventionRate')%"
ok "Insights computed"

# Done
echo ""
echo -e "${BOLD}${GREEN}╔══════════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}${GREEN}║           Demo Complete                          ║${RESET}"
echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════════════╝${RESET}"
echo ""
echo "Summary:"
echo "  - GitHub CI failure detected by typed sensor"
echo "  - Incident + run created automatically"
echo "  - Agent proposed an action (file write)"
echo "  - Human approved with evidence context"
echo "  - Capability token minted (scoped, time-bounded)"
echo "  - Gateway executed (agent NEVER saw the GitHub token)"
echo "  - Full audit trail in receipt chain"
echo "  - Case file exportable with integrity verification"
echo ""
echo -e "Run the case file verifier: ${YELLOW}npx tsx scripts/verify-case-file.ts case-file.json${RESET}"

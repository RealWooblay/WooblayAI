# Wooblay MVP — Architecture & Design

**Wooblay = Tenderly + Cloudflare for AI agents.**

- **Tenderly**: Simulate every action before it touches production. Evidence bundles prove safety.
- **Cloudflare**: Non-bypassable gateway between agents and the real world. Agents never hold credentials.
- Plus: Run orchestration, immutable receipts, case file export, insights metrics.

---

## Architecture

```
                         GitHub Webhooks
                              │
                     ┌────────┴────────┐
                     │  GitHub Sensors  │ (typed: CI fail, agent PR fail)
                     │  + Deduplication │
                     └────────┬────────┘
                              │ Incident
                     ┌────────┴────────┐
                     │   Orchestrator   │ State machine, scheduler,
                     │  (Run Manager)   │ preemption, loop detection,
                     │                  │ kill switch, quarantine
                     └────────┬────────┘
                              │ Run + Context
                     ┌────────┴────────┐
                     │   OpenClaw       │ (Brain — one runtime for MVP)
                     │   Runtime        │ Analyzes, proposes actions
                     └────────┬────────┘
                              │ Proposed Action
                 ┌────────────┴────────────┐
                 │     Evidence Engine      │ CI Replay: A/B sandbox
                 │  (simulate before act)   │ Structured diff, hash all I/O
                 └────────────┬────────────┘
                              │ Evidence Bundle
                 ┌────────────┴────────────┐
                 │      Policy Engine       │ Evaluate risk, evidence,
                 │    + Approval Flow       │ budget, approver
                 └────────────┬────────────┘
                              │ Approved + Cap Token
                 ┌────────────┴────────────┐
                 │      Tool Gateway        │ Validate cap token,
                 │  (non-bypassable)        │ retrieve credential,
                 │  Agent NEVER sees creds  │ execute, return result
                 └────────────┬────────────┘
                              │ Result
                 ┌────────────┴────────────┐
                 │   Receipt (chained)      │ Hash + signature
                 │   Case File Export       │ ZIP with verifier
                 └────────────┬────────────┘
                              │
                 ┌────────────┴────────────┐
                 │      Insights            │ Success %, override %,
                 │   (metric display)       │ rollback %, MTTF
                 └─────────────────────────┘
```

---

## Event Schema

All events flow through `WooblayEventBus` and are persisted to `EventLog`.

| Event                     | Data                                                |
|--------------------------|-----------------------------------------------------|
| `incident.created`       | incidentId, source, priority, title                 |
| `incident.updated`       | incidentId, status, previousStatus                  |
| `run.created`            | runId, incidentId, priority                         |
| `run.state_changed`      | runId, from, to, reason                             |
| `run.quarantined`        | runId, reason                                       |
| `run.budget_exceeded`    | runId, budgetCents, spentCents                      |
| `proposal.created`       | proposalId, runId, actionClass, riskClass           |
| `proposal.decided`       | proposalId, status, approver                        |
| `evidence.started`       | evidenceId, runId, recipeType                       |
| `evidence.completed`     | evidenceId, status, reproducible                    |
| `capability.issued`      | capabilityId, runId, actionClass, expiresAt         |
| `capability.revoked`     | capabilityId, reason                                |
| `capability.expired`     | capabilityId                                        |
| `gateway.executed`       | capabilityId, runId, actionClass, success           |
| `gateway.bypass_attempt` | runId, target, blocked                              |

---

## Data Models

### Incident
Context that triggers work. Sources: `github_ci`, `github_agent_pr`, `manual`.
Priority: P0 (production) > P1 (CI) > P2 (chore).

### Run
Unit of work tied to an incident. Deterministic ID: `sha256(incidentId + attempt)`.
State machine: pending → scheduled → running → {completed, failed, quarantined, paused}.

### Proposal
An action the agent wants to take within a run. Links to evidence bundle.
Status: pending → approved/denied → executed → verified/rolled_back.

### EvidenceBundle
Proof of what will happen before it happens. Recipes: `ci_replay`, `manual`.
Contains environment/inputs/outputs hashes for tamper evidence.

### Capability
Scoped, time-bounded, revocable token for agent actions.
Bound to (run, workspace, actionClass). Default TTL: 15 minutes.

### RunEvent
Consistent event schema per run. Types: state_change, tool_call, evidence, approval, error, budget.

### Connection
External service credential store. Provider: `github` (MVP). Agent never sees.

---

## Policy Model

### Evaluation Flow
1. Classify action risk (READ → WRITE → DESTRUCTIVE → structural + AI)
2. Check policy rules (glob match on tool name, risk tier, category)
3. If action has evidence: weight toward approval
4. If action is irreversible: always require human approval + compensating plan
5. Check budget (per-run + global daily)
6. Return: ALLOW (auto-execute), DENY, APPROVE (human needed)

### Enhanced Policy (MVP additions)
- Evidence requirement: high/critical risk actions need evidence bundles
- Budget check: per-run and global daily limits
- Irreversible flag: must have compensating action plan

---

## Capability Token Model

### Flow
1. Run starts → orchestrator is active
2. Agent proposes action → evidence gathered → policy approves
3. Capability minted: `wbl_cap_{random_hex}`
4. Token is scoped to: `(runId, actionClass, scope, maxUses, ttl)`
5. Agent sends token to Gateway
6. Gateway validates: not revoked, not expired, not over max uses, action matches
7. Gateway retrieves real credential from Connection store
8. Gateway executes action, returns result to agent
9. Agent NEVER sees the real credential

### Properties
- **Time-bounded**: 15-minute default TTL
- **Scoped**: bound to action class + resource (repo, branch)
- **Revocable**: kill switch revokes all capabilities for a run
- **Auditable**: every use logged to receipt chain
- **Max-use limited**: prevents infinite loops

---

## Threat Model

### Agent Credential Theft
**Threat**: Agent exfiltrates GitHub PAT/AWS key via tool output or network.
**Mitigation**: Agent never has credentials. Gateway holds them. iptables blocks all egress except gateway.

### Agent Bypasses Gateway
**Threat**: Agent makes direct HTTP calls to GitHub API.
**Mitigation**: Container iptables restrict ALL egress to gateway IP only. Bypass attempts logged + run quarantined.

### Agent Replay Attack
**Threat**: Agent replays a capability token.
**Mitigation**: Tokens have max-use limits, time expiry, and are bound to run ID. Revoked on kill.

### Tampered Evidence
**Threat**: Evidence bundle modified after creation.
**Mitigation**: All evidence hashed (SHA-256): inputs, outputs, environment. Hashes stored in receipt chain.

### Receipt Chain Tampering
**Threat**: Receipts modified to hide actions.
**Mitigation**: Hash chain (each receipt links to previous hash). ed25519 signatures. Standalone verifier script.

### Infinite Loop
**Threat**: Agent creates runs that create runs indefinitely.
**Mitigation**: Loop detection (5 runs in 5 minutes for same incident). Budget limits. Quarantine.

### Privilege Escalation
**Threat**: Agent requests broader capability than approved.
**Mitigation**: Capability scope checked on every gateway call. Action class matching is strict (not glob by default).

---

## Bypass Prevention

### Network Enforcer (iptables)
```bash
# Block ALL outbound traffic except to gateway
iptables -A OUTPUT -p tcp -d $GATEWAY_IP --dport $GATEWAY_PORT -j ACCEPT
iptables -A OUTPUT -j LOG --log-prefix "WOOBLAY_BYPASS: "
iptables -A OUTPUT -j DROP
```

### Kill Switch Flow
1. Operator triggers kill on a run
2. All active capabilities for that run → revoked
3. Run state → failed/cancelled
4. Agent container → stopped (if running)
5. All events logged to receipt chain

### Quarantine Flow
1. Bypass attempt detected, or anomaly flagged
2. Run state → quarantined (no further actions)
3. All capabilities → revoked
4. Alert sent to operators
5. Run can only transition to → cancelled (requires human)

---

## API Surface (New Endpoints)

### Incidents
- `GET /api/incidents` — list (filterable)
- `GET /api/incidents/:id` — detail with runs
- `POST /api/incidents` — create manually
- `PATCH /api/incidents/:id` — update status/priority

### Runs
- `GET /api/runs` — list (filterable)
- `GET /api/runs/:id` — detail with timeline
- `POST /api/runs` — create for incident
- `POST /api/runs/:id/transition` — state change
- `POST /api/runs/:id/pause` / `resume` / `kill` / `quarantine`
- `GET /api/runs/:id/events` — timeline
- `GET /api/runs/:id/budget` — budget check

### Proposals
- `GET /api/proposals` — list
- `GET /api/proposals/:id` — detail
- `POST /api/proposals` — create
- `POST /api/proposals/:id/evidence` — attach evidence
- `POST /api/proposals/:id/approve` / `deny` / `executed` / `verified`

### Capabilities
- `POST /api/capabilities` — mint
- `POST /api/capabilities/validate` — validate
- `POST /api/capabilities/:id/revoke` — revoke
- `GET /api/runs/:runId/capabilities` — list active

### Gateway
- `POST /api/gateway/execute` — execute action via capability token
- `POST /api/gateway/bypass-report` — log bypass attempt

### Connections
- `GET /api/connections` — list (credentials redacted)
- `POST /api/connections` — create
- `POST /api/connections/:id/revoke` / `test`
- `DELETE /api/connections/:id`

### Sensors
- `POST /api/webhooks/github` — GitHub webhook receiver
- `GET /api/sensors/status` — sensor status

### Insights
- `GET /api/insights/metrics` — per-action metrics
- `GET /api/insights/summary` — high-level summary

### Case Files
- `GET /api/case-files/:runId` — export
- `GET /api/case-files/:runId/verify` — verify integrity

---

## UI Pages

| Page | Route | Description |
|------|-------|-------------|
| Inbox | `/inbox` | Active incidents by priority |
| Incident | `/incidents/:id` | Detail + runs + timeline |
| Run | `/runs/:id` | State machine + proposals + evidence + timeline |
| Approvals | `/approvals` | Enhanced with evidence viewer |
| Insights | `/insights` | Success %, override %, rollback %, MTTF |
| Connections | `/connections` | GitHub connection management + sensor status |
| Policies | `/policies` | Existing |
| Activity | `/activity` | Existing |
| Dashboard | `/` | Existing command center |

---

## Explicitly Cut (V2)

- Declarative sensor DSL / JSONPath rule engine
- MCP protocol adapter
- Slack / arbitrary webhook sources
- Multi-runtime support (only OpenClaw for MVP)
- Autonomy ladder automation (auto-promote/demote)
- AWS/GCP gateway integrations (GitHub only for MVP)

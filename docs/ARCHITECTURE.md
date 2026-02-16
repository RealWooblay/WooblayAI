# Wooblay — Technical Architecture

**Sensor-first:** Connect sensors (e.g. GitHub); they produce **Operations**. Wooblay routes each Operation to the right agent, the agent runs (via the Tool Gateway), and every decision is receipted.

For Miro-ready diagrams (full technical, UX flow, UX-to-tech mapping), see **[ARCHITECTURE-DIAGRAMS.md](./ARCHITECTURE-DIAGRAMS.md)**.

---

## Monorepo Structure

```
wooblay/
  apps/
    gate/           — Fastify API (operations, sensors, runs, approvals, gateway, policies, instances)
    ui/             — React dashboard (Vite, Tailwind, TanStack Query)
  packages/
    types/          — Shared TypeScript types (Operation, Run, Connection, GitHubSensorConfig, etc.)
    crypto/         — ed25519 signing, receipt hashing, verification
  docker/
    gate/           — Gate Dockerfile (monorepo build + UI static serving)
    runtimes/
      openclaw/     — OpenClaw runtime Dockerfile + config templates
  docs/             — Architecture, deployment, roadmap, testing
```

---

## Core Systems

### 1. Authentication & multi-tenancy

- **Clerk** — Sign up, sign in, JWT. Organizations for team scope.
- **Org-scope middleware** (`org-scope.ts`) — All list/create/update APIs scope by `orgId` from the active Clerk org.
- **Clerk webhooks** — Sync organizations and members; org data stored in `Organization` / `User` for isolation.

### 2. Sensors (connection-as-sensor)

Connections (e.g. GitHub) act as **sensors**: they observe events and create Operations.

- **Per-connection webhooks** — Each Connection has a unique URL: `POST /api/webhooks/github/:connectionId` and its own `webhookSecret` for HMAC verification. Incoming webhooks are tied to that connection → deterministic `orgId` and `connectionId` on the created Operation.
- **Sensor config** — Per-provider JSON (e.g. `GitHubSensorConfig`: `watchEvents`, `branchFilter`, `ignoreDrafts`, `ignoreBot`, `autoCreateRun`). Stored on `Connection.sensorConfig`.
- **Sensor engine** (`engine/sensor.ts`) — Rule-based filter from `sensorConfig`, deduplication, then creates an `Operation` with `connectionId` and `orgId` set.
- **Endpoints** — `GET /api/sensors/status`, `PATCH /api/connections/:id/sensor`, `GET /api/connections/:id/webhook-url`, `POST /api/connections/:id/sensor/init`.

### 3. Operations & agent router

- **Operation** — Context that triggers work. Sources: `github_ci`, `github_agent_pr`, `github_pr_opened`, `github_push`, `manual`, `api`. Tracks priority (P0/P1/P2), status, intent, and **routing**: `instanceId`, `routingConfidence`, `routingStatus` (pending | auto_routed | approved | manual), `routingReason`.
- **Agent router** (`engine/router.ts`) — After an Operation is created (e.g. by webhook), evaluates it against **all active instances** in the org (roles/summaries). Uses an LLM to score fit; applies confidence thresholds: high → auto-route, medium → needs approval, low/none → pending or manual. Never discards; unassigned Operations stay in the list for manual assignment.
- **Endpoints** — CRUD `/api/operations`, `POST /api/operations/:id/route`, `POST /api/operations/:id/approve-routing`, `POST /api/operations/:id/dismiss`. Legacy `/api/incidents` aliased for backward compatibility.

### 4. Run orchestrator

- **Run** — Unit of work for an Operation. Deterministic ID: `sha256(operationId + attempt)`. State machine: pending → scheduled → running → {completed, failed, quarantined, paused}.
- **Orchestrator** (`engine/orchestrator.ts`) — Creates runs, enforces transitions, loop detection, timeout reaper, preemption.
- **Endpoints** — CRUD `/api/runs`, `POST /api/runs/:id/transition`, pause/resume/kill, `GET /api/runs/:id/events`, budget.

### 5. Tool Gateway

Non-bypassable path for agent actions. Agents never see real credentials.

- **Capability tokens** — Ed25519-signed, short-lived, scoped to (run, actionClass, scope). Agent receives token after approval; sends it to the gateway for execution.
- **Gateway** (`engine/gateway.ts` or equivalent) — Validates token, resolves credential from Connection store (envelope encryption), executes action (e.g. GitHub API), records cost, post-action verification, idempotency.
- **Endpoint** — `POST /api/gateway/execute` (with capability token).

### 6. Policy engine & approvals

- **Policy engine** (`engine/policy.ts`) — Priority-ordered rules: `matchTool`, risk tier (READ/WRITE/DESTRUCTIVE), `decision` (ALLOW/DENY/APPROVE). Optional `matchArgs`. Presets: Balanced, Strict, Permissive.
- **Approval flow** — APPROVE → create Proposal (pending) → human approves/denies → capability minted on approve → agent executes via gateway.
- **Proposals** — CRUD `/api/proposals`, `POST /api/proposals/:id/approve`, `deny`. Evidence bundles and risk classification.

### 7. Receipt chain & audit

- **Receipts** — Every tool decision produces a signed receipt (canonical JSON, SHA-256 hash, ed25519 signature). Hash chain links receipts. Stored in PostgreSQL.
- **Audit** — `GET /api/audit/report`, `GET /api/audit/chain-integrity`. Case file export per run.

### 8. Analysis & flags

- **Human-readable descriptions** — `describeToolCall()`, `explainWhyFlagged()`, `describeRisk()` for approvals and activity.
- **Flag detection** (`engine/flags.ts`) — Rule-based (velocity, retry loops, privilege escalation, sensitive access) and optional AI layer. Stored as `AuditFlag` with severity.

### 9. AI supervisor (optional)

- **Services** (`services/ai-supervisor.ts`) — Threat assessment, behavioral analysis, contribution assessment, session summary. Requires `OPENAI_API_KEY`; non-blocking, failures do not block execution.
- **Router** — Same key used for global agent routing (LLM evaluation of Operation vs instance roles).

### 10. Trust, cost, contributions

- **Trust scoring** — Per-agent score from approvals, denials, flags; trend (improving/stable/declining).
- **Cost tracking** — Per-tool cost heuristics, per-run and daily aggregation, burn rate.
- **Contributions** — Files/commands/PRs, approval efficiency; optional AI quality assessment.

### 11. Instances & mission

- **Instance** — Deployed agent runtime (OpenClaw). Own container, `.env`, config. Managed via `/api/instances` (create, start, stop, restart, delete). Role/summary used by router.
- **Mission / observability** — `GET /api/instances/:id/mission`, trust, cost, pipeline stage, recent actions.

### 12. Webhooks & notifications

- **Outbound webhooks** — Notifications for pending approvals, flags, trust alerts. CRUD `/api/webhooks`, test endpoint.

---

## Data models (summary)

| Model | Purpose |
|-------|---------|
| **Operation** | Triggering context (source, priority, status, intent; routing fields). DB table name kept as `Incident` for migration. |
| **Run** | Work unit for an operation; state machine; `operationId` (backed by `incidentId` column). |
| **Connection** | External credential store (e.g. GitHub); sensor fields: `sensorEnabled`, `sensorConfig`, `webhookSecret`. |
| **Instance** | Deployed agent; role, status, containerId. |
| **Proposal** | Pending/approved/denied action; risk class, evidence, policy snapshot. |
| **Capability** | Scoped token for gateway; actionClass, scope, TTL, maxUses. |
| **EvidenceBundle** | Pre-execution proof (recipe, structured diff, hashes). |
| **PolicyRule** | Gating rules; org/instance scoped. |
| **User / Organization** | Clerk-synced identity and org membership. |

---

## Event schema (WooblayEventBus)

| Event | Data |
|-------|------|
| `operation.created` | operationId, source, priority, title |
| `operation.updated` | operationId, status, previousStatus |
| `operation.routed` | operationId, instanceId, confidence, status |
| `run.created` | runId, operationId, priority |
| `run.state_changed` | runId, from, to, reason |
| `proposal.created` / `proposal.decided` | proposalId, runId, status, approver |
| `evidence.started` / `evidence.completed` | evidenceId, runId, status |
| `capability.issued` / `capability.revoked` / `capability.expired` | capabilityId, runId, reason |
| `gateway.executed` / `gateway.bypass_attempt` | capabilityId, runId, success/blocked |

Legacy aliases: `incident.created` / `incident.updated` for backward compatibility.

---

## API surface (current)

- **Operations** — `GET/POST /api/operations`, `GET/PATCH /api/operations/:id`, `POST .../route`, `.../approve-routing`, `.../dismiss`. Legacy: `/api/incidents`.
- **Sensors** — `POST /api/webhooks/github/:connectionId`, `GET /api/sensors/status`, `PATCH /api/connections/:id/sensor`, `GET /api/connections/:id/webhook-url`, `POST /api/connections/:id/sensor/init`.
- **Runs** — CRUD `/api/runs`, `POST /api/runs/:id/transition`, pause/resume/kill, events, budget.
- **Proposals** — CRUD `/api/proposals`, approve/deny.
- **Gateway** — `POST /api/gateway/execute`.
- **Connections** — CRUD `/api/connections`, revoke, test.
- **Instances** — CRUD `/api/instances`, start/stop/restart, mission, logs, contributions.
- **Policies** — CRUD `/api/policies`, presets, AI optimize.
- **Insights** — `GET /api/insights/metrics`, `GET /api/insights/summary`.
- **Audit** — `GET /api/audit/report`, `GET /api/audit/chain-integrity`.
- **Case files** — `GET /api/case-files/:runId`, verify.
- **Users** — `GET /api/users/me`, coupon redeem; Clerk webhook handler for org sync.
- **Webhooks** — CRUD `/api/webhooks`, test.

---

## UI (sensor-first)

| Page | Route | Description |
|------|-------|-------------|
| Operations | `/operations` | List operations; routing status; inline approve / assign / dismiss |
| Operation detail | `/operations/:id` | Metadata, routing section (agent, confidence, reason), runs, create run |
| Sensors | `/sensors` | Connections as sensors; webhook URL/secret; sensor config; toggle on/off |
| Run | `/runs/:id` | State, proposals, evidence, timeline, budget, case file |
| Approvals | `/approvals` | Pending action approvals |
| Insights | `/insights` | Metrics, summary |
| Activity | `/activity` | Event log, flags, export |
| Dashboard | `/` | Instance cards, deploy, start/stop |
| Instance detail | `/instances/:id` | Overview, Profile (SOUL.md, IDENTITY.md), Access (with risk warning), Workspace |
| Policies | `/policies` | Rules, presets, AI suggestions |
| Settings | `/settings` | Profile, organization management (Clerk), webhooks |

Legacy redirects: `/inbox` → `/operations`, `/incidents/:id` → `/operations/:id`, `/connections` → `/sensors`.

---

## Threat model & bypass prevention

### Agent credential theft

- **Threat:** Agent exfiltrates GitHub PAT / API keys.
- **Mitigation:** Agent never holds credentials. Tool Gateway holds them; capability tokens are short-lived and scoped. Container egress can be restricted to gateway only.

### Agent bypasses gateway

- **Threat:** Agent calls GitHub (or other APIs) directly.
- **Mitigation:** Network rules (e.g. iptables) restrict agent egress to the gateway. Bypass attempts logged; run can be quarantined.

### Token replay / privilege escalation

- **Threat:** Replay or misuse of capability tokens.
- **Mitigation:** Tokens bound to run, actionClass, scope; max-use and TTL; revoked on run kill. Gateway validates every request.

### Receipt / evidence tampering

- **Threat:** Tampering with receipts or evidence bundles.
- **Mitigation:** Hash chain and ed25519 signatures; evidence hashes stored in receipt chain; standalone verifier.

### Infinite loops

- **Threat:** Operations or runs trigger unbounded new work.
- **Mitigation:** Loop detection (e.g. run count per operation/time), budget limits, quarantine.

### Kill switch

- Operator triggers kill on a run → all capabilities for that run revoked, run state set to failed/cancelled, container stopped if needed, events recorded.

### Quarantine

- On bypass attempt or anomaly → run state quarantined, capabilities revoked, alert; only transition out is to cancelled (human decision).

---

## Security (summary)

- **Auth:** Clerk JWT for dashboard; org-scope on all APIs; agent signature verification for tool path.
- **Secrets:** Envelope encryption (DEK/KEK); credentials never returned in API responses; per-connection webhook secrets for GitHub.
- **Webhooks:** HMAC-SHA256 (GitHub), Svix-style (Clerk); verification before processing.
- **Containers:** Cap drop, no-new-privileges, memory limits; Docker bridge isolation.

---

## Diagram reference

For full technical architecture, UX flow, and UX-to-tech mapping, see **[ARCHITECTURE-DIAGRAMS.md](./ARCHITECTURE-DIAGRAMS.md)** (Mermaid, Miro-ready).

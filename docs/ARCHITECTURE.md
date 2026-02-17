# Wooblay — Technical Architecture

**Connection-first:** Connect external services (e.g. GitHub); each Connection has dual roles — **sensing** (detect events, create Operations) and **execution** (provide credentials for the three-layer security moat). Wooblay routes each Operation to the right agent, the agent runs, and every decision is receipted.

For the detailed technical diagram (Miro-ready Mermaid), see **[ARCHITECTURE-DIAGRAMS.md](./ARCHITECTURE-DIAGRAMS.md)**.

---

## Monorepo Structure

```
wooblay/
  apps/
    gate/                — Fastify API server
      src/
        engine/          — Core engines (sensor, router, orchestrator, scope, simulate, secure-exec, etc.)
        routes/          — API route handlers
        services/        — AI supervisor, vault
        middleware/       — Auth, org-scope, rate-limit
        events/          — Event bus + run events
        types/           — All TypeScript type definitions (per-domain files)
        prompts/         — All LLM system prompt builders (per-domain files)
        db/              — Prisma client, seed data
        config.ts        — Environment config
    ui/                  — React dashboard (Vite, Tailwind, TanStack Query)
      src/
        pages/           — Route pages (operations, connections, approvals, instances, etc.)
        components/      — Shared components (layout, sidebar, tour)
        contexts/        — React contexts (auth, tour)
        api/             — API client functions
  packages/
    types/               — Shared TypeScript types (Operation, Run, Connection, GitHubSensorConfig, etc.)
    crypto/              — ed25519 signing, receipt hashing, verification
    adapters/openclaw/   — OpenClaw plugin (structured_action + gated tools)
  docker/
    gate/                — Gate Dockerfile (monorepo build + UI static serving)
    runtimes/openclaw/   — OpenClaw runtime Dockerfile + config templates
  docs/                  — Architecture, deployment, product docs
```

---

## Core Systems

### 1. Authentication & Multi-Tenancy

- **Clerk** — Sign up, sign in, JWT. Organizations for team scope.
- **Org-scope middleware** (`middleware/org-scope.ts`) — All list/create/update APIs scope by `orgId` from the active Clerk org.
- **Clerk webhooks** — Sync organizations and members; org data stored in `Organization` / `User` for isolation.

### 2. Connections (Dual-Role: Sensing + Execution)

Each Connection (e.g. GitHub) has **two roles**:

**Sensing** — Observe events and create Operations:
- **Per-connection webhooks** — Each Connection has a unique URL: `POST /api/webhooks/github/:connectionId` and its own `webhookSecret` for HMAC verification. Incoming webhooks are tied to that connection → deterministic `orgId` and `connectionId` on the created Operation.
- **Sensor config** — Per-provider JSON (e.g. `GitHubSensorConfig`: `watchEvents`, `branchFilter`, `ignoreDrafts`, `ignoreBot`, `autoCreateRun`). Stored on `Connection.sensorConfig`.
- **Sensor engine** (`engine/sensor.ts`) — Rule-based filter from `sensorConfig`, deduplication, extracts rich `EventContext`, creates an `Operation` with suggested intent.

**Execution** — Provide credentials for secure agent actions:
- **Scope boundaries** — `Connection.scopeBoundaries` defines per-action allowed/blocked patterns (e.g. `git:push` allowed to `feature/*`, blocked from `main`).
- **Credential vault** — `Connection.credentialRef` stored with AES-256-GCM envelope encryption (DEK/KEK via `vault.ts`).
- **Connection Secrets** — User-defined key-value pairs (`Connection.secrets`) with two visibility modes:
  - **`agent`** — Injected as env vars into the agent's running container. Available immediately via `$KEY_NAME` in `gated_exec`, `gated_web_fetch`. Use for: API keys for testing, DB URLs, service tokens.
  - **`exec_only`** — Only injected into ephemeral secure execution containers. Agent never sees the value. Use for: deploy credentials, root access keys, sensitive tokens.
- **Supported providers** — GitHub (PAT), AWS (Access Key + Secret Key + Region), GCP (Service Account JSON + Project ID).

**Endpoints** — `GET /api/connections`, `POST/GET/DELETE /api/connections/:id/secrets`, `GET /api/connections/secrets/names`, `PATCH /api/connections/:id/scope-boundaries`, `GET /api/actions/available`, sensor endpoints.

### 3. Operations & Agent Router

- **Operation** — Context that triggers work. Sources: `github_ci`, `github_agent_pr`, `github_pr_opened`, `github_push`, `manual`, `api`. Tracks priority (P0/P1/P2), status, intent (AI-classified), `suggestedIntent`, `eventContext`, and routing: `instanceId`, `routingConfidence`, `routingStatus`.
- **Agent router** (`engine/router.ts`) — Dynamically classifies intent from rich `EventContext` (not hardcoded by sensors). Evaluates all active instances using LLM scoring. Confidence thresholds: ≥0.7 → auto-route, ≥0.3 → needs approval, <0.3 → pending/manual.
- **Endpoints** — CRUD `/api/operations`, `POST .../route`, `.../approve-routing`, `.../dismiss`.

### 4. Run Orchestrator

- **Run** — Unit of work for an Operation. Deterministic ID: `sha256(operationId + attempt)`. State machine: pending → scheduled → running → {completed, failed, quarantined, paused}.
- **Orchestrator** (`engine/orchestrator.ts`) — Creates runs, enforces transitions, loop detection, timeout reaper, preemption.
- **Endpoints** — CRUD `/api/runs`, `POST .../transition`, pause/resume/kill, events, budget.

### 5. Three-Layer Security Moat

The core innovation. Every credentialed agent action passes through three sequential layers:

**Layer 1: Scope Boundaries** (`engine/scope.ts`)
- Per-connection `allowed`/`blocked` patterns stored in `Connection.scopeBoundaries`.
- `checkScope()` validates the action + params against patterns before execution.
- Example: `git:push` allowed only to `feature/*` branches, blocked from `main`.

**Layer 2: Sandbox Simulation + AI Intent Verification** (`engine/simulate.ts`)
- Runs the command in an isolated sandbox container (`--network none`, no credentials, read-only filesystem) then AI verifies the command's behavior matches its stated intent.
- Strategies: `SANDBOX_EXEC` (container sandbox for exec/structured actions), `CONTENT_ANALYSIS` (AI analysis for write/edit operations).
- `simulateAction()` and `simulateLocalAction()` return pass/fail with AI intent analysis.
- `shouldSimulate()` dynamically decides if simulation triggers based on org threshold and risk tier.

**Layer 3: Ephemeral Secure Execution** (`engine/secure-exec.ts`)
- Spawn a short-lived Docker container with:
  - Clean environment (no agent tampering)
  - Credentials injected as env vars (resolved from vault)
  - Network scoped to target service only
  - Agent workspace mounted read-only (if needed)
  - Deterministic command from the action registry
- Capture stdout/stderr/exit code, destroy the container.
- **The agent NEVER has credentials. The agent NEVER runs the command.**

### 6. Action Registry & Structured Actions

- **Action registry** (`engine/action-registry.ts`) — Maps structured action IDs to deterministic `ExecutionSpec` objects. Includes validated shortcuts (e.g. `git:push`, `github:pr:create`, `aws:s3:cp`) AND a generic `exec:run` passthrough for any command.
- **`exec:run`** — The agent runs ANY command in a secure ephemeral container with provider credentials + exec_only secrets. Supports custom Docker image, timeout, and provider selection. Example: `{ action: "exec:run", params: { command: "gcloud logging read ...", provider: "gcp", image: "google/cloud-sdk:slim" } }`. Still goes through the full three-layer moat.
- **`structured_action` tool** (`packages/adapters/openclaw/plugin/index.ts`) — Agents declare what they want; Wooblay decides how to do it safely. The tool calls `POST /api/tool/structured-execute` which routes through scope check, simulation, and ephemeral execution.
- **`list_secrets` tool** — Agent discovers available secrets (names + modes). Agent-accessible secrets are in env; exec_only secrets require `structured_action`/`exec:run`.
- **`gated_web_fetch` with headers** — Agents can pass custom HTTP headers (e.g. Authorization) for API testing. Supports `$ENV_VAR` resolution in header values.

### 7. Policy Engine & Approvals

- **Policy engine** (`engine/policy-eval.ts`) — Priority-ordered rules: `matchTool`, risk tier, `decision` (ALLOW/DENY/APPROVE). Evidence requirements by risk class, budget checks, approver role requirements.
- **Approval flow** — APPROVE → create Proposal → human approves/denies → capability minted on approve → agent executes.
- **Risk classification** (`engine/risk.ts`) — Two-layer: structural (fast, rule-based) + AI (smart, LLM-powered, can only escalate).

### 8. Receipt Chain & Audit

- **Receipts** — Every tool decision produces a signed receipt (canonical JSON, SHA-256 hash, ed25519 signature). Hash chain links receipts.
- **Audit** — `GET /api/audit/report`, `GET /api/audit/chain-integrity`. Case file export per run.

### 9. AI Supervisor (optional)

- **Services** (`services/ai-supervisor.ts`) — Threat assessment, behavioral analysis, contribution assessment, session summary, role inference. Requires `OPENAI_API_KEY`; non-blocking, failures do not block execution.
- **Prompt builders** (`prompts/supervisor.ts`) — All LLM system prompts extracted into dedicated builder functions.

### 10. Trust, Cost, Contributions

- **Trust scoring** (`engine/trust.ts`) — Per-agent 0-100 score from approvals, denials, flags; trend tracking.
- **Cost tracking** (`engine/cost-attribution.ts`, `engine/budget.ts`) — Per-run budget limits, daily global budget, per-category cost recording.
- **Contributions** (`engine/contributions.ts`) — Files/commands/PRs, approval efficiency; optional AI quality assessment.

### 11. Instances & Mission

- **Instance** — Deployed agent runtime (OpenClaw). Own container, config. Managed via `/api/instances`. Role/summary used by router.
- **Mission / observability** — Trust, cost, pipeline stage, recent actions.

### 12. Real-Time Event Streaming

- **SSE endpoint** (`routes/sse.ts`) — `GET /api/events/stream` using `fetch()` + `ReadableStream` with JWT authentication (not `EventSource`, which can't send headers).
- **Run events** (`engine/run-events.ts`) — Events emitted at every moat layer: `scope_check`, `simulation_start/complete`, `secure_exec_start/complete`, `gateway_exec`.

---

## Data Models (Summary)

| Model | Purpose |
|-------|---------|
| **Operation** | Triggering context (source, priority, status, intent, suggestedIntent, eventContext; routing fields). DB table: `Incident`. |
| **Run** | Work unit; state machine; budget tracking. |
| **Connection** | External service credentials + sensor config + scope boundaries + webhook secret. Dual-role: sensing + execution. |
| **Instance** | Deployed agent; role, status, containerId. |
| **Proposal** | Pending/approved/denied action; risk class, evidence, policy snapshot. |
| **Capability** | Scoped token for gateway; actionClass, scope, TTL, maxUses. |
| **EvidenceBundle** | Pre-execution proof (recipe, structured diff, hashes). |
| **PolicyRule** | Gating rules; org/instance scoped. |
| **RunCost** | Per-action cost attribution (category, amountCents). |
| **User / Organization** | Clerk-synced identity and org membership. |

---

## UI Pages

| Page | Route | Description |
|------|-------|-------------|
| Operations | `/operations` | List operations; routing status; inline approve/assign/dismiss |
| Operation Detail | `/operations/:id` | Metadata, routing section, runs, real-time event timeline |
| Connections | `/connections` | Dual-role cards (sensing + execution); scope boundary editor; actions list |
| Approvals | `/approvals` | Pending action approvals; secure execution preview for structured actions |
| Dashboard | `/` | Instance cards, deploy, start/stop |
| Instance Detail | `/instances/:id` | Overview, Profile, Available Secure Actions, Workspace |
| Policies | `/policies` | Rules, presets, AI optimization suggestions |
| Insights | `/insights` | Metrics, summary |
| Activity | `/activity` | Event log, flags, export |
| Settings | `/settings` | Profile, organization management (Clerk), webhooks |

---

## Threat Model & Security

### Agent Credential Isolation
- **Threat:** Agent exfiltrates credentials.
- **Mitigation:** Agent containers have zero credentials. Credentials resolved only inside ephemeral execution containers that are destroyed after use.

### Scope Boundary Enforcement
- **Threat:** Agent performs actions outside intended scope.
- **Mitigation:** Per-connection scope boundaries (allowed/blocked patterns) checked before any execution.

### Pre-Execution Verification
- **Threat:** Agent action has unintended side effects.
- **Mitigation:** Dry-run simulation in ephemeral container before real execution; pass/fail gating.

### Token Replay / Privilege Escalation
- **Threat:** Replay or misuse of capability tokens.
- **Mitigation:** Ed25519-signed tokens bound to (run, actionClass, scope); max-use and TTL; key rotation via `kid`.

### Receipt & Evidence Tampering
- **Threat:** Tampering with audit trail.
- **Mitigation:** Hash-chained ed25519-signed receipts; evidence hashes included in chain.

### Agent Behavioral Threats
- **Threat:** Agent goes off-task, escalates privileges, exfiltrates data.
- **Mitigation:** AI supervisor (threat assessment, behavioral analysis), policy engine rules, flag detection, quarantine flow.

---

## Code Structure

```
apps/gate/src/
  types/           — All TypeScript interfaces/types (per-domain: actions, scope, simulation, etc.)
  prompts/         — All LLM system prompt builders (routing, risk, policy, supervisor)
  engine/          — Core business logic (imports types from ../types/, prompts from ../prompts/)
  routes/          — HTTP route handlers
  services/        — AI supervisor, vault
  middleware/      — Auth, org-scope, rate-limit
  events/          — Event bus, run event emission
  db/              — Prisma client, migrations, seed data
  config.ts        — Environment configuration
```

---

## API Endpoint Reference (Detailed)

### Connections

| Method | Path | Body / Params | Response |
|--------|------|---------------|----------|
| `GET` | `/api/connections` | — | `Connection[]` (scoped to org) |
| `POST` | `/api/connections` | `{ name, provider, token, metadata?, sensorEnabled?, sensorConfig? }` | `Connection` |
| `PATCH` | `/api/connections/:id` | Partial `Connection` fields | `Connection` |
| `DELETE` | `/api/connections/:id` | — | `{ ok: true }` |
| `POST` | `/api/connections/:id/test` | — | `{ success: boolean, message: string }` |
| `PATCH` | `/api/connections/:id/scope-boundaries` | `{ scopeBoundaries: Record<string, { allowed: string[], blocked: string[] }> }` | `Connection` |
| `POST` | `/api/connections/:id/secrets` | `{ key: string, value: string, mode: "agent" \| "exec_only" }` | `{ ok: true }` |
| `GET` | `/api/connections/:id/secrets` | — | `{ key: string, mode: string }[]` |
| `DELETE` | `/api/connections/:id/secrets/:key` | — | `{ ok: true }` |
| `GET` | `/api/connections/secrets/names` | — | `{ key, mode, provider, connectionName }[]` |
| `GET` | `/api/actions/available` | — | `{ action: string, provider: string, description: string }[]` |

### Operations

| Method | Path | Body / Params | Response |
|--------|------|---------------|----------|
| `GET` | `/api/operations` | `?status=&priority=` | `Operation[]` |
| `POST` | `/api/operations` | `{ title, description?, priority?, source? }` | `Operation` |
| `GET` | `/api/operations/:id` | — | `Operation` (with runs, routing) |
| `PATCH` | `/api/operations/:id` | Partial fields | `Operation` |
| `POST` | `/api/operations/:id/route` | — | `{ routingStatus, instanceId, confidence }` |
| `POST` | `/api/operations/:id/approve-routing` | — | `{ run: Run }` |
| `POST` | `/api/operations/:id/dismiss` | — | `Operation` |

### Runs

| Method | Path | Body / Params | Response |
|--------|------|---------------|----------|
| `GET` | `/api/runs` | `?operationId=&status=` | `Run[]` |
| `POST` | `/api/runs` | `{ operationId, instanceId }` | `Run` |
| `GET` | `/api/runs/:id` | — | `Run` |
| `POST` | `/api/runs/:id/transition` | `{ to: RunStatus }` | `Run` |
| `POST` | `/api/runs/:id/pause` | — | `Run` |
| `POST` | `/api/runs/:id/resume` | — | `Run` |
| `POST` | `/api/runs/:id/kill` | — | `Run` |
| `GET` | `/api/runs/:id/events` | — | `RunEvent[]` |
| `GET` | `/api/runs/:id/costs` | — | `RunCost[]` |

### Proposals & Approvals

| Method | Path | Body / Params | Response |
|--------|------|---------------|----------|
| `GET` | `/api/proposals` | `?status=pending` | `Proposal[]` |
| `POST` | `/api/proposals/:id/approve` | `{ reason? }` | `Proposal` + minted `Capability` |
| `POST` | `/api/proposals/:id/deny` | `{ reason? }` | `Proposal` |

### Tool Gateway (Agent → Gate)

| Method | Path | Body / Params | Response |
|--------|------|---------------|----------|
| `POST` | `/api/tool/structured-execute` | `{ action: string, params: Record, runId, instanceId }` | `{ success, output, exitCode, receipt }` |
| `POST` | `/api/gateway/execute` | `{ actionClass, scope, capabilityToken }` | `{ success, output }` |

### Events & Audit

| Method | Path | Body / Params | Response |
|--------|------|---------------|----------|
| `GET` | `/api/events/stream` | `Authorization: Bearer <jwt>` | SSE stream (`text/event-stream`) |
| `GET` | `/api/audit/report` | `?from=&to=` | Audit report JSON |
| `GET` | `/api/audit/chain-integrity` | — | `{ valid: boolean, brokenAt?: number }` |

---

## Roadmap

### Near-Term (Next 3 Months)

| Feature | Description | Status |
|---------|-------------|--------|
| **Generic webhook sensing** | Accept events from any source (Slack, Jira, PagerDuty, custom HTTP) — not just GitHub. Connection-level webhook URL + configurable event parser. | Planned |
| **Redis-backed rate limiting** | Replace in-memory rate limiter with Redis for horizontal scaling across multiple Gate instances. | Planned |
| **Slack/Teams approval channel** | Route approval requests to Slack or Teams channels; approve/deny via reactions or buttons. | Planned |
| **Terraform/IaC provider support** | Structured actions for `terraform plan/apply`, Pulumi, CloudFormation. Provider credentials via Connections. | Planned |

### Mid-Term (3–6 Months)

| Feature | Description | Status |
|---------|-------------|--------|
| **Additional runtime adapters** | Support for agent runtimes beyond OpenClaw (e.g. CrewAI, AutoGen, LangGraph) via adapter interface. | Planned |
| **Pricing & billing UI** | Usage-based billing dashboard: compute minutes, API calls, storage. Stripe integration. | Planned |
| **SSO/SAML for enterprise** | Enterprise SSO via SAML 2.0 / OIDC in addition to Clerk social/email auth. | Planned |
| **Multi-region deployment** | Deploy Gate + agent workspaces across regions for latency and data residency. | Planned |

### Long-Term (6–12 Months)

| Feature | Description | Status |
|---------|-------------|--------|
| **Agent marketplace** | Publish and discover pre-configured agent roles with policy templates and connection presets. | Planned |
| **Custom simulation strategies** | User-defined simulation scripts (e.g. run test suite, check migration safety) as a moat layer. | Planned |
| **Compliance packages** | SOC2/HIPAA-ready policy templates, audit export formats, retention policies. | Planned |
| **Federated agent networks** | Cross-org agent collaboration with trust boundaries and credential federation. | Planned |

---

## Diagram Reference

For the full technical Mermaid diagram (Miro-ready), see **[ARCHITECTURE-DIAGRAMS.md](./ARCHITECTURE-DIAGRAMS.md)**.

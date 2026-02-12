# Wooblay — Technical Architecture

## Monorepo Structure

```
wooblay/
  apps/
    gate/           — Fastify API server (policy, approvals, receipts, analysis, AI supervisor)
    ui/             — React dashboard (Vite, Tailwind, TanStack Query)
  packages/
    types/          — Shared TypeScript types + Zod schemas
    crypto/         — ed25519 signing, receipt hashing, verification
  docker/
    gate/           — Gate Dockerfile (monorepo build + UI static serving)
    runtimes/
      openclaw/     — OpenClaw runtime Dockerfile + config templates
    docker-compose.runtime.yml — Production deployment compose
  docs/             — Product, architecture, deployment, roadmap documentation
```

## Core Systems

### 1. Policy Engine (`apps/gate/src/engine/policy.ts`)

Priority-ordered rule evaluation. First match wins.

- Rules: `matchTool` (glob), `riskTier` (READ/WRITE/DESTRUCTIVE/*), `decision` (ALLOW/DENY/APPROVE)
- Optional `matchArgs` patterns for argument-level filtering
- Presets: Balanced, Strict, Permissive — one-click policy replacement via `POST /api/policies/presets/:name`
- Suggestions: `/api/stats/suggestions` recommends rule changes based on historical failure rates
- CRUD: Full create/read/update/delete via `/api/policies`

### 2. Receipt Chain (`packages/crypto/`)

Every tool call produces a signed receipt:

- Canonical JSON serialization (RFC 8785)
- SHA-256 content hash
- ed25519 signature over hash
- Hash chain: each receipt references the previous receipt's hash
- Stored in PostgreSQL with verification endpoint: `GET /api/receipts/:hash/verify`
- Chain integrity check: `GET /api/audit/chain-integrity`

### 3. Approval Flow

```
Agent calls tool
      |
  Gate evaluates policy
      |
  +---+---+---+
  |       |       |
ALLOW   DENY   APPROVE
  |       |       |
execute  deny  create Approval (PENDING)
  |       |       |
receipt  receipt  wait for human (24h TTL)
                  |
            +-----+-----+
            |           |
         APPROVED    DENIED/EXPIRED
            |           |
         execute     deny + receipt
```

**Deferred Approval (24-hour window):**
OpenClaw has a 120s hardcoded timeout. Wooblay's bridge:
1. Polls Gate for 100s (budget within OpenClaw's timeout)
2. If unresolved: sends `deny` to OpenClaw, keeps approval PENDING in Gate for 24h
3. Background poller checks for late approvals
4. If approved: sends `chat.send` to re-trigger the agent with the approved command
5. On re-trigger: bridge finds pre-approved command, instantly resolves as `allow-once`

### 4. Human-Readable Descriptions (`apps/gate/src/engine/analysis.ts`)

Every tool call and approval is enriched with:

- **`describeToolCall()`** — Translates raw tool names + args into plain English (e.g., `exec` with `rm -rf /tmp` → "Execute shell command: delete all files in /tmp")
- **`explainWhyFlagged()`** — Explains why an action requires approval or was denied based on the matching policy rule and risk tier
- **`describeRisk()`** — Risk tier explanation for non-technical users

### 5. Flag Detection Engine (`apps/gate/src/engine/flags.ts`)

Two-layer detection system running on every tool call:

**Layer 1: Rule-based (fast, deterministic)**
| Detector | Trigger |
|----------|---------|
| Velocity anomaly | >10 tool calls in 60s from same agent |
| Retry loop | Same tool+args repeated 3+ times in 5 minutes |
| Privilege escalation | Risk tier jumps (READ → DESTRUCTIVE) |
| Sensitive access | Credentials, keys, PII in args or paths |

**Layer 2: AI-powered (async, non-blocking)** — requires `OPENAI_API_KEY`
| Analysis | What it does |
|----------|-------------|
| Threat assessment | LLM evaluates each tool call for malicious intent |
| Behavioral analysis | LLM reviews recent action patterns for anomalies |

Flags are stored as `AuditFlag` records with severity (LOW/MEDIUM/HIGH/CRITICAL) and can be dismissed from the UI.

### 6. AI Supervisor (`apps/gate/src/services/ai-supervisor.ts`)

OpenAI-powered intelligence layer (optional, requires `OPENAI_API_KEY`):

- **`assessThreat()`** — Real-time threat scoring per tool call (severity 1-10, reasoning, recommendations)
- **`analyzeBehavior()`** — Batch behavioral pattern analysis across recent agent actions
- **`assessContributions()`** — Evaluates quality/impact of agent work (productivity score, code quality, risk assessment)
- **`summarizeSession()`** — Generates human-readable session summaries with key decisions and outcomes

All AI calls are non-blocking and non-critical — failures are logged but never block agent execution.

### 7. Trust Scoring (`apps/gate/src/engine/trust.ts`)

Per-agent trust score (0-100) computed from:
- Approved actions (+2 each, capped)
- Denied actions (-5 each)
- Detected flags (-10 per HIGH/CRITICAL, -3 per MEDIUM)
- Trend calculation (7-day vs 30-day comparison: improving/stable/declining)

Displayed as badges on Mission Cards and approval cards.

### 8. Cost Tracking (`apps/gate/src/engine/cost.ts`)

Per-tool-call cost estimation based on heuristics:
- `exec` commands: $0.01
- `write`/`edit` operations: $0.005
- `web_fetch`/`web_search`: $0.002
- LLM-estimated token cost per action

Aggregated into: total cost, daily/weekly summaries, burn rate per instance.

### 9. Contribution Analytics (`apps/gate/src/engine/contributions.ts`)

Computes per-agent metrics from tool call history:
- Files created/edited, commands executed, lines written
- PRs/commits detected, research actions
- Approval efficiency (approved vs denied ratio)
- Optional AI assessment of work quality (if `OPENAI_API_KEY` set)

### 10. Multi-Instance Deployment

`Instance` model in Prisma tracks deployed agent runtimes. Each instance:

- Gets its own Docker container, `.env`, and `docker-compose.yml`
- Points back to the same Gate for centralized monitoring
- Configurable model, API keys, Telegram, GitHub PAT, policy preset
- Managed via `POST /api/instances` (create), start/stop/restart/delete endpoints
- UI: Deploy form, instance cards with live container status, logs viewer

### 11. Webhook Notifications (`apps/gate/src/services/webhooks.ts`)

Configurable outbound webhooks for:
- Pending/stale approvals
- Critical/high-severity flags
- Low trust score alerts
- New instance events

CRUD management via `/api/webhooks`, with test endpoint for validation.

### 12. Audit Trail Export (`apps/gate/src/routes/audit.ts`)

- `GET /api/audit/report` — JSON or CSV export with date range filtering and summary statistics
- `GET /api/audit/chain-integrity` — Cryptographic hash chain verification for a given period
- Includes action counts, risk distribution, approval/denial rates

### 13. Mission Cards & Observability (`apps/gate/src/routes/mission.ts`)

Dashboard-oriented endpoints that aggregate multiple data sources:
- `GET /api/instances/:id/mission` — Combined mission summary (status, pipeline stage, recent actions, trust, cost)
- `GET /api/agents/:pubkey/trust` — Trust score with trend
- `GET /api/instances/:id/cost` — Cost summary with burn rate
- `GET /api/sessions/:sessionId/playback` — Ordered session events with optional AI summary

## API Surface

### Core Gating
- `POST /api/tool/execute` — Submit tool call for policy evaluation
- `GET/POST /api/approvals/:id/approve|deny` — Approval management
- `GET /api/receipts/:hash` + `/verify` — Receipt retrieval and verification

### Policy Management
- CRUD `/api/policies` — Policy rules
- `GET /api/policies/presets` — Available presets
- `POST /api/policies/presets/:name` — Apply preset

### Monitoring & Flags
- `GET /api/flags` — Filterable flag list with severity summary
- `POST /api/flags/:id/dismiss` — Dismiss a flag

### Audit & Compliance
- `GET /api/audit/report` — Export audit report (JSON/CSV)
- `GET /api/audit/chain-integrity` — Verify hash chain integrity

### Observability
- `GET /api/instances/:id/mission` — Mission card data
- `GET /api/agents/:pubkey/trust` — Trust score
- `GET /api/instances/:id/cost` — Cost summary
- `GET /api/agents/:pubkey/contributions` — Contribution analytics
- `GET /api/sessions/:sessionId/playback` — Session replay

### Instance Management
- CRUD `/api/instances` + `/start|stop|restart` — Instance lifecycle
- `GET /api/instances/:id/logs` — Container logs

### Webhooks
- CRUD `/api/webhooks` — Webhook configuration
- `POST /api/webhooks/:id/test` — Test webhook delivery

### AI Analysis (optional)
- `GET /api/ai/status` — AI supervisor status
- `POST /api/ai/analyze-agent` — On-demand agent behavioral analysis
- `POST /api/ai/summarize-session` — On-demand session summary
- `POST /api/ai/assess-contributions` — On-demand contribution assessment

### Platform
- `GET /api/stats` + `/suggestions` — Aggregate stats and policy recommendations
- `POST /api/users/me` — User profile
- `POST /api/coupons/redeem` — Beta access coupon

## Database

PostgreSQL with Prisma ORM. Key models:

- `Agent` (identity, trust level, allowlist status)
- `ToolCall` (every intercepted action with risk tier)
- `PolicyRule` (priority-ordered gating rules)
- `Approval` (pending/approved/denied/expired with 24h TTL)
- `Execution` (stdout, stderr, exit code, duration)
- `Receipt` (signed, hash-chained audit record)
- `Analysis` + `AuditFlag` (findings, flags, AI assessments)
- `Instance` (deployed agent runtimes with config)
- `Webhook` (notification configuration)
- `User` + `Coupon` (platform auth and access control)

## Security

- **Network isolation**: Agent containers on separate Docker bridge network, can only reach Gate on port 4800
- **Cryptographic identity**: ed25519 keypairs for agents and Gate server
- **Receipt integrity**: Hash chain prevents tampering, signatures prove origin
- **Container hardening**: `cap_drop: ALL`, `no-new-privileges`, memory limits (1.5GB per agent)
- **Secret management**: API keys redacted in DB (`***SET***`), never returned in API responses
- **Auth layers**: Clerk JWT for dashboard users, agent signature verification for tool calls, Docker internal network trust for agent-to-gate communication

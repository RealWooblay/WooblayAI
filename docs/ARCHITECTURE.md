# Wooblay — Technical Architecture

## Monorepo Structure

```
wooblay/
  apps/
    gate/           — Fastify API server (policy, approvals, receipts, analysis)
    ui/             — React dashboard (Vite, Tailwind, TanStack Query)
    landing/        — Marketing site
  packages/
    types/          — Shared TypeScript types + Zod schemas
    schemas/        — Request/response validation schemas
    crypto/         — ed25519 signing, receipt hashing, verification
    adapters/
      openclaw/     — OpenClaw plugin (WS bridge + audit hooks)
    gate-client/    — Typed HTTP client for Gate API
  docker/
    gate/           — Gate Dockerfile (monorepo build + UI static serving)
    runtimes/
      openclaw/     — OpenClaw runtime Dockerfile + config templates
    docker-compose.runtime.yml — Production deployment compose
  infra/
    tenant/         — Terraform for per-tenant EC2 deployment
```

## Core Systems

### 1. Policy Engine (`apps/gate/src/engine/policy.ts`)

Priority-ordered rule evaluation. First match wins.

- Rules: `matchTool` (glob), `riskTier` (READ/WRITE/DESTRUCTIVE/*), `decision` (ALLOW/DENY/APPROVE)
- Trust-aware: agents with `trustLevel: 'read-only'` have WRITE/DESTRUCTIVE auto-denied regardless of rules
- Presets: Balanced, Strict, Permissive — one-click policy replacement
- Suggestions: `/api/stats/suggestions` recommends rule changes based on historical failure rates

### 2. Receipt Chain (`packages/crypto/`)

Every tool call produces a signed receipt:

- Canonical JSON serialization (RFC 8785)
- SHA-256 content hash
- ed25519 signature over hash
- Hash chain: each receipt references the previous receipt's hash
- Stored in PostgreSQL with verification endpoint: `GET /api/receipts/:hash/verify`

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

### 4. Agent Identity & Trust

**Trust levels**: `read-only` | `write-with-approvals` | `autonomous`

**Trust score** (0-100): Computed from behavioral analysis, manual overrides, and spawn inheritance.

**Lineage**: Agents track `parentPubkey` and `spawnDepth`. Sub-agents inherit discounted trust from parents. The `SpawnAttestation` model records the spawn contract (purpose, scope, constraints).

**Controls**: Suspend (auto-deny all calls), Revoke (permanent), Trust Override (manual level change with audit trail).

### 5. Behavioral Analysis (`apps/gate/src/engine/analyzer/`)

12 detectors run on every receipt and task:

| Detector | Severity | Trigger |
|----------|----------|---------|
| DESTRUCTIVE_CMD | CRITICAL | rm -rf, DROP TABLE, etc. |
| APPROVAL_BYPASS | CRITICAL | Agent circumvents approval flow |
| CANARY_TRIP | CRITICAL | Agent accesses honeypot file/env/URL |
| RETRY_LOOP | HIGH | Repeated failed attempts (brute-force) |
| READONLY_VIOLATION | HIGH | Read-only agent attempts write |
| IDENTITY_DRIFT | HIGH | Behavior deviates from baseline |
| CROSS_AGENT_CORRELATION | HIGH | Coordinated suspicious activity |
| SPAWN_CHAIN_ANOMALY | HIGH | Too deep, too fast, or circular spawns |
| SENSITIVE_ACCESS | HIGH | Credentials, keys, PII accessed |
| DOMAIN_DRIFT | MEDIUM | Agent outside configured domain |
| COST_TIME_BASELINE | MEDIUM | Cost/duration far exceeds baseline |
| HUMAN_INTERVENTION | LOW | Task required human override |

Findings produce `Analysis` records with severity, causal chains, and prosecution briefs (CRITICAL only).

### 6. OpenClaw Integration

**Strategy**: Exec Approvals + WS Bridge + Audit Hooks (zero source modification)

- `exec-approvals.json`: `security: "allowlist"`, `ask: "always"`, `askFallback: "deny"`
- Plugin (`~/.openclaw/extensions/wooblay/`): Registers as OpenClaw extension
- WS Bridge: Connects to Gateway WS (port 18789), handles `connect.challenge` auth, intercepts `exec.approval.requested`, resolves via Gate
- Audit Hooks: `tool:start` / `tool:result` fire-and-forget to Gate for receipts
- Sub-agent detection: Listens for `agent.spawned` events, registers in Gate

**Channels**: Telegram via `channels.telegram` in OpenClaw config. Direct API via `POST /api/chat/send` proxy through Gate.

### 7. Multi-Instance Deployment

`Instance` model in Prisma tracks deployed agent runtimes. Each instance:

- Gets its own Docker container, `.env`, and `docker-compose.yml`
- Points back to the same Gate for centralized monitoring
- Configurable model, API key, Telegram, policy preset
- Managed via `POST /api/instances` (create), start/stop/restart/delete endpoints
- UI: Deploy wizard with 5-step flow, instance cards with live status, logs viewer

### 8. Real-Time Events

SSE stream at `/api/events/stream` with `Last-Event-Id` replay. Typed event bus emits:

- `tool.called`, `approval.created`, `approval.resolved`
- `receipt.created`, `score.created`
- `agent.spawned`, `agent.trust.changed`
- `canary.tripped`, `policy.updated`

## API Surface

### Core
- `POST /api/tool/execute` — Submit tool call for policy evaluation
- `GET/POST /api/approvals/:id/approve|deny` — Approval management
- `GET /api/receipts/:hash` + `/verify` — Receipt retrieval and verification

### Management
- CRUD `/api/policies` + `/presets` — Policy rules and presets
- CRUD `/api/agents` + `/spawn` + `/trust/override` — Agent registry
- CRUD `/api/instances` + `/start|stop|restart` — Instance lifecycle
- `POST /api/scores` — Task outcome labeling

### Observability
- `GET /api/activity` — Paginated, filterable activity feed
- `GET /api/sessions/:key/status` — Session timeline with steps
- `GET /api/agents/:pubkey/insights` — Behavioral profile, trust trajectory
- `GET /api/agents/:pubkey/lineage` — Full lineage tree
- `GET /api/tasks/:id/analysis` — Analysis findings and causal chains
- `GET /api/stats` + `/suggestions` — Aggregate stats and policy recommendations

### Runtime
- `GET/POST /api/runtime/config` — Environment variable management
- `POST /api/runtime/restart` — Agent container restart
- `POST /api/chat/send` — Direct message proxy to agent
- `GET /api/chat/status` — Agent gateway reachability check

## Database

PostgreSQL with Prisma ORM. Key models:

- `Agent` (identity, trust, lineage)
- `ToolCall` (every intercepted action)
- `PolicyRule` (priority-ordered gating rules)
- `Approval` (pending/approved/denied/expired)
- `Execution` (stdout, stderr, exit code)
- `Receipt` (signed, hash-chained audit record)
- `Analysis` (findings, causal chains, briefs)
- `Instance` (deployed agent runtimes)
- `Canary` (honeypot traps)
- `SpawnAttestation` (parent-child spawn contracts)

## Security

- **Network isolation**: Agent containers on separate Docker bridge network, can only reach Gate on port 4800
- **Cryptographic identity**: ed25519 keypairs for agents and Gate server
- **Receipt integrity**: Hash chain prevents tampering, signatures prove origin
- **Container hardening**: `cap_drop: ALL`, `no-new-privileges`, memory limits
- **Secret management**: AWS Secrets Manager in production, redacted in API responses
- **Canary traps**: Honeypot files/env/URLs that trigger CRITICAL alerts when accessed

# Wooblay Litepaper

**The Execution Firewall for AI Agents**

Version 1.0 — February 2026

---

## 1. The Problem

AI agents ship code, deploy infrastructure, manage cloud resources, open pull requests, and operate production systems — autonomously, around the clock.

Every one of those actions requires credentials: a GitHub PAT, AWS IAM keys, a GCP service account. Today, you hand those credentials directly to the agent. The agent holds your secrets. You have no say in what it does with them until after it acts.

Three things break:

**No credential isolation.** The agent process has your GitHub token in its environment. If the agent is compromised, hallucinating, or simply wrong — it has full access to push to main, delete branches, or exfiltrate the token. There is no architectural boundary between the agent and your secrets.

**No pre-execution control.** There is no point between the agent deciding to act and the action taking effect where you can intervene. A `git push --force` to production happens before you know about it. You cannot define which actions are safe and which need review.

**No verifiable audit.** Log files can be edited. Databases can be altered. When a regulator, security auditor, or your own team asks "what exactly did this agent do at 2 AM?" — you are reconstructing from scattered application logs with no integrity guarantee.

These problems compound. More capable agents need more credentials, take more actions, and create more risk. The current approach — hand over keys, hope for the best — does not scale.

---

## 2. What Wooblay Is

Wooblay is a runtime security layer that sits between AI agents and the systems they act on. Agents request actions. Wooblay evaluates, approves, and executes them. Credentials never enter the agent process.

It is not an agent framework, an orchestration platform, or a monitoring tool. It is a firewall — specifically for agent execution.

**Core guarantee:** The agent process has zero credentials. It requests an action ("push this branch to GitHub"). Wooblay checks policy, optionally holds for human approval, then executes the action in an isolated container where the credential exists for the duration of that single operation. The container is destroyed. The agent receives the result.

Wooblay works with any agent framework. We ship an adapter for OpenClaw and a native MCP proxy that any MCP-speaking agent can connect to. The architecture supports LangChain, CrewAI, AutoGen, Claude, Cursor, or any custom agent — the proxy or adapter intercepts tool calls and routes them through the Wooblay Gate. No agent code changes required.

---

## 3. Architecture

```
                       ┌──────────────┐
                       │   Dashboard  │  React UI
                       │  (Clerk JWT) │  deploy, approve, monitor, configure
                       └──────┬───────┘
                              │
   GitHub ─────────────┐      │     ┌── External Agents (Claude, Cursor, custom)
   (webhooks)          │      │     │   via MCP proxy SSE or HTTP gateway
                       ▼      ▼     ▼
                    ┌────────────────────┐
                    │    Wooblay Gate    │  Fastify API server
                    │  (TypeScript/Node) │
                    └──┬────┬────┬────┬─┘
                       │    │    │    │
              ┌────────┘    │    │    └──────────┐
              ▼             ▼    ▼              ▼
       ┌────────────┐  ┌───────┐ ┌──────────┐ ┌─────────┐
       │Policy Engine│  │ Vault │ │ Receipt  │ │ Sensor  │
       │+ Risk Class │  │AES-256│ │  Chain   │ │ Engine  │
       │+ Simulation │  │ -GCM  │ │ ed25519  │ │         │
       └──────┬─────┘  └───┬───┘ └──────────┘ └─────────┘
              │             │
       ┌──────▼─────────────▼────┐
       │  Ephemeral Exec Container│
       │  - credentials injected  │
       │  - network isolated      │
       │  - destroyed after use   │
       └─────────────────────────┘

  ┌───────────────────────┐       ┌─────────────────────────┐
  │   Agent Container     │ stdio │     MCP Proxy Sidecar   │ SSE
  │  (OpenClaw / custom)  │──────▶│  intercepts all MCP     │◀── External
  │  zero credentials     │       │  tool calls, routes     │    Agents
  └───────────────────────┘       │  through Gate L1+L2+L3  │
                                  └────────────┬────────────┘
                                               │
                                  ┌────────────▼────────────┐
                                  │  Upstream MCP Servers    │
                                  │  (npm packages / SSE)   │
                                  │  run inside L3 container │
                                  │  when credentials needed │
                                  └─────────────────────────┘
```

**Agent Container:** Runs the AI agent (any framework). Has no credentials. Communicates with the Gate API and the MCP Proxy sidecar.

**MCP Proxy:** Deployed as a sidecar alongside each agent container. Presents itself as an MCP server to the agent (via stdio) and to external agents (via SSE). Intercepts every MCP tool call and routes it through the Gate for policy evaluation, simulation, and secure execution. The agent and the proxy share no credentials — the proxy fetches them from the Gate at execution time. External agents connect by adding a single SSE URL to their MCP configuration.

**Gate:** Receives every tool call. Classifies risk. Evaluates policy. Manages approvals. Orchestrates execution. Signs receipts.

**Vault:** Stores credentials using envelope encryption (AES-256-GCM, KMS-backed in production). Decrypts only into ephemeral execution containers.

**Ephemeral Exec Container:** Created per-action. Receives the decrypted credential as an environment variable. Executes the command (or starts the upstream MCP server for MCP tool calls). Returns output. Gets destroyed. Read-only filesystem, isolated network, 1 GB memory limit, 128 PID limit.

---

## 4. Three-Layer Security

Every action that touches external systems passes through three layers. Each layer answers a different question.

### Layer 1: Policy Gate

*"Should this action happen at all?"*

The policy engine evaluates every tool call against user-defined rules before anything executes.

**How it works:**

1. Risk classification — structural analysis (regex pattern matching against 60+ patterns for destructive/write/read operations) plus optional AI escalation (GPT-4o-mini, can only raise risk tier, never lower it)
2. Category assignment — each tool call is tagged: `code`, `git`, `packages`, `shell`, `files`, `network`, `secrets`, `infra`, `destructive`, `communication`, `data`
3. Policy evaluation — rules are priority-ordered, first match wins. Each rule specifies: tool name (glob pattern), risk tier, category, args pattern, and decision: `ALLOW`, `DENY`, or `APPROVE` (human review)

**Default behavior:** READ actions auto-allow. WRITE and DESTRUCTIVE actions require human approval. Users configure from there.

### Layer 2: Simulation

*"Will this action do what it claims?"*

Before a credential-bearing action executes, Wooblay runs it in a sandbox to verify intent.

**How it works:**

1. Sandbox execution — identical command runs in a Docker container with no credentials, no network access, and a read-only filesystem. Captures stdout, stderr, exit code.
2. AI intent verification — GPT-4o-mini compares the agent's stated intent against the sandbox output. Returns: intent match (boolean), reasoning, observed behavior, discrepancies.
3. Decision — if intent does not match, the action is flagged or blocked before real credentials are involved.

Credential actions are always simulated. Non-credential actions are simulated based on configurable threshold (all, high-risk, critical-only).

### Layer 3: Secure Execution

*"Execute safely, verify it worked."*

The action runs in an ephemeral container with the real credential.

**Container spec:**
- `--rm` (auto-destroy after exit)
- `--read-only` filesystem
- `--network wooblay-exec-net` (isolated execution network)
- `--memory 1g --cpus 1 --pids-limit 128`
- `--tmpfs /tmp:rw,noexec,nosuid,size=256m`
- Credential injected as environment variable (e.g., `GITHUB_TOKEN`)
- Agent workspace mounted read-only (when needed)

The agent process cannot read from, write to, or communicate with this container. It receives only the stdout/stderr output after execution completes and the container is destroyed.

---

## 5. MCP Proxy

The Model Context Protocol (MCP) is the emerging standard for agents to discover and invoke tools. Agents that speak MCP expect to connect to an MCP server, call `tools/list` to discover available tools, and call `tools/call` to execute them. Wooblay's MCP Proxy makes this work without breaking the credential isolation guarantee.

### How It Works

The proxy is a security membrane. It presents itself as an MCP server to agents and acts as an MCP client to upstream tool servers. Every tool call passes through the Gate before it reaches the upstream server.

```
Agent ──(MCP)──▶ Wooblay MCP Proxy ──(Gate L1+L2)──▶ policy check
                                      │
                        ┌─────────────┼─────────────┐
                        ▼             ▼              ▼
                  non-credentialed  credentialed   denied
                  tool call         tool call      → blocked
                        │             │
                        ▼             ▼
                  proxy calls     Gate L3: ephemeral
                  upstream MCP    container starts
                  server directly upstream MCP server
                                  with vault creds
                                  → result → destroy
```

**Non-credentialed tools** — the proxy calls the upstream MCP server directly after L1 policy and L2 simulation pass. No credentials are involved.

**Credentialed tools** — the proxy routes the call through the Gate's structured execution endpoint. The Gate creates an ephemeral container, injects the vault-decrypted credentials, starts the upstream MCP server inside that container, calls the tool, captures the result, and destroys the container. The agent and the proxy never see the credential.

### Two Connection Modes

**Hosted agents (sidecar):** The proxy runs as a Docker sidecar alongside the agent container. The agent connects via stdio. Configuration is automatic — the proxy reads its MCP server list from the Gate and exposes all configured tools to the agent.

**External agents (SSE):** Any MCP-speaking agent — Claude Desktop, Cursor, a custom agent on a developer's laptop — connects by adding Wooblay's SSE endpoint to its MCP configuration. The agent sends tool calls over SSE. The proxy authenticates via gateway token and applies the same three-layer security as hosted agents. No dashboard, no agent hosting — just a URL and a token.

### What Users Configure

From the Security tab of any instance in the dashboard, users add MCP servers by specifying:

- **Name** — human-readable identifier (e.g., `slack-tools`, `stripe-api`)
- **Transport** — `stdio` (npm package executed locally) or `sse` (remote HTTPS endpoint)
- **Source** — the npm package name or SSE URL
- **Connection IDs** — which vault credentials to inject for Layer 3 execution

Any MCP server can be added. There is no hardcoded list. The proxy discovers tools from each configured server at startup and aggregates them into a single tool namespace for the agent.

---

## 6. Credential Architecture

### Envelope Encryption

Credentials are encrypted at rest using envelope encryption:

1. A random Data Encryption Key (DEK) is generated per secret (32 bytes)
2. The secret is encrypted with the DEK using AES-256-GCM (12-byte nonce)
3. The DEK is encrypted with a Key Encryption Key (KEK)
4. In production, the KEK is AWS KMS-backed. In development, it's derived from `VAULT_MASTER_KEY`

Storage format: `enc:v1:<keyId>:<dekNonce>:<wrappedDek>:<dataNonce>:<ciphertext>`

Decryption happens only inside the Gate process, only at execution time, and the plaintext credential is passed only to the ephemeral container's environment.

### Two Secret Classes

| Type | Where it lives | Agent can see it? | Use case |
|------|---------------|-------------------|----------|
| **Exec-only** | Vault → ephemeral container only | No | GitHub PAT, AWS keys, GCP service account |
| **Agent env var** | Agent container environment | Yes | LLM API key (Anthropic, OpenAI) |

The UI shows clear warnings when adding agent-visible secrets.

---

## 7. Cryptographic Receipt Chain

Every decision — allow, deny, approve, execute — produces a receipt.

**Receipt contents:**
- Agent public key, tool name, arguments
- Risk tier, policy decision, policy rule ID
- Approval decision and approver (if applicable)
- Execution summary (stdout, exit code)
- Evidence hash (if evidence bundle exists)
- Timestamp

**Cryptographic properties:**
- **Signed:** ed25519 signature using server private key
- **Hashed:** SHA-256 over RFC 8785 canonical JSON serialization
- **Chained:** Each receipt's `chainPrev` field contains the hash of the previous receipt
- **Content-addressable:** Receipt ID equals its content hash

The chain is append-only and tamper-evident. Modifying any receipt changes its hash, which breaks every subsequent receipt's `chainPrev` link. An independent verifier can validate the entire chain without trusting the server.

**Verification endpoint:** `GET /api/audit/chain-integrity` validates the full chain and reports any gaps or hash mismatches.

---

## 8. Sensor Engine and Operations

Wooblay is event-driven. External events create Operations; Operations route to agents.

### Webhook Processing

GitHub webhooks are processed through the sensor engine:

1. **Signature verification** — HMAC-SHA256 per-connection webhook secret
2. **Replay protection** — deduplicate on `X-GitHub-Delivery` header
3. **Event evaluation** — specialized evaluators for `check_run` (CI failure), `pull_request` (new PR), `push` (code push)
4. **Context extraction** — structured metadata: additions/deletions, change size, sensitive file detection (`.env`, `Dockerfile`, CI configs), branch classification, author type, force push detection, commit analysis
5. **Rule filtering** — user-defined rules map events to intents (`ci_failure` → `fix`, `pr_opened` → `review`)
6. **Smart escalation** — auto-adjusts priority based on context signals (high risk → P0, force push to protected branch → P0, large change set → P1)
7. **Deduplication** — prevents duplicate Operations from rapid webhook delivery

### AI Routing

Operations are routed to the best-fit agent:

1. Load all running agent instances with their roles, capabilities, and history
2. Build agent profiles: total operations routed, completion rate, average response time, recent intents handled
3. AI evaluation (GPT-4o-mini): scores each agent on role match, specialization, performance history, and event context
4. Confidence thresholds: ≥0.7 auto-routes, ≥0.3 suggests (user confirms), <0.3 requires manual assignment
5. Fallback: keyword/intent matching with history-based boost if AI is unavailable

---

## 9. Gateway API

Wooblay exposes two complementary interfaces to agents:

1. **HTTP Gateway** — a REST endpoint for direct integrations, GPT Actions, and programmatic access.
2. **MCP Proxy** — a native MCP server (see Section 5) that any MCP-speaking agent can connect to with zero code changes.

Both interfaces route through the same Gate engine. The same policy rules, simulation checks, and secure execution containers apply regardless of which interface the agent uses.

### HTTP Gateway

**Endpoint:** `POST /api/gateway/execute`

**Auth:** `Authorization: Bearer wbl_ak_...` (API key) or capability token in body

**Request:**
```json
{
  "action": "git:push",
  "params": { "branch": "feature/auth", "remote": "origin" }
}
```

**What happens:**
1. API key validation → resolve org, caller
2. Idempotency check (SHA-256 hash of caller + action + params, 24h cache)
3. Action registry lookup (optional — falls back to generic `exec:run`)
4. Find active connection for provider + org
5. Layer 1: Policy evaluation
6. Layer 2: Simulation
7. Layer 3: Secure execution
8. Return result

**OpenAPI spec:** `GET /api/gateway/spec` returns a spec importable into GPT Actions, Claude tools, or any OpenAPI-consuming client.

**Action registry** — structured actions with typed parameters:

| Action | Provider | What it does |
|--------|----------|-------------|
| `git:push` | GitHub | Push branch to remote |
| `github:pr:create` | GitHub | Open a pull request |
| `github:pr:merge` | GitHub | Merge a pull request |
| `aws:s3:cp` | AWS | Copy files to/from S3 |
| `aws:ecs:deploy` | AWS | Update ECS service |
| `gcp:cloudrun:deploy` | GCP | Deploy to Cloud Run |
| `mcp:tool-call` | Any | Execute any MCP tool through L3 isolation |
| `exec:run` | Any | Run arbitrary shell command with credentials |

The provider column is not a whitelist. Any provider string is accepted — connections for Slack, Stripe, Linear, or any other service use the same credential isolation pipeline.

---

## 10. Agent Supervision

### Trust Scoring

Each agent has a 0–100 trust score computed from its action history:

- Base: 70
- +1 per approved action (cap: +20)
- +0.5 per auto-allowed action (cap: +15)
- -3 per denied action
- -10 per CRITICAL flag, -5 per HIGH flag
- Trend: compared against prior 24h

### Flag Detection

Automated anomaly detection runs on every action:

- **Velocity anomaly** — action rate spike vs. baseline
- **Evasion pattern** — obfuscated commands, encoded payloads
- **Sensitive access** — touching credentials, environment files, CI configs
- **Privilege escalation** — requesting higher permissions than role suggests
- **Unusual pattern** — off-task behavior relative to assigned role

Optional AI threat assessment (GPT-4o-mini) provides deeper behavioral analysis when enabled. Degrades gracefully without an OpenAI key.

### Cost Tracking

Per-action cost attribution across categories: LLM tokens, compute minutes, API calls, gateway calls. Daily aggregation, burn rate calculation, and per-instance breakdown displayed on the dashboard.

---

## 11. Deployment Modes

### Firewall Mode (default)

Single-tenant. Runs alongside your agent infrastructure. Agent-to-Gate auth via ed25519 signed requests. No user management — it's your box, your agents, your policies.

Best for: teams running their own agents who need execution security without SaaS dependencies.

### Full Platform Mode

Multi-tenant SaaS. Clerk-based auth with org isolation. Hosted agent instances (deploy from dashboard). Sensor engine, AI routing, operation management. Receipt aggregation across instances.

Best for: teams that want managed agent infrastructure with built-in security.

Full Platform is gated — unlocked per-org with a platform password.

---

## 12. Tech Stack

| Component | Technology |
|-----------|-----------|
| Gate API | TypeScript, Fastify 5, Node.js 22+ |
| Database | PostgreSQL, Prisma 6 |
| Dashboard | React 19, Vite 6, Tailwind CSS v4, TanStack Query v5 |
| Auth | Clerk (JWT + Organizations), ed25519 (agent signatures) |
| Crypto | AES-256-GCM (vault), ed25519 (receipts), SHA-256 (hashing), RFC 8785 (canonical JSON) |
| MCP | @modelcontextprotocol/sdk (stdio + SSE transports) |
| Containers | Docker (agent runtime + MCP proxy sidecar + ephemeral execution) |
| Infrastructure | AWS EC2, ECR, ALB, Terraform |
| AI | OpenAI GPT-4o-mini (risk classification, intent verification, routing, policy optimization, threat assessment) |
| Agent Runtime | OpenClaw adapter shipped; any MCP-speaking or custom agent supported via proxy or adapter |

---

## 13. What Exists Today

**Shipped and operational:**

- Three-layer security moat (policy → simulation → secure execution)
- Envelope-encrypted credential vault (AES-256-GCM, KMS-ready)
- Ephemeral execution containers with credential injection
- Ed25519-signed, hash-chained receipt chain with integrity verification
- Policy engine with glob matching, category filters, risk tiers, presets, AI optimization
- Human-in-the-loop approval queue with human-readable descriptions and TTL
- GitHub sensor with webhook processing, event rules, smart escalation, deduplication
- AI-powered operation routing to agent instances
- Multi-instance agent deployment and management from dashboard
- Trust scoring, flag detection, cost tracking
- Gateway API with OpenAPI spec for external agents (GPT, Claude, MCP)
- MCP Proxy with Layer 3 credential isolation for any MCP tool server (stdio + SSE)
- External agent support via SSE endpoint (Claude Desktop, Cursor, custom agents)
- Dynamic provider support — any credential type, not limited to a fixed list
- Per-instance MCP server configuration from the dashboard
- Full activity audit trail with export (JSON, CSV)
- Webhook notifications for approval events, critical flags, trust alerts

**In progress:**

- Receipt verification UI
- Session playback timeline
- Contribution analytics page
- Slack/Teams integration
- Custom adapter SDK
- Agent orchestration graphs
- Rollback and checkpoints
- Compliance reporting (SOC 2, GDPR, HIPAA)

---

## 14. Why This Matters

The AI agent market is moving from demos to production deployment. Production means credentials, external systems, and real consequences.

Every company deploying agents in production will need to answer three questions:

1. **Who has the credentials?** If the agent holds them, you have a security problem. Wooblay ensures the agent never does.
2. **Who approved this action?** If no one, you have a governance problem. Wooblay provides pre-execution policy enforcement and human-in-the-loop approval.
3. **Can you prove what happened?** If your audit trail is a log file, you have a compliance problem. Wooblay provides a cryptographically signed, tamper-evident receipt chain.

These are not optional requirements. They are table stakes for enterprise agent deployment. Wooblay is the infrastructure that makes them architecturally guaranteed rather than procedurally promised.

---

**Wooblay** — Agents decide. Wooblay executes.

wooblay.com

---

*This document is confidential and proprietary. All rights reserved.*

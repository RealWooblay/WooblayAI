# Wooblay

**The execution firewall for AI agents.**

AI agents are connecting to everything — Salesforce, Stripe, Slack, databases, internal APIs, cloud infrastructure. They query customer records, process payments, send messages, update pipelines, and manage data. To do any of it, they need credentials. And right now, you hand those credentials over and hope for the best.

Wooblay is an MCP governance proxy. It sits between any AI agent and any MCP tool server. Every tool call is intercepted, evaluated against your policies, and — if risky — held for human approval before it touches anything. Credentials never reach the agent. Every decision is cryptographically signed and recorded.

**Agents decide. Wooblay executes.**

---

## The Problem

You connect an AI agent to your business tools. It needs to query your CRM, charge a customer's card, send a Slack message to your team, update a database record, provision a cloud resource. To do any of that, it needs credentials — and you need to trust it.

Today, that means:

- **Handing over long-lived API keys** and hoping the agent doesn't leak or misuse them
- **No approval workflow** — the agent acts, you find out after
- **No audit trail** — if something goes wrong at 2 AM, you're reverse-engineering logs
- **No isolation** — one compromised agent has your full set of secrets
- **No way to say "this, not that"** — you can't scope what an agent can do without modifying its code
- **Every agent is a silo** — Cursor has one set of keys, Claude has another, ChatGPT has a third. No shared policy, no unified audit, no central control

The more capable agents become, and the more tools they connect to, the worse this gets.

## How Wooblay Solves It

### 1. Three-Layer Security Moat

Every tool call goes through three checks before it touches the real world:

| Layer | Question | What Happens |
|-------|----------|-------------|
| **Policy Gate** | Should this action happen at all? | Rules evaluate the tool, risk tier, and category. Low-risk reads auto-allow. A Stripe charge over $500? Requires human approval. |
| **Simulation** | Is it targeting the right thing? | Per-connection allow/block patterns. Query `contacts`? Allowed. Delete `accounts`? Blocked. |
| **Secure Execution** | Can we contain the blast radius? | Action runs in an ephemeral container. Credentials are injected at runtime, never exposed to the agent. Container is destroyed after. |

### 2. Zero-Trust Credential Handling

Agents never see your secrets. Wooblay uses **envelope encryption** (AES-256-GCM, KMS-backed in production) to store credentials. When a tool call needs Stripe or Salesforce access, the credential is injected into a short-lived execution container that the agent cannot read from. The agent requests the action; Wooblay performs it.

Two classes of secrets:
- **Exec-only secrets**: Injected only during secure execution. The agent literally cannot access them.
- **Agent env vars**: Injected into the agent environment as variables. Use for keys the agent needs directly (e.g., an LLM API key). Clear warnings about agent visibility.

### 3. Cryptographic Audit Trail

Every decision — allow, deny, approve, execute — produces an **ed25519-signed, SHA-256 hash-chained receipt**. The chain is append-only and tamper-evident. You get a complete, cryptographically verifiable record of everything every agent ever did, across every tool, in one place.

### 4. Human-in-the-Loop Approvals

When a risky action is flagged, it lands in the approval queue with:
- A **human-readable description** of what the agent wants to do
- The **risk tier** (READ / WRITE / DESTRUCTIVE)
- **Full arguments** and context
- A **TTL countdown** — if no one approves, it's denied

Approve or deny from the dashboard with keyboard shortcuts. Receive push notifications via Telegram, Slack, WhatsApp, or email with one-tap approve/deny. Create "always allow" rules from any approval to teach the system your preferences.

### 5. Agent Agnostic

One setup. All agents. Wooblay speaks MCP — the open standard that Cursor, Claude, ChatGPT, and every major agent platform supports. Connect any MCP client to Wooblay and it gets the same policy enforcement, the same credential isolation, the same audit trail. No per-agent configuration. No per-agent secrets. One policy governs every agent in your organization.

### 6. Frictionless Setup

```bash
npx @wooblaymcp/cli setup --api-key wbl_ak_... --instance-id <id>
```

One command. Wooblay detects your installed agents (Cursor, Claude Desktop, VS Code), writes MCP configuration to each, and verifies connectivity. No manual JSON editing, no per-agent config files. All agents are routed through Wooblay automatically.

### 7. Custom MCP Hosting

Bring your own MCP servers. Point Wooblay at an npm package or a remote URL, and it hosts and proxies the server for you. Your custom tools get the same policy engine, credential vault, and audit trail as every built-in integration — without changing a line of your MCP server code.

---

## What's Built

### Dashboard & Control Plane

- **Command Center** — Live overview with pending action counts, cost tracking, and agent activity.
- **Approvals** — Full-width cards with human-readable descriptions, risk badges, keyboard shortcuts (j/k/a/d), "Always Allow Similar" policy creation.
- **Connections** — Stripe, Salesforce, Slack, GitHub, AWS, GCP, databases, custom MCP servers. Scope boundaries, secret management, connection health.
- **Policies** — Priority-ordered rules with glob matching, category filters (data, payments, messaging, code, files, network, infra, destructive), presets, AI-powered policy optimization.
- **Activity & Audit** — Complete audit trail with search, filtering by agent, tool, risk tier, and decision. Every receipt is cryptographically verifiable. Export to JSON or CSV.
- **Insights** — Cost breakdowns, action volume trends, policy hit rates.
- **Notifications** — Multi-channel delivery (Telegram, Slack, WhatsApp, Email) with one-tap approve/deny for risky actions. Role-based routing.
- **Kill Switch** — One tap to pause all agent activity org-wide.

### Backend Engine

- **MCP Proxy** — Full MCP protocol support over SSE and stdio. Any MCP-compatible agent connects directly. Tool discovery, call interception, response relay.
- **Policy Engine** — First-match-wins rule evaluation. READ/WRITE/DESTRUCTIVE risk classification. Category-based filtering. Default: writes need approval, reads auto-allow.
- **Vault** — Envelope encryption with AES-256-GCM. KMS-backed in production. Secret leasing with auto-expiration. Redaction patterns for logs.
- **Receipt Chain** — ed25519 signatures. SHA-256 hash chain. RFC 8785 canonical JSON. Tamper-evident, append-only.
- **Tool Host** — Hosts and proxies custom MCP servers (npm packages or remote URLs). Lifecycle management, health checks, credential injection.
- **Capability Tokens** — Time-bounded, scope-limited tokens for structured actions. Revocable kill switch. Max-use limits.
- **Anomaly Detection** — Velocity anomalies, evasion patterns, sensitive access, privilege escalation, unusual behavior. AI-assisted threat assessment.

### Auth & Multi-Tenancy

- **Clerk integration** — JWT auth for browser requests, org-based multi-tenancy.
- **Agent signature auth** — Ed25519 signed requests for agent-to-proxy communication.
- **Org scoping** — All data queries automatically filtered by organization. Cross-org access impossible.

---

## Architecture

```
  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
  │    Cursor     │  │    Claude     │  │  Any MCP     │
  │  (MCP client) │  │  (MCP client) │  │    Client    │
  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘
         │                 │                  │
         └────────────┬────┴──────────────────┘
                      │  MCP (SSE / stdio)
               ┌──────▼──────┐
               │   Wooblay   │         ┌──────────────┐
               │  MCP Proxy  │────────►│  Dashboard   │
               │  (Fastify)  │         │   (React)    │
               └──┬───┬───┬──┘         └──────────────┘
                  │   │   │
         ┌────────┘   │   └────────┐
         │            │            │
 ┌───────▼──────┐ ┌──▼───┐ ┌──────▼──────┐
 │ Policy Engine│ │Vault │ │ Receipt     │
 │ + Simulation │ │(AES) │ │ Chain       │
 │ + Risk Tier  │ │      │ │ (ed25519)   │
 └───────┬──────┘ └──┬───┘ └─────────────┘
         │            │
 ┌───────▼────────────▼───┐
 │  Ephemeral Exec        │
 │  Container             │
 │  (credential injection)│
 │  (destroyed after use) │
 └───────────┬────────────┘
             │
 ┌───────────▼────────────────────────────────────┐
 │           Upstream MCP Servers                  │
 │  ┌────────┐ ┌──────────┐ ┌───────┐ ┌────────┐ │
 │  │ Stripe │ │Salesforce│ │ Slack │ │ Custom │ │
 │  └────────┘ └──────────┘ └───────┘ └────────┘ │
 └────────────────────────────────────────────────┘
```

The agent never touches credentials. It makes a tool call through MCP. Wooblay intercepts it, evaluates it against policy, optionally holds for human approval, then executes it in an isolated container with the necessary credentials injected. The agent gets the result.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | TypeScript, Fastify 5, Prisma 6, PostgreSQL |
| Frontend | React 19, Vite 6, Tailwind CSS v4, TanStack Query v5 |
| MCP | @modelcontextprotocol/sdk, SSE + stdio transports |
| Crypto | ed25519 (node:crypto), AES-256-GCM, SHA-256, RFC 8785 |
| Auth | Clerk (JWT + Organizations) |
| Infra | Docker, AWS EC2, ECR, ALB, Terraform |
| AI | OpenAI GPT-4o-mini (threat analysis, policy optimization, risk classification, intent verification) |
| CLI | Commander.js, npx-ready |

---

## Quick Start

```bash
# Install dependencies
pnpm install

# Set up environment
cp .env.example .env
# Edit .env: DATABASE_URL, CLERK_SECRET_KEY, VAULT_MASTER_KEY

# Run database migrations
pnpm --filter @wooblay/gate exec prisma migrate deploy
pnpm --filter @wooblay/gate exec prisma generate

# Start development
pnpm dev
# Gate API on :4800, UI on :5173
```

## Deploy

```bash
# Build
docker build --platform linux/arm64 -f docker/gate/Dockerfile -t wooblay-gate .

# Push to ECR
docker tag wooblay-gate:latest <account>.dkr.ecr.us-east-1.amazonaws.com/wooblay-gate:latest
docker push <account>.dkr.ecr.us-east-1.amazonaws.com/wooblay-gate:latest

# Run
docker compose -f docker/docker-compose.runtime.yml up -d
```

---

## Project Structure

```
wooblay/
  apps/
    gate/           Fastify API — policy engine, vault, receipts, tool host
    mcp-proxy/      MCP protocol proxy — SSE + stdio, agent-facing
    toolhost/       Custom MCP server hosting and lifecycle management
    cli/            CLI — npx @wooblaymcp/cli setup, status, deploy
    ui/             React dashboard — approve, monitor, configure
    landing/        Marketing site
  packages/
    types/          Shared TypeScript types
    crypto/         ed25519 signing and verification
    schemas/        Zod validation schemas
    gate-client/    Gate API client library
  docker/
    gate/           Gate Dockerfile (multi-stage, embeds UI)
  infra/            Terraform (VPC, EC2, ALB, ECR, Secrets Manager)
```

The OpenClaw adapter is maintained as a separate package: [`@wooblay/openclaw-adapter`](https://github.com/Wooblay/openclaw-adapter).

---

## What Makes Wooblay Different

**Credentials are architecturally isolated.** This isn't "we promise not to log your keys." The agent process physically cannot access the credentials. They exist only inside ephemeral execution containers that are destroyed after use. Your Stripe secret key, your Salesforce OAuth token, your database password — none of them are ever visible to any agent.

**Policy runs before execution, not after.** Every tool call hits the policy engine before anything happens. A Stripe charge, a Salesforce update, a Slack message — each one is evaluated, classified by risk, and either auto-allowed, blocked, or held for approval. You define the rules. Wooblay enforces them.

**Approval workflows are built in.** Risky actions don't just get logged — they get queued for human review. Approve from the dashboard, your phone (Telegram, Slack, WhatsApp), or create "always allow" rules to reduce friction over time. The agent waits for the green light.

**The audit trail is cryptographic, not just a log file.** Every receipt is ed25519-signed and hash-chained. You can mathematically prove the complete history of every agent action across every tool. No one — not even us — can tamper with it after the fact.

**Agent agnostic. One setup for all agents.** Cursor, Claude, ChatGPT, custom agents — they all connect through MCP. One Wooblay instance governs all of them. One policy set. One audit trail. One approval queue. No per-agent configuration sprawl.

**One command to start.** `npx @wooblaymcp/cli setup` detects your agents, writes configuration, and connects everything. No manual wiring.

---

## Docs

- [Litepaper](LITEPAPER.md) — Product architecture, security model, and design
- [Architecture](docs/ARCHITECTURE.md) — Gateway, policy engine, vault, execution
- [Architecture Diagrams](docs/ARCHITECTURE-DIAGRAMS.md) — Mermaid diagrams
- [Security Model](docs/SECURITY.md) — Threat model, guarantees, compliance
- [Deployment](docs/DEPLOYMENT.md) — Production deployment guide
- [Enterprise Quickstart](docs/ENTERPRISE-QUICKSTART.md) — Onboarding guide for teams

## Integrations

- [`@wooblay/openclaw-adapter`](https://github.com/Wooblay/openclaw-adapter) — Open-source adapter for OpenClaw agent framework
- [`@wooblaymcp/cli`](https://www.npmjs.com/package/@wooblaymcp/cli) — CLI for agent configuration and management

## License

Proprietary. All rights reserved.

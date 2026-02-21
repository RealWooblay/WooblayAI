# Wooblay

**The execution firewall for AI agents.**

AI agents are powerful. They write code, deploy infrastructure, merge pull requests, and manage cloud resources — autonomously, 24/7. But that power creates a problem: every action an agent takes is a trust decision. Hand over your GitHub PAT and hope for the best? Give an agent your AWS keys and cross your fingers?

Wooblay sits between agents and the real world. Every action is intercepted, evaluated against your policies, and — if risky — held for human approval before it touches anything. Credentials never reach the agent. Every decision is cryptographically signed and recorded.

**Agents decide. Wooblay executes.**

---

## The Problem

You deploy an AI coding agent on your repo. It needs to push branches, open PRs, run tests, deploy to staging, manage S3 buckets. To do any of that, it needs credentials — and you need to trust it.

Today, that means:

- **Handing over long-lived API keys** and hoping the agent doesn't leak or misuse them
- **No approval workflow** — the agent acts, you find out after
- **No audit trail** — if something goes wrong at 2 AM, you're reverse-engineering logs
- **No isolation** — one compromised agent has your full set of secrets
- **No way to say "this, not that"** — you can't scope what an agent can do without modifying its code

The more capable agents become, the worse this gets.

## How Wooblay Solves It

### 1. Three-Layer Security Moat

Every action goes through three checks before it touches the real world:

| Layer | Question | What Happens |
|-------|----------|-------------|
| **Policy Gate** | Should this action happen at all? | Rules evaluate tool, risk tier, and category. Low-risk reads auto-allow. Destructive actions require human approval. |
| **Scope Boundaries** | Is it targeting the right thing? | Per-connection allow/block patterns. Push to `feature-*`? Allowed. Push to `main`? Blocked. |
| **Secure Execution** | Can we contain the blast radius? | Action runs in an ephemeral container. Credentials are injected at runtime, never exposed to the agent. Container is destroyed after. |

### 2. Zero-Trust Credential Handling

Agents never see your secrets. Wooblay uses **envelope encryption** (AES-256-GCM, KMS-backed in production) to store credentials. When an action needs GitHub or AWS access, the credential is injected into a short-lived execution container that the agent cannot read from. The agent requests the action; Wooblay performs it.

Two classes of secrets:
- **Exec-only secrets**: Injected only during secure execution. The agent literally cannot access them.
- **Agent env vars**: Injected into the agent container as environment variables. Use for keys the agent needs directly (e.g., an LLM API key). Clear warnings about agent visibility.

### 3. Cryptographic Audit Trail

Every decision — allow, deny, approve, execute — produces an **ed25519-signed, SHA-256 hash-chained receipt**. The chain is append-only and tamper-evident. You get a complete, cryptographically verifiable record of everything every agent ever did.

### 4. Human-in-the-Loop Approvals

When a risky action is flagged, it lands in the approval queue with:
- A **human-readable description** of what the agent wants to do
- The **risk tier** (READ / WRITE / DESTRUCTIVE)
- **Full arguments** and context
- A **TTL countdown** — if no one approves, it's denied

Approve or deny from the dashboard with keyboard shortcuts. Create "always allow" rules from any approval to teach the system your preferences.

### 5. Sensor-First Operations

Connect GitHub as a sensor. When a CI check fails, a PR is opened, or code is pushed, Wooblay creates an **Operation** and routes it to the right agent based on context, agent roles, and AI classification. Agents respond to events, not arbitrary triggers.

### 6. Runtime-Agnostic

Wooblay is the security layer, not the runtime. Your agents keep running exactly how they do today. We ship an **OpenClaw adapter** out of the box, but the architecture supports any framework — LangChain, CrewAI, AutoGen, or your own. The adapter intercepts tool calls and routes them through the Gate API.

---

## What's Built

### Dashboard & Control Plane

- **Command Center** — Live agent cards with trust scores, animated status faces, cost tracking, pending action counts. Deploy new agents in 3 steps.
- **Operations** — Sensor-created work items with priority (P0/P1/P2), intent classification, AI routing suggestions, manual assignment.
- **Approvals** — Full-width cards with human-readable descriptions, risk badges, keyboard shortcuts (j/k/a/d), "Always Allow Similar" policy creation.
- **Connections** — GitHub, AWS, GCP. Sensor configuration, scope boundaries, secret management. Full-access key guidance.
- **Policies** — Priority-ordered rules with glob matching, category filters (code, git, shell, files, network, secrets, infra, destructive), presets, AI-powered policy optimization.
- **Activity** — Complete audit trail. Filter by agent, tool, risk tier, decision.
- **Insights** — Trust score trends, cost breakdowns, contribution assessments.
- **Settings** — Webhook notifications for agent events.

### Instance Management

- **Deploy from UI** — Model selection (Claude, GPT-4, Gemini), API keys, Telegram bot configuration.
- **Instance Detail** — Trust-based weather backgrounds, animated agent character, contribution graphs, action breakdowns by category, agent network visualization (sub-agents), live workspace file browser.
- **Profile Editor** — Edit agent role and goal inline. Changes sync to SOUL.md and IDENTITY.md in the running container. The agent reads these for context.
- **Security Tab** — Add environment variables directly to the agent (no connection required). Clear warning about agent visibility. Links to exec-only secrets and policies.

### Backend Engine

- **Policy Engine** — First-match-wins rule evaluation. READ/WRITE/DESTRUCTIVE risk classification. Category-based filtering. Default: writes need approval, reads auto-allow.
- **Action Registry** — Structured actions (git:push, github:pr:create, aws:s3:cp, gcp:cloudrun:deploy) mapped to Docker execution specs. Plus `exec:run` for arbitrary shell commands.
- **Orchestrator** — Run state machine (pending → scheduled → running → completed/failed). Priority scheduling, concurrency limits, preemption, loop detection, budget enforcement, timeout detection, kill switch.
- **Sensor Engine** — GitHub webhook processing (check_run, pull_request, push). Rule-based filtering, deduplication, event context extraction. Creates Operations for AI router.
- **AI Router** — Context-aware routing of Operations to agent instances based on roles, capabilities, and event context. Confidence scores.
- **Vault** — Envelope encryption with AES-256-GCM. KMS-backed in production. Secret leasing with auto-expiration. Redaction patterns for logs.
- **AI Supervisor** — Threat assessment (obfuscation, exfiltration, social engineering). Behavioral analysis (off-task, spinning, escalation). Contribution evaluation. Session summaries.
- **Receipt Chain** — ed25519 signatures. SHA-256 hash chain. RFC 8785 canonical JSON. Tamper-evident, append-only.
- **Capability Tokens** — Time-bounded, scope-limited tokens for structured actions. Revocable kill switch. Max-use limits.
- **Evidence Bundles** — Test results, logs, diffs, environment manifests. Reproducibility tracking.

### Auth & Multi-Tenancy

- **Clerk integration** — JWT auth for browser requests, org-based multi-tenancy.
- **Agent signature auth** — Ed25519 signed requests for agent-to-gate communication.
- **Org scoping** — All data queries automatically filtered by organization. Cross-org access impossible.

---

## Architecture

```
                    ┌─────────────┐
                    │   Browser   │
                    │  (Clerk JWT)│
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐         ┌──────────────┐
  GitHub ──────────►│  Wooblay    │────────►│  Dashboard   │
  (webhooks)        │    Gate     │         │   (React)    │
                    │  (Fastify)  │         └──────────────┘
                    └──┬───┬───┬──┘
                       │   │   │
              ┌────────┘   │   └────────┐
              │            │            │
      ┌───────▼──────┐ ┌──▼───┐ ┌──────▼──────┐
      │ Policy Engine│ │Vault │ │ Receipt     │
      │ + Scope      │ │(AES) │ │ Chain       │
      │ + Risk Tier  │ │      │ │ (ed25519)   │
      └───────┬──────┘ └──┬───┘ └─────────────┘
              │            │
      ┌───────▼────────────▼───┐
      │  Ephemeral Containers  │
      │  (credential injection)│
      │  (network isolation)   │
      │  (destroyed after use) │
      └────────────────────────┘

  Agent Container                 Exec Container
  ┌─────────────────┐            ┌─────────────────┐
  │ OpenClaw + Plugin│──request──►│ git push        │
  │ (no credentials) │◄──result──│ (credentials    │
  │                  │            │  injected here) │
  └─────────────────┘            └─────────────────┘
```

The agent never touches credentials. It requests an action. Wooblay evaluates, approves (or asks a human), then executes it in an isolated container with the necessary credentials. The agent gets the result.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | TypeScript, Fastify, Prisma, PostgreSQL |
| Frontend | React 19, Vite 6, Tailwind CSS v4, TanStack Query v5 |
| Crypto | ed25519 (node:crypto), AES-256-GCM, SHA-256, RFC 8785 |
| Auth | Clerk (JWT + Organizations) |
| Infra | Docker, AWS EC2, ECR, ALB, Terraform |
| AI | OpenAI (threat analysis, routing, policy optimization) |
| Agent Runtime | OpenClaw (adapter included), extensible to any framework |

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
# Gate API on :4800, UI on :5173, Landing on :3000
```

## Deploy

```bash
# Build
docker build --platform linux/arm64 -f docker/gate/Dockerfile -t wooblay-gate .
docker build --platform linux/arm64 -f docker/runtimes/openclaw/Dockerfile -t wooblay-openclaw .

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
    gate/           Fastify API — policy engine, vault, receipts, orchestrator
    ui/             React dashboard — deploy, approve, monitor, configure
    landing/        Next.js marketing site
  packages/
    types/          Shared TypeScript types
    crypto/         ed25519 signing and verification
    schemas/        Zod validation schemas
    gate-client/    Gate API client library
    adapters/
      openclaw/     OpenClaw plugin (gated tools)
  docker/
    gate/           Gate Dockerfile (multi-stage, embeds UI)
    runtimes/
      openclaw/     OpenClaw runtime + Wooblay plugin
  infra/            Terraform (VPC, EC2, ALB, ECR, Secrets Manager)
```

---

## What Makes Wooblay Different

**It's a firewall, not a restrictor.** Agents keep their full capabilities. They can push to any branch, deploy to any environment, run any command — if your policies allow it. Wooblay doesn't limit what agents *can* do. It verifies what they *should* do.

**Credentials are architecturally isolated.** This isn't "we promise not to log your keys." The agent process physically cannot access the credentials. They exist only inside ephemeral execution containers that are destroyed after use.

**The audit trail is cryptographic, not just a log file.** Every receipt is ed25519-signed and hash-chained. You can mathematically prove the complete history of every agent action. No one — not even us — can tamper with it after the fact.

**It works with what you already have.** Wooblay doesn't replace your agent framework. It doesn't require you to rewrite your tools. Drop in the adapter, connect your services, define your policies. Your agents keep running exactly as they did before — just with a security layer between them and the world.

---

## Docs

- [ARCHITECTURE.md](docs/ARCHITECTURE.md) — Sensors, operations, router, gateway, execution
- [ARCHITECTURE-DIAGRAMS.md](docs/ARCHITECTURE-DIAGRAMS.md) — Mermaid diagrams
- [DEPLOYMENT.md](docs/DEPLOYMENT.md) — Production deployment guide
- [EXTERNAL-TESTING.md](docs/EXTERNAL-TESTING.md) — Testing checklist

## License

Proprietary. All rights reserved.

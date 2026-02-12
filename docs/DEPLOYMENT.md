# Wooblay Deployment Guide

## Overview

Wooblay runs as a single EC2 instance behind an Application Load Balancer (ALB). The Gate process serves both the dashboard UI and the API, and dynamically manages agent instances as Docker containers on the same host.

```
Internet
   |
   v
AWS ALB (HTTPS on wooblay.com)
   |
   v
EC2 Instance (t3.medium)
├── wooblay-gate        (Platform API + UI, port 4800)
├── wooblay-postgres    (PostgreSQL 16, data volume)
├── agent-instance-1    (OpenClaw container, isolated network)
├── agent-instance-2    (OpenClaw container, isolated network)
└── ...                 (N agent containers, spawned on demand)
```

## Multi-Instance Architecture

Each agent instance is a separate Docker container with:
- **Isolated environment** — own API keys, Telegram token, GitHub PAT, model selection
- **Network isolation** — agents can only reach the Gate API (for tool gating) and external internet (for LLM APIs, GitHub, etc.)
- **Independent lifecycle** — create, start, stop, restart, delete from the dashboard
- **Shared Gate** — all instances route tool calls through the same Gate for policy evaluation and approval

When you click "Deploy Instance" in the UI:
1. Gate creates a database record for the instance
2. Gate writes an `.env` file and `docker-compose.yml` with the instance's configuration
3. Gate spawns a Docker container using the OpenClaw image
4. The container starts OpenClaw with Wooblay plugin, routing all risky tool calls through the Gate
5. Actions appear in the dashboard for approval/denial

## Components

| Component | Image | Purpose |
|-----------|-------|---------|
| `wooblay-gate` | `wooblay-gate:mvp` | API server + static UI + instance orchestration |
| `wooblay-postgres` | `postgres:16-alpine` | Platform database (users, policies, receipts, instances) |
| Agent containers | `wooblay-openclaw:latest` | OpenClaw runtime with Wooblay plugin pre-installed |

## AWS Infrastructure

| Resource | Purpose |
|----------|---------|
| **EC2** (t3.medium) | Hosts all containers. Docker socket mounted into Gate for container management. |
| **ALB** | HTTPS termination with ACM certificate. Routes 443 → Gate port 4800. |
| **ECR** | Docker image registry. Repos: `wooblay-gate`, `wooblay-openclaw`. |
| **Route53** | DNS for `wooblay.com` pointing to ALB. |
| **ACM** | SSL certificate for `wooblay.com` and `*.wooblay.com`. |
| **S3** | Build artifacts bucket (`wooblay-deploy-artifacts`). |
| **IAM** | Instance role with SSM, ECR pull, S3 read permissions. |

### Why EC2 (not Fargate/Lambda)?

The Gate needs Docker socket access to spawn and manage agent containers dynamically. This is Docker-in-Docker orchestration, which isn't supported on serverless platforms. EC2 provides:
- Full Docker daemon access
- Container-to-container networking
- Docker socket mounting for orchestration
- Persistent volumes for database data

## Deployment Methods

### Method 1: GitHub Actions CI/CD (Recommended)

Push to the `mvp` or `main` branch triggers automated deployment via `.github/workflows/deploy.yml`:

1. Builds Gate Docker image with UI baked in
2. Pushes to ECR
3. SSM sends commands to EC2 to pull and restart

Required GitHub Secrets:
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` — IAM credentials
- `CLERK_SECRET_KEY` — Clerk backend secret
- `VITE_CLERK_PUBLISHABLE_KEY` — Clerk frontend key

### Method 2: Manual Deploy

```bash
# 1. Create a source tarball
tar --exclude='node_modules' --exclude='.git' --exclude='dist' \
    --exclude='.pnpm-store' --exclude='infra' --exclude='.instances' \
    -czf /tmp/wooblay-mvp.tar.gz .

# 2. Upload to S3
aws s3 cp /tmp/wooblay-mvp.tar.gz s3://wooblay-deploy-artifacts/mvp/wooblay-mvp.tar.gz

# 3. On EC2 (via SSM): download, build, restart
aws s3 cp s3://wooblay-deploy-artifacts/mvp/wooblay-mvp.tar.gz .
tar -xzf wooblay-mvp.tar.gz

docker build \
  --build-arg VITE_CLERK_PUBLISHABLE_KEY=pk_test_xxx \
  -f docker/gate/Dockerfile \
  -t wooblay-gate:mvp .

docker compose down
docker compose up -d
```

## Environment Variables

### Platform (Gate runtime)

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `PLATFORM_MODE` | Yes | `true` for central platform API |
| `CLERK_SECRET_KEY` | Yes | Clerk backend key for JWT verification |
| `WOOBLAY_SERVER_PRIVATE_KEY` | Yes | ed25519 private key (hex DER) for receipt signing |
| `WOOBLAY_SERVER_PUBLIC_KEY` | Yes | ed25519 public key (hex DER) for receipt verification |
| `AGENT_IMAGE` | Yes | Docker image for OpenClaw containers |
| `INSTANCES_DIR` | No | Where instance configs are stored (default: `/opt/wooblay/instances`) |
| `GATE_INTERNAL_URL` | No | Gate URL for agent containers (default: `http://172.21.0.20:4800`) |
| `OPENAI_API_KEY` | No | Enables AI supervisor (threat detection, behavioral analysis) |
| `OPENAI_MODEL` | No | OpenAI model to use (default: `gpt-4.1-mini`) |

### Build-time (baked into UI)

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_CLERK_PUBLISHABLE_KEY` | Yes | Clerk frontend key for auth UI |
| `VITE_API_URL` | No | API base URL (empty = same origin) |

### Per-Instance (passed to agent containers)

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | LLM provider key |
| `OPENCLAW_MODEL` | No | Model name (default: `claude-sonnet-4-20250514`) |
| `TELEGRAM_BOT_TOKEN` | No | Telegram bot token for chat interface |
| `TELEGRAM_ALLOWED_USERS` | No | Comma-separated Telegram user IDs |
| `GITHUB_TOKEN` | No | GitHub PAT for code operations |

## Network Topology

```
Docker Networks:
  gate_net (172.20.0.0/24)
  ├── postgres   (172.20.0.10)
  └── gate       (172.20.0.20)

  agent_net (172.21.0.0/24)
  ├── gate       (172.21.0.20)  ← agents talk to gate here
  ├── agent-1    (172.21.0.30+)
  ├── agent-2    (172.21.0.31+)
  └── ...
```

- Agents can reach: Gate API (for tool gating), external internet (for LLM, GitHub)
- Agents cannot reach: Postgres directly, other agents
- Gate can reach: Postgres, all agents, Docker socket

## Local Development

```bash
# Prerequisites: PostgreSQL running locally, Node.js 20+, pnpm

# 1. Install dependencies
pnpm install

# 2. Set up environment
cp .env.example .env
# Edit .env with your DATABASE_URL and keys

# 3. Run database migrations
cd apps/gate && npx prisma@6 migrate deploy && npx prisma@6 generate

# 4. Start the gate (API server)
pnpm --filter gate dev

# 5. Start the UI (in another terminal)
pnpm --filter ui dev

# Visit http://localhost:5173
```

For local instance deployment, set in `.env`:
```
INSTANCES_DIR=/path/to/your/project/.instances
GATE_INTERNAL_URL=http://host.docker.internal:4800
```

## Authentication

| Mode | Method | Description |
|------|--------|-------------|
| Without Clerk keys | No auth | Single-user, direct access (local dev) |
| With Clerk keys | Clerk JWT | Sign up → Enter coupon code → Full access |

Beta coupon code: `WOOBLAY-BETA-2026` (auto-seeded on first boot)

## Scaling

Current: Single EC2 handles ~5-10 concurrent agent instances on a t3.medium (2 vCPU, 4GB RAM).

Future scaling path:
- **Vertical**: Upgrade to t3.xlarge/2xlarge for more agents per host
- **Horizontal**: Multiple EC2s with shared RDS, agent placement via the platform API
- **Kubernetes**: EKS with per-agent pods

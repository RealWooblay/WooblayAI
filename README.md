# Wooblay

**The gate between AI agents and the real world.**

Wooblay is an enterprise supervision layer that intercepts every risky AI agent action — shell commands, file writes, API calls — and requires human approval before execution. Deploy agents, approve their actions from a dashboard, and get a cryptographic receipt for every decision.

## How It Works

```
Agent tries to run `rm -rf /tmp/data`
            |
     Wooblay Gate intercepts
            |
     Policy engine evaluates risk
            |
   +--------+--------+
   |                  |
 Low risk          High risk
 Auto-allow     Route to human
   |                  |
   |          Dashboard shows approval
   |          Human approves or denies
   |                  |
   +--------+---------+
            |
   Signed receipt recorded
   Action executes (or blocked)
```

1. Agent calls a tool (shell command, file write, web fetch)
2. Wooblay plugin intercepts and sends to the Gate API
3. Policy engine classifies risk and evaluates rules
4. Low-risk actions auto-execute. High-risk actions wait for human approval (up to 24 hours)
5. Every decision produces an ed25519-signed, hash-chained receipt

## MVP Features

- **Deploy agent instances from the UI** — One-click OpenClaw deployment with model selection and API key configuration
- **Telegram integration** — Connect a Telegram bot to interact with your agent via chat, configurable from the dashboard
- **Approve/deny from dashboard** — Pending actions show human-readable descriptions of what the agent wants to do
- **24-hour approval window** — Agents get a deny-then-retrigger pattern so humans have time to review
- **Cryptographic receipt chain** — ed25519-signed, SHA-256 hash-chained audit trail for every action
- **Policy engine** — Risk classification (READ/WRITE/DESTRUCTIVE) with configurable rules and presets
- **Instance management** — Start, stop, restart, configure, and monitor agent containers
- **Configure Telegram post-deploy** — Enable or update Telegram bot settings on running instances

## Tech Stack

- **Backend**: TypeScript, Fastify, Prisma, PostgreSQL
- **Frontend**: React 19, Vite 6, Tailwind CSS v4, TanStack Query v5
- **Crypto**: ed25519 (node:crypto), RFC 8785 canonical JSON, SHA-256
- **Infra**: Docker, AWS EC2, ECR, ALB, Terraform
- **Agent**: OpenClaw with Wooblay plugin (gated tools via `registerTool`)

## Quick Start (Local Dev)

```bash
# Install dependencies
pnpm install

# Set up environment
cp .env.example .env
# Edit .env with your DATABASE_URL (PostgreSQL)

# Run database migrations
pnpm --filter @wooblay/gate exec prisma migrate deploy
pnpm --filter @wooblay/gate exec prisma generate

# Start development servers
pnpm dev
# Gate API on :4800, UI on :5173
```

## Deploy (Production)

```bash
# Build Docker images
docker build --platform linux/arm64 -f docker/gate/Dockerfile -t wooblay-gate .
docker build --platform linux/arm64 -f docker/runtimes/openclaw/Dockerfile -t wooblay-openclaw .

# Push to ECR
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <account>.dkr.ecr.us-east-1.amazonaws.com
docker tag wooblay-gate:latest <account>.dkr.ecr.us-east-1.amazonaws.com/wooblay-gate:latest
docker tag wooblay-openclaw:latest <account>.dkr.ecr.us-east-1.amazonaws.com/openclaw-wooblay:latest
docker push <account>.dkr.ecr.us-east-1.amazonaws.com/wooblay-gate:latest
docker push <account>.dkr.ecr.us-east-1.amazonaws.com/openclaw-wooblay:latest

# Deploy on EC2 with docker-compose
docker compose -f docker/docker-compose.runtime.yml up -d
```

## Project Structure

```
wooblay/
  apps/
    gate/          Fastify API — policy engine, approvals, receipts, instance management
    ui/            React dashboard — deploy, approve, monitor
    landing/       Next.js marketing site
  packages/
    types/         Shared TypeScript types
    crypto/        ed25519 signing and verification
    schemas/       Zod validation schemas
    gate-client/   Gate API client library
    adapters/
      openclaw/    OpenClaw plugin (gated tools)
  docker/
    gate/          Gate Dockerfile
    runtimes/
      openclaw/    OpenClaw runtime Dockerfile + entrypoint
  infra/           Terraform (VPC, EC2, ALB, ECR, Secrets Manager)
```

## Roadmap

See [ROADMAP.md](ROADMAP.md) for partially built features and planned additions including:

- Audit trail with AI-powered anomaly detection
- GitHub PR attribution
- Slack/Teams approval integration
- Agent orchestration graphs
- Custom adapter SDK for any agent framework
- Multi-tenant SaaS mode
- Compliance reporting (SOC 2, GDPR, HIPAA)

## License

Proprietary. All rights reserved.

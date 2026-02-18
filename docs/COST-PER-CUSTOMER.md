# Wooblay — Cost Per Customer & Pricing Model

Business expenses breakdown for determining customer pricing.

---

## Infrastructure Costs (per customer)

### Compute — EC2

| Component | Instance | Cost/Month | Notes |
|-----------|----------|------------|-------|
| Gate Server | t3.medium (2 vCPU, 4GB) | ~$30 | API server, policy engine, router |
| Agent Containers | Runs on same host | Included | Docker containers share host resources |
| Ephemeral Exec Containers | Runs on same host | Included | Short-lived (~10-60 sec per action) |

For heavier customers (many concurrent agents), upgrade to t3.large (~$60) or c6i.xlarge (~$100).

**Multi-tenant architecture**: One Gate server can serve multiple customers via org isolation. At scale, a single t3.xlarge (~$120/mo) can handle ~10-20 small customers, dropping per-customer infra to ~$6-12/mo.

### Database — PostgreSQL (RDS)

| Tier | Instance | Cost/Month | Notes |
|------|----------|------------|-------|
| Single customer | db.t4g.micro | ~$13 | 2 vCPU, 1GB RAM |
| Shared (5-10 customers) | db.t4g.small | ~$26 | 2 vCPU, 2GB RAM, org-scoped queries |
| Growth (10-50 customers) | db.t4g.medium | ~$50 | 2 vCPU, 4GB RAM |

Per-customer cost on shared tier: **~$3-5/mo**

### Storage

| Item | Cost | Notes |
|------|------|-------|
| RDS storage | ~$0.115/GB/mo | 20GB base is ~$2.30/mo |
| Agent workspace (EBS) | ~$0.08/GB/mo | 10-50GB per active agent |
| Docker images (ECR) | ~$0.10/GB/mo | OpenClaw image ~2GB, cached |

Per-customer estimate: **~$3-8/mo**

### Networking

| Item | Cost | Notes |
|------|------|-------|
| Data transfer out | $0.09/GB | Mostly LLM API calls, webhook payloads |
| NAT Gateway (if VPC) | ~$32/mo fixed + $0.045/GB | Consider only at scale |

Most customers generate <5GB/mo transfer: **~$1-5/mo** (no NAT) or **~$35+/mo** (with NAT gateway, shared across customers)

---

## AI/LLM Costs (per customer, variable)

These are the **dominant variable costs**. Depends on usage.

### Gate-side LLM calls (Wooblay's OpenAI spend)

Default model: `gpt-4.1-mini` ($0.40/1M input, $1.60/1M output)

| Call Type | When | Tokens (~) | Cost per call |
|-----------|------|------------|---------------|
| Risk classification | Every tool call through Gate | ~200 in, ~50 out | ~$0.00009 |
| Operation routing | Every new operation | ~500 in, ~200 out | ~$0.00052 |
| Policy AI analysis | Policy rule creation (one-time) | ~800 in, ~300 out | ~$0.00080 |
| AI Supervisor | Per run (if enabled) | ~2000 in, ~500 out | ~$0.0016 |

**Typical customer per month** (50 operations, 500 tool calls, 20 runs):
- Risk classification: 500 × $0.00009 = **$0.045**
- Operation routing: 50 × $0.00052 = **$0.026**
- AI Supervisor: 20 × $0.0016 = **$0.032**
- **Total Gate LLM: ~$0.10/mo** (light), **~$1-5/mo** (heavy)

### Agent-side LLM calls (customer's own API key)

The agent's LLM calls (Claude, GPT-4, etc.) are paid by the **customer via their own API key**. This is NOT your expense. The agent container is configured with the customer's `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`.

However, for reference on what customers should expect:

| Agent Model | Cost/1M tokens (in/out) | Typical run (10K in, 5K out) | Notes |
|-------------|-------------------------|------------------------------|-------|
| Claude Sonnet 4 | $3.00 / $15.00 | ~$0.105 | Most capable |
| GPT-4.1 | $2.00 / $8.00 | ~$0.060 | Good balance |
| GPT-4.1 mini | $0.40 / $1.60 | ~$0.012 | Cost-efficient |
| Claude 3 Haiku | $0.25 / $1.25 | ~$0.009 | Cheapest |

A typical agent run uses 50K-200K tokens → **$0.05-$3.00 per run** depending on model.

**Important for customers:** The OpenClaw runtime uses the customer's Anthropic (or OpenAI) API key **while the instance container is running**. That includes startup, idle behavior, Telegram bots, and any default or background behavior in OpenClaw — not only when the user explicitly sends a message. **Stop the instance when not in use to avoid unexpected API spend.** The UI shows a notice when an instance is running: "Your Anthropic key is in use — stop when not in use to avoid API spend."

---

## Per-Customer Cost Summary

### Light customer (startup, 1-2 repos, few operations/month)

| Category | Monthly Cost |
|----------|-------------|
| Compute (shared) | $6-12 |
| Database (shared) | $3-5 |
| Storage | $3-5 |
| Network | $1-2 |
| Gate LLM (your expense) | $0.10-0.50 |
| **Total COGS** | **$13-25/mo** |

### Medium customer (5-10 repos, daily operations)

| Category | Monthly Cost |
|----------|-------------|
| Compute (shared or dedicated) | $15-30 |
| Database (shared) | $5-8 |
| Storage | $5-10 |
| Network | $2-5 |
| Gate LLM | $1-5 |
| **Total COGS** | **$28-58/mo** |

### Heavy customer (many repos, continuous CI, multiple agents)

| Category | Monthly Cost |
|----------|-------------|
| Compute (dedicated) | $60-120 |
| Database (dedicated or large shared) | $13-50 |
| Storage | $10-30 |
| Network | $5-15 |
| Gate LLM | $5-20 |
| **Total COGS** | **$93-235/mo** |

---

## Pricing Recommendations

| Tier | Target | Suggested Price | COGS | Gross Margin |
|------|--------|-----------------|------|-------------|
| Starter | Small teams, 1-2 agents | $49/mo | ~$20 | ~60% |
| Pro | Mid-size teams, 5+ agents | $149/mo | ~$45 | ~70% |
| Enterprise | Large orgs, unlimited agents | $499+/mo | ~$150 | ~70% |

### Key pricing principles

1. **Agent LLM costs are on the customer** — they bring their own API keys. This keeps your COGS predictable.
2. **Gate LLM costs are tiny** — gpt-4.1-mini at $0.40/1M input tokens means even heavy usage is <$20/mo.
3. **Compute is the main expense** — multi-tenant shared infra is the path to margins above 60%.
4. **Value pricing, not cost pricing** — Wooblay's value is security + automation, not compute. A customer paying $149/mo for autonomous CI-fixing agents that save 10+ dev-hours/month is getting 10x+ ROI.

---

## Cost Attribution (already built)

Wooblay tracks per-run costs in `engine/cost-attribution.ts`:

| Category | Tracked | Pricing Used |
|----------|---------|-------------|
| LLM tokens | Input/output per model | Actual model pricing table |
| Compute minutes | Container uptime | $0.005/min ($0.30/hr) |
| Gateway calls | Per structured action | $0.01/call |

This data feeds the Runs page cost display and budget enforcement. Customers see their per-run spend.

---

## Break-even Analysis

Assuming shared infrastructure (1 server for ~10 customers):

| Customers | Monthly Revenue | Monthly COGS | Net |
|-----------|----------------|-------------|-----|
| 5 (Starter) | $245 | $150 (infra) + $5 (LLM) = $155 | +$90 |
| 10 (mix) | $990 | $200 (infra) + $20 (LLM) = $220 | +$770 |
| 20 (mix) | $2,980 | $350 (infra) + $50 (LLM) = $400 | +$2,580 |
| 50 (mix) | $7,450 | $800 (infra) + $150 (LLM) = $950 | +$6,500 |

**Break-even: ~3-4 customers at Starter tier.**

Unit economics improve dramatically with scale because the Gate server, database, and networking are shared.

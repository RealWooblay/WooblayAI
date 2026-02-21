# Wooblay — Cost Per Customer & Pricing Model

Business expenses breakdown for determining customer pricing. Kept in sync with product: Gate, agent instances, MCP proxy, Layer 3 execution.

### Cost terminology

| Term | Meaning |
|------|--------|
| **Inference cost** | Cost of running an LLM: input tokens + output tokens × model price. Gate inference = Wooblay's spend (risk classification, routing, AI Supervisor). Agent inference = customer's spend (their API key). |
| **Execution cost** | Compute and hosting: Gate server, agent containers, ephemeral Layer 3 containers. Usually the largest fixed/variable infra line. |
| **Gate LLM** | Wooblay-paid inference for policy, risk, and routing. Small per call (~$0.00009 per tool call for risk classification). |

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

### MCP proxy & external clients (Cursor, Claude Desktop)

Tool calls from the **MCP proxy** (e.g. Cursor or Claude Desktop using the Wooblay MCP URL + API key) go through the same Gate path as in-container agents:

- **L1+L2 (policy gate):** Every tool call triggers risk classification (Gate LLM) and policy evaluation. Same per-call cost as agent-originated tool calls (~$0.00009 for risk classification).
- **L3 (credentialed tools only):** If the MCP server has credentials attached in the UI, the tool runs in an **ephemeral container** (Layer 3). One container per credentialed call: startup + run + teardown. Adds **latency** (~5–15+ seconds per call) and **compute** (CPU/memory for that container). No extra per-call fee in the doc’s attribution today; it’s “included” in host compute, but heavy credentialed MCP use increases container churn and host load.

So: **inference cost** for MCP = same Gate LLM cost per tool call. **Execution cost** for MCP = proxy container (always on) + ephemeral L3 containers (only when credentials are attached and the tool is invoked).

---

## Gateway-only (non–full-platform) cost plan

For customers who use **only the Gateway**: API keys, firewall, MCP proxy (e.g. Cursor or Claude Desktop). **No agent instances**, no OpenClaw containers, no full platform.

### What’s in scope (gateway-only)

| Included | Not included |
|----------|--------------|
| Gate API (auth, policy, routing) | Agent instances / OpenClaw |
| API key auth for MCP | Per-run AI Supervisor |
| MCP proxy container (one per customer/org) | Operation routing (per “operation”) |
| Risk classification on every tool call | Long-lived agent compute |
| L3 ephemeral only when credentialed MCP tools are used | |

### Infrastructure (gateway-only)

| Component | Cost/Month | Notes |
|-----------|------------|-------|
| Gate server | Shared (~$3–6/customer) | Same host as full-platform; gateway-only adds mostly API + proxy traffic |
| Database | Shared (~$2–4/customer) | Orgs, API keys, MCP config, policy — smaller footprint than full platform |
| MCP proxy container | Shared host, minimal | One container per customer; light (Node + npx), ~256MB–512MB each |
| Storage / network | ~$1–3/customer | Config, logs; egress for MCP tool calls |

**Per-customer infra (gateway-only): ~$6–13/mo** on shared multi-tenant.

### Gate LLM (gateway-only)

Only **risk classification** applies on each tool call through the proxy. No operation routing, no AI Supervisor.

| Call type | When | Cost per call |
|-----------|------|----------------|
| Risk classification | Every MCP tool call through Gate | ~$0.00009 |

**Example:** 1,000 tool calls/month → **~$0.09**. 10,000 → **~$0.90**. 50,000 → **~$4.50**.

Policy AI (one-time per rule) if they create policy rules: same as full platform (~$0.0008 per rule).

### Execution / L3 (gateway-only)

- **No agent compute** — customer runs Cursor/Claude Desktop on their own machine.
- **L3 (ephemeral)** only when an MCP server has credentials attached and a credentialed tool is invoked. Same cost model as full platform (container start/run/teardown; included in host compute).

### Per-customer cost summary (gateway-only)

| Usage | Monthly COGS | Notes |
|-------|----------------|-------|
| Light (500 tool calls, no/small L3) | **~$7–15** | Infra ~$6–13 + Gate LLM &lt;$0.05 |
| Medium (5,000 tool calls, some L3) | **~$10–20** | Infra similar; Gate LLM ~$0.45; L3 in host |
| Heavy (25,000+ tool calls, frequent L3) | **~$15–35** | Gate LLM ~$2–3; more proxy + L3 churn on host |

### Pricing recommendation (gateway-only)

| Tier | Target | Suggested Price | COGS | Gross Margin |
|------|--------|-----------------|------|--------------|
| Gateway | Individuals, small teams (MCP only) | $19–29/mo | ~$10–15 | ~50–60% |
| Gateway Pro | Teams, heavier MCP + credentials | $49/mo | ~$15–25 | ~50–60% |

Gateway-only has **no agent LLM** (customer’s inference stays in Cursor/Claude). Wooblay’s cost is infra + Gate LLM only, so lower price and lower COGS than full platform.

---

## Per-Customer Cost Summary (full platform)

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

## Pricing Recommendations (full platform)

| Tier | Target | Suggested Price | COGS | Gross Margin |
|------|--------|-----------------|------|-------------|
| Starter | Small teams, 1-2 agents | $49/mo | ~$20 | ~60% |
| Pro | Mid-size teams, 5+ agents | $149/mo | ~$45 | ~70% |
| Enterprise | Large orgs, unlimited agents | $499+/mo | ~$150 | ~70% |

Gateway-only tiers and COGS are in [Gateway-only (non–full-platform) cost plan](#gateway-only-nonfull-platform-cost-plan) above.

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
| LLM tokens (inference) | Input/output per model | Actual model pricing table (gpt-4o, Claude, etc.) |
| Compute minutes | Container uptime (agent + L3 ephemeral) | $0.005/min ($0.30/hr) |
| Gateway calls | Per structured action / tool call through Gate | $0.01/call |

This data feeds the Runs page cost display and budget enforcement. Customers see their per-run spend. MCP-originated tool calls through the Gate use the same attribution when tied to a run.

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

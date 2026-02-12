# Wooblay — Product Vision

## One-liner

The governance layer between AI agents and the real world.

## The Problem

AI agents are moving from chat interfaces to autonomous execution — writing code, sending emails, managing infrastructure, accessing business data. Every enterprise wants this productivity gain, but nobody has an answer for:

- **"What did the agent actually do?"** — No tamper-proof record of actions taken
- **"Can I stop it before it does something destructive?"** — No approval workflow before execution
- **"Is this compliant?"** — No audit trail that satisfies SOC 2, HIPAA, or internal governance
- **"How do I deploy agents safely?"** — No standardized runtime with security boundaries

Today, teams either block agent adoption entirely (losing competitive advantage) or deploy agents with full access and hope for the best (risking data breaches, compliance violations, and operational disasters).

## The Solution

Wooblay sits in the execution path of every AI agent action. Before an agent runs a shell command, writes a file, makes an API call, or accesses a database — Wooblay intercepts it, classifies risk, enforces policy, and optionally routes to a human for approval. Every decision produces a cryptographically signed, hash-chained receipt.

```
Agent decides to act → Wooblay intercepts → Policy evaluates risk
                                                    |
                                          Low risk: auto-approve
                                          High risk: human decides
                                                    |
                                          Signed receipt recorded
                                          Action executes (or blocked)
```

## Why This Matters Now

1. **Timing**: 2025-2026 is the inflection point. Claude, GPT, and open-source models now reliably use tools. OpenClaw, Devin, Cursor, Copilot Workspace — autonomous agents are shipping. Governance hasn't kept up.

2. **Regulation is coming**: The EU AI Act, NIST AI RMF, and enterprise compliance frameworks are all moving toward requiring auditability for AI-driven decisions. Wooblay's receipt chain is built for this.

3. **The trust gap**: Surveys show 78% of enterprises want to deploy AI agents but only 12% trust them to act autonomously. Wooblay closes that gap.

## Technical Moat

### 1. Cryptographic Receipt Chain (Deep Moat)

Every action produces an immutable receipt:
- **ed25519 digital signature** — tamper-proof, verifiable by any third party
- **SHA-256 hash chain** — each receipt links to the previous, creating a blockchain-like audit trail
- **RFC 8785 canonical JSON** — deterministic serialization for reproducible hashes
- **Decision trail** — captures the agent's reasoning, citations, and inputs used

This isn't logging. This is **cryptographic proof** of what happened, who approved it, and why. It's the difference between "we think the agent did X" and "here's a mathematically verifiable record."

Competitors log actions to a database. Wooblay produces evidence.

### 2. Execution-Layer Gating (Structural Moat)

Most AI safety tools operate at the prompt layer (input/output filtering). Wooblay operates at the **execution layer** — intercepting the actual tool calls. This means:
- Works regardless of what the agent said or how it was prompted
- Cannot be bypassed by prompt injection or jailbreaking
- Captures the real action, not the described intention

### 3. Runtime Deployment + Governance (Platform Moat)

Wooblay doesn't just monitor — it deploys and manages agent runtimes. This creates lock-in through:
- Infrastructure management (users don't want to run their own EC2 instances)
- Configuration management (API keys, Telegram tokens, GitHub PATs)
- Lifecycle management (start/stop/restart/scale agents)

Once an enterprise runs their agents through Wooblay, migration cost is high.

### 4. Policy Engine with Learning (Future Moat)

The policy engine starts with static rules but evolves:
- Auto-suggest policy changes based on approval patterns
- ML-driven risk classification trained on the receipt corpus
- Cross-customer threat intelligence (anonymized) — "agents across our platform are increasingly attempting X"

## Competitive Landscape

| Company | Focus | Wooblay Difference |
|---------|-------|--------------------|
| Invariant Labs | AI safety testing | Testing, not runtime gating. No approval workflow. |
| Patronus AI | LLM output evaluation | Evaluates text outputs, not tool execution. |
| Lakera | Prompt injection defense | Input filtering only. No execution-layer control. |
| LangSmith / LangFuse | Observability & tracing | Observe-only. No approval, no gating, no receipts. |
| Arthur AI | Model monitoring | Model-level metrics. Not agent-action governance. |

**Wooblay's unique position**: The only product that combines execution-layer gating + human approval workflows + cryptographic audit trail + managed agent deployment.

## Product Tiers (Planned)

### Free Tier
- 1 agent instance
- 100 actions/month
- Basic policy rules
- 7-day receipt retention

### Pro ($99/month per instance)
- Unlimited actions
- Custom policy rules
- Telegram + Slack integrations
- 90-day receipt retention
- Priority approval routing

### Enterprise (Custom pricing)
- Dedicated infrastructure (per-customer EC2/VPC)
- SSO / SAML integration
- Compliance reporting (SOC 2, HIPAA, GDPR)
- Unlimited receipt retention
- Custom adapter development
- SLA guarantees
- On-premise deployment option

## Long-Term Vision

### Phase 1: Agent Governance (Now)
- Deploy and supervise OpenClaw agents
- Approve/deny actions from dashboard
- Cryptographic receipt trail
- Policy engine with risk classification

### Phase 2: Universal Agent Gateway (6 months)
- Adapters for every major agent framework (LangChain, CrewAI, AutoGen, custom)
- MCP (Model Context Protocol) server for Claude Desktop / Cursor / Windsurf
- SDK for building custom agent integrations
- Webhook-based approval routing (Slack, Teams, PagerDuty)

### Phase 3: Intelligence Layer (12 months)
- AI-powered audit analysis — automatically flag anomalous patterns
- Cross-agent orchestration governance — when Agent A tells Agent B to act
- Predictive risk scoring trained on the global receipt corpus
- Automated compliance report generation
- Agent performance benchmarking across customers (anonymized)

### Phase 4: Industry Standard (18+ months)
- Open-source the receipt format specification
- Push for adoption as an industry standard for agent auditability
- Certification program — "Wooblay Certified" for agent frameworks
- Marketplace for policy templates and adapters
- Government and defense contracts (FedRAMP)

## Key Metrics to Track

| Metric | Why It Matters |
|--------|---------------|
| Actions gated per month | Core usage / value delivered |
| Approval latency (median) | UX quality — are humans responding fast? |
| Deny rate by risk tier | Policy effectiveness |
| Receipt verification rate | Trust signal — are customers checking receipts? |
| Agent instances deployed | Platform stickiness |
| Time to first gated action | Onboarding friction |

## Why This Wins

1. **Regulatory tailwind** — Compliance requirements for AI are only increasing. Wooblay becomes mandatory infrastructure.
2. **Developer-friendly** — One plugin, one command, agents are supervised. No architectural changes needed.
3. **Sticky by design** — Once the receipt chain is your audit trail, you can't remove it without losing compliance.
4. **Network effects** — More customers = better threat intelligence, better policy templates, better risk models.
5. **Expansion revenue** — Each customer deploys more agents over time. Usage grows with AI adoption.

## The Ask

Wooblay is looking for:
- **Design partners** — Enterprises deploying AI agents who need governance today
- **Early customers** — Teams willing to run agents through Wooblay in exchange for direct input on the product
- **Feedback** — What's missing? What would make this a must-have for your org?

---

*Built by the Wooblay team. Supervised autonomy for agents — approvals, identity, receipts, scoring.*

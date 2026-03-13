# Wooblay Roadmap

## Shipped

Everything below is live in production.

- **Three-layer security moat** — policy gate → simulation → secure execution in ephemeral containers
- **MCP proxy** — any agent (Cursor, Claude, ChatGPT, custom) connects via SSE; all tools proxied through L1/L2/L3
- **Credential vault** — AES-256-GCM envelope encryption, KMS-backed; credentials never reach agent process
- **Policy engine** — priority-ordered rules, glob matching, matchArgs for per-action argument patterns, AI risk classification, AI policy optimization
- **Human-in-the-loop approvals** — approval queue with TTL, human-readable descriptions, "always allow similar" creates policy
- **Multi-channel approval notifications** — Telegram, Slack, WhatsApp, Email with one-tap approve/deny; role-based routing
- **Role-based approval enforcement** — requiredApproverRole on policies, atomic resolution, admin/owner override
- **Kill switch** — one-tap pause all agent activity from dashboard or notification
- **Anomaly detection** — velocity spikes, evasion patterns, sensitive access, privilege escalation, unusual behavior
- **Cryptographic audit trail** — ed25519-signed, SHA-256 hash-chained receipts, tamper-evident, chain integrity verification
- **Custom MCP hosting** — npm packages hosted in L3 + remote SSE URLs proxied; configure once, all agents get access
- **CLI setup** — `npx @wooblaymcp/cli setup` auto-detects Cursor, Claude Desktop, VS Code; writes configs; one command, all agents
- **Gateway API** — HTTP REST endpoint with OpenAPI spec for GPT Actions, Claude tools, programmatic access
- **Agent trust scoring** — 0-100 composite score from action history, anomaly flags, trend indicators
- **Cost tracking** — per-action attribution across LLM tokens, compute, API calls; daily aggregation, burn rate
- **Contribution tracking** — org-wide metrics by agent, user, tool, outcome, cost, time period
- **Dashboard** — command center, approvals, policies, activity/audit, connections/credentials, sensors, operations, insights, notifications, usage
- **Sensor engine** — GitHub webhooks with signature verification, replay protection, smart escalation, deduplication
- **AI operation routing** — GPT-4o-mini scores agent fit; auto-routes high-confidence, suggests low-confidence
- **Multi-instance agent deployment** — deploy, start, stop, restart, delete from dashboard
- **Audit export** — JSON and CSV with date range filtering

## Next

Priority items under active development.

- **Scoped credentials** — just-in-time token minting (AWS STS, GitHub App installations, GCP short-lived tokens) to replace long-lived keys
- **Cross-agent awareness** — action ordering and conflict prevention when multiple agents operate on the same resources
- **Generic webhook sensing** — accept events from any source (Slack, Jira, PagerDuty, custom HTTP), not just GitHub
- **Stripe billing integration** — usage-based metering through the proxy, automated invoicing
- **Additional runtime adapters** — LangChain, CrewAI, AutoGen via adapter interface

## Future

Strategic direction for the product.

- **ML-driven risk classification** — trained on the global receipt corpus for improved accuracy over static regex
- **Cross-org threat intelligence** — anonymized pattern sharing across customers
- **Automated compliance reports** — SOC 2, HIPAA, GDPR-ready exports with receipt chain evidence
- **Agent marketplace** — publish and discover pre-configured agent roles with policy templates
- **Open-source receipt specification** — push for industry standard for agent auditability
- **SSO/SAML** — enterprise SSO via SAML 2.0 / OIDC in addition to Clerk
- **Multi-region deployment** — deploy Gate + agent workspaces across regions for latency and data residency
- **Custom simulation strategies** — user-defined simulation scripts (test suites, migration safety checks)
- **Federated agent networks** — cross-org agent collaboration with trust boundaries
- **Desktop app** — native application for non-developer onboarding

# Wooblay — Feature Roadmap

## Shipped (MVP)

### Execution-Layer Gating
Tool calls from agents are intercepted, risk-classified, and routed through policy evaluation. Actions are auto-allowed, auto-denied, or held for human approval with a 24-hour window. Every decision produces a cryptographically signed receipt.

### Policy Engine with Presets
CRUD policy rules with priority ordering, tool/risk matching, and argument patterns. Three one-click presets (Balanced, Strict, Permissive). Policy suggestions based on historical data.

### Human-Readable Descriptions
Every tool call is translated into plain English. Approvals show what the agent is trying to do and why it was flagged — accessible to non-technical reviewers.

### Activity Feed with Flag Detection
Filterable activity table showing all agent actions. Rule-based flag detection (velocity anomalies, retry loops, privilege escalation, sensitive access). Expandable rows with full details.

### AI Supervisor (Optional)
OpenAI-powered threat assessment, behavioral pattern analysis, contribution evaluation, and session summaries. Non-blocking and non-critical — gracefully degrades without API key.

### Agent Trust Scoring
0-100 trust score per agent computed from approval/denial history and detected flags. Trend indicators (improving/stable/declining). Displayed on Mission Cards and approval cards.

### Cost Tracking
Per-tool-call cost estimation with daily/weekly aggregation and burn rate calculation. Displayed on instance cards and mission views.

### Audit Trail Export
JSON and CSV export with date range filtering and summary statistics. Cryptographic hash chain integrity verification.

### Mission Cards & Pipeline View
Dashboard shows each instance as a Mission Card with current pipeline stage (Planning → Executing → Approval → Done), trust badge, cost estimate, and recent action summary.

### Webhook Notifications
Configurable outbound webhooks for approval events, critical flags, and trust alerts. CRUD management with test endpoint.

### Multi-Instance Deployment
Deploy, configure, start, stop, restart, and delete agent instances from the dashboard. Each instance gets isolated Docker container with own API keys and config.

### Cryptographic Receipt Chain
Every action produces an immutable receipt with ed25519 signature, SHA-256 hash chain, and RFC 8785 canonical JSON serialization.

---

## Partially Built (Code Exists, Not Fully Integrated)

### Receipt Vault & Verification UI
**Status:** Backend complete, frontend scaffolded
Browse and verify receipts from the dashboard. Independent tamper-proof verification.
**What's left:** Polish search/filter UI, integrate verification into approval flow.

### Session Playback
**Status:** Backend API complete (`/api/sessions/:id/playback`)
Ordered timeline of all events in a session with optional AI summary.
**What's left:** Dedicated frontend page with visual timeline.

### Contribution Analytics
**Status:** Backend complete, feeds into Mission Cards
Per-agent metrics: files created/edited, commands run, PRs detected, approval efficiency.
**What's left:** Dedicated analytics page with charts and trends.

### Task Timeline
**Status:** Backend complete, frontend scaffolded
Step-by-step visual timeline of every tool call within a task.
**What's left:** Real-time updates via SSE, timeline diff view.

### Task Scoring
**Status:** Backend complete, frontend scaffolded
Label task outcomes (SUCCESS/FAIL/NEEDS_HUMAN). Feeds into policy suggestions.
**What's left:** Scoring input forms, reliability dashboards.

---

## Planned (Not Yet Built)

### Slack / Teams Integration
Approval notifications and actions directly from Slack or Microsoft Teams. Approve/deny agent actions without opening the dashboard.

### MCP (Model Context Protocol) Proxy
Universal adapter for any MCP-compatible agent (Claude Desktop, Cursor, Windsurf). Wooblay sits as a transparent MCP proxy — zero agent modification required.

### Custom Adapter SDK
TypeScript SDK for building Wooblay adapters for any agent framework. Currently supports OpenClaw natively; SDK will enable LangChain, CrewAI, AutoGPT integration.

### Context Engine
Shared memory layer across agents — agents read/write structured context that persists across sessions and is visible in the dashboard.

### Agent Orchestration Graphs
Visual DAG editor for multi-agent workflows. Chain agents with conditional routing, parallel execution, and rollback triggers.

### Rollback & Checkpoints
Filesystem snapshots before destructive actions. One-click rollback to any checkpoint in the receipt chain.

### Cost Budgets & Alerts
Per-agent and per-task budget limits. Auto-deny actions when budget exceeded. Alert thresholds.

### Compliance Reporting
Auto-generated SOC 2, GDPR, HIPAA reports from the receipt chain. PDF export with cryptographic attestation.

### Multi-Tenant SaaS Mode
Full multi-tenant with per-tenant isolation, usage-based billing, and admin portal.

### Cross-Customer Threat Intelligence
Anonymized pattern sharing across deployments. "Agents across our platform are increasingly attempting X."

### Agent Performance Benchmarking
Compare agent effectiveness across tasks, models, and configurations.

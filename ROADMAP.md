# Wooblay — Feature Roadmap

Features that are partially built in the codebase but not yet integrated into the MVP release.

## Partially Built (Code Exists)

### Receipt Vault & Verification
**Status:** Backend complete, UI scaffolded  
**What it does:** Every agent action produces a cryptographically signed receipt with ed25519 signatures and SHA-256 hash chains. The vault page lets you browse all receipts, and each receipt can be independently verified for tamper-proofing.  
**What's left:** Polish the vault search/filter UI, integrate receipt verification into the approvals flow, add export functionality.  
**Files:** `apps/ui/src/pages/vault/VaultPage.tsx`, `apps/ui/src/pages/receipts/ReceiptPage.tsx`, `apps/gate/src/routes/receipts.ts`

### Audit Trail with AI Analysis
**Status:** Backend complete, UI scaffolded  
**What it does:** Full chronological audit log with 12 anomaly detectors that auto-flag suspicious patterns (unusual timing, privilege escalation, repeated denied actions). Produces human-readable narration of causal chains.  
**What's left:** Connect AI analysis endpoints to the UI, add real-time streaming of flags, tune detection thresholds.  
**Files:** `apps/ui/src/pages/audit/AuditPage.tsx`, `apps/gate/src/routes/audit.ts`, `apps/gate/src/services/analysis.ts`

### GitHub Attribution
**Status:** Backend and webhook handler complete, UI scaffolded  
**What it does:** Links agent actions back to GitHub PRs and commits. When a PR triggers an agent run, the audit trail shows exactly which code change caused which agent actions.  
**What's left:** OAuth flow for GitHub app installation, webhook delivery verification, PR comment integration.  
**Files:** `apps/ui/src/pages/github/GitHubPage.tsx`, `apps/gate/src/routes/github-webhook.ts`

### Task Timeline
**Status:** Backend complete, UI scaffolded  
**What it does:** Step-by-step visual timeline of every tool call within a task, showing the decision chain (policy eval → approval → execution → receipt).  
**What's left:** Real-time timeline updates via SSE, timeline diff view for comparing runs.  
**Files:** `apps/ui/src/pages/timeline/TimelinePage.tsx`, `apps/gate/src/routes/timeline.ts`

### Task Scoring
**Status:** Backend complete, UI scaffolded  
**What it does:** Label task outcomes (SUCCESS/FAIL/NEEDS_HUMAN/REGRESSION) and track agent reliability over time. Feeds into policy suggestions.  
**What's left:** Scoring input forms, per-agent reliability dashboards, automated scoring based on execution results.  
**Files:** `apps/ui/src/pages/scoring/ScoringPage.tsx`, `apps/gate/src/routes/scores.ts`

### Infrastructure Management
**Status:** Backend health checks complete, UI scaffolded  
**What it does:** Monitor runtime health, adapter connectivity, canary trap status, and system-level runtime configuration from a single page.  
**What's left:** Live health streaming, adapter auto-discovery, configuration hot-reload.  
**Files:** `apps/ui/src/pages/infrastructure/InfrastructurePage.tsx`, `apps/gate/src/routes/runtime.ts`

### Session Detail View
**Status:** Backend complete, UI scaffolded  
**What it does:** Detailed view of all activity within a single agent session — every tool call, approval decision, and execution result in chronological order.  
**What's left:** Session replay, session comparison, session export.  
**Files:** `apps/ui/src/pages/sessions/SessionPage.tsx`

---

## Planned (Not Yet Built)

### Slack / Teams Integration
Approval notifications and actions directly from Slack or Microsoft Teams. Approve/deny agent actions without opening the dashboard.

### Context Engine
Shared memory layer across agents — agents can read/write structured context that persists across sessions and is visible in the dashboard for full transparency.

### Agent Orchestration Graphs
Visual DAG editor for defining multi-agent workflows. Chain agents together with conditional routing, parallel execution, and rollback triggers.

### Rollback & Checkpoints
Filesystem workspace snapshots before destructive actions. One-click rollback to any checkpoint in the receipt chain.

### Cost Tracking & Budgets
Per-agent and per-task cost tracking (LLM tokens, API calls, compute time). Set budget limits that auto-deny actions when exceeded.

### Custom Adapter SDK
TypeScript SDK for building Wooblay adapters for any agent framework. Currently supports OpenClaw natively; SDK will enable integration with LangChain, CrewAI, AutoGPT, and custom agents.

### Multi-Tenant SaaS Mode
Full multi-tenant deployment with per-tenant isolation, billing, and admin portal. Currently supports single-tenant managed instances.

### Compliance Reporting
Auto-generated compliance reports (SOC 2, GDPR, HIPAA) based on the receipt chain and audit trail. Export to PDF with cryptographic attestation.

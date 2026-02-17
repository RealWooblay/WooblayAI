# Wooblay — Execution Engine (How agents actually do things)

This document traces the **complete path** from "agent wants to create a PR" to "PR exists on GitHub" — and explains where OpenClaw, the Wooblay plugin, the Gate, the Tool Gateway, and credentials all fit together.

---

## The short answer

The agent (OpenClaw) **never has credentials**. When it wants to do something on GitHub (create a PR, push a branch, read a file), it doesn't call the GitHub API directly. Instead:

1. The agent calls a **gated tool** (e.g. `gated_exec`) inside its container
2. That tool asks Wooblay Gate: "can I do this?"
3. Gate evaluates policy → ALLOW / DENY / NEEDS APPROVAL
4. If allowed, a **capability token** is minted
5. The capability token is sent to the **Tool Gateway**
6. The Tool Gateway **decrypts the real credential** from the Connection store and calls GitHub
7. The result flows back to the agent

The credential (your GitHub PAT or GitHub App installation token) lives in the `Connection` table, encrypted at rest. The agent container never sees it.

---

## Two execution paths

Wooblay has **two parallel paths** for how an agent interacts with external services:

### Path A: Gated tools (shell commands inside the container)

This is the "classic" path. The agent uses OpenClaw's built-in tools (`exec`, `write`, `edit`) to run shell commands, write files, etc. — but Wooblay intercepts every call.

```
Agent (OpenClaw) decides: "I need to run `git push`"
        │
        ▼
Calls gated_exec({ command: "git push" })
        │
        ▼
Wooblay Plugin → POST /api/tool/execute to Gate
        │
        ▼
Gate: classify risk → evaluate policy
        │
   ┌────┼────────────────────┐
   │    │                    │
 ALLOW  DENY            APPROVE
   │    │                    │
   │  return "BLOCKED"    Create Approval
   │                     (wait for human)
   │                         │
   ▼                    APPROVED → execute
Plugin runs the actual                
shell command locally,       DENIED → block
returns output to agent
```

**For GitHub specifically**: if `GITHUB_TOKEN` is set as an env var in the container (via the Access tab), the agent can `git push` directly because `git` uses the token from the environment. But this **bypasses the Tool Gateway** — which is why the Access tab has a risk warning.

### Path B: Tool Gateway (structured API actions)

This is the **secure** path. The agent (or orchestrator) sends a structured action like `github:pr:create` to the Tool Gateway, which resolves the credential and calls the GitHub API server-side.

```
Operation created → Run started → Agent proposes action
        │
        ▼
Proposal created (e.g. "create PR on owner/repo")
        │
        ▼
Policy evaluates → if APPROVE, human approves in UI
        │
        ▼
Capability token minted:
  wbl_cap_v1.<claims>.<signature>
  - Scoped to: (runId, actionClass: "github:pr:create", repo: "owner/repo")
  - TTL: 15 minutes
  - Max uses: 10
        │
        ▼
POST /api/gateway/execute
  { capabilityToken, action: "github:pr:create", params: { owner, repo, title, head, base } }
        │
        ▼
Gateway validates token:
  1. ed25519 signature check (tries current key, then rotated keys)
  2. Claims: audience, expiry, action class match
  3. DB check: not revoked, not over max uses, run still active
  4. Org isolation: run.orgId === connection.orgId
        │
        ▼
Idempotency check (SHA-256 of capabilityId + action + params)
  → If cached: replay previous response
        │
        ▼
Find active Connection for provider "github" in same org
        │
        ▼
resolveGitHubToken(connectionId):
  ├── GitHub App connection? → mint installation token (short-lived, ~1hr, repo-scoped)
  └── PAT connection? → envelopeDecrypt(credentialRef) → plaintext PAT
        │
        ▼
executeGitHubAction(connectionId, { action: "github:pr:create", params })
  → calls https://api.github.com/repos/{owner}/{repo}/pulls
  → with Authorization: Bearer <real_token>
  → agent NEVER sees this token
        │
        ▼
Record cost → emit gateway.executed event → cache idempotency result
        │
        ▼
Post-action verification (optional):
  Read back from GitHub API to confirm the PR was actually created
        │
        ▼
Result returned to caller (agent/orchestrator)
```

---

## How OpenClaw ties in

[OpenClaw](https://github.com/anthropics/openclaw) is an autonomous agent runtime. It:
- Runs an LLM (Claude, GPT, etc.)
- Has built-in tools: `exec` (shell), `write` (files), `edit` (files), `browser`, `web_fetch`, etc.
- Has a plugin system (extensions) and a hook system (event listeners)

Wooblay integrates with OpenClaw at **three levels**:

### 1. Wooblay Plugin (gated tools)

**File:** `packages/adapters/openclaw/plugin/index.ts`

When OpenClaw starts, it loads the Wooblay plugin from `~/.openclaw/extensions/wooblay/`. The plugin uses `api.registerTool()` to add four gated tools:

| Gated tool | Replaces | What it does |
|------------|----------|-------------|
| `gated_exec` | `exec` | Shell commands — calls Gate before running |
| `gated_write` | `write` | File writes — calls Gate before writing |
| `gated_edit` | `edit` | File edits — calls Gate before editing |
| `gated_web_fetch` | `web_fetch` | HTTP requests — calls Gate before fetching |

Each gated tool:
1. POSTs to `{GATE_URL}/api/tool/execute` with the tool name + args
2. Gate classifies risk (READ / WRITE / DESTRUCTIVE) and evaluates policy
3. If EXECUTE: the plugin runs the actual command locally and returns output
4. If DENY: returns "BLOCKED by Wooblay policy" to the agent
5. If PENDING_APPROVAL: polls `GET /api/approvals/{id}` for up to 100 seconds, then executes or blocks

**The agent itself (the LLM) is told** these tools exist. When it decides "I need to run a command", it calls `gated_exec` — it doesn't know that a policy check is happening behind the scenes.

### 2. Hook handler (audit logging)

**File:** `packages/adapters/openclaw/src/hooks/handler.ts`

OpenClaw fires events for every tool call (`tool:start`, `tool:result`). The Wooblay hook listens to these and:
- On `tool:start`: POSTs to Gate to log the tool call
- On `tool:result`: POSTs to Gate to record the result and generate a signed receipt

This is **fire-and-forget** (non-blocking). It doesn't affect execution — it's purely for the audit trail.

### 3. Exec Approval Bridge (blocking approval flow)

**File:** `packages/adapters/openclaw/src/bridge/exec-approval-bridge.ts`

OpenClaw has a native approval system (`exec-approvals.json`). The bridge:
1. Listens for `exec.approval.requested` events from OpenClaw
2. Forwards each request to Gate for policy evaluation
3. Resolves the approval back to OpenClaw (allow / deny)

The pre-baked `exec-approvals.json` sets `ask: "always"` and `askFallback: "deny"`, so every risky tool call from OpenClaw's built-in tools goes through this flow.

---

## Container architecture

When you click "Deploy" in the Wooblay dashboard:

```
┌─────────────────────────────────────────────────┐
│ EC2 Host                                        │
│                                                 │
│  ┌────────────────────────────┐                 │
│  │ wooblay-gate (port 4800)   │                 │
│  │  ├─ API server (Fastify)   │                 │
│  │  ├─ Policy engine          │                 │
│  │  ├─ Tool Gateway           │◄───── Browser   │
│  │  ├─ Agent Router           │       (React UI)│
│  │  ├─ Connection store (DB)  │                 │
│  │  └─ Static UI              │                 │
│  └────────────┬───────────────┘                 │
│               │ Docker socket                   │
│  ┌────────────┴───────────────┐                 │
│  │ agent-instance-1 (OpenClaw)│                 │
│  │  ├─ OpenClaw gateway       │                 │
│  │  ├─ Wooblay plugin         │─── gate_net ──► │
│  │  │   (gated tools)         │   port 4800     │
│  │  ├─ Wooblay hook           │                 │
│  │  ├─ SOUL.md / IDENTITY.md  │                 │
│  │  └─ Workspace files        │                 │
│  └────────────────────────────┘                 │
│                                                 │
│  ┌────────────────────────────┐                 │
│  │ agent-instance-2 (OpenClaw)│                 │
│  │  └─ (same structure)       │                 │
│  └────────────────────────────┘                 │
│                                                 │
│  ┌─────────────┐                                │
│  │ PostgreSQL   │                                │
│  └─────────────┘                                │
└─────────────────────────────────────────────────┘
```

**Key networking:**
- Agent containers can reach Gate on port 4800 (for gated tool calls and audit)
- Agent containers can reach the internet (for LLM APIs: Anthropic, OpenAI)
- Agent containers **cannot** reach PostgreSQL directly
- If `GITHUB_TOKEN` is injected via Access tab → agent can `git push` directly (bypasses TG)

---

## Credential flow in detail

### When you add a sensor (Connection)

1. You enter a GitHub PAT on the Sensors page
2. Frontend sends `POST /api/connections` with `{ provider: "github", name: "...", credential: "ghp_..." }`
3. Gate calls `envelopeEncrypt(credential)`:
   - Generate a random DEK (data encryption key, 32 bytes)
   - Encrypt the PAT with the DEK (AES-256-GCM)
   - Encrypt the DEK with the KEK (key-encryption key, from `VAULT_MASTER_KEY`)
   - Store: `enc:v1:<keyId>:<dekNonce>:<wrappedDek>:<dataNonce>:<ciphertext>`
4. The encrypted ref is stored in `Connection.credentialRef`
5. The plaintext PAT is **never stored** — only the encrypted blob

### When the Tool Gateway needs the credential

1. Gateway finds the active Connection for the provider + org
2. Calls `resolveGitHubToken(connectionId)`:
   - If `authMode === "github_app"`: mints a short-lived installation token via GitHub App API (cached ~1hr)
   - If PAT: calls `envelopeDecrypt(credentialRef)` → plaintext PAT
3. Uses the decrypted token for the actual GitHub API call
4. Token is in memory only during the request — never stored in plaintext

### When you add credentials via Access tab (direct injection)

1. You enter a GitHub PAT on the Instance Detail → Access tab
2. Gate writes it as an environment variable into the agent's `.env` file
3. Container is restarted with `GITHUB_TOKEN=ghp_...` in its environment
4. The agent can now run `git push` directly — the token is in the shell environment
5. **This bypasses the Tool Gateway entirely** — no policy check, no audit, no credential resolution

This is why the Access tab has a risk warning: "Direct Access — Bypasses Tool Gateway."

---

## The "create a PR" example, end to end

Let's trace what happens when an agent needs to create a PR:

### Scenario A: Via Tool Gateway (secure path)

1. **Sensor** detects a push event on GitHub (webhook → `POST /api/webhooks/github/:connectionId`)
2. **Sensor engine** creates an Operation: "New push to main on owner/repo"
3. **Agent router** evaluates all active instances → assigns to the agent whose role matches
4. **Orchestrator** creates a Run for the Operation
5. Agent (OpenClaw) analyzes the code, decides a PR is needed
6. Agent calls `gated_exec({ command: "git checkout -b fix/bug && git commit ..." })`
   - Plugin → Gate → policy → ALLOW → runs locally in container
   - But `git push` requires auth...
7. If no `GITHUB_TOKEN` in env: the push **fails** (no credentials in container)
8. Instead, the orchestrator/agent uses the **Tool Gateway**:
   - Creates a Proposal: "Create PR: fix/bug → main"
   - Policy evaluates → APPROVE (human reviews in UI)
   - Human approves → capability token minted
   - `POST /api/gateway/execute { action: "github:pr:create", params: { owner, repo, title, head: "fix/bug", base: "main" } }`
   - Gateway decrypts the Connection's credential → calls GitHub API → PR created
   - Result returned to agent

### Scenario B: Via direct credentials (Access tab)

1. Same sensor → Operation → Run flow
2. Agent has `GITHUB_TOKEN` in its environment (set via Access tab)
3. Agent calls `gated_exec({ command: "git push origin fix/bug" })`
   - Plugin → Gate → policy → ALLOW → runs `git push` locally
   - `git` uses `GITHUB_TOKEN` from environment → push succeeds
4. Agent calls `gated_exec({ command: 'curl -X POST https://api.github.com/repos/.../pulls -H "Authorization: Bearer $GITHUB_TOKEN" ...' })`
   - Plugin → Gate → policy → ALLOW → runs curl locally
   - Direct GitHub API call using the injected token
5. **No Tool Gateway involved** — no capability token, no credential resolution, no post-action verification

---

## Supported Tool Gateway actions

The Gateway currently supports these GitHub actions:

| Action | What it does |
|--------|-------------|
| `github:repo:get` | Get repo metadata |
| `github:pr:list` | List pull requests |
| `github:pr:get` | Get a specific PR |
| `github:pr:create` | Create a new PR |
| `github:pr:merge` | Merge a PR |
| `github:pr:comment` | Comment on a PR |
| `github:file:read` | Read a file from a repo |
| `github:file:write` | Create/update a file (commits directly) |
| `github:branch:create` | Create a branch |
| `github:branch:list` | List branches |
| `github:checks:list` | List check runs |

Each action is executed by `dispatchAction()` in `services/github-gateway.ts`, which translates the structured params into the correct GitHub REST API call with proper auth headers.

---

## Security properties

| Property | Gated tools (Path A) | Tool Gateway (Path B) |
|----------|---------------------|----------------------|
| Policy check before action | Yes (Gate) | Yes (capability token) |
| Credential exposure to agent | If injected via Access tab | Never |
| Audit trail | Hook logs to Gate | Gateway events + receipts |
| Scope enforcement | Shell-level only | Action class + repo + TTL |
| Idempotency | No | Yes (SHA-256 cache) |
| Post-action verification | No | Yes (reads back from API) |
| Cost attribution | Heuristic | Per-action tracking |
| Kill switch (revoke all) | Stops container | Revokes all capability tokens |

---

## Key files

| File | Role |
|------|------|
| `packages/adapters/openclaw/plugin/index.ts` | Plugin that registers gated tools in OpenClaw |
| `packages/adapters/openclaw/src/hooks/handler.ts` | Hook that logs all tool events to Gate (audit) |
| `packages/adapters/openclaw/src/bridge/exec-approval-bridge.ts` | Bridges OpenClaw's native approval system with Gate |
| `packages/adapters/openclaw/src/gate-client.ts` | HTTP client for Gate API (submit tool calls, check approvals) |
| `packages/adapters/openclaw/src/approval-waiter.ts` | Polls Gate for approval resolution |
| `apps/gate/src/routes/tool.ts` | `POST /api/tool/execute` — policy evaluation endpoint |
| `apps/gate/src/routes/gateway.ts` | `POST /api/gateway/execute` — Tool Gateway endpoint |
| `apps/gate/src/services/github-gateway.ts` | Executes GitHub API actions (PR create, file read, etc.) |
| `apps/gate/src/services/github-app.ts` | Resolves GitHub tokens (App installation tokens or PAT) |
| `apps/gate/src/services/vault.ts` | Envelope encryption/decryption for credentials |
| `apps/gate/src/engine/capability.ts` | Mints, validates, revokes capability tokens |
| `apps/gate/src/engine/policy.ts` | Priority-ordered policy rule evaluation |
| `apps/gate/src/engine/verify.ts` | Post-action verification (reads back from GitHub API) |
| `docker/runtimes/openclaw/Dockerfile` | Agent container image (OpenClaw + Wooblay plugin) |
| `docker/runtimes/openclaw/entrypoint.sh` | Container startup (config generation, identity seeding) |
| `docker/runtimes/openclaw/exec-approvals.json` | Pre-baked: `ask: "always"`, `askFallback: "deny"` |

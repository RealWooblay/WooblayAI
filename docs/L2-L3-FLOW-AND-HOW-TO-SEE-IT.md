# Security Layers for MCP Tool Calls

## The Two-Layer Moat for MCP

| Layer | When | What it does | Blocks? |
|-------|------|-------------|---------|
| **L1 (Policy)** | Before everything | Policy check: allow / deny / needs human approval | Yes |
| **L2 PRE-EXEC** | After approval, BEFORE credentials injected | AI + rules verify: server command + tool name + credential env vars — is this combination safe? | **Yes — credentials never leave vault if blocked** |
| **L3 (Secure Execution)** | After L2 passes | Ephemeral Docker container with vault-injected credentials, runs the tool, captures result | N/A (execution) |

Result monitoring (anomalies, misuse patterns) is handled by the Activity supervisor and audit flags.

## What L2 Pre-Execution Catches

The main MCP threat: **credentials going to a malicious server**.

- `npx evil-package` receiving `GITHUB_PERSONAL_ACCESS_TOKEN` → **BLOCKED** (unknown package + sensitive creds)
- `@modelcontextprotocol/server-github` calling `exfiltrate_data` → **BLOCKED** (suspicious tool name)
- GitHub token going to a Slack server → **BLOCKED** (credential-server mismatch)
- `@modelcontextprotocol/server-github` calling `search_repositories` with `GITHUB_PERSONAL_ACCESS_TOKEN` → **PASSED**

When AI is unavailable, a rule-based fallback runs:
- Official `@modelcontextprotocol/*` packages with matching credentials → pass
- Unknown packages with sensitive credentials → block
- Credential type mismatch (e.g., GitHub token to non-GitHub server) → block

## Admin Dashboard

Navigate to `/admin` and enter the admin password.

Shows:
- **L3 Executions**: Container status, exit codes, duration, stdout/stderr with linked ToolCall records
- **Security Events**: L3 container details (Docker security posture — `--read-only`, `--rm`, tmpfs mounts, memory/CPU/PID limits, injected credential env var names) + L2 pre-exec verifications
- **Audit Flags**: AI-detected anomalies and intent mismatches

The L3 container events show exactly what Docker flags were used, which credential env var names were injected (never values), and the container lifecycle — proving the isolation is real.

## Full MCP Flow

```
Agent calls tool → MCP Proxy
  → L1: Policy check (callGate)
    → DENY → blocked, no execution
    → PENDING_APPROVAL → human reviews in /approvals
    → ALLOW/APPROVED →
      → Credentials resolved from vault
      → L2 PRE-EXEC: AI verifies server+tool+creds combination
        → UNSAFE → BLOCKED, credentials never exposed
        → SAFE →
          → L3: Ephemeral container (--read-only, --rm, resource limits)
            → Credentials injected via env-file (never as CLI args)
            → MCP server starts, tool called, result captured
            → Container destroyed
          → Execution recorded (visible in /activity and /admin)
          → Result returned to agent
```

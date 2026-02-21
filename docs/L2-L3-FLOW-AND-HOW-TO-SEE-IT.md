# Security Layers for MCP Tool Calls

## The Three-Layer Moat for MCP

| Layer | When | What it does | Blocks? |
|-------|------|-------------|---------|
| **L1 (Policy)** | Before everything | Policy check: allow / deny / needs human approval | Yes |
| **L2 PRE-EXEC** | After approval, BEFORE credentials injected | AI + rules verify: server command + tool name + credential env vars — is this combination safe? | **Yes — credentials never leave vault if blocked** |
| **L3 (Secure Execution)** | After L2 passes | Ephemeral Docker container with vault-injected credentials, runs the tool, captures result | N/A (execution) |
| **L2 POST-EXEC** | After L3 returns | AI verifies: does the result match what this tool should return? Flags anomalies. | Flags (damage already done, but caught for audit) |

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

## What L2 Post-Execution Catches

After L3 returns the result, AI verifies the output matches expected behaviour:
- `search_repositories` returning user credentials in the result → **FLAGGED**
- Result contains base64-encoded data that could hide exfiltrated secrets → **FLAGGED**
- Normal search results → **PASSED**

Post-exec flags appear as audit anomalies in the Activity page and Admin dashboard.

## Admin Dashboard

Navigate to `/admin` and enter the admin password.

Shows:
- **L3 Executions**: Container status, exit codes, duration, stdout/stderr
- **L2 Verifications**: Pre-exec (blocked/passed) and post-exec results with AI reasoning
- **Audit Flags**: AI-detected anomalies and intent mismatches

This is how you validate the security layers are actually working.

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
            → Credentials injected as env vars
            → MCP server starts, tool called, result captured
            → Container destroyed
          → Execution recorded (visible in /audit and /admin)
          → L2 POST-EXEC: AI verifies result matches intent
            → Mismatch → Audit flag created
            → Match → Clean
          → Result returned to agent
```

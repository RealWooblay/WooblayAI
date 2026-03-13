# Wooblay — Enterprise Quickstart

Get your team's AI agents governed by Wooblay in under 10 minutes.

---

## Prerequisites

- A Wooblay account with an organization created ([app.wooblay.com](https://app.wooblay.com))
- An API key (generated from the dashboard under **Settings → API Keys**)
- Node.js 18+ installed on developer machines

---

## Step 1: Create an API Key

1. Log in to [app.wooblay.com](https://app.wooblay.com)
2. Navigate to **Settings → API Keys**
3. Click **Create API Key**
4. Give it a name (e.g., "Engineering Team")
5. Copy the key — it starts with `wbl_ak_` and is shown only once

---

## Step 2: Deploy a Gateway Instance

1. Navigate to **Gateway** in the sidebar
2. Click **Deploy Instance**
3. Configure the instance:
   - **Name** — e.g., "Production Gateway"
   - **MCP Servers** — add any tool servers your agents need (Stripe, GitHub, Slack, etc.)
4. Click **Deploy**
5. Copy the **Instance ID** from the instance detail page

---

## Step 3: Configure Agents (One Command)

On each developer's machine, run:

```bash
npx @wooblaymcp/cli setup \
  --api-key wbl_ak_YOUR_KEY \
  --instance-id YOUR_INSTANCE_ID \
  --endpoint https://gate.wooblay.com
```

This command:
- Detects installed agents (Cursor, Claude Desktop, VS Code)
- Writes MCP configuration to each agent's config file
- Points all agents at your Wooblay gateway
- Verifies connectivity

After running, every agent on that machine routes tool calls through Wooblay.

### Manual Configuration (Alternative)

If you prefer to configure agents manually, add this to each agent's MCP configuration:

**Cursor** (`~/.cursor/mcp.json`):
```json
{
  "mcpServers": {
    "wooblay": {
      "url": "https://gate.wooblay.com/mcp/YOUR_INSTANCE_ID/sse",
      "headers": {
        "Authorization": "Bearer wbl_ak_YOUR_KEY"
      }
    }
  }
}
```

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):
```json
{
  "mcpServers": {
    "wooblay": {
      "url": "https://gate.wooblay.com/mcp/YOUR_INSTANCE_ID/sse",
      "transport": "sse",
      "headers": {
        "Authorization": "Bearer wbl_ak_YOUR_KEY"
      }
    }
  }
}
```

---

## Step 4: Configure Policies

Wooblay ships with sensible defaults:
- **READ** actions (file reads, list operations) — auto-allowed
- **WRITE** actions (file writes, API calls) — require human approval
- **DESTRUCTIVE** actions (deletions, force pushes) — require human approval

To customize:

1. Navigate to **Policies** in the sidebar
2. Use a **preset** (Balanced, Strict, or Permissive) as a starting point
3. Add custom rules:
   - **Tool pattern** — glob match (e.g., `github_*`, `stripe_charge*`)
   - **Risk tier** — READ, WRITE, or DESTRUCTIVE
   - **Category** — code, git, files, network, data, infra, destructive, etc.
   - **Decision** — ALLOW, DENY, or APPROVE (human review)
   - **Args pattern** — match specific arguments (e.g., `"branch": "main"` → require approval)
4. Rules are priority-ordered — first match wins. Drag to reorder.

### AI Policy Optimization

Click **AI Optimize** to let Wooblay analyze your approval history and suggest policy changes. Frequently approved actions get "always allow" suggestions. Frequently denied patterns get "auto-deny" suggestions.

---

## Step 5: Set Up Approval Notifications

So your team gets notified when agents need approval:

1. Navigate to **Notifications** in the sidebar
2. Each team member configures their channels:
   - **Telegram** (recommended) — connect a Telegram bot for instant push notifications with one-tap approve/deny
   - **Slack** — add an incoming webhook URL for approval notifications with interactive buttons
   - **WhatsApp** — connect via WhatsApp Business for approval action links
   - **Email** — approval notifications sent to the user's registered email
3. Select which channels to enable and save

Approvals are routed based on org role. If a policy requires CTO approval, only users with the `cto` role (or `admin`/`owner`) receive the notification.

---

## Step 6: Add Credentials (Optional)

If your agents need to interact with external services through Wooblay's credential isolation:

1. Navigate to **Connections** in the sidebar
2. Click **Add Connection** and select a provider (GitHub, Stripe, AWS, etc.)
3. Add secrets:
   - **Exec-only secrets** — injected only during secure execution; agents cannot access them directly
   - **Scope boundaries** — define which operations are allowed per connection

Credentials are encrypted with AES-256-GCM envelope encryption and never leave the Wooblay vault except during ephemeral execution.

---

## Step 7: Verify

1. Open any configured agent (Cursor, Claude, etc.)
2. Ask the agent to perform an action — e.g., "list my GitHub repos"
3. Check the **Activity** page in the Wooblay dashboard
4. You should see the tool call logged with risk tier, policy decision, and a receipt

For a write action (e.g., "create a file on my desktop"), the action should appear in the **Approvals** queue. Approve it from the dashboard or from your notification channel.

---

## Team Rollout Checklist

- [ ] Create Wooblay organization and invite team members
- [ ] Generate API keys (one per team or one per developer, depending on attribution needs)
- [ ] Deploy gateway instance with required MCP servers
- [ ] Run `npx @wooblaymcp/cli setup` on each developer machine
- [ ] Configure policies (start with Balanced preset, customize from there)
- [ ] Set up notification channels for approvers
- [ ] Add credentials for external service connections
- [ ] Test with a sample action to verify the full pipeline
- [ ] Share the dashboard URL with the team

---

## Architecture at a Glance

```
Developer's Machine              Wooblay Cloud                   External Services
┌─────────────────┐              ┌─────────────────┐             ┌──────────────┐
│  Cursor / Claude │──(SSE)────►│  MCP Proxy       │             │  GitHub      │
│  (MCP client)    │             │       │          │             │  Stripe      │
└─────────────────┘              │  Policy Engine   │──(L3)────►│  Slack       │
                                 │  Approval Queue  │             │  AWS / GCP   │
                                 │  Credential Vault│             │  Databases   │
                                 │  Receipt Chain   │             │  Any MCP     │
                                 └─────────────────┘             └──────────────┘
```

All tool calls from all agents flow through Wooblay. One policy governs everything. One audit trail records everything. One approval queue manages everything.

---

## FAQ

**Q: Do I need to change my agent code?**
No. Wooblay uses MCP — the standard protocol that Cursor, Claude, and other agents already speak. You add a URL to the agent's config. No code changes.

**Q: What happens if Wooblay is down?**
Agent tool calls that route through Wooblay will fail (fail-closed). Agents cannot bypass Wooblay to access tools directly. This is by design — if the firewall is down, actions should not proceed unsupervised.

**Q: Can agents approve their own actions?**
No. The approval API is not exposed to agents. Approvals can only happen through the authenticated dashboard or cryptographically signed notification links scoped to specific human approvers.

**Q: What happens to pending approvals if no one responds?**
Each approval has a TTL (time-to-live). If no approver acts within the TTL, the action is automatically denied and the agent receives a timeout response.

**Q: Can I use Wooblay with agents I don't host?**
Yes. Any MCP-speaking agent (local or remote) can connect to Wooblay's SSE endpoint. You don't need to host agents through Wooblay to use the governance proxy.

**Q: How do I audit what happened?**
Navigate to **Activity** in the dashboard. Every action is logged with full context, risk tier, policy decision, approval details, and a cryptographic receipt. Export to JSON or CSV for compliance reporting. Use `GET /api/audit/chain-integrity` to verify the entire receipt chain.

---

## Support

- **Email:** support@wooblay.com
- **Documentation:** [docs/](../docs/)
- **Security issues:** security@wooblay.com

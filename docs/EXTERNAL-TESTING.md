# Wooblay — External testing

Use this doc to test the app end-to-end or hand to testers. Includes step-by-step instructions for **Cursor**, **Claude Desktop**, and **HTTP API** integration.

**Platform modes:** **Firewall** (default): Gateway, Credentials, Sensors, Policies, Approvals, Audit — no hosted agents, no Operations/Insights. **Full Platform**: adds Dashboard (agents), Operations, Insights. Unlock via **Settings > Platform Mode** with the password from Wooblay.

---

## Quick start — external integrations

Before testing Cursor or Claude Desktop you need:

1. **API key** — Gateway page → create a key, copy it (shown once). You need this for all integrations.
2. **MCP proxy** — Gateway page → "Your Firewall" → deploy a proxy (name + Deploy). Wait until status is `running`.
3. **SSE endpoint** — After proxy is running, copy the endpoint shown (e.g. `https://wooblay.com/mcp/<instance-id>/sse`).
4. **MCP servers** — In "MCP Tools" add at least one MCP server (e.g. GitHub, Filesystem). You can attach vault credentials when adding — click the catalog item and a credential picker appears. You can also add/change credentials later via the "credentials" link on each configured server.

---

## Cursor integration

1. Open Cursor.
2. Open **Settings** (gear or `Cmd/Ctrl + ,`) → **Cursor Settings** → **Features** → **MCP** (or search "MCP").
3. Edit the MCP config file (e.g. `~/.cursor/mcp.json` or the path Cursor shows).
4. Add Wooblay as an MCP server:

```json
{
  "mcpServers": {
    "wooblay": {
      "url": "YOUR_SSE_ENDPOINT",
      "transport": "sse",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}
```

Replace `YOUR_SSE_ENDPOINT` with your Gateway SSE URL (e.g. `https://wooblay.com/mcp/<instance-id>/sse`) and `YOUR_API_KEY` with the API key you created on the Gateway page.

**Auth is required.** Both Cursor and Claude Desktop need the `Authorization: Bearer` header. Without it you'll get 401.

5. Restart Cursor or reload MCP servers (if there is an option).
6. In a chat, ask the model to list tools or use a tool that you added (e.g. GitHub). Requests go through Wooblay; check **Gateway** page usage (calls, blocked, pending) and **Audit** for the activity log.

**Checklist:**

- [ ] API key created and copied.
- [ ] Proxy deployed and status `running`.
- [ ] SSE endpoint copied from Gateway page.
- [ ] `mcp.json` updated with Wooblay URL and `headers.Authorization`.
- [ ] Cursor restarted / MCP reloaded.
- [ ] Model can list or call Wooblay tools; Activity/Audit shows the call.

---

## Claude Desktop integration

1. Get your **API key** and **SSE endpoint** from the Wooblay Gateway page (see Quick start).
2. Open Claude Desktop config:
   - **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
   - **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
3. Add the Wooblay MCP server (identical config to Cursor):

```json
{
  "mcpServers": {
    "wooblay": {
      "url": "YOUR_SSE_ENDPOINT",
      "transport": "sse",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}
```

Replace `YOUR_SSE_ENDPOINT` (e.g. `https://wooblay.com/mcp/<instance-id>/sse`) and `YOUR_API_KEY` with your values.

4. Restart Claude Desktop.
5. Start a new conversation; Claude should have access to the tools exposed by your Wooblay proxy. Trigger a tool call and verify in Wooblay **Gateway** (usage) and **Audit**.

**Checklist:**

- [ ] Config file updated with Wooblay `url`, `transport`, and `headers.Authorization`.
- [ ] Claude Desktop restarted.
- [ ] Tool call appears in Wooblay Audit.

---

## HTTP API (gateway execute)

Use this to test the gateway without an MCP client.

1. Create an **API key** on the Gateway page and copy it.
2. Call the execute endpoint:

```bash
curl -X POST https://YOUR_DOMAIN/api/gateway/execute \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "exec:run",
    "toolName": "github__create_issue",
    "args": { "title": "Test", "repo": "org/repo" },
    "connectionIds": []
  }'
```

Replace `YOUR_DOMAIN` (e.g. `wooblay.com`) and `YOUR_API_KEY`. Adjust `toolName`, `args`, and `connectionIds` to match your setup.

3. Expect either a successful result or a clear error (e.g. 403 policy, 404 tool, missing connection). A valid key should not return 401.

**Checklist:**

- [ ] Request returns 2xx or a clear 4xx/5xx (not 401 with valid key).
- [ ] If allowed, receipt appears in Audit.

---

## 1. Auth & onboarding

- [ ] Sign up (email or OAuth)
- [ ] Sign out and sign back in
- [ ] Session persists after refresh
- [ ] If onboarding is enabled: complete coupon/activation to reach the app

---

## 2. Sidebar & navigation

- [ ] **Firewall mode:** CONNECT (Gateway, Credentials, Sensors), SECURE (Approvals, Policies), MONITOR (Notifications, Audit). No AGENTS or PLATFORM.
- [ ] **Full Platform mode:** Dashboard (AGENTS), then CONNECT, SECURE, MONITOR, PLATFORM (Operations, Insights).
- [ ] Organization switcher (Clerk) works if you have multiple orgs.
- [ ] Tutorial and Settings at bottom work.
- [ ] Unknown URL redirects appropriately (e.g. dashboard or 404).

---

## 3. Gateway (firewall setup)

- [ ] Go to **CONNECT > Gateway** (`/setup`).
- [ ] **API Keys:** Create key (name + optional expiry) → key shown once → copy it. Key appears in list with prefix; Revoke works.
- [ ] **Your Firewall:** If no proxy, deploy one (name + Deploy). If proxy exists: status badge, SSE endpoint with copy, usage (calls, blocked, pending). Delete proxy: click delete → confirm/cancel.
- [ ] **Connection tabs:** Claude Desktop / Cursor / HTTP / cURL snippets match your endpoint and key placeholder.
- [ ] **MCP Tools:** Add from catalog (e.g. GitHub, Filesystem) or custom server (name, transport, source, optional vault credentials). Configured list shows toggles and remove. Section only visible when a proxy exists.
- [ ] **How It Works:** L1/L2/L3 summary visible. No Full Platform unlock on this page (use Settings).

---

## 4. Credentials & Sensors

- [ ] **Credentials** (`/credentials`): List connections; add (provider/name/credential). Active/Inactive. Custom provider supported.
- [ ] **Sensors** (`/sensors`): Only visible in Full Platform mode. Webhook URL and secret per connection; sensor config; event rules (free-form). Manual or webhook-triggered operations (Full Platform).

---

## 5. Dashboard — Agents (Full Platform only)

- [ ] Home (`/`) shows instances or empty state.
- [ ] Deploy: choose **Proxy** or **Agent**. Proxy: name only. Agent: name, model, API key, channels.
- [ ] Instance cards show type (Agent/Proxy), status, tool count or model.
- [ ] Start / Stop / Restart work; status updates (may take a short time after restart).
- [ ] Config and Logs (for agents). Click instance → detail.

---

## 6. Instance detail

- [ ] **Overview:** Status, endpoint (proxy), or mission/action (agent). Tabs: Overview, Profile (agents), Security (Access), Workspace (agents).
- [ ] **Security (Access):** MCP servers, credentials (e.g. GitHub, AWS, GCP, custom). Add/edit/remove tools and credential links.
- [ ] **Profile / Workspace:** As applicable for agents only.

---

## 7. Activity / Audit

- [ ] Audit shows tool calls and receipts.
- [ ] Filters (date, risk, status). Expand row for details.
- [ ] Export if available.

---

## 8. Policies

- [ ] Global rules; no agent dropdown in firewall mode.
- [ ] Add/edit/disable/delete rules. Presets and suggestions if enabled.
- [ ] AI Security Supervisor / suggestions if configured.

---

## 9. Approvals

- [ ] Pending actions list. Approve / Deny; activity updates.

---

## 10. Settings

- [ ] Profile, Account, Appearance (theme persists).
- [ ] **Platform Mode:** Firewall vs Full Platform; unlock with password when gated.
- [ ] Sign out works.

---

## 11. Edge cases

- [ ] Stopped agent: workspace/profile show clear message.
- [ ] Invalid API key or bad config → clear error (no silent fail).
- [ ] 404 / missing instance → handled.
- [ ] Simulation/gateway failure → execution blocked (e.g. DENY or 503), not allowed through.

---

## Quick handoff

1. Share app URL (e.g. `https://wooblay.com`) and this doc.
2. **External testing:** Create API key + deploy proxy on Gateway → copy SSE endpoint → configure Cursor or Claude Desktop (or call HTTP API). Verify in Gateway usage and Audit.
3. **Firewall:** Gateway, Credentials, Policies, Approvals, Audit.
4. **Full Platform:** Add Dashboard (deploy proxy/agent), instance detail, Operations, Approvals.
5. Note anything broken, unclear, or slow — and which section.

---

*Last updated: Feb 2026*

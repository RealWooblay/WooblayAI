# Wooblay MCP

Cursor plugin for using the **Wooblay MCP proxy** from Cursor. Every MCP tool call goes through Wooblay’s Gate: policy checks, human approval when needed, and secure execution. Credentials stay in Wooblay; the agent never sees them.

## What this plugin does

- **Rule** — Keeps the agent aware of the Wooblay approval flow: when a tool returns `PENDING_APPROVAL`, use `wooblay__check_approval` and `wooblay__list_pending` instead of blocking.
- **Skill** — Walks you through configuring Cursor’s MCP to point at your Wooblay Gate (URL, instance ID, API key).

## Prerequisites

- A Wooblay deployment with the Gate and MCP proxy running.
- An **instance** and its **instance ID** (from the Wooblay UI: Instance detail page or Setup).
- An **API key** (`wbl_ak_...`) for the org that owns the instance (Dashboard → API keys).

---

## Quick start (local)

1. **Start Wooblay** (Gate + proxy + at least one instance). Get your **instance ID** from the Wooblay UI and an **API key** from Dashboard → API keys.

2. **Generate MCP config** and write it into the Wooblay repo so Cursor picks it up:

   ```bash
   cd wooblay-mcp-plugin
   WOOBLAY_GATE_URL=http://localhost:4800 \
   WOOBLAY_INSTANCE_ID=YOUR_INSTANCE_ID \
   WOOBLAY_API_KEY=wbl_ak_YOUR_KEY \
   node scripts/generate-mcp-config.mjs --write
   ```

   This creates `.cursor/mcp.json` in the Wooblay repo root. Cursor reads project MCP config from `.cursor/mcp.json`.

3. **Restart Cursor** (or reload MCP). Open the Wooblay repo. You should see the Wooblay MCP server and all tools (e.g. `github__search_repositories`, `wooblay__check_approval`, `wooblay__list_pending`).

4. **Test**: Ask the agent to use a tool (e.g. "Search GitHub for wooblay"). If approval is required, approve in the Wooblay dashboard and have the agent call `wooblay__check_approval` to get the result.

---

## Connect Cursor to Wooblay (manual)

1. Open Cursor **Settings** → **MCP** (or your Cursor MCP config file).
2. Add an MCP server with **SSE** transport:

   - **URL:** `http://<GATE>/mcp/<INSTANCE_ID>/sse` — local: `http://localhost:4800/mcp/<ID>/sse`; prod: `https://wooblay.com/mcp/<ID>/sse`
   - **Headers:** `Authorization: Bearer <your-api-key>` (org API key, starts with `wbl_ak_`).

3. Save and **restart Cursor** (or reload MCP). Cursor will discover all tools from the proxy.

**Config locations:** Project `.cursor/mcp.json` or global `~/.cursor/mcp.json`. Template: `mcp.example.json` — replace `YOUR_INSTANCE_ID` and `YOUR_API_KEY`, then copy into your Cursor MCP config. For step-by-step help, use the **configure-wooblay-mcp** skill in Cursor.

## Approval flow

When a tool call requires human approval, the proxy returns immediately with a **pending** message instead of blocking. The agent can:

- Continue other work.
- Call **`wooblay__check_approval({ "approvalId": "<id>" })`** to poll for the result once a reviewer approves.
- Call **`wooblay__list_pending()`** to see all pending approvals in the session.

The plugin’s rule reminds the agent to use these tools when it sees a `PENDING_APPROVAL` response.

## Testing the connection

### Sanity-check MCP from the repo root (recommended first)

From the **Wooblay repo root** (not `wooblay-mcp-plugin`), run the action test. Prod uses the main app URL as the Gate base (e.g. `https://wooblay.com`), not a separate gate subdomain:

```bash
node scripts/test-mcp-action.mjs https://wooblay.com <INSTANCE_ID> '<API_KEY>' github__search_repositories '{"query":"wooblay"}'
```

You should see tools listed, then a tool result (or a pending approval + poll). If that works, the same URL and key will work in Cursor.

### Test the Cursor plugin

1. **MCP config** — Project `.cursor/mcp.json` must point at your **Gate base URL** + `/mcp/<INSTANCE_ID>/sse`. For prod that’s `https://wooblay.com/mcp/<ID>/sse` (not `gate.wooblay.com`). Header: `Authorization: Bearer <API_KEY>`.

2. **Restart Cursor** (or reload MCP). Open the Wooblay repo so Cursor uses this project’s `.cursor/mcp.json`.

3. **Verify** — **Settings → Tools & MCP**: Wooblay server should be connected and list tools (e.g. `github__search_repositories`, `wooblay__check_approval`).

4. **E2E** — In chat, ask the agent to use a Wooblay tool (e.g. “Search GitHub for wooblay”). You should get a real result or the approval flow; approve in the dashboard if needed.

(Local: use `http://localhost:4800` as base and `node scripts/test-mcp-action.mjs http://localhost:4800 ...` to sanity-check.)

## Components

| Type  | Name                   | Description |
|-------|------------------------|-------------|
| Rule  | `wooblay-approval-flow` | Use `wooblay__check_approval` and `wooblay__list_pending` when tools are pending approval. |
| Skill | `configure-wooblay-mcp` | Configure Cursor MCP to use your Wooblay Gate URL, instance ID, and API key. |

## Publishing to the Cursor Marketplace

There is **no public API** to create or publish a plugin. You apply as a publisher at [cursor.com/marketplace/publish](https://cursor.com/marketplace/publish), then submit your repo to the Cursor team (Slack or email). See **[PUBLISHING.md](./PUBLISHING.md)** for the full flow and checklist. Run `node scripts/validate-plugin.mjs` before submission.

## License

MIT

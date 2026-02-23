---
name: configure-wooblay-mcp
description: Configure Cursor to use the Wooblay MCP proxy (Gate URL, instance ID, API key, and MCP server entry). Use when the user wants to connect Cursor to Wooblay or fix MCP connection issues.
---

# Configure Wooblay MCP in Cursor

## Trigger

The user wants to connect Cursor to Wooblay’s MCP proxy, or needs to fix or update an existing Wooblay MCP connection.

## Required inputs

Gather (or ask the user for):

- **Gate base URL** — The public URL of the Wooblay Gate (e.g. `https://gate.wooblay.io` or `https://gate.example.com`). No trailing slash.
- **Instance ID** — The instance’s ID (e.g. a CUID like `clxyz123...`), from the Wooblay dashboard (instance detail or agent/connection setup).
- **API key** — An org API key that starts with `wbl_ak_`. Created in the Wooblay dashboard (e.g. API keys or Connections). This is sent as a Bearer token.

## Workflow

1. **Build the SSE URL**
   - `{GATE_BASE_URL}/mcp/{INSTANCE_ID}/sse`
   - Example: `https://gate.wooblay.io/mcp/clxyz123abc/sse`

2. **Tell the user how to add the MCP server in Cursor**
   - Open **Cursor Settings** → **MCP** (or edit the MCP config file Cursor uses).
   - Add a new MCP server with **SSE** transport.
   - Set:
     - **URL:** the SSE URL from step 1.
     - **Headers:** `Authorization: Bearer <their-api-key>` (replace with their actual `wbl_ak_...` key).
   - Save. They may need to restart Cursor or reload MCP for the server to appear.

3. **Optional: env or placeholders**
   - If the user prefers not to paste the API key in the UI, mention that some setups allow environment variables in MCP config; they should use a variable that expands to their `wbl_ak_...` key and reference it in the Authorization header.

4. **Verify**
   - After reconnecting, Cursor should list the Wooblay proxy’s tools (all upstream tools plus `wooblay__check_approval` and `wooblay__list_pending`). If the list is empty or connection fails, check Gate URL, instance ID, API key, and that the instance’s MCP proxy is running.

## Output

- The exact SSE URL for their Gate + instance.
- Clear steps to add the server in Cursor with the Authorization header.
- A short reminder to use `wooblay__check_approval` when a tool returns pending approval.

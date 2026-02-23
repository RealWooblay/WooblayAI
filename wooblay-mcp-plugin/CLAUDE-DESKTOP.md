# Using Wooblay with Claude Desktop

Claude Desktop only supports **stdio** MCP (it launches a process and talks to it over stdin/stdout). It does **not** support a remote `url` in the config — adding one can make Claude fail to launch.

Use the **bridge script** so Claude spawns a local process that connects to your Wooblay SSE URL. Wooblay then works exactly as in Cursor.

## 1. Get the bridge path

From your machine, the script is:

```
/Users/jackcoleman/Developer/Wooblay/wooblay-mcp-plugin/scripts/claude-desktop-bridge.mjs
```

(If you cloned Wooblay elsewhere, use that path plus `/wooblay-mcp-plugin/scripts/claude-desktop-bridge.mjs`.)

You need **Node.js** (v18+) installed so `node` runs.

## 2. Edit Claude Desktop config

**Config file:**

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`

Use **only** `command` and `args` — no `url` or `transport`:

```json
{
  "mcpServers": {
    "wooblay": {
      "command": "node",
      "args": [
        "/Users/jackcoleman/Developer/Wooblay/wooblay-mcp-plugin/scripts/claude-desktop-bridge.mjs",
        "https://wooblay.com/mcp/YOUR_INSTANCE_ID/sse",
        "YOUR_API_KEY"
      ]
    }
  }
}
```

Replace:

- `YOUR_INSTANCE_ID` — your Wooblay instance ID (e.g. from the instance URL or Setup).
- `YOUR_API_KEY` — your org API key (`wbl_ak_...`).

If your Wooblay repo is in a different folder, replace the first item in `args` with the full path to `claude-desktop-bridge.mjs`.

## 3. Restart Claude Desktop

Quit fully (Cmd+Q) and open again. Claude should launch and list Wooblay tools. Tool calls go through Wooblay (approvals, audit) as in Cursor.

## Troubleshooting

- **Claude won’t launch:** Remove the `wooblay` entry so `mcpServers` is `{}`, confirm Claude starts, then add the entry back with the exact paths and no typos.
- **No tools / errors:** Run the bridge by hand to see errors:
  ```bash
  node /Users/jackcoleman/Developer/Wooblay/wooblay-mcp-plugin/scripts/claude-desktop-bridge.mjs https://wooblay.com/mcp/YOUR_INSTANCE_ID/sse YOUR_API_KEY
  ```
  It will wait for stdin; Ctrl+C to exit. Check that the URL and key are correct (same as in Cursor).

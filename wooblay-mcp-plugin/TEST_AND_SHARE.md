# Test the plugin, then share it

## Test (with your setup)

1. **Instance ID**  
   Your `.cursor/mcp.json` already has your Gate URL and API key. Replace `REPLACE_WITH_YOUR_INSTANCE_ID` in that file with your real **instance ID** from the Wooblay UI (instance detail page or Setup).  
   (If you prefer to regenerate the file: run `WOOBLAY_GATE_URL=http://localhost:4800 WOOBLAY_INSTANCE_ID=YOUR_ID WOOBLAY_API_KEY=wbl_ak_... node scripts/generate-mcp-config.mjs --write`.)

2. **Start Wooblay**  
   Start the Gate and at least one instance (so the MCP proxy is running).

3. **Optional: script test**  
   ```bash
   cd wooblay-mcp-plugin
   WOOBLAY_GATE_URL=http://localhost:4800 WOOBLAY_INSTANCE_ID=YOUR_ID WOOBLAY_API_KEY=wbl_ak_... node scripts/test-mcp-connection.mjs
   ```  
   You want to see `200` (or `502` if the proxy isn’t up yet).

4. **Test in Cursor**  
   Restart Cursor (or reload MCP), open the Wooblay repo, then check **Settings → Tools & MCP**. The Wooblay server should be connected and list tools. Ask the agent to use a tool (e.g. “Search GitHub for wooblay”) to confirm E2E.

---

## How to share the plugin

There is **no public “create plugin” API**. To get the plugin in front of other users:

1. **Apply as a publisher**  
   Sign in at **[cursor.com/marketplace/publish](https://cursor.com/marketplace/publish)** and submit a plugin publisher application.

2. **Prepare the plugin**  
   - Run `node scripts/validate-plugin.mjs`.  
   - Optionally add a logo (`assets/logo.svg` and `"logo": "assets/logo.svg"` in `plugin.json`).

3. **Submit the repo**  
   Send the **repository link** to the Cursor team:
   - Cursor community **Slack**, or  
   - **Email:** `kniparko@anysphere.com`

   They review and, if approved, list it on the [Cursor Marketplace](https://cursor.com/marketplace). Users can then install “Wooblay MCP” and configure their own Gate URL, instance ID, and API key (via the skill or the generate script).

For more detail (single vs multi-plugin repo, checklist), see **[PUBLISHING.md](./PUBLISHING.md)**.

# Publishing to the Cursor Marketplace

There is **no public "create-plugin" API**. Cursor uses a human submission flow.

## How it works

1. **Apply as a publisher**  
   Sign in at **[cursor.com/marketplace/publish](https://cursor.com/marketplace/publish)** and submit a plugin publisher application. You need to be signed in to apply.

2. **Prepare the plugin**  
   - Plugin structure: `.cursor-plugin/plugin.json`, `rules/`, `skills/`, `mcp.example.json`, `README.md`.  
   - Optional: `assets/logo.svg` (or similar) and reference it in `plugin.json` as `"logo": "assets/logo.svg"`.  
   - Cursor’s docs: [cursor.com/docs/plugins](https://cursor.com/docs/plugins), [Building Plugins](https://cursor.com/docs/plugins/building).  
   - Official template (optional): [github.com/cursor/plugin-template](https://github.com/cursor/plugin-template). You can run their `node scripts/validate-template.mjs` if you align with that repo layout.

3. **Submit the plugin**  
   Once the plugin is ready and your publisher application is in progress (or approved), submit your **repository** to the Cursor team:
   - **Slack** (Cursor community), or  
   - **Email:** `kniparko@anysphere.com`  

   They will review and list the plugin on the [Cursor Marketplace](https://cursor.com/marketplace) if it meets their criteria.

## Single-plugin repo

For a **single plugin**, Cursor’s template suggests: plugin contents at **repo root**, one `.cursor-plugin/plugin.json`, no `.cursor-plugin/marketplace.json`.  

This plugin currently lives in the `wooblay-mcp-plugin/` folder inside the Wooblay monorepo. For marketplace submission you can either:

- **Option A:** Publish `wooblay-mcp-plugin` as its **own repo** (copy this folder to a new repo, put contents at root, then submit that repo), or  
- **Option B:** Submit the Wooblay repo and point Cursor to the `wooblay-mcp-plugin` subfolder, if they accept monorepo plugins.

## After listing

Users will:

1. Open the [Cursor Marketplace](https://cursor.com/marketplace), find **Wooblay MCP**, and install it.  
2. Get the **rule** (approval flow) and **skill** (configure Wooblay MCP) from the plugin.  
3. Configure their **own** Wooblay Gate URL, instance ID, and API key (via the skill, `mcp.example.json`, or `scripts/generate-mcp-config.mjs`). Credentials are never shipped with the plugin.

## Checklist before submission

- [ ] Valid `.cursor-plugin/plugin.json` (name, displayName, description, author, license, keywords).
- [ ] `rules/` and `skills/` present and referenced in `plugin.json`.
- [ ] `README.md` with setup and usage.
- [ ] `mcp.example.json` for MCP config template.
- [ ] Optional: logo at `assets/logo.svg` and `"logo": "assets/logo.svg"` in `plugin.json`.
- [ ] Run any validation you use (e.g. Cursor template’s `validate-template.mjs` if you adopt that layout).

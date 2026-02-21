/**
 * @wooblay/openclaw-adapter
 *
 * OpenClaw integration for Wooblay enterprise agent supervision.
 *
 * Enforcement — every tool call goes through Wooblay Gate:
 *
 * 1. **Plugin tool overrides**: Registers gated versions of common tools (exec,
 *    write, edit, web_fetch) that call Gate for policy evaluation before executing.
 *    Also provides structured_action for credentialed external operations.
 *
 * 2. **Hook handler (universal)**: Fires on every tool:start event — from any
 *    source (built-in, plugin, MCP server). Submits to Gate for policy evaluation.
 *    If Gate says DENY, throws to abort execution. No skip lists, no exceptions.
 *
 * The agent has full capabilities — no restrictions on what tools or actions
 * are available. Gate is the only decision maker, based on user-configured
 * policy rules and AI risk classification.
 *
 * The agent process runs as non-root (uid 1000) and cannot modify the plugin,
 * hook, or config files. Policy enforcement is tamper-resistant.
 */

export { PluginGateClient } from './gate-client.js';
export type { WooblayPluginConfig } from './config.js';
export { resolveConfig } from './config.js';

// Re-export the hook handler for OpenClaw's hook discovery system
export { default as hookHandler } from './hooks/handler.js';

/**
 * @wooblay/openclaw-adapter
 *
 * OpenClaw integration for Wooblay enterprise agent supervision.
 *
 * Integration strategy (aligned with OpenClaw's actual API):
 *
 * 1. **Exec Approvals Bridge**: OpenClaw has a native approval system
 *    (`exec-approvals.json`) that can block tool calls and require human approval.
 *    We pre-configure it to `ask: "always"` and route all approval decisions
 *    through Wooblay Gate. When OpenClaw broadcasts `exec.approval.requested`,
 *    our bridge intercepts it, sends it to Gate for policy evaluation, and resolves
 *    the approval via `exec.approval.resolve`.
 *
 * 2. **Tool Hook (audit)**: OpenClaw's Hook system (HOOK.md + handler.ts) fires
 *    `tool:start`, `tool:update`, `tool:result` events. These are fire-and-forget
 *    (non-blocking), perfect for audit logging, receipt generation, and the Wooblay
 *    timeline.
 *
 * 3. **Pre-configured exec-approvals.json**: Baked into the Docker image. Sets
 *    `security: "allowlist"` + `ask: "always"` + `askFallback: "deny"` so every
 *    risky tool call MUST go through the approval flow (and hence through Wooblay).
 *
 * This file exports both:
 *   - The Exec Approvals Bridge (runs as a background service)
 *   - The Hook handler (registered via OpenClaw's hook discovery system)
 */

export { ExecApprovalBridge } from './bridge/exec-approval-bridge.js';
export { PluginGateClient } from './gate-client.js';
export type { WooblayPluginConfig } from './config.js';
export { resolveConfig } from './config.js';

// Re-export the hook handler for OpenClaw's hook discovery system
// OpenClaw loads this from the HOOK.md -> handler.ts entry point
export { default as hookHandler } from './hooks/handler.js';

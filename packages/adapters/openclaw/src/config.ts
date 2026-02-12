/**
 * Plugin configuration types and defaults.
 * These mirror the configSchema in openclaw.plugin.json.
 */

export interface WooblayPluginConfig {
  /** URL of the Wooblay Gate server */
  gateUrl: string;
  /** Path to the directory containing signing key files */
  signingKeyPath?: string;
  /** Name of the key pair files (default: "wooblay-agent") */
  agentKeyName: string;
  /** Which tools to gate: "all", "risky", or "custom" */
  toolFilter: 'all' | 'risky' | 'custom';
  /** Custom list of tool names to gate (only when toolFilter is "custom") */
  customToolList: string[];
  /** Timeout in ms for approval waiting (default: 5 minutes) */
  approvalTimeoutMs: number;
  /** Poll interval in ms for approval status checks */
  approvalPollIntervalMs: number;
}

/** Default configuration values */
export const DEFAULT_CONFIG: WooblayPluginConfig = {
  gateUrl: 'http://localhost:4800',
  agentKeyName: 'wooblay-agent',
  toolFilter: 'risky',
  customToolList: [],
  approvalTimeoutMs: 300_000,
  approvalPollIntervalMs: 2_000,
};

/**
 * Tools considered "risky" by default — these are the ones that execute code,
 * write to disk, browse the web, or spawn sub-processes.
 */
export const RISKY_TOOLS = new Set([
  'exec',
  'process',
  'write',
  'edit',
  'apply_patch',
  'browser',
  'web_fetch',
  'web_search',
  'sessions_spawn',
  'sessions_send',
  'cron',
  'message',
  'gateway',
]);

/**
 * Tools that are always safe and never gated (read-only, no side effects).
 */
export const SAFE_TOOLS = new Set([
  'read',
  'image',
  'canvas',
]);

/**
 * Determine if a given tool should be gated based on the plugin config.
 */
export function shouldGateTool(toolName: string, config: WooblayPluginConfig): boolean {
  switch (config.toolFilter) {
    case 'all':
      // Gate everything except explicitly safe tools
      return !SAFE_TOOLS.has(toolName);
    case 'risky':
      return RISKY_TOOLS.has(toolName);
    case 'custom':
      return config.customToolList.includes(toolName);
    default:
      return RISKY_TOOLS.has(toolName);
  }
}

/**
 * Merge partial user config with defaults.
 */
export function resolveConfig(partial: Partial<WooblayPluginConfig>): WooblayPluginConfig {
  return {
    ...DEFAULT_CONFIG,
    ...partial,
    customToolList: partial.customToolList ?? DEFAULT_CONFIG.customToolList,
  };
}

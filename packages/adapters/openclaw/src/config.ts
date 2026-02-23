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
 * Merge partial user config with defaults.
 */
export function resolveConfig(partial: Partial<WooblayPluginConfig>): WooblayPluginConfig {
  return {
    ...DEFAULT_CONFIG,
    ...partial,
    customToolList: partial.customToolList ?? DEFAULT_CONFIG.customToolList,
  };
}

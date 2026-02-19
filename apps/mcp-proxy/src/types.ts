/** MCP server configuration loaded from Gate API or env. */
export interface McpServerConfigEntry {
  id: string;
  name: string;
  transport: 'stdio' | 'sse';
  source: string;
  args?: string[];
  /** Connection IDs — vault references. Gate resolves actual creds at L3 exec time. */
  connectionIds: string[];
  enabled: boolean;
}

/** A tool discovered from an upstream MCP server. */
export interface UpstreamTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

/** Gate policy decision for a tool call. */
export interface GateDecision {
  decision: 'EXECUTE' | 'DENY' | 'PENDING_APPROVAL';
  toolCallId?: string;
  approvalId?: string;
  reason?: string;
}

/** Request to the Gate's structured execution endpoint. */
export interface StructuredExecRequest {
  action: string;
  params: Record<string, unknown>;
}

/** Result from Gate's structured execution. */
export interface StructuredExecResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  error?: string;
}

/** Proxy configuration loaded at startup. */
export interface ProxyConfig {
  gateUrl: string;
  instanceId: string;
  servers: McpServerConfigEntry[];
}

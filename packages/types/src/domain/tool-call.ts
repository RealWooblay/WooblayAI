export enum RiskTier {
  READ = 'READ',
  WRITE = 'WRITE',
  DESTRUCTIVE = 'DESTRUCTIVE',
}

export interface ToolCall {
  id: string;
  taskId: string | null;
  sessionId: string | null;
  agentPubkey: string;
  toolName: string;
  args: string; // canonical JSON
  riskTier: RiskTier;
  /** Which adapter submitted this tool call (e.g. "openclaw-plugin", "mcp-toolhost") */
  adapter: string | null;
  createdAt: string;
}

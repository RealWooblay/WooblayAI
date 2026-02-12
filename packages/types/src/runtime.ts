/**
 * Agent runtime descriptor: used by provisioning and UI to show "which agent" is running.
 * Agent-agnostic: the Gate and Tool Host don't know or care about the specific agent brand.
 */
export interface AgentRuntimeDescriptor {
  id: string;            // e.g. "openclaw", "custom-mcp-host"
  name: string;          // e.g. "OpenClaw"
  version?: string;
  /** ECR image name (Runtime mode) or adapter name (local mode). */
  imageOrAdapter: string;
}

/** Built-in agent runtimes. Extensible by adding entries. */
export const AGENT_RUNTIMES: AgentRuntimeDescriptor[] = [
  {
    id: 'openclaw',
    name: 'OpenClaw',
    version: 'latest',
    imageOrAdapter: 'openclaw-wooblay',
  },
];

export function getRuntime(id: string): AgentRuntimeDescriptor | undefined {
  return AGENT_RUNTIMES.find((r) => r.id === id);
}

/**
 * Adapter descriptors: define how Wooblay integrates with different agent frameworks.
 * The Gate is agent-agnostic; adapters translate each framework's tool execution
 * lifecycle into Gate API calls.
 */

/** How the adapter connects to the agent runtime. */
export type AdapterType = 'plugin' | 'sidecar' | 'sdk';

/**
 * Describes an adapter that bridges an agent framework to Wooblay Gate.
 *
 * - plugin:  runs in-process with the agent (e.g. OpenClaw plugin using before_tool_call)
 * - sidecar: runs as a separate process alongside the agent (e.g. MCP Tool Host)
 * - sdk:     agent integrates directly via HTTP SDK calls to Gate
 */
export interface AdapterDescriptor {
  /** Unique adapter identifier, e.g. "openclaw-plugin", "mcp-toolhost" */
  id: string;
  /** Human-readable name, e.g. "OpenClaw Plugin" */
  name: string;
  /** How this adapter connects to its agent framework */
  type: AdapterType;
  /** Which agent runtime this adapter targets, e.g. "openclaw", "any-mcp", "generic" */
  agentRuntime: string;
  /** CLI command to install this adapter (used internally, not shown to customers) */
  installCommand?: string;
  /** Default config template for provisioning */
  configTemplate?: Record<string, unknown>;
  /** Short description of what this adapter does */
  description?: string;
}

/** Built-in adapter registry. Extensible by adding entries. */
export const ADAPTERS: AdapterDescriptor[] = [
  {
    id: 'openclaw-plugin',
    name: 'OpenClaw Plugin',
    type: 'plugin',
    agentRuntime: 'openclaw',
    installCommand: 'openclaw plugins install @wooblay/openclaw-adapter',
    description:
      'Native OpenClaw plugin that intercepts tool calls via before_tool_call/after_tool_call hooks. Pre-installed in managed Runtime instances.',
  },
  {
    id: 'mcp-toolhost',
    name: 'MCP Tool Host',
    type: 'sidecar',
    agentRuntime: 'any-mcp',
    description:
      'Standalone MCP server (stdio transport) that exposes wooblay_exec/wooblay_browser/wooblay_http tools. Works with any MCP-compatible agent.',
  },
  {
    id: 'http-sdk',
    name: 'HTTP SDK',
    type: 'sdk',
    agentRuntime: 'generic',
    description:
      'Direct REST API integration. Any agent can call POST /api/tool/execute on the Gate. Requires the agent to handle gating logic itself.',
  },
];

/** Look up an adapter by id. */
export function getAdapter(id: string): AdapterDescriptor | undefined {
  return ADAPTERS.find((a) => a.id === id);
}

/** Look up adapters by agent runtime. */
export function getAdaptersForRuntime(runtime: string): AdapterDescriptor[] {
  return ADAPTERS.filter((a) => a.agentRuntime === runtime || a.agentRuntime === 'generic');
}

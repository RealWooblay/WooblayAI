import { useState } from 'react';
import clsx from 'clsx';
import { Card } from '../../components/common/Card.tsx';
import { Badge } from '../../components/common/Badge.tsx';
import { Button } from '../../components/common/Button.tsx';
import {
  IconRocket,
  IconPlus,
  IconActivity,
  IconSettings,
  IconBot,
  IconLayers,
} from '../../components/icons.tsx';

interface RuntimeConfig {
  id: string;
  name: string;
  type: 'openclaw' | 'mcp' | 'custom';
  status: 'running' | 'stopped' | 'deploying';
  agents: number;
  adapter: string;
  environment: string;
  createdAt: string;
}

const MOCK_RUNTIMES: RuntimeConfig[] = [
  {
    id: 'rt-001',
    name: 'Production OpenClaw',
    type: 'openclaw',
    status: 'running',
    agents: 3,
    adapter: 'openclaw-plugin',
    environment: 'production',
    createdAt: '2026-02-01T00:00:00Z',
  },
  {
    id: 'rt-002',
    name: 'Staging MCP Toolhost',
    type: 'mcp',
    status: 'running',
    agents: 2,
    adapter: 'mcp-toolhost',
    environment: 'staging',
    createdAt: '2026-02-05T00:00:00Z',
  },
  {
    id: 'rt-003',
    name: 'Dev Sandbox',
    type: 'custom',
    status: 'stopped',
    agents: 0,
    adapter: 'http-sdk',
    environment: 'development',
    createdAt: '2026-02-08T00:00:00Z',
  },
];

const DEPLOYMENT_METHODS = [
  {
    id: 'managed',
    title: 'Deploy Managed Runtime',
    description: 'Launch an agent runtime managed by Wooblay. Includes automatic supervision, policy enforcement, and receipt generation.',
    icon: IconRocket,
    badge: 'Recommended',
    badgeVariant: 'cyan' as const,
  },
  {
    id: 'integrate',
    title: 'Integrate Your Runtime',
    description: 'Connect your existing agent infrastructure to Wooblay Gate via adapters. Choose from OpenClaw plugin, MCP sidecar, or HTTP SDK.',
    icon: IconLayers,
    badge: 'BYOA',
    badgeVariant: 'purple' as const,
  },
  {
    id: 'sdk',
    title: 'Use HTTP SDK',
    description: 'Directly integrate with the Gate REST API from any language. Full control over tool execution flow with cryptographic receipts.',
    icon: IconBot,
    badge: 'Flexible',
    badgeVariant: 'blue' as const,
  },
];

export function DeployPage() {
  const [selectedMethod, setSelectedMethod] = useState<string | null>(null);

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      {/* Active Runtimes */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-200">Active Runtimes</h3>
          <span className="text-[10px] text-gray-600">
            {MOCK_RUNTIMES.filter(r => r.status === 'running').length} running
          </span>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {MOCK_RUNTIMES.map(rt => (
            <Card key={rt.id} hover className="space-y-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <div className={clsx(
                    'flex h-8 w-8 items-center justify-center rounded-lg',
                    rt.status === 'running' ? 'bg-emerald-950/60 text-emerald-400' : 'bg-gray-800 text-gray-500',
                  )}>
                    <IconActivity size={16} />
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold text-gray-200">{rt.name}</h4>
                    <p className="text-[10px] text-gray-600">{rt.environment}</p>
                  </div>
                </div>
                <Badge
                  variant={rt.status === 'running' ? 'green' : rt.status === 'deploying' ? 'cyan' : 'gray'}
                >
                  {rt.status}
                </Badge>
              </div>

              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="rounded-md bg-[#06060b] border border-[#1e1e30] p-2">
                  <p className="text-sm font-bold text-gray-200">{rt.agents}</p>
                  <p className="text-[9px] text-gray-600">Agents</p>
                </div>
                <div className="rounded-md bg-[#06060b] border border-[#1e1e30] p-2">
                  <p className="text-xs font-bold text-gray-200 font-mono">{rt.type}</p>
                  <p className="text-[9px] text-gray-600">Type</p>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-2 border-t border-[#1e1e30]">
                <Button size="xs" variant="ghost" className="flex-1">
                  <IconSettings size={12} /> Configure
                </Button>
                {rt.status === 'running' ? (
                  <Button size="xs" variant="ghost" className="flex-1 text-rose-400">
                    Stop
                  </Button>
                ) : (
                  <Button size="xs" variant="ghost" className="flex-1 text-emerald-400">
                    Start
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      </div>

      {/* Deploy new */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-gray-200">Deploy New Agent</h3>
        <p className="text-xs text-gray-500">
          Choose a deployment method to get agents supervised by Wooblay Gate.
        </p>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {DEPLOYMENT_METHODS.map(method => {
            const MethodIcon = method.icon;
            const isSelected = selectedMethod === method.id;

            return (
              <Card
                key={method.id}
                hover
                onClick={() => setSelectedMethod(isSelected ? null : method.id)}
                className={clsx(
                  'space-y-3 cursor-pointer transition-all',
                  isSelected && 'ring-1 ring-cyan-500/30 glow-accent',
                )}
              >
                <div className="flex items-start justify-between">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#06060b] border border-[#1e1e30]">
                    <MethodIcon size={20} className={isSelected ? 'text-cyan-400' : 'text-gray-500'} />
                  </div>
                  <Badge variant={method.badgeVariant}>{method.badge}</Badge>
                </div>
                <h4 className="text-sm font-semibold text-gray-200">{method.title}</h4>
                <p className="text-[11px] text-gray-500 leading-relaxed">{method.description}</p>
                {isSelected && (
                  <Button size="sm" className="w-full">
                    <IconPlus size={14} /> Get Started
                  </Button>
                )}
              </Card>
            );
          })}
        </div>
      </div>

      {/* Integration guide preview */}
      <Card className="space-y-4">
        <h3 className="text-sm font-semibold text-gray-200">Quick Integration</h3>
        <p className="text-xs text-gray-500">
          Connect any agent to Wooblay Gate with a few lines of code.
        </p>

        <div className="rounded-lg bg-[#06060b] border border-[#1e1e30] overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2 border-b border-[#1e1e30] bg-[#08080e]">
            <span className="text-[10px] font-semibold text-gray-500">gate-client.ts</span>
          </div>
          <pre className="p-4 text-xs font-mono text-gray-400 overflow-x-auto">
{`import { GateClient } from '@wooblay/gate-client';

const gate = new GateClient({
  gateUrl: 'http://localhost:4800',
  agentPubkey: process.env.AGENT_PUBKEY,
});

// Every tool call goes through Gate
const result = await gate.execute({
  toolName: 'wooblay_exec',
  args: { command: 'npm test' },
  decisionTrail: {
    plan_summary: 'Run test suite',
    reason_summary: 'Verify changes before deploy',
    citations: [],
  },
});

// result.decision: 'EXECUTE' | 'DENY' | 'PENDING_APPROVAL'
// result.receiptId: cryptographic receipt hash`}
          </pre>
        </div>
      </Card>
    </div>
  );
}

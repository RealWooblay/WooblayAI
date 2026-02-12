import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAgents, updateAgent, fetchApi } from '../../api/client.ts';
import { useAgentInsights, useAgentLineage, useOverrideTrust } from '../../api/hooks/useAnalysis.ts';
import { AgentCharacter } from '../../components/trust/AgentCharacter.tsx';
import { TrustLadderGauge } from '../../components/trust/TrustLadderGauge.tsx';
import { AnalysisPanel } from '../../components/analysis/AnalysisPanel.tsx';
import { InsightChip } from '../../components/analysis/InsightChip.tsx';
import { Badge } from '../../components/common/Badge.tsx';
import { Button } from '../../components/common/Button.tsx';
import { Card } from '../../components/common/Card.tsx';
import type { TrustLevel, LineageNode, Analysis } from '@wooblay/types';
import clsx from 'clsx';

function TrustTrajectoryChart({ history }: { history: Array<{ date: string; score: number; level: string }> }) {
  if (history.length < 2) {
    return <p className="text-xs text-gray-500">Not enough data for trajectory chart.</p>;
  }

  const maxScore = 100;
  const width = 600;
  const height = 120;
  const padding = 20;

  const points = history.map((h, i) => ({
    x: padding + (i / (history.length - 1)) * (width - 2 * padding),
    y: height - padding - (h.score / maxScore) * (height - 2 * padding),
  }));

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" preserveAspectRatio="none">
      {/* Grid lines */}
      {[0, 40, 80].map((threshold) => {
        const y = height - padding - (threshold / maxScore) * (height - 2 * padding);
        return (
          <g key={threshold}>
            <line x1={padding} y1={y} x2={width - padding} y2={y} stroke="#1e1e30" strokeWidth="1" />
            <text x={padding - 4} y={y + 3} fill="#4a4a6a" fontSize="8" textAnchor="end">
              {threshold}
            </text>
          </g>
        );
      })}

      {/* Area fill */}
      <path
        d={`${pathD} L ${points[points.length - 1].x} ${height - padding} L ${points[0].x} ${height - padding} Z`}
        fill="url(#trust-gradient)"
        opacity="0.2"
      />

      {/* Line */}
      <path d={pathD} fill="none" stroke="#06b6d4" strokeWidth="2" />

      {/* Points */}
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="2" fill="#06b6d4" />
      ))}

      <defs>
        <linearGradient id="trust-gradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#06b6d4" />
          <stop offset="100%" stopColor="transparent" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function LineageTreeViz({ node, depth = 0 }: { node: LineageNode; depth?: number }) {
  const trustColor = node.trustScore >= 80 ? 'text-cyan-400' : node.trustScore >= 40 ? 'text-amber-400' : 'text-red-400';

  return (
    <div style={{ marginLeft: depth * 20 }}>
      <Link
        to={`/agents/${node.pubkey}`}
        className={clsx('flex items-center gap-2 py-1 hover:bg-gray-800/50 rounded px-2 -mx-2')}
      >
        <span className={clsx('h-2 w-2 rounded-full', trustColor.replace('text-', 'bg-'))} />
        <span className="text-sm text-gray-200">{node.name}</span>
        <span className={clsx('text-[10px] font-mono', trustColor)}>{Math.round(node.trustScore)}</span>
        <span className="text-[10px] text-gray-500">{node.trustLevel}</span>
      </Link>
      {node.children.map((child) => (
        <LineageTreeViz key={child.pubkey} node={child} depth={depth + 1} />
      ))}
    </div>
  );
}

// ── Tab definitions ──────────────────────────────────────────────────────────

const TABS = ['overview', 'sub-agents', 'analysis', 'policy-overrides'] as const;
type Tab = typeof TABS[number];

export function AgentDetailPage() {
  const { pubkey } = useParams<{ pubkey: string }>();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<Tab>('overview');

  const { data: agents, isLoading: agentsLoading } = useQuery({
    queryKey: ['agents'],
    queryFn: getAgents,
  });
  const { data: insights } = useAgentInsights(pubkey);
  const { data: lineage } = useAgentLineage(pubkey);
  const overrideMut = useOverrideTrust();

  // Mutation for suspend / revoke
  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      updateAgent(id, { status } as any),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agents'] }),
  });

  const agent = agents?.find((a) => a.pubkey === pubkey);

  // Sub-agents from the agents list
  const subAgents = agents?.filter((a) => a.parentPubkey === pubkey) ?? [];

  if (agentsLoading) {
    return <div className="py-20 text-center text-gray-500">Loading…</div>;
  }

  if (!agent) {
    return <div className="py-20 text-center text-red-400">Agent not found</div>;
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <AgentCharacter
          name={agent.name}
          status={agent.status}
          trustScore={agent.trustScore ?? 50}
          size="lg"
        />
        <div className="flex-1 space-y-1">
          <h2 className="text-xl font-bold text-gray-100">{agent.name}</h2>
          <p className="font-mono text-xs text-gray-400 break-all">{agent.pubkey}</p>
          <div className="flex items-center gap-2 mt-2">
            <Badge variant={agent.status === 'active' ? 'green' : agent.status === 'suspended' ? 'yellow' : 'red'}>
              {agent.status}
            </Badge>
            {agent.parentPubkey && (
              <span className="text-xs text-gray-500">
                Spawned by{' '}
                <Link to={`/agents/${agent.parentPubkey}`} className="text-indigo-400 hover:text-indigo-300">
                  {agent.parentPubkey.slice(0, 12)}…
                </Link>
                {' '}(depth {agent.spawnDepth})
              </span>
            )}
            {subAgents.length > 0 && (
              <span className="text-xs text-cyan-400">{subAgents.length} sub-agent(s)</span>
            )}
          </div>
        </div>
        <TrustLadderGauge
          score={agent.trustScore ?? 50}
          level={(agent.trustLevel as TrustLevel) ?? 'read-only'}
          size="md"
        />
      </div>

      {/* Agent Actions: Suspend / Revoke / Resume */}
      <Card className="flex items-center justify-between flex-wrap gap-3">
        <span className="text-sm text-gray-300">Agent Controls</span>
        <div className="flex gap-2">
          {agent.status === 'active' && (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  if (confirm(`Suspend agent "${agent.name}"? All tool calls will be auto-denied.`)) {
                    statusMut.mutate({ id: agent.id, status: 'suspended' });
                  }
                }}
                disabled={statusMut.isPending}
              >
                <span className="text-amber-400">Suspend</span>
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  if (confirm(`Permanently revoke agent "${agent.name}"? This cannot be undone.`)) {
                    statusMut.mutate({ id: agent.id, status: 'revoked' });
                  }
                }}
                disabled={statusMut.isPending}
              >
                <span className="text-red-400">Revoke</span>
              </Button>
            </>
          )}
          {agent.status === 'suspended' && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                if (confirm(`Re-activate agent "${agent.name}"?`)) {
                  statusMut.mutate({ id: agent.id, status: 'active' });
                }
              }}
              disabled={statusMut.isPending}
            >
              <span className="text-emerald-400">Resume</span>
            </Button>
          )}
        </div>
      </Card>

      {/* Trust Override */}
      <Card className="flex items-center justify-between flex-wrap gap-3">
        <span className="text-sm text-gray-300">Manual Trust Override</span>
        <div className="flex gap-2">
          {(['read-only', 'write-with-approvals', 'autonomous'] as TrustLevel[]).map((level) => (
            <Button
              key={level}
              size="sm"
              variant={agent.trustLevel === level ? 'primary' : 'ghost'}
              onClick={() => {
                if (confirm(`Override trust to ${level}?`)) {
                  overrideMut.mutate({
                    pubkey: agent.pubkey,
                    body: { trustLevel: level, reason: 'Manual override', operator: 'ui' },
                  });
                }
              }}
              disabled={overrideMut.isPending}
            >
              {level}
            </Button>
          ))}
        </div>
      </Card>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-gray-800">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={clsx(
              'px-4 py-2.5 text-xs font-semibold capitalize transition-colors border-b-2',
              activeTab === tab
                ? 'border-indigo-500 text-indigo-400'
                : 'border-transparent text-gray-500 hover:text-gray-300',
            )}
          >
            {tab.replace('-', ' ')}
            {tab === 'sub-agents' && subAgents.length > 0 && (
              <span className="ml-1.5 text-[10px] bg-indigo-500/15 text-indigo-400 px-1.5 py-0.5 rounded-full">
                {subAgents.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab: Overview */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Trust Trajectory */}
          {insights?.trustTrajectory && insights.trustTrajectory.length > 0 && (
            <Card className="space-y-3">
              <h3 className="text-sm font-semibold text-gray-200">Trust Trajectory</h3>
              <TrustTrajectoryChart history={insights.trustTrajectory} />
            </Card>
          )}

          {/* Insights Grid */}
          {insights && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Card className="text-center">
                <div className="text-2xl font-bold text-gray-100">{insights.totalAnalyses}</div>
                <div className="text-[10px] text-gray-500 uppercase">Total Analyses</div>
              </Card>
              <Card className="text-center">
                <div className="text-2xl font-bold text-red-400">{insights.criticalCount}</div>
                <div className="text-[10px] text-gray-500 uppercase">Critical</div>
              </Card>
              <Card className="text-center">
                <div className="text-2xl font-bold text-amber-400">{insights.highCount}</div>
                <div className="text-[10px] text-gray-500 uppercase">High</div>
              </Card>
              <Card className="text-center">
                <div className="text-2xl font-bold text-cyan-400">
                  {Math.round((insights.reliability.successRate ?? 0) * 100)}%
                </div>
                <div className="text-[10px] text-gray-500 uppercase">Success Rate</div>
              </Card>
            </div>
          )}

          {/* Top Failure Modes */}
          {insights?.topFailureModes && insights.topFailureModes.length > 0 && (
            <Card className="space-y-2">
              <h3 className="text-sm font-semibold text-gray-200">Top Failure Modes</h3>
              <div className="space-y-1">
                {insights.topFailureModes.map((fm) => (
                  <div key={fm.code} className="flex items-center justify-between text-xs">
                    <InsightChip code={fm.code} severity="MEDIUM" />
                    <span className="text-gray-400">{fm.count}x — last {new Date(fm.lastSeen).toLocaleDateString()}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Common Denies */}
          {insights?.commonDenies && insights.commonDenies.length > 0 && (
            <Card className="space-y-2">
              <h3 className="text-sm font-semibold text-gray-200">Common Denials</h3>
              <div className="space-y-1 text-xs">
                {insights.commonDenies.map((d, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <span className="font-mono text-gray-300">{d.toolName}: {d.argSignature}</span>
                    <span className="text-gray-500">{d.count}x</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Tab: Sub-Agents */}
      {activeTab === 'sub-agents' && (
        <div className="space-y-6">
          {/* Lineage Tree */}
          {lineage && (
            <Card className="space-y-3">
              <h3 className="text-sm font-semibold text-gray-200">Lineage Tree</h3>
              <LineageTreeViz node={lineage} />
            </Card>
          )}

          {/* Sub-Agent Cards */}
          {subAgents.length > 0 ? (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-gray-200">Direct Sub-Agents</h3>
              {subAgents.map((sub) => {
                const trustColor = (sub.trustScore ?? 50) >= 80
                  ? 'cyan' : (sub.trustScore ?? 50) >= 40
                  ? 'amber' : 'red';
                return (
                  <Card key={sub.id} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <AgentCharacter name={sub.name} status={sub.status} trustScore={sub.trustScore ?? 50} size="sm" />
                      <div>
                        <Link to={`/agents/${sub.pubkey}`} className="text-sm font-semibold text-gray-200 hover:text-indigo-400">
                          {sub.name}
                        </Link>
                        <div className="flex items-center gap-2 text-[10px]">
                          <Badge variant={sub.status === 'active' ? 'green' : sub.status === 'suspended' ? 'yellow' : 'red'}>
                            {sub.status}
                          </Badge>
                          <span className={`text-${trustColor}-400`}>
                            Trust: {Math.round(sub.trustScore ?? 50)}
                          </span>
                          <span className="text-gray-500">{sub.trustLevel}</span>
                          <span className="text-gray-500">Depth: {sub.spawnDepth}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {sub.status === 'active' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            if (confirm(`Suspend sub-agent "${sub.name}"?`)) {
                              statusMut.mutate({ id: sub.id, status: 'suspended' });
                            }
                          }}
                        >
                          <span className="text-amber-400 text-xs">Suspend</span>
                        </Button>
                      )}
                      {sub.status === 'suspended' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => statusMut.mutate({ id: sub.id, status: 'active' })}
                        >
                          <span className="text-emerald-400 text-xs">Resume</span>
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          if (confirm(`Revoke sub-agent "${sub.name}"? Permanently.`)) {
                            statusMut.mutate({ id: sub.id, status: 'revoked' });
                          }
                        }}
                      >
                        <span className="text-red-400 text-xs">Revoke</span>
                      </Button>
                    </div>
                  </Card>
                );
              })}
            </div>
          ) : (
            <Card className="text-center py-8">
              <p className="text-sm text-gray-500">No sub-agents spawned by this agent.</p>
              <p className="text-xs text-gray-600 mt-1">Sub-agents will appear here when the agent dynamically spawns them.</p>
            </Card>
          )}
        </div>
      )}

      {/* Tab: Analysis */}
      {activeTab === 'analysis' && (
        <AgentAnalysisTab pubkey={pubkey!} insights={insights} />
      )}

      {/* Tab: Policy Overrides */}
      {activeTab === 'policy-overrides' && (
        <div className="space-y-6">
          <Card className="space-y-4">
            <h3 className="text-sm font-semibold text-gray-200">Per-Agent Policy Overrides</h3>
            <p className="text-xs text-gray-400">
              Set agent-specific constraints that override the global policy. These are enforced in real-time by the policy engine.
            </p>

            {/* Trust Level (links to override) */}
            <div className="p-3 bg-gray-900/50 rounded-lg space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-400">Trust Level</span>
                <span className="text-gray-200 font-semibold capitalize">{agent.trustLevel}</span>
              </div>
              <p className="text-[10px] text-gray-500">
                {agent.trustLevel === 'read-only' && 'Only read operations allowed. Write/Destructive auto-denied.'}
                {agent.trustLevel === 'write-with-approvals' && 'Writes require approval. Reads auto-allowed. Destructive auto-denied.'}
                {agent.trustLevel === 'autonomous' && 'All operations auto-allowed based on global policy. Use with caution.'}
              </p>
            </div>

            {/* Spawn Depth Limit */}
            <div className="p-3 bg-gray-900/50 rounded-lg space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-400">Max Spawn Depth</span>
                <span className="text-gray-200 font-mono">{agent.spawnDepth ?? 0} / 5</span>
              </div>
              <p className="text-[10px] text-gray-500">
                Limits how deeply this agent can create sub-agents. Deeper spawn chains are denied if they exceed the threshold.
              </p>
            </div>

            {/* Tool Restrictions */}
            <div className="p-3 bg-gray-900/50 rounded-lg space-y-2">
              <div className="text-xs text-gray-400 mb-1">Tool Restrictions</div>
              <div className="flex flex-wrap gap-2">
                <span className="px-2 py-1 rounded bg-emerald-500/10 text-emerald-400 text-[10px] font-mono">read: allowed</span>
                <span className={clsx(
                  'px-2 py-1 rounded text-[10px] font-mono',
                  agent.trustLevel === 'read-only'
                    ? 'bg-red-500/10 text-red-400'
                    : 'bg-amber-500/10 text-amber-400',
                )}>
                  exec: {agent.trustLevel === 'read-only' ? 'denied' : 'approval required'}
                </span>
                <span className={clsx(
                  'px-2 py-1 rounded text-[10px] font-mono',
                  agent.trustLevel === 'autonomous'
                    ? 'bg-amber-500/10 text-amber-400'
                    : 'bg-red-500/10 text-red-400',
                )}>
                  destructive: {agent.trustLevel === 'autonomous' ? 'approval required' : 'denied'}
                </span>
              </div>
              <p className="text-[10px] text-gray-500">
                These are derived from the agent's trust level. Change the trust level above to modify.
              </p>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

// ── Behavioral Detectors Reference ──────────────────────────────────────────

const DETECTORS = [
  { code: 'DESTRUCTIVE_CMD', label: 'Destructive Command', desc: 'Detects rm -rf, DROP TABLE, and similar destructive operations', severity: 'CRITICAL' },
  { code: 'APPROVAL_BYPASS', label: 'Approval Bypass', desc: 'Agent attempts to circumvent the approval flow', severity: 'CRITICAL' },
  { code: 'CANARY_TRIP', label: 'Canary Trip', desc: 'Agent accessed a honeypot file, env, or URL', severity: 'CRITICAL' },
  { code: 'RETRY_LOOP', label: 'Retry Loop', desc: 'Repeated failed attempts at the same action (possible brute-force)', severity: 'HIGH' },
  { code: 'READONLY_VIOLATION', label: 'Read-Only Violation', desc: 'Agent with read-only trust attempted a write operation', severity: 'HIGH' },
  { code: 'IDENTITY_DRIFT', label: 'Identity Drift', desc: 'Agent behavior deviates significantly from its established baseline', severity: 'HIGH' },
  { code: 'CROSS_AGENT_CORRELATION', label: 'Cross-Agent Correlation', desc: 'Coordinated suspicious activity detected across multiple agents', severity: 'HIGH' },
  { code: 'SPAWN_CHAIN_ANOMALY', label: 'Spawn Chain Anomaly', desc: 'Unusual spawn pattern: too deep, too fast, or circular', severity: 'HIGH' },
  { code: 'DOMAIN_DRIFT', label: 'Domain Drift', desc: 'Agent operating outside its configured domain scope', severity: 'MEDIUM' },
  { code: 'COST_TIME_BASELINE', label: 'Cost/Time Anomaly', desc: 'Task cost or duration far exceeds the agent baseline', severity: 'MEDIUM' },
  { code: 'HUMAN_INTERVENTION', label: 'Human Intervention', desc: 'Task required human override to complete', severity: 'LOW' },
  { code: 'SENSITIVE_ACCESS', label: 'Sensitive Access', desc: 'Agent accessed credentials, keys, or PII', severity: 'HIGH' },
] as const;

// ── Agent Analysis Tab (extracted for readability) ──────────────────────────

function AgentAnalysisTab({ pubkey, insights }: { pubkey: string; insights: any }) {
  // Fetch actual analysis records for this agent
  const { data: analyses } = useQuery({
    queryKey: ['agent-analyses', pubkey],
    queryFn: () => fetchApi<Analysis[]>(`/api/tasks/${pubkey}/analysis`),
    retry: false,
  });

  return (
    <div className="space-y-6">
      {/* Detector Overview */}
      <Card className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-200">Behavioral Detectors (12)</h3>
        <p className="text-xs text-gray-400">
          Wooblay continuously monitors agent behavior using 12 specialized detectors.
          Findings are automatically correlated and surfaced below.
        </p>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
          {DETECTORS.map((d) => {
            const hasFinding = insights?.topFailureModes?.some((f: any) => f.code === d.code);
            return (
              <div
                key={d.code}
                className={clsx(
                  'p-2.5 rounded-lg border text-xs transition-all',
                  hasFinding
                    ? 'border-red-800/40 bg-red-950/20'
                    : 'border-gray-800/50 bg-gray-900/30',
                )}
              >
                <div className="flex items-center gap-2 mb-1">
                  <InsightChip
                    code={d.code}
                    severity={d.severity as any}
                    className="!text-[8px] !px-1.5 !py-0"
                  />
                  {hasFinding && <span className="h-1.5 w-1.5 rounded-full bg-red-400 animate-pulse" />}
                </div>
                <div className="text-[10px] text-gray-500 leading-relaxed">{d.desc}</div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Behavioral Profile */}
      {insights?.behavioralProfile && (
        <Card className="space-y-3">
          <h3 className="text-sm font-semibold text-gray-200">Behavioral Profile</h3>
          <div className="grid grid-cols-2 gap-4 text-xs">
            {Object.entries(insights.behavioralProfile).map(([key, value]) => (
              <div key={key} className="flex justify-between p-2 bg-gray-900/50 rounded">
                <span className="text-gray-400 capitalize">{key.replace(/([A-Z])/g, ' $1')}</span>
                <span className="text-gray-200 font-mono">
                  {typeof value === 'number' ? Math.round(value * 100) / 100 : String(value)}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Reliability */}
      {insights?.reliability && (
        <Card className="space-y-3">
          <h3 className="text-sm font-semibold text-gray-200">Reliability Metrics</h3>
          <div className="grid grid-cols-3 gap-3 text-xs">
            <div className="text-center p-3 bg-gray-900/50 rounded-lg">
              <div className="text-lg font-bold text-emerald-400">{Math.round((insights.reliability.successRate ?? 0) * 100)}%</div>
              <div className="text-gray-500">Success Rate</div>
            </div>
            <div className="text-center p-3 bg-gray-900/50 rounded-lg">
              <div className="text-lg font-bold text-amber-400">{insights.reliability.avgFindingsPerTask?.toFixed(1) ?? '0'}</div>
              <div className="text-gray-500">Avg Findings/Task</div>
            </div>
            <div className="text-center p-3 bg-gray-900/50 rounded-lg">
              <div className="text-lg font-bold text-cyan-400">{insights.reliability.totalTasks ?? 0}</div>
              <div className="text-gray-500">Tasks</div>
            </div>
          </div>
        </Card>
      )}

      {/* Findings Summary */}
      <Card className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-200">Findings Summary</h3>
        {insights ? (
          <div className="space-y-2 text-xs">
            {insights.criticalCount > 0 && (
              <div className="flex items-center gap-2 p-2 bg-red-900/20 border border-red-800/30 rounded-lg">
                <span className="h-2 w-2 rounded-full bg-red-400" />
                <span className="text-red-400 font-semibold">{insights.criticalCount} CRITICAL finding(s)</span>
                <span className="text-gray-500 ml-auto">Requires immediate review</span>
              </div>
            )}
            {insights.highCount > 0 && (
              <div className="flex items-center gap-2 p-2 bg-amber-900/20 border border-amber-800/30 rounded-lg">
                <span className="h-2 w-2 rounded-full bg-amber-400" />
                <span className="text-amber-400 font-semibold">{insights.highCount} HIGH finding(s)</span>
                <span className="text-gray-500 ml-auto">Review recommended</span>
              </div>
            )}
            {insights.criticalCount === 0 && insights.highCount === 0 && (
              <p className="text-gray-500 py-4 text-center">No critical or high-severity findings.</p>
            )}
          </div>
        ) : (
          <p className="text-gray-500 text-xs">No analysis data available.</p>
        )}
      </Card>

      {/* Detailed Analyses (using AnalysisPanel) */}
      {analyses && analyses.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-gray-200">Detailed Analysis Reports</h3>
          <AnalysisPanel analyses={analyses} />
        </div>
      )}
    </div>
  );
}

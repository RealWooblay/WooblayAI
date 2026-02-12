import { useParams, Link } from 'react-router-dom';
import clsx from 'clsx';
import { Card } from '../../components/common/Card.tsx';
import { Badge } from '../../components/common/Badge.tsx';
import { Button } from '../../components/common/Button.tsx';
import { TrustMeter } from '../../components/common/TrustMeter.tsx';
import { RiskPill } from '../../components/action-pr/RiskPill.tsx';
import {
  IconAlert,
  IconCheck,
  IconX,
  IconUnlock,
} from '../../components/icons.tsx';
import { getMockAgent, MOCK_ACTION_PRS } from '../../lib/mock-data.ts';
import { relativeTime, formatDuration } from '../../lib/utils.ts';

function avatarBg(name: string): string {
  const colors = [
    'bg-blue-100 text-blue-700',
    'bg-violet-100 text-violet-700',
    'bg-emerald-100 text-emerald-700',
    'bg-amber-100 text-amber-700',
    'bg-rose-100 text-rose-700',
    'bg-sky-100 text-sky-700',
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function autonomyLabel(level: string): string {
  switch (level) {
    case 'read-only': return 'Read Only';
    case 'write-with-approvals': return 'Write + Approvals';
    case 'autonomous': return 'Autonomous';
    default: return level;
  }
}

export function AgentProfilePage() {
  const { id } = useParams<{ id: string }>();
  const agent = getMockAgent(id ?? '');

  if (!agent) {
    return (
      <div className="flex items-center justify-center py-20 text-stone-400">
        Agent not found
      </div>
    );
  }

  const agentActions = MOCK_ACTION_PRS.filter(a => a.agentId === agent.id);

  // Mock recommended policy changes
  const policyRecommendations = agent.trustScore > 70 ? [
    { type: 'promote', change: 'Upgrade wooblay_exec READ from APPROVE → ALLOW', reason: '94% approval rate on 823 READ actions' },
  ] : agent.trustScore < 40 ? [
    { type: 'restrict', change: 'Downgrade wooblay_exec WRITE from APPROVE → DENY', reason: '38% failure rate on WRITE operations' },
    { type: 'restrict', change: 'Revoke DESTRUCTIVE access entirely', reason: 'Multiple policy violations detected' },
  ] : [];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-stone-400">
        <Link to="/agents" className="hover:text-stone-600 transition-colors no-underline">Agents</Link>
        <span>/</span>
        <span className="text-stone-600">{agent.name}</span>
      </div>

      {/* Hero */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left: Identity */}
        <Card className="lg:col-span-2 flex items-start gap-5">
          <div className={clsx(
            'flex h-14 w-14 items-center justify-center rounded-xl text-lg font-bold shrink-0',
            avatarBg(agent.name),
          )}>
            {agent.name.slice(0, 2).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0 space-y-3">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold text-stone-900">{agent.name}</h1>
                <Badge
                  variant={agent.status === 'active' ? 'green' : agent.status === 'suspended' ? 'yellow' : 'red'}
                >
                  {agent.status}
                </Badge>
              </div>
              <p className="text-xs font-mono text-stone-400 mt-1">{agent.pubkey}</p>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              <Badge
                variant={
                  agent.autonomyLevel === 'autonomous' ? 'blue'
                  : agent.autonomyLevel === 'write-with-approvals' ? 'yellow'
                  : 'gray'
                }
              >
                {autonomyLabel(agent.autonomyLevel)}
              </Badge>
              {agent.allowlisted ? (
                <Badge variant="green">Allowlisted</Badge>
              ) : (
                <Badge variant="red">Not allowlisted</Badge>
              )}
            </div>

            <div className="flex gap-2 pt-1">
              <Button size="sm" variant="primary">
                <IconUnlock size={14} />
                Promote Autonomy
              </Button>
              {agent.status === 'active' ? (
                <Button size="sm" variant="danger">Suspend</Button>
              ) : (
                <Button size="sm" variant="secondary">Reactivate</Button>
              )}
            </div>
          </div>
        </Card>

        {/* Right: Trust Score */}
        <Card className="flex flex-col items-center justify-center gap-3">
          <div className="text-sm font-semibold text-stone-500">Trust Score</div>
          <div className="text-4xl font-bold text-stone-900">{agent.trustScore}</div>
          <TrustMeter score={agent.trustScore} width="120px" />
        </Card>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Card className="!p-3 text-center">
          <p className="text-lg font-bold text-stone-900">{agent.stats.totalActions.toLocaleString()}</p>
          <p className="text-[10px] text-stone-500">Total Actions</p>
        </Card>
        <Card className="!p-3 text-center">
          <p className={clsx(
            'text-lg font-bold',
            agent.stats.successRate >= 0.95 ? 'text-green-700'
            : agent.stats.successRate >= 0.8 ? 'text-amber-700'
            : 'text-red-700',
          )}>
            {(agent.stats.successRate * 100).toFixed(1)}%
          </p>
          <p className="text-[10px] text-stone-500">Success Rate</p>
        </Card>
        <Card className="!p-3 text-center">
          <p className="text-lg font-bold text-stone-900">{formatDuration(agent.stats.avgDuration)}</p>
          <p className="text-[10px] text-stone-500">Avg Duration</p>
        </Card>
        <Card className="!p-3 text-center">
          <p className="text-lg font-bold text-stone-900">${agent.stats.avgCostPerAction.toFixed(3)}</p>
          <p className="text-[10px] text-stone-500">Avg Cost</p>
        </Card>
        <Card className="!p-3 text-center">
          <p className="text-lg font-bold text-stone-900">{relativeTime(agent.stats.lastActive)}</p>
          <p className="text-[10px] text-stone-500">Last Active</p>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Risk Tier Breakdown */}
        <Card className="space-y-4">
          <h3 className="text-sm font-semibold text-stone-800">Actions by Risk Tier</h3>
          <div className="space-y-3">
            {Object.entries(agent.stats.byRiskTier).map(([tier, count]) => {
              const total = agent.stats.totalActions;
              const pct = total > 0 ? (count / total) * 100 : 0;
              return (
                <div key={tier} className="space-y-1">
                  <div className="flex items-center justify-between">
                    <RiskPill tier={tier} />
                    <span className="text-xs text-stone-500">{count} ({pct.toFixed(0)}%)</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-stone-100 overflow-hidden">
                    <div
                      className={clsx(
                        'h-full rounded-full transition-all duration-1000',
                        tier === 'READ' && 'bg-green-500',
                        tier === 'WRITE' && 'bg-amber-500',
                        tier === 'DESTRUCTIVE' && 'bg-red-500',
                      )}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        {/* Common Failure Reasons */}
        <Card className="space-y-4">
          <h3 className="text-sm font-semibold text-stone-800">Common Failure Reasons</h3>
          {agent.stats.failureReasons.length === 0 ? (
            <p className="text-xs text-stone-400 italic">No failures recorded</p>
          ) : (
            <div className="space-y-2">
              {agent.stats.failureReasons.map((f, i) => (
                <div key={i} className="flex items-center justify-between rounded-md bg-stone-50 border border-stone-200 px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <IconAlert size={14} className="text-red-400" />
                    <span className="text-xs text-stone-700">{f.reason}</span>
                  </div>
                  <span className="text-xs font-bold text-stone-500">{f.count}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Policy Recommendations */}
      {policyRecommendations.length > 0 && (
        <Card className="space-y-4">
          <h3 className="text-sm font-semibold text-stone-800">Recommended Policy Changes</h3>
          <div className="space-y-2">
            {policyRecommendations.map((rec, i) => (
              <div
                key={i}
                className={clsx(
                  'rounded-md border border-stone-200 bg-white p-4 space-y-2',
                  rec.type === 'promote' && 'border-l-2 border-l-green-500',
                  rec.type === 'restrict' && 'border-l-2 border-l-red-500',
                )}
              >
                <div className="flex items-center gap-2">
                  {rec.type === 'promote' ? (
                    <IconCheck size={14} className="text-green-600" />
                  ) : (
                    <IconX size={14} className="text-red-600" />
                  )}
                  <span className="text-xs font-semibold text-stone-800">
                    {rec.type === 'promote' ? 'Promote' : 'Restrict'}
                  </span>
                </div>
                <pre className="rounded-md bg-stone-50 border border-stone-200 p-3 text-xs font-mono">
                  <span className={rec.type === 'promote' ? 'text-green-700' : 'text-red-700'}>
                    {rec.type === 'promote' ? '+' : '-'} {rec.change}
                  </span>
                </pre>
                <p className="text-[11px] text-stone-500">{rec.reason}</p>
                <Button size="xs" variant={rec.type === 'promote' ? 'primary' : 'danger'}>
                  Review Diff
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Recent Actions */}
      <Card className="space-y-4">
        <h3 className="text-sm font-semibold text-stone-800">Recent Actions</h3>
        {agentActions.length === 0 ? (
          <p className="text-xs text-stone-400 italic py-4">No actions recorded</p>
        ) : (
          <div className="space-y-2">
            {agentActions.slice(0, 5).map(action => (
              <Link
                key={action.id}
                to={`/actions/${action.id}`}
                className="flex items-center gap-3 rounded-md bg-stone-50 border border-stone-200 px-4 py-3 hover:bg-stone-100 transition-colors no-underline"
              >
                <RiskPill tier={action.riskTier} />
                <span className="text-xs text-stone-700 flex-1 truncate">{action.title}</span>
                <Badge variant={
                  action.status === 'pending' ? 'blue'
                  : action.status === 'executed' ? 'green'
                  : action.status === 'denied' ? 'red'
                  : action.status === 'rolled_back' ? 'purple'
                  : 'gray'
                }>
                  {action.status}
                </Badge>
                <span className="text-[10px] text-stone-400">{relativeTime(action.createdAt)}</span>
              </Link>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

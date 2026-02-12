import { useState, useCallback, useMemo } from 'react';
import clsx from 'clsx';
import { DataTable, type Column } from '../../components/common/DataTable.tsx';
import { TrustMeter } from '../../components/common/TrustMeter.tsx';
import { Badge } from '../../components/common/Badge.tsx';
import { Button } from '../../components/common/Button.tsx';
import { MOCK_AGENTS, type MockAgent } from '../../lib/mock-data.ts';
import { relativeTime } from '../../lib/utils.ts';
import { useInspector } from '../../components/layout/LayoutShell.tsx';
import { Link } from 'react-router-dom';

/** Pastel avatar bg from name */
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

function autonomyVariant(level: string): 'gray' | 'yellow' | 'blue' {
  switch (level) {
    case 'autonomous': return 'blue';
    case 'write-with-approvals': return 'yellow';
    default: return 'gray';
  }
}

/* ------------------------------------------------------------------ */
/*  Inspector content for an agent                                    */
/* ------------------------------------------------------------------ */

function AgentInspectorContent({ agent }: { agent: MockAgent }) {
  const interventionRate = (1 - agent.stats.successRate) * 100;

  return (
    <div className="space-y-5">
      {/* Identity */}
      <div className="flex items-center gap-3">
        <div className={clsx(
          'flex h-10 w-10 items-center justify-center rounded-lg text-sm font-bold',
          avatarBg(agent.name),
        )}>
          {agent.name.slice(0, 2).toUpperCase()}
        </div>
        <div>
          <h4 className="text-sm font-semibold text-stone-900">{agent.name}</h4>
          <p className="text-[10px] font-mono text-stone-400">{agent.pubkey.slice(0, 20)}...</p>
        </div>
      </div>

      {/* Autonomy level */}
      <div className="rounded-md border border-stone-200 bg-stone-50 p-3">
        <div className="text-[11px] text-stone-500 mb-1">Autonomy Level</div>
        <div className="flex items-center gap-2">
          <Badge variant={autonomyVariant(agent.autonomyLevel)}>
            {autonomyLabel(agent.autonomyLevel)}
          </Badge>
          {agent.allowlisted && (
            <Badge variant="green">Allowlisted</Badge>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="space-y-3">
        <div className="flex items-center justify-between text-xs">
          <span className="text-stone-500">Success Rate</span>
          <span className={clsx(
            'font-semibold',
            agent.stats.successRate >= 0.95 ? 'text-green-700'
            : agent.stats.successRate >= 0.8 ? 'text-amber-700'
            : 'text-red-700',
          )}>
            {(agent.stats.successRate * 100).toFixed(1)}%
          </span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-stone-500">Intervention Rate</span>
          <span className="font-semibold text-stone-700">{interventionRate.toFixed(1)}%</span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-stone-500">Total Actions</span>
          <span className="font-semibold text-stone-700">{agent.stats.totalActions.toLocaleString()}</span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-stone-500">Trust Score</span>
          <TrustMeter score={agent.trustScore} width="80px" />
        </div>
      </div>

      {/* Failure reasons */}
      {agent.stats.failureReasons.length > 0 && (
        <div>
          <h5 className="text-[11px] font-semibold uppercase tracking-wider text-stone-500 mb-2">
            Common Failure Reasons
          </h5>
          <div className="space-y-1">
            {agent.stats.failureReasons.map((fr, i) => (
              <div key={i} className="flex items-center justify-between rounded-md border border-stone-100 px-3 py-1.5 text-xs">
                <span className="text-stone-600">{fr.reason}</span>
                <span className="text-stone-400 font-mono">{fr.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recommended policy changes as diff */}
      <div>
        <h5 className="text-[11px] font-semibold uppercase tracking-wider text-stone-500 mb-2">
          Recommended Policy Changes
        </h5>
        <pre className="rounded-md border border-stone-200 bg-stone-50 p-3 text-[11px] font-mono text-stone-600 overflow-x-auto">
          <div className="diff-add px-2 py-0.5">+ Allow {agent.name.toLowerCase()} autonomous READ ops</div>
          <div className="diff-remove px-2 py-0.5">- Require approval for all WRITE ops</div>
          <div className="diff-add px-2 py-0.5">+ Auto-approve WRITE ops with success_rate &gt; 95%</div>
        </pre>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  TrustPage (Agents)                                                */
/* ------------------------------------------------------------------ */

export function TrustPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<'trust' | 'actions' | 'success'>('trust');
  const { openInspector, closeInspector, inspector } = useInspector();

  const sorted = useMemo(() => {
    const agents = [...MOCK_AGENTS];
    agents.sort((a, b) => {
      // Active first
      if (a.status !== b.status) {
        if (a.status === 'active') return -1;
        if (b.status === 'active') return 1;
      }
      switch (sortKey) {
        case 'trust': return b.trustScore - a.trustScore;
        case 'actions': return b.stats.totalActions - a.stats.totalActions;
        case 'success': return b.stats.successRate - a.stats.successRate;
        default: return 0;
      }
    });
    return agents;
  }, [sortKey]);

  const handleRowClick = useCallback(
    (agent: MockAgent) => {
      if (selectedId === agent.id && inspector.isOpen) {
        setSelectedId(null);
        closeInspector();
        return;
      }
      setSelectedId(agent.id);
      openInspector({
        title: agent.name,
        content: <AgentInspectorContent agent={agent} />,
        footer: (
          <div className="flex items-center gap-2">
            <Link to={`/agents/${agent.id}`} className="no-underline flex-1">
              <Button variant="secondary" size="sm" className="w-full">
                Full Profile
              </Button>
            </Link>
            <Button variant="primary" size="sm" className="flex-1">
              Promote Autonomy
            </Button>
          </div>
        ),
      });
    },
    [selectedId, inspector.isOpen, openInspector, closeInspector],
  );

  const columns: Column<MockAgent>[] = useMemo(() => [
    {
      key: 'name',
      header: 'Agent',
      width: '160px',
      render: (row) => (
        <div className="flex items-center gap-2">
          <div className={clsx(
            'flex h-7 w-7 items-center justify-center rounded-md text-[10px] font-bold',
            avatarBg(row.name),
          )}>
            {row.name.slice(0, 2).toUpperCase()}
          </div>
          <span className="text-xs font-medium text-stone-800">{row.name}</span>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: '90px',
      render: (row) => (
        <div className="flex items-center gap-1.5">
          <span className={clsx(
            'inline-flex h-2 w-2 rounded-full',
            row.status === 'active' ? 'bg-green-500'
            : row.status === 'suspended' ? 'bg-amber-500'
            : 'bg-stone-400',
          )} />
          <span className="text-xs text-stone-600 capitalize">{row.status}</span>
        </div>
      ),
    },
    {
      key: 'level',
      header: 'Level',
      width: '150px',
      render: (row) => (
        <Badge variant={autonomyVariant(row.autonomyLevel)}>
          {autonomyLabel(row.autonomyLevel)}
        </Badge>
      ),
    },
    {
      key: 'trust',
      header: 'Trust',
      width: '120px',
      render: (row) => <TrustMeter score={row.trustScore} width="64px" />,
    },
    {
      key: 'actions',
      header: 'Actions',
      width: '80px',
      render: (row) => (
        <span className="text-xs tabular-nums text-stone-600">{row.stats.totalActions.toLocaleString()}</span>
      ),
    },
    {
      key: 'success',
      header: 'Success',
      width: '80px',
      render: (row) => (
        <span className={clsx(
          'text-xs tabular-nums font-medium',
          row.stats.successRate >= 0.95 ? 'text-green-700'
          : row.stats.successRate >= 0.8 ? 'text-amber-700'
          : 'text-red-700',
        )}>
          {(row.stats.successRate * 100).toFixed(0)}%
        </span>
      ),
    },
    {
      key: 'lastActive',
      header: 'Last Active',
      width: '90px',
      render: (row) => (
        <span className="text-xs text-stone-400">{relativeTime(row.stats.lastActive)}</span>
      ),
    },
  ], []);

  const activeCount = MOCK_AGENTS.filter(a => a.status === 'active').length;
  const inactiveCount = MOCK_AGENTS.length - activeCount;

  return (
    <div className="h-full flex flex-col">
      {/* Header bar */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-stone-100">
        <div className="text-sm text-stone-600">
          <span className="font-semibold text-stone-900">{MOCK_AGENTS.length} agents</span>
          <span className="ml-2 text-stone-400">
            &middot; {activeCount} active, {inactiveCount} inactive
          </span>
        </div>

        {/* Sort buttons */}
        <div className="flex items-center gap-1 text-[11px]">
          <span className="text-stone-400 mr-1">Sort:</span>
          {([
            { key: 'trust' as const, label: 'Trust' },
            { key: 'actions' as const, label: 'Actions' },
            { key: 'success' as const, label: 'Success' },
          ]).map(s => (
            <button
              key={s.key}
              onClick={() => setSortKey(s.key)}
              className={clsx(
                'rounded-md px-2 py-1 font-medium transition-colors cursor-pointer',
                sortKey === s.key
                  ? 'bg-stone-100 text-stone-800'
                  : 'text-stone-400 hover:text-stone-600',
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto px-6 py-2">
        <DataTable
          columns={columns}
          data={sorted}
          rowKey={(r) => r.id}
          selectedId={selectedId}
          onRowClick={handleRowClick}
          keyboardNav
          emptyMessage="No agents registered"
        />
      </div>
    </div>
  );
}

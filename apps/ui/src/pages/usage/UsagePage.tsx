import { useQuery } from '@tanstack/react-query';
import { getStats } from '../../api/client.ts';

export function UsagePage() {
  const { data: stats } = useQuery({ queryKey: ['stats'], queryFn: getStats, refetchInterval: 10_000 });

  const totalActions = stats?.totalToolCalls ?? 0;
  const allowed = stats?.byDecision?.ALLOW ?? 0;
  const approved = stats?.byDecision?.APPROVE ?? 0;
  const denied = stats?.byDecision?.DENY ?? 0;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-bold text-text-primary">Usage</h1>
        <p className="text-xs text-text-muted mt-0.5">Action counts and decision breakdown across all agents</p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-surface-1 border border-border rounded-xl p-4">
          <p className="text-[10px] text-text-muted uppercase tracking-wider mb-1">Total Actions</p>
          <p className="text-2xl font-bold text-text-primary tabular-nums">{totalActions.toLocaleString()}</p>
        </div>
        <div className="bg-surface-1 border border-border rounded-xl p-4">
          <p className="text-[10px] text-text-muted uppercase tracking-wider mb-1">Auto-Allowed</p>
          <p className="text-2xl font-bold text-emerald-400 tabular-nums">{allowed.toLocaleString()}</p>
        </div>
        <div className="bg-surface-1 border border-border rounded-xl p-4">
          <p className="text-[10px] text-text-muted uppercase tracking-wider mb-1">Approved</p>
          <p className="text-2xl font-bold text-amber-400 tabular-nums">{approved.toLocaleString()}</p>
        </div>
        <div className="bg-surface-1 border border-border rounded-xl p-4">
          <p className="text-[10px] text-text-muted uppercase tracking-wider mb-1">Denied</p>
          <p className="text-2xl font-bold text-red-400 tabular-nums">{denied.toLocaleString()}</p>
        </div>
      </div>

      {/* Breakdown by decision */}
      <div className="bg-surface-1 border border-border rounded-xl p-5">
        <h2 className="text-sm font-semibold text-text-primary mb-3">Action Breakdown</h2>
        {totalActions === 0 ? (
          <p className="text-xs text-text-muted py-4 text-center">No actions yet</p>
        ) : (
          <div className="space-y-2">
            {[
              { label: 'Auto-Allowed', count: allowed, color: 'bg-emerald-400' },
              { label: 'Human Approved', count: approved, color: 'bg-amber-400' },
              { label: 'Denied', count: denied, color: 'bg-red-400' },
            ].map(({ label, count, color }) => (
              <div key={label} className="flex items-center gap-3">
                <span className="text-xs text-text-secondary w-28">{label}</span>
                <div className="flex-1 h-1.5 bg-surface-3 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${color} rounded-full`}
                    style={{ width: `${totalActions > 0 ? (count / totalActions) * 100 : 0}%` }}
                  />
                </div>
                <span className="text-xs text-text-tertiary tabular-nums w-12 text-right">{count}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* By tool */}
      {stats?.byTool && Object.keys(stats.byTool).length > 0 && (
        <div className="bg-surface-1 border border-border rounded-xl p-5">
          <h2 className="text-sm font-semibold text-text-primary mb-3">By Tool</h2>
          <div className="space-y-2">
            {Object.entries(stats.byTool)
              .sort(([, a], [, b]) => (b as number) - (a as number))
              .slice(0, 15)
              .map(([tool, count]) => (
                <div key={tool} className="flex items-center gap-3">
                  <span className="text-xs text-text-secondary w-40 truncate font-mono">{tool}</span>
                  <div className="flex-1 h-1.5 bg-surface-3 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-accent rounded-full"
                      style={{ width: `${totalActions > 0 ? ((count as number) / totalActions) * 100 : 0}%` }}
                    />
                  </div>
                  <span className="text-xs text-text-tertiary tabular-nums w-12 text-right">{(count as number).toLocaleString()}</span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

import { useQuery } from '@tanstack/react-query';
import { getStats } from '../../api/client.ts';

export function StatusBar() {
  const { data: stats } = useQuery({
    queryKey: ['stats'],
    queryFn: getStats,
    refetchInterval: 10_000,
  });

  return (
    <footer className="flex items-center h-7 bg-surface-1 border-t border-border px-4 shrink-0 z-20">
      <div className="flex items-center gap-4 text-[10px] font-mono text-text-tertiary">
        {/* Connection */}
        <div className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-success" />
          <span>Gate connected</span>
        </div>

        <span className="text-border">│</span>

        {/* Stats */}
        {stats ? (
          <>
            <span>
              <span className="text-text-secondary">{stats.agentsRegistered}</span> agents
            </span>
            <span>
              <span className="text-text-secondary">{stats.totalToolCalls}</span> tool calls
            </span>
            <span>
              <span className="text-text-secondary">{stats.totalReceipts}</span> receipts
            </span>
            {stats.pendingApprovals > 0 && (
              <span className="text-warning">
                {stats.pendingApprovals} pending
              </span>
            )}
          </>
        ) : (
          <span>Loading stats...</span>
        )}
      </div>

      <div className="flex-1" />

      <div className="text-[10px] font-mono text-text-muted">
        v0.1.0
      </div>
    </footer>
  );
}

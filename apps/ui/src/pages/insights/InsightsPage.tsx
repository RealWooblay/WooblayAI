import { useQuery } from '@tanstack/react-query';
import { getInsightsMetrics, getInsightsSummary } from '../../api/client.ts';
import { Spinner } from '../../components/common/Spinner.tsx';

export function InsightsPage() {
  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ['insights-summary'],
    queryFn: () => getInsightsSummary(30),
    refetchInterval: 30_000,
  });

  const { data: metrics, isLoading: metricsLoading } = useQuery({
    queryKey: ['insights-metrics'],
    queryFn: () => getInsightsMetrics(30),
    refetchInterval: 30_000,
  });

  if (summaryLoading || metricsLoading) {
    return <div className="flex items-center justify-center h-64"><Spinner /></div>;
  }

  return (
    <div className="max-w-4xl mx-auto" data-tour="tour-insights">
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-text-primary">Insights</h1>
        <p className="text-xs text-text-tertiary mt-0.5">Last 30 days</p>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-4 gap-4 mb-8" data-tour="tour-insights-metrics">
          <SummaryCard
            label="Incidents"
            value={summary.incidents.total}
            sub={`${summary.incidents.resolved} resolved`}
          />
          <SummaryCard
            label="Runs"
            value={summary.runs.total}
            sub={`${summary.runs.completed} completed, ${summary.runs.failed} failed`}
          />
          <SummaryCard
            label="Proposals"
            value={summary.proposals.total}
            sub={`${summary.proposals.approved} approved, ${summary.proposals.denied} denied`}
          />
          <SummaryCard
            label="Intervention Rate"
            value={`${summary.interventionRate}%`}
            sub={`${summary.approvals.humanApproved} human approvals`}
          />
        </div>
      )}

      {/* Per-Action Metrics */}
      <h2 className="text-sm font-medium text-text-primary mb-3">Per Action Class</h2>
      {metrics?.metrics?.length === 0 ? (
        <div className="text-xs text-text-tertiary bg-surface-1 border border-border rounded-lg p-6 text-center">
          No action data yet. Metrics will appear as proposals are created and processed.
        </div>
      ) : (
        <div className="space-y-3">
          {metrics?.metrics?.map((m: any) => (
            <ActionMetricCard key={m.actionClass} metric={m} />
          ))}
        </div>
      )}

      {/* Quarantine & Safety */}
      {summary && summary.runs.quarantined > 0 && (
        <div className="mt-8 bg-red-500/5 border border-red-500/20 rounded-lg p-4">
          <h3 className="text-sm font-medium text-red-400 mb-1">Safety Alerts</h3>
          <p className="text-xs text-red-300/80">
            {summary.runs.quarantined} run{summary.runs.quarantined > 1 ? 's' : ''} quarantined in the last 30 days.
          </p>
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value, sub }: { label: string; value: string | number; sub: string }) {
  return (
    <div className="bg-surface-1 border border-border rounded-lg px-4 py-3">
      <p className="text-[10px] text-text-tertiary uppercase tracking-wider">{label}</p>
      <p className="text-xl font-semibold text-text-primary mt-1 tabular-nums">{value}</p>
      <p className="text-[10px] text-text-tertiary mt-0.5">{sub}</p>
    </div>
  );
}

function ActionMetricCard({ metric }: { metric: any }) {
  return (
    <div className="bg-surface-1 border border-border rounded-lg px-4 py-3">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[12px] font-mono text-text-primary">{metric.actionClass}</span>
        <span className="text-[10px] text-text-tertiary">{metric.total} samples</span>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <MetricBar label="Success" value={metric.successRate} color="emerald" unit="%" />
        <MetricBar label="Override" value={metric.overrideRate} color="amber" unit="%" />
        <div>
          <p className="text-[10px] text-text-tertiary mb-1">MTTF</p>
          <p className="text-sm font-mono text-text-primary">
            {metric.mttfMs ? `${Math.round(metric.mttfMs / 1000)}s` : '—'}
          </p>
        </div>
        <div>
          <p className="text-[10px] text-text-tertiary mb-1">Risk</p>
          <div className="flex gap-1 mt-0.5">
            {metric.riskDistribution.low > 0 && (
              <span className="text-[9px] bg-emerald-500/15 text-emerald-400 px-1 rounded">L:{metric.riskDistribution.low}</span>
            )}
            {metric.riskDistribution.medium > 0 && (
              <span className="text-[9px] bg-amber-500/15 text-amber-400 px-1 rounded">M:{metric.riskDistribution.medium}</span>
            )}
            {metric.riskDistribution.high > 0 && (
              <span className="text-[9px] bg-orange-500/15 text-orange-400 px-1 rounded">H:{metric.riskDistribution.high}</span>
            )}
            {metric.riskDistribution.critical > 0 && (
              <span className="text-[9px] bg-red-500/15 text-red-400 px-1 rounded">C:{metric.riskDistribution.critical}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricBar({ label, value, color, unit }: { label: string; value: number; color: string; unit: string }) {
  const barColor = {
    emerald: 'bg-emerald-500',
    amber: 'bg-amber-500',
    red: 'bg-red-500',
  }[color] ?? 'bg-zinc-500';

  return (
    <div>
      <p className="text-[10px] text-text-tertiary mb-1">{label}</p>
      <p className="text-sm font-mono text-text-primary">{value}{unit}</p>
      <div className="w-full h-1 bg-surface-3 rounded-full mt-1">
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.min(value, 100)}%` }} />
      </div>
    </div>
  );
}

import { useQuery } from '@tanstack/react-query';
import { getStats } from '../../api/client.ts';

const COST_PER_ACTION = 0.002;

const PLAN_TIERS = [
  { name: 'Free Beta', limit: 5000, color: 'text-accent' },
  { name: 'Starter', limit: 25000, color: 'text-emerald-400' },
  { name: 'Team', limit: 100000, color: 'text-purple-400' },
];

export function UsagePage() {
  const { data: stats } = useQuery({ queryKey: ['stats'], queryFn: getStats, refetchInterval: 10_000 });

  const totalActions = stats?.totalToolCalls ?? 0;
  const allowed = stats?.byDecision?.ALLOW ?? 0;
  const approved = stats?.byDecision?.APPROVE ?? 0;
  const denied = stats?.byDecision?.DENY ?? 0;
  const estimatedCost = totalActions * COST_PER_ACTION;
  const currentPlan = PLAN_TIERS[0];
  const usagePercent = Math.min(100, (totalActions / currentPlan.limit) * 100);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-bold text-text-primary">Usage</h1>
        <p className="text-xs text-text-muted mt-0.5">Action counts, cost estimates, and plan limits</p>
      </div>

      {/* Plan badge + usage bar */}
      <div className="bg-surface-1 border border-border rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <span className={`text-sm font-semibold ${currentPlan.color}`}>{currentPlan.name}</span>
            <span className="text-xs text-text-tertiary">Current Plan</span>
          </div>
          <span className="text-xs text-text-tertiary">
            {totalActions.toLocaleString()} / {currentPlan.limit.toLocaleString()} actions
          </span>
        </div>
        <div className="w-full h-2 bg-surface-3 rounded-full overflow-hidden">
          <div
            className="h-full bg-accent rounded-full transition-all duration-500"
            style={{ width: `${usagePercent}%` }}
          />
        </div>
        <p className="text-[10px] text-text-muted mt-2">
          {usagePercent < 80
            ? `${(currentPlan.limit - totalActions).toLocaleString()} actions remaining this period`
            : usagePercent < 100
            ? 'Approaching plan limit'
            : 'Plan limit reached — actions will still be processed during beta'}
        </p>
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

      {/* Cost estimate */}
      <div className="bg-surface-1 border border-border rounded-xl p-5">
        <h2 className="text-sm font-semibold text-text-primary mb-3">Cost Estimate</h2>
        <div className="flex items-end justify-between">
          <div>
            <p className="text-3xl font-bold text-text-primary tabular-nums">
              ${estimatedCost.toFixed(2)}
            </p>
            <p className="text-[10px] text-text-muted mt-1">
              Based on {totalActions.toLocaleString()} actions × ${COST_PER_ACTION}/action
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-text-tertiary">No charges during beta</p>
            <p className="text-[10px] text-text-muted mt-0.5">This is a preview of what usage-based pricing could look like</p>
          </div>
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

      {/* Plan comparison */}
      <div className="bg-surface-1 border border-border rounded-xl p-5">
        <h2 className="text-sm font-semibold text-text-primary mb-3">Plans</h2>
        <div className="grid grid-cols-3 gap-3">
          {PLAN_TIERS.map((plan, i) => (
            <div
              key={plan.name}
              className={`border rounded-xl p-4 ${i === 0 ? 'border-accent/30 bg-accent/5' : 'border-border'}`}
            >
              <p className={`text-sm font-semibold ${plan.color} mb-1`}>{plan.name}</p>
              <p className="text-xs text-text-tertiary">{plan.limit.toLocaleString()} actions/mo</p>
              <p className="text-lg font-bold text-text-primary mt-2">
                {i === 0 ? '$0' : i === 1 ? '$49' : '$199'}
                <span className="text-xs text-text-muted font-normal">/mo</span>
              </p>
              {i === 0 && <p className="text-[10px] text-accent mt-1">Current plan</p>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

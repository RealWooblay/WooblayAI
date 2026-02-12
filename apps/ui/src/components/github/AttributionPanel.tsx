/**
 * Full attribution panel for a PR.
 *
 * Shows:
 * - Contribution bar (agent vs human LOC)
 * - Intervention score gauge
 * - Triggered intervention factors
 * - Key metrics (time to merge, reviews, CI)
 */

import { Card } from '../common/Card.tsx';
import { InterventionBadge } from './InterventionBadge.tsx';
import { ContributionBar } from './ContributionBar.tsx';

interface InterventionFactor {
  factor: string;
  triggered: boolean;
  detail: string;
}

interface AttributionPanelProps {
  agentLOC: number;
  humanLOC: number;
  agentCommitCount: number;
  humanCommitCount: number;
  interventionScore: number;
  interventionBreakdown: InterventionFactor[] | null;
  receiptCoverage: number | null;
  timeToMergeHours: number | null;
  reviewCycles: number;
  ciFailureCount: number;
}

const FACTOR_LABELS: Record<string, string> = {
  human_commits: 'Human Commits',
  human_loc_threshold: 'Human LOC Threshold',
  changes_requested: 'Changes Requested',
  ci_failures: 'CI Failures',
  reverted: 'PR Reverted',
};

export function AttributionPanel({
  agentLOC,
  humanLOC,
  agentCommitCount,
  humanCommitCount,
  interventionScore,
  interventionBreakdown,
  receiptCoverage,
  timeToMergeHours,
  reviewCycles,
  ciFailureCount,
}: AttributionPanelProps) {
  return (
    <div className="space-y-4">
      {/* Contribution breakdown */}
      <Card>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-200">Contribution Breakdown</h3>
            <InterventionBadge score={interventionScore} />
          </div>

          <ContributionBar agentLOC={agentLOC} humanLOC={humanLOC} />

          {/* Commit counts */}
          <div className="flex gap-6 text-xs text-gray-500">
            <span>
              <span className="text-cyan-400 font-medium">{agentCommitCount}</span> agent commits
            </span>
            <span>
              <span className="text-amber-400 font-medium">{humanCommitCount}</span> human commits
            </span>
          </div>
        </div>
      </Card>

      {/* Metrics */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard
          label="Time to Merge"
          value={timeToMergeHours !== null ? `${timeToMergeHours}h` : '—'}
        />
        <MetricCard
          label="Review Cycles"
          value={String(reviewCycles)}
        />
        <MetricCard
          label="CI Failures"
          value={String(ciFailureCount)}
          alert={ciFailureCount > 2}
        />
        <MetricCard
          label="Receipt Coverage"
          value={receiptCoverage !== null ? `${Math.round(receiptCoverage * 100)}%` : 'N/A'}
        />
      </div>

      {/* Intervention factors */}
      {interventionBreakdown && interventionBreakdown.length > 0 && (
        <Card>
          <h3 className="text-sm font-semibold text-gray-200 mb-3">Intervention Factors</h3>
          <div className="space-y-2">
            {interventionBreakdown.map((factor) => (
              <div
                key={factor.factor}
                className="flex items-start gap-3 text-xs"
              >
                <span
                  className={`mt-0.5 h-4 w-4 rounded flex items-center justify-center text-[10px] font-bold ${
                    factor.triggered
                      ? 'bg-red-950/70 text-red-400'
                      : 'bg-gray-800/70 text-gray-600'
                  }`}
                >
                  {factor.triggered ? '!' : '—'}
                </span>
                <div>
                  <span className={factor.triggered ? 'text-gray-200 font-medium' : 'text-gray-500'}>
                    {FACTOR_LABELS[factor.factor] ?? factor.factor}
                  </span>
                  <p className="text-gray-500 mt-0.5">{factor.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

// ── Metric card sub-component ────────────────────────────────────────────────

function MetricCard({
  label,
  value,
  alert,
}: {
  label: string;
  value: string;
  alert?: boolean;
}) {
  return (
    <Card className="!p-3 text-center">
      <p className="text-[11px] text-gray-500 uppercase tracking-wider">{label}</p>
      <p
        className={`mt-1 text-lg font-bold ${
          alert ? 'text-red-400' : 'text-gray-100'
        }`}
      >
        {value}
      </p>
    </Card>
  );
}

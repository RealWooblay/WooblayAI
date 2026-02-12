/**
 * GitHub Attribution Dashboard — main page.
 *
 * Tabs:
 *   - Overview: Key metrics, intervention trend, agent leaderboard
 *   - PRs: Filterable list of agent PRs
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { useGitHubPRs } from '../../api/hooks/useGitHub.ts';
import { Card } from '../../components/common/Card.tsx';
import { Badge } from '../../components/common/Badge.tsx';
import { Button } from '../../components/common/Button.tsx';
import { InterventionBadge } from '../../components/github/InterventionBadge.tsx';
import { ContributionBar } from '../../components/github/ContributionBar.tsx';

// ── Types ────────────────────────────────────────────────────────────────────

type Tab = 'overview' | 'prs';

const STATES = ['ALL', 'open', 'merged', 'closed'] as const;

// ── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function truncatePubkey(s: string): string {
  if (s.length <= 12) return s;
  return s.slice(0, 6) + '...' + s.slice(-4);
}

// ── Filter dropdown ──────────────────────────────────────────────────────────

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-gray-400">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-gray-200 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o === 'ALL' ? 'All States' : o}
          </option>
        ))}
      </select>
    </label>
  );
}

// ── Pagination ───────────────────────────────────────────────────────────────

function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (p: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-between pt-4">
      <span className="text-xs text-gray-500">
        Page {page} of {totalPages} &middot; {total} total
      </span>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          Previous
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}

// ── Overview Tab ─────────────────────────────────────────────────────────────

function OverviewTab() {
  const { data, isLoading } = useGitHubPRs({ pageSize: 5 });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-gray-500">
        Loading GitHub data...
      </div>
    );
  }

  const prs = data?.data ?? [];
  const total = data?.total ?? 0;

  // Compute overview metrics from available data
  const withAttribution = prs.filter((p) => p.attribution);
  const avgScore =
    withAttribution.length > 0
      ? Math.round(
          (withAttribution.reduce((s, p) => s + (p.attribution?.interventionScore ?? 0), 0) /
            withAttribution.length) * 10,
        ) / 10
      : 0;
  const interventionRate =
    withAttribution.length > 0
      ? Math.round(
          (withAttribution.filter((p) => (p.attribution?.interventionScore ?? 0) > 0).length /
            withAttribution.length) * 100,
        )
      : 0;

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card className="!p-4 text-center">
          <p className="text-[11px] text-gray-500 uppercase tracking-wider">Total Agent PRs</p>
          <p className="mt-1 text-2xl font-bold text-gray-100">{total}</p>
        </Card>
        <Card className="!p-4 text-center">
          <p className="text-[11px] text-gray-500 uppercase tracking-wider">Avg Intervention</p>
          <p className="mt-1 text-2xl font-bold text-gray-100">{avgScore}/5</p>
        </Card>
        <Card className="!p-4 text-center">
          <p className="text-[11px] text-gray-500 uppercase tracking-wider">Intervention Rate</p>
          <p className="mt-1 text-2xl font-bold text-gray-100">{interventionRate}%</p>
        </Card>
        <Card className="!p-4 text-center">
          <p className="text-[11px] text-gray-500 uppercase tracking-wider">Recent PRs</p>
          <p className="mt-1 text-2xl font-bold text-gray-100">{prs.length}</p>
        </Card>
      </div>

      {/* Recent PRs preview */}
      <div>
        <h3 className="text-sm font-semibold text-gray-300 mb-3">Recent Agent PRs</h3>
        {prs.length === 0 ? (
          <Card className="py-8 text-center text-gray-500">
            No agent PRs tracked yet. Install the Wooblay GitHub App to get started.
          </Card>
        ) : (
          <div className="space-y-2">
            {prs.map((pr) => (
              <PRCard key={pr.id} pr={pr} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── PRs Tab ──────────────────────────────────────────────────────────────────

function PRsTab() {
  const [state, setState] = useState('ALL');
  const [highIntervention, setHighIntervention] = useState(false);
  const [page, setPage] = useState(1);

  const filters = {
    page,
    pageSize: 20,
    ...(state !== 'ALL' && { state }),
    ...(highIntervention && { minIntervention: 3 }),
  };

  const { data, isLoading, error } = useGitHubPRs(filters);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-gray-500">
        Loading PRs...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-20 text-red-400">
        Error: {(error as Error).message}
      </div>
    );
  }

  const prs = data?.data ?? [];

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <FilterSelect
          label="State"
          value={state}
          options={STATES}
          onChange={(v) => {
            setState(v);
            setPage(1);
          }}
        />
        <label className="flex items-center gap-1.5 text-xs text-gray-400">
          <input
            type="checkbox"
            checked={highIntervention}
            onChange={(e) => {
              setHighIntervention(e.target.checked);
              setPage(1);
            }}
            className="rounded border-gray-600 bg-gray-800 text-indigo-500 focus:ring-indigo-500 focus:ring-offset-gray-950"
          />
          High intervention only (3+)
        </label>
      </div>

      {/* PR list */}
      {prs.length === 0 ? (
        <Card className="py-12 text-center text-gray-500">
          No PRs match the current filters.
        </Card>
      ) : (
        <div className="space-y-2">
          {prs.map((pr) => (
            <PRCard key={pr.id} pr={pr} />
          ))}
        </div>
      )}

      <Pagination
        page={page}
        pageSize={data?.pageSize ?? 20}
        total={data?.total ?? 0}
        onPageChange={setPage}
      />
    </div>
  );
}

// ── PR Card ──────────────────────────────────────────────────────────────────

function PRCard({
  pr,
}: {
  pr: {
    id: string;
    repoId: string;
    repoFullName: string;
    number: number;
    title: string;
    state: string;
    authorLogin: string;
    agentPubkey: string | null;
    detectionMode: string | null;
    createdAt: string;
    mergedAt: string | null;
    attribution: {
      agentLOC: number;
      humanLOC: number;
      interventionScore: number;
    } | null;
  };
}) {
  const stateVariant =
    pr.state === 'merged' ? 'green' : pr.state === 'closed' ? 'red' : 'cyan';

  return (
    <Link to={`/github/repos/${pr.repoId}/prs/${pr.number}`}>
      <Card hover className="space-y-3">
        {/* Row 1: Title + badges */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <span className="text-xs text-gray-500 font-mono">{pr.repoFullName}#{pr.number}</span>
            <p className="text-sm font-medium text-gray-100 leading-snug truncate">{pr.title}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Badge variant={stateVariant}>{pr.state}</Badge>
            {pr.attribution && (
              <InterventionBadge score={pr.attribution.interventionScore} showLabel={false} />
            )}
          </div>
        </div>

        {/* Row 2: Contribution bar (if attribution exists) */}
        {pr.attribution && (
          <ContributionBar
            agentLOC={pr.attribution.agentLOC}
            humanLOC={pr.attribution.humanLOC}
            showLabels={false}
          />
        )}

        {/* Row 3: Metadata */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
          <span>by {pr.authorLogin}</span>
          {pr.agentPubkey && (
            <span className="font-mono text-gray-600">
              {truncatePubkey(pr.agentPubkey)}
            </span>
          )}
          {pr.detectionMode && (
            <Badge variant="gray">{pr.detectionMode}</Badge>
          )}
          <span title={new Date(pr.createdAt).toLocaleString()} className="cursor-help">
            {relativeTime(pr.createdAt)}
          </span>
        </div>
      </Card>
    </Link>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export function GitHubPage() {
  const [activeTab, setActiveTab] = useState<Tab>('overview');

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-gray-100">GitHub Attribution</h1>
        <p className="mt-1 text-sm text-gray-500">
          Track agent vs human contributions, intervention rates, and receipt coverage across PRs.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-800">
        {([
          { id: 'overview' as Tab, label: 'Overview' },
          { id: 'prs' as Tab, label: 'Pull Requests' },
        ]).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={clsx(
              'px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px',
              activeTab === tab.id
                ? 'border-indigo-500 text-indigo-300'
                : 'border-transparent text-gray-500 hover:text-gray-300 hover:border-gray-600',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'overview' ? <OverviewTab /> : <PRsTab />}
    </div>
  );
}

import { useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import {
  useAuditLog,
  useAuditFlags,
  useDismissFlag,
  useRunAnalysis,
} from '../../api/hooks/useAudit.ts';
import type { AuditLogFilters, AuditFlagFilters } from '../../api/client.ts';
import { Badge, riskTierVariant, statusVariant, adapterVariant, adapterLabel } from '../../components/common/Badge.tsx';
import { Button } from '../../components/common/Button.tsx';
import { Card } from '../../components/common/Card.tsx';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
  return s.slice(0, 6) + '…' + s.slice(-4);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function decisionFromEntry(entry: any): string {
  const approval = entry.approval as Record<string, unknown> | undefined;
  const receipt = entry.receipt as Record<string, unknown> | null | undefined;
  if (approval?.status && approval.status !== 'PENDING') return String(approval.status);
  if (receipt?.policyDecision) return String(receipt.policyDecision);
  return 'PENDING';
}

// ---------------------------------------------------------------------------
// Category display helpers
// ---------------------------------------------------------------------------

const CATEGORY_DISPLAY: Record<string, { icon: string; label: string }> = {
  velocity_anomaly: { icon: '⚡', label: 'Velocity Anomaly' },
  evasion_pattern: { icon: '🔄', label: 'Evasion Pattern' },
  sensitive_access: { icon: '🔐', label: 'Sensitive Access' },
  privilege_escalation: { icon: '⚠️', label: 'Privilege Escalation' },
  unusual_pattern: { icon: '📊', label: 'Unusual Pattern' },
};

function categoryDisplay(cat: string) {
  return CATEGORY_DISPLAY[cat] ?? { icon: '🔍', label: cat };
}

function severityVariant(sev: string): 'red' | 'yellow' | 'blue' | 'gray' {
  switch (sev.toUpperCase()) {
    case 'CRITICAL':
    case 'HIGH':
      return 'red';
    case 'MEDIUM':
      return 'yellow';
    case 'LOW':
      return 'blue';
    default:
      return 'gray';
  }
}

const RISK_TIERS = ['ALL', 'READ', 'WRITE', 'DESTRUCTIVE'] as const;
const DECISIONS = ['ALL', 'EXECUTE', 'DENY', 'PENDING_APPROVAL'] as const;
const SEVERITIES = ['ALL', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'] as const;
const CATEGORIES = [
  'ALL',
  'velocity_anomaly',
  'evasion_pattern',
  'sensitive_access',
  'privilege_escalation',
  'unusual_pattern',
] as const;

// ---------------------------------------------------------------------------
// Shared dropdown component
// ---------------------------------------------------------------------------

function FilterSelect({
  label,
  value,
  options,
  onChange,
  renderOption,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
  renderOption?: (o: string) => string;
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
            {renderOption ? renderOption(o) : o}
          </option>
        ))}
      </select>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Audit Log Tab
// ---------------------------------------------------------------------------

function AuditLogTab() {
  const [riskTier, setRiskTier] = useState('ALL');
  const [decision, setDecision] = useState('ALL');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const filters: AuditLogFilters = {
    page,
    pageSize: 20,
    ...(riskTier !== 'ALL' && { riskTier }),
    ...(decision !== 'ALL' && { decision }),
    ...(search.trim() && { search: search.trim() }),
  };

  const { data, isLoading, error } = useAuditLog(filters);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-gray-500">
        Loading audit log…
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

  const entries = data?.data ?? [];

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        <FilterSelect
          label="Risk"
          value={riskTier}
          options={RISK_TIERS}
          onChange={(v) => { setRiskTier(v); setPage(1); }}
        />
        <FilterSelect
          label="Decision"
          value={decision}
          options={DECISIONS}
          onChange={(v) => { setDecision(v); setPage(1); }}
        />
        <input
          type="text"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder="Search agent name…"
          className="rounded-md border border-gray-700 bg-gray-800 px-3 py-1.5 text-xs text-gray-200 placeholder-gray-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 w-48"
        />
      </div>

      {/* Entries */}
      {entries.length === 0 ? (
        <Card className="py-12 text-center text-gray-500">
          No audit entries found.
        </Card>
      ) : (
        <div className="space-y-2">
          {entries.map((entry) => {
            const entryDecision = decisionFromEntry(entry);
            const receiptHash =
              entry.receipt && 'hash' in entry.receipt
                ? (entry.receipt as { hash?: string }).hash
                : undefined;

            return (
              <Card key={entry.toolCall.id} className="space-y-2">
                {/* Row 1: Description + badges */}
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-medium text-gray-100 leading-snug">
                    {entry.humanDescription}
                  </p>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant={riskTierVariant(entry.toolCall.riskTier)}>
                      {entry.toolCall.riskTier}
                    </Badge>
                    <Badge variant={statusVariant(entryDecision)}>
                      {entryDecision}
                    </Badge>
                    {entry.toolCall.adapter && (
                      <Badge variant={adapterVariant(entry.toolCall.adapter)}>
                        {adapterLabel(entry.toolCall.adapter)}
                      </Badge>
                    )}
                  </div>
                </div>

                {/* Row 2: Risk explanation */}
                <p className="text-xs text-gray-400 leading-relaxed">
                  {entry.riskExplanation}
                </p>

                {/* Row 3: Metadata */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
                  <span className="flex items-center gap-1">
                    <span className="text-gray-600">Agent:</span>
                    <span className="text-gray-300">{entry.agentName}</span>
                    <span className="font-mono text-gray-600">
                      {truncatePubkey(entry.toolCall.agentPubkey)}
                    </span>
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="text-gray-600">Tool:</span>
                    <span className="font-mono text-gray-400">{entry.toolCall.toolName}</span>
                  </span>
                  <span
                    title={new Date(entry.toolCall.createdAt).toLocaleString()}
                    className="cursor-help"
                  >
                    {relativeTime(entry.toolCall.createdAt)}
                  </span>
                  {receiptHash && (
                    <Link
                      to={`/receipts/${receiptHash}`}
                      className="text-indigo-400 hover:text-indigo-300 transition-colors"
                    >
                      View Receipt →
                    </Link>
                  )}
                </div>
              </Card>
            );
          })}
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

// ---------------------------------------------------------------------------
// Flags Tab
// ---------------------------------------------------------------------------

function FlagsTab() {
  const [severity, setSeverity] = useState('ALL');
  const [category, setCategory] = useState('ALL');
  const [showDismissed, setShowDismissed] = useState(false);
  const [page, setPage] = useState(1);
  const [analysisResult, setAnalysisResult] = useState<number | null>(null);

  const dismiss = useDismissFlag();
  const analyze = useRunAnalysis();

  const filters: AuditFlagFilters = {
    page,
    pageSize: 20,
    ...(severity !== 'ALL' && { severity }),
    ...(category !== 'ALL' && { category }),
    dismissed: showDismissed ? undefined : false,
  };

  const { data, isLoading, error } = useAuditFlags(filters);

  const handleRunAnalysis = useCallback(() => {
    analyze.mutate(undefined, {
      onSuccess: (result) => {
        setAnalysisResult(result.flagsCreated);
        setTimeout(() => setAnalysisResult(null), 5000);
      },
    });
  }, [analyze]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-gray-500">
        Loading flags…
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

  const flags = data?.data ?? [];

  return (
    <div className="space-y-4">
      {/* Filter bar + actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <FilterSelect
            label="Severity"
            value={severity}
            options={SEVERITIES}
            onChange={(v) => { setSeverity(v); setPage(1); }}
          />
          <FilterSelect
            label="Category"
            value={category}
            options={CATEGORIES}
            onChange={(v) => { setCategory(v); setPage(1); }}
            renderOption={(o) => (o === 'ALL' ? 'ALL' : categoryDisplay(o).label)}
          />
          <label className="flex items-center gap-1.5 text-xs text-gray-400">
            <input
              type="checkbox"
              checked={showDismissed}
              onChange={(e) => { setShowDismissed(e.target.checked); setPage(1); }}
              className="rounded border-gray-600 bg-gray-800 text-indigo-500 focus:ring-indigo-500 focus:ring-offset-gray-950"
            />
            Show dismissed
          </label>
        </div>

        <div className="flex items-center gap-3">
          {analysisResult !== null && (
            <span className="text-xs text-emerald-400 animate-pulse">
              {analysisResult} flag{analysisResult !== 1 ? 's' : ''} created
            </span>
          )}
          <Button
            size="sm"
            variant="secondary"
            onClick={handleRunAnalysis}
            disabled={analyze.isPending}
          >
            {analyze.isPending ? 'Analyzing…' : 'Run Analysis'}
          </Button>
        </div>
      </div>

      {/* Flags list */}
      {flags.length === 0 ? (
        <Card className="py-12 text-center text-gray-500">
          No flags found. The system is clean.
        </Card>
      ) : (
        <div className="space-y-2">
          {flags.map((flag) => {
            const cat = categoryDisplay(flag.category);
            const isCritical = flag.severity.toUpperCase() === 'CRITICAL';

            return (
              <Card
                key={flag.id}
                className={clsx(
                  'space-y-2 transition-all',
                  isCritical && 'border-l-2 border-l-red-500 shadow-[inset_0_0_20px_rgba(239,68,68,0.05)]',
                  flag.dismissed && 'opacity-60',
                )}
              >
                {/* Row 1: Severity + category + title */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <Badge
                      variant={severityVariant(flag.severity)}
                      className={clsx(isCritical && 'animate-pulse')}
                    >
                      {flag.severity.toUpperCase()}
                    </Badge>
                    <span className="text-sm text-gray-400">
                      {cat.icon} {cat.label}
                    </span>
                    <span className="text-sm font-semibold text-gray-100 truncate">
                      {flag.title}
                    </span>
                  </div>
                  {!flag.dismissed && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => dismiss.mutate(flag.id)}
                      disabled={dismiss.isPending}
                    >
                      Dismiss
                    </Button>
                  )}
                </div>

                {/* Row 2: Description */}
                <p className="text-xs text-gray-400 leading-relaxed">
                  {flag.description}
                </p>

                {/* Row 3: Metadata */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
                  {flag.agentPubkey && (
                    <span>
                      <span className="text-gray-600">Agent:</span>{' '}
                      <span className="font-mono text-gray-400">
                        {truncatePubkey(flag.agentPubkey)}
                      </span>
                    </span>
                  )}
                  <span
                    title={new Date(flag.createdAt).toLocaleString()}
                    className="cursor-help"
                  >
                    {relativeTime(flag.createdAt)}
                  </span>
                  {flag.dismissed && (
                    <Badge variant="gray">Dismissed</Badge>
                  )}
                </div>
              </Card>
            );
          })}
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

// ---------------------------------------------------------------------------
// Main AuditPage
// ---------------------------------------------------------------------------

type Tab = 'log' | 'flags';

export function AuditPage() {
  const [activeTab, setActiveTab] = useState<Tab>('log');

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-gray-100">Audit</h1>
        <p className="mt-1 text-sm text-gray-500">
          Complete history of every action supervised by Wooblay, plus auto-detected anomalies.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-800">
        {([
          { id: 'log' as Tab, label: 'Audit Log' },
          { id: 'flags' as Tab, label: 'Flags' },
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
      {activeTab === 'log' ? <AuditLogTab /> : <FlagsTab />}
    </div>
  );
}

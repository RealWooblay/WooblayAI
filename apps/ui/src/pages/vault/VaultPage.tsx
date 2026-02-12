/**
 * Receipts Vault — browse and search cryptographic receipt chain.
 * Uses the audit log API which includes receipt data on entries.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { useQuery } from '@tanstack/react-query';
import { getAuditLog } from '../../api/client.ts';
import type { AuditLogFilters, AuditEntry } from '../../api/client.ts';
import { Badge, riskTierVariant, statusVariant } from '../../components/common/Badge.tsx';
import { Button } from '../../components/common/Button.tsx';

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
  return `${Math.floor(hrs / 24)}d ago`;
}

function truncatePubkey(s: string): string {
  if (s.length <= 12) return s;
  return s.slice(0, 6) + '…' + s.slice(-4);
}

function truncateHash(s: string, len = 16): string {
  if (s.length <= len) return s;
  return s.slice(0, len) + '…';
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function VaultPage() {
  const [search, setSearch] = useState('');
  const [riskTier, setRiskTier] = useState('ALL');
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);

  const filters: AuditLogFilters = {
    page,
    pageSize: 30,
    ...(riskTier !== 'ALL' && { riskTier }),
    ...(search.trim() && { search: search.trim() }),
  };

  const { data, isLoading } = useQuery({
    queryKey: ['audit-log-receipts', filters],
    queryFn: () => getAuditLog(filters),
    refetchInterval: 15_000,
  });

  const entries = data?.data ?? [];
  // Only show entries that have receipts
  const withReceipts = entries.filter((e) => e.receipt);
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / 30));

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div>
        <h1 className="text-lg font-bold text-text-primary">Receipt Vault</h1>
        <p className="text-xs text-text-tertiary mt-0.5">
          Cryptographically signed, hash-chained audit receipts for every supervised action.
        </p>
      </div>

      {/* Search + filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search by agent name, tool name..."
            className="w-full rounded-lg border border-border bg-surface-1 pl-9 pr-4 py-2.5 text-xs text-text-primary placeholder-text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
        <select
          value={riskTier}
          onChange={(e) => { setRiskTier(e.target.value); setPage(1); }}
          className="rounded-lg border border-border bg-surface-1 px-3 py-2.5 text-xs text-text-primary focus:border-accent focus:outline-none"
        >
          <option value="ALL">All Risk Tiers</option>
          <option value="READ">READ</option>
          <option value="WRITE">WRITE</option>
          <option value="DESTRUCTIVE">DESTRUCTIVE</option>
        </select>
        <span className="text-[10px] text-text-muted tabular-nums">
          {data?.total ?? '...'} receipts
        </span>
      </div>

      {/* Receipt chain visualization */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-border bg-surface-1 p-4 animate-pulse">
              <div className="h-3 w-1/3 bg-surface-3 rounded" />
              <div className="h-2 w-2/3 bg-surface-3 rounded mt-2" />
            </div>
          ))}
        </div>
      ) : withReceipts.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface-1 py-16 text-center">
          <div className="text-3xl opacity-20 mb-3">🧾</div>
          <p className="text-text-secondary text-sm">No receipts found</p>
          <p className="text-text-muted text-xs mt-1">
            {entries.length > 0 ? 'Try adjusting your filters' : 'Receipts appear when agents execute supervised actions'}
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {withReceipts.map((entry, idx) => (
            <ReceiptRow
              key={entry.toolCall.id}
              entry={entry}
              index={idx}
              isExpanded={expanded === entry.toolCall.id}
              onToggle={() =>
                setExpanded(expanded === entry.toolCall.id ? null : entry.toolCall.id)
              }
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <span className="text-[10px] text-text-muted">
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            <Button
              size="xs"
              variant="secondary"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              Previous
            </Button>
            <Button
              size="xs"
              variant="secondary"
              disabled={page >= totalPages}
              onClick={() => setPage(page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Receipt Row
// ---------------------------------------------------------------------------

function ReceiptRow({
  entry,
  index,
  isExpanded,
  onToggle,
}: {
  entry: AuditEntry;
  index: number;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const receipt = entry.receipt as unknown as Record<string, unknown> | null;
  if (!receipt) return null;

  const hash = String(receipt.hash ?? '');
  const signature = String(receipt.signature ?? '');
  const chainPrev = receipt.chainPrev ? String(receipt.chainPrev) : null;
  const policyDecision = String(receipt.policyDecision ?? '');
  const approvalDecision = receipt.approvalDecision ? String(receipt.approvalDecision) : null;

  return (
    <div
      className={clsx(
        'rounded-lg border transition-all',
        isExpanded
          ? 'border-accent/30 bg-surface-1 glow-accent'
          : 'border-border bg-surface-1 hover:border-border-strong',
      )}
    >
      {/* Main row */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-4 p-4 text-left cursor-pointer bg-transparent border-none"
      >
        {/* Chain connector */}
        <div className="flex flex-col items-center gap-0.5 shrink-0 w-6">
          <div
            className={clsx(
              'h-6 w-6 rounded-full flex items-center justify-center text-[9px] font-bold',
              policyDecision === 'DENY'
                ? 'bg-red-500/10 text-red-400 ring-1 ring-red-500/20'
                : 'bg-purple-500/10 text-purple-400 ring-1 ring-purple-500/20',
            )}
          >
            {index + 1}
          </div>
          {chainPrev && (
            <div className="w-px h-3 bg-border" />
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-mono font-semibold text-text-primary">
              {truncateHash(hash)}
            </span>
            <Badge variant={riskTierVariant(entry.toolCall.riskTier)}>
              {entry.toolCall.riskTier}
            </Badge>
            <Badge variant={statusVariant(policyDecision)}>
              {policyDecision}
            </Badge>
            {approvalDecision && (
              <Badge variant={statusVariant(approvalDecision)}>
                {approvalDecision}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1 text-[10px] text-text-muted">
            <span className="font-mono">{entry.toolCall.toolName}</span>
            <span className="text-text-tertiary">·</span>
            <span>{entry.agentName} ({truncatePubkey(entry.toolCall.agentPubkey)})</span>
            <span className="text-text-tertiary">·</span>
            <span>{relativeTime(entry.toolCall.createdAt)}</span>
          </div>
        </div>

        {/* Verified badge */}
        <div className="flex items-center gap-2 shrink-0">
          <Badge variant="green">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
              <path d="m5 12 5 5L20 7" />
            </svg>
            Signed
          </Badge>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className={clsx('text-text-muted transition-transform', isExpanded && 'rotate-180')}
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </div>
      </button>

      {/* Expanded details */}
      {isExpanded && (
        <div className="px-4 pb-4 space-y-3 animate-slide-up">
          <div className="border-t border-border pt-3" />

          {/* Description */}
          <p className="text-xs text-text-secondary leading-relaxed">
            {entry.humanDescription}
          </p>

          {/* Signature */}
          <div className="rounded-lg border border-border bg-surface-0 p-3 space-y-2">
            <h5 className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wider">
              Cryptographic Proof
            </h5>
            <div>
              <span className="text-[10px] text-text-muted">Hash (SHA-256):</span>
              <p className="text-[10px] font-mono text-accent-bright break-all mt-0.5">{hash}</p>
            </div>
            <div>
              <span className="text-[10px] text-text-muted">Ed25519 Signature:</span>
              <p className="text-[10px] font-mono text-text-tertiary break-all mt-0.5">{truncateHash(signature, 64)}</p>
            </div>
            <div>
              <span className="text-[10px] text-text-muted">Chain Previous:</span>
              {chainPrev ? (
                <p className="text-[10px] font-mono text-purple-400 break-all mt-0.5">{chainPrev}</p>
              ) : (
                <p className="text-[10px] text-text-muted mt-0.5">Genesis receipt (chain root)</p>
              )}
            </div>
          </div>

          {/* Risk explanation */}
          {entry.riskExplanation && (
            <div className="rounded-lg border border-border bg-surface-0 p-3">
              <h5 className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wider mb-1">
                Risk Assessment
              </h5>
              <p className="text-[11px] text-text-secondary leading-relaxed">
                {entry.riskExplanation}
              </p>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1">
            <Link to={`/receipts/${hash}`}>
              <Button size="xs" variant="secondary">
                Verify Receipt →
              </Button>
            </Link>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => void navigator.clipboard.writeText(hash)}
            >
              Copy Hash
            </Button>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => void navigator.clipboard.writeText(JSON.stringify(receipt, null, 2))}
            >
              Copy JSON
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

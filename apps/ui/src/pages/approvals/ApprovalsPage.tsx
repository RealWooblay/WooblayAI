/**
 * Approvals — the core product page.
 * Full-width cards showing exactly what the agent wants to do.
 * Keyboard: j/k navigate, a approve, d deny.
 */

import { useState, useEffect, useCallback } from 'react';
import clsx from 'clsx';
import {
  useApprovals,
  useApproveApproval,
  useDenyApproval,
} from '../../api/hooks/useApprovals.ts';
import { Badge, riskTierVariant } from '../../components/common/Badge.tsx';
import { Button } from '../../components/common/Button.tsx';
import { humanReadableAction } from '../../components/common/ActionSummary.tsx';
import { useToast } from '../../components/common/Toast.tsx';
import { Tooltip } from '../../components/common/Tooltip.tsx';
import { createPolicy } from '../../api/client.ts';
import { useMutation, useQueryClient } from '@tanstack/react-query';

function timeRemaining(createdAt: string, ttlSeconds: number): string {
  const elapsed = (Date.now() - new Date(createdAt).getTime()) / 1000;
  const remaining = ttlSeconds - elapsed;
  if (remaining <= 0) return 'Expired';
  if (remaining < 60) return `${Math.floor(remaining)}s left`;
  if (remaining < 3600) return `${Math.floor(remaining / 60)}m left`;
  return `${Math.floor(remaining / 3600)}h left`;
}

export function ApprovalsPage() {
  const { data: approvals, isLoading } = useApprovals();
  const approveMut = useApproveApproval();
  const denyMut = useDenyApproval();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [selectedIdx, setSelectedIdx] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const alwaysAllowMut = useMutation({
    mutationFn: (item: any) => {
      const tc = item.toolCall;
      const toolName = tc?.toolName?.replace(/^(wooblay_|gated_)/, '') ?? '*';
      return createPolicy({
        matchTool: toolName,
        riskTier: tc?.riskTier ?? 'WRITE',
        decision: 'ALLOW',
        source: 'from-approval',
        description: `Auto-allow ${toolName} (from approval)`,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['policies'] });
      toast('Policy created — future similar actions will be auto-approved', 'success');
    },
  });

  const items = approvals ?? [];

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!items.length) return;
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIdx((i) => Math.min(i + 1, items.length - 1));
      }
      if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(i - 1, 0));
      }
      if (e.key === 'a' && !e.metaKey && !e.ctrlKey) {
        const item = items[selectedIdx];
        if (item) {
          approveMut.mutate(
            { id: item.id, body: { approver: 'dashboard' } },
            { onSuccess: () => toast('Approved', 'success') },
          );
        }
      }
      if (e.key === 'd' && !e.metaKey && !e.ctrlKey) {
        const item = items[selectedIdx];
        if (item) {
          denyMut.mutate(
            { id: item.id, body: { approver: 'dashboard', reason: 'Denied from dashboard' } },
            { onSuccess: () => toast('Denied', 'info') },
          );
        }
      }
    },
    [items, selectedIdx, approveMut, denyMut, toast],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    if (selectedIdx >= items.length) setSelectedIdx(Math.max(0, items.length - 1));
  }, [items.length, selectedIdx]);

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-bold text-text-primary">Approvals</h1>
          <p className="text-xs text-text-muted mt-1">
            {items.length} pending
            {items.length > 0 && (
              <> · <span className="font-mono">j/k</span> navigate · <span className="font-mono">a</span> approve · <span className="font-mono">d</span> deny</>
            )}
          </p>
        </div>
        {items.length > 1 && (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => {
                items.forEach((item) =>
                  approveMut.mutate({ id: item.id, body: { approver: 'dashboard' } }),
                );
                toast(`Approved ${items.length} actions`, 'success');
              }}
            >
              Approve All ({items.length})
            </Button>
          </div>
        )}
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="text-sm text-text-muted py-12 text-center">Loading...</div>
      )}

      {/* Empty */}
      {!isLoading && items.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="text-3xl mb-3 opacity-20">✓</div>
          <p className="text-sm font-medium text-text-secondary">All clear</p>
          <p className="text-xs text-text-muted mt-1">No actions waiting for approval</p>
        </div>
      )}

      {/* Cards */}
      <div className="space-y-3">
        {items.map((item, idx) => {
          const tc = item.toolCall;
          const isSelected = idx === selectedIdx;
          const isExpanded = expandedId === item.id;
          const action = humanReadableAction(tc?.toolName ?? '', tc?.args);

          return (
            <div
              key={item.id}
              className={clsx(
                'rounded-xl border p-5 transition-all',
                isSelected
                  ? 'border-accent/30 bg-surface-1 glow-accent'
                  : 'border-border bg-surface-0 hover:border-border-strong',
              )}
              onClick={() => setSelectedIdx(idx)}
            >
              {/* Risk + Category + Tool */}
              <div className="flex items-center gap-2 mb-2">
                <Badge variant={riskTierVariant(tc?.riskTier ?? 'READ')}>
                  {tc?.riskTier ?? 'READ'}
                </Badge>
                <Tooltip content={`Risk tier: ${tc?.riskTier ?? 'READ'} — determines approval requirements`}>
                  <span className="text-[11px] text-text-muted font-medium uppercase tracking-wider">
                    {tc?.toolName}
                  </span>
                </Tooltip>
                <span className="ml-auto text-[11px] text-text-muted">
                  {item.ttlSeconds ? timeRemaining(item.createdAt, item.ttlSeconds) : ''}
                </span>
              </div>

              {/* Human-readable description */}
              {item.humanDescription && (
                <p className="text-sm text-text-primary font-medium mb-1">
                  {item.humanDescription}
                </p>
              )}

              {/* Hero action — raw command */}
              <code className="text-xs font-mono text-text-secondary block mb-2 leading-relaxed opacity-70">
                {action}
              </code>

              {/* Why flagged */}
              {(item as any).whyFlagged && (
                <div className="bg-amber-500/5 border border-amber-500/15 rounded-lg px-3 py-2 mb-3">
                  <p className="text-xs text-amber-300">
                    <span className="font-medium">Why this needs approval:</span> {(item as any).whyFlagged}
                  </p>
                </div>
              )}

              {/* Risk explanation */}
              {item.riskExplanation && (
                <p className="text-[11px] text-text-muted mb-3">
                  {item.riskExplanation}
                </p>
              )}

              {/* Agent name */}
              <p className="text-xs text-text-muted mb-4">
                Agent: {tc?.agentPubkey ? tc.agentPubkey.slice(0, 12) + '...' : 'Unknown'}
                {tc?.taskId && <> · Task: {tc.taskId}</>}
              </p>

              {/* Action buttons */}
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    approveMut.mutate(
                      { id: item.id, body: { approver: 'dashboard' } },
                      { onSuccess: () => toast('Approved', 'success') },
                    );
                  }}
                  disabled={approveMut.isPending}
                >
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={(e) => {
                    e.stopPropagation();
                    denyMut.mutate(
                      { id: item.id, body: { approver: 'dashboard', reason: 'Denied' } },
                      { onSuccess: () => toast('Denied', 'info') },
                    );
                  }}
                  disabled={denyMut.isPending}
                >
                  Deny
                </Button>
                <Tooltip content="Approve this and automatically allow all future similar actions">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      approveMut.mutate(
                        { id: item.id, body: { approver: 'dashboard' } },
                        {
                          onSuccess: () => {
                            toast('Approved + policy created', 'success');
                            alwaysAllowMut.mutate(item);
                          },
                        },
                      );
                    }}
                    disabled={alwaysAllowMut.isPending}
                    className="px-3 py-1 text-[10px] bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/20 rounded-lg transition-colors"
                  >
                    Always Allow Similar
                  </button>
                </Tooltip>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setExpandedId(isExpanded ? null : item.id);
                  }}
                  className="text-xs text-text-muted hover:text-text-secondary ml-2 transition-colors"
                >
                  {isExpanded ? 'Hide details' : 'Details'}
                </button>
              </div>

              {/* Expanded details */}
              {isExpanded && (
                <div className="mt-4 pt-4 border-t border-border space-y-3 animate-slide-in-up">
                  <div>
                    <h4 className="text-[10px] text-text-muted uppercase tracking-wider mb-1">Full Arguments</h4>
                    <pre className="text-[11px] font-mono text-text-secondary bg-surface-0 rounded-lg p-3 overflow-x-auto max-h-40">
                      {typeof tc?.args === 'string' ? tc.args : JSON.stringify(tc?.args, null, 2)}
                    </pre>
                  </div>
                  {item.riskExplanation && (
                    <div>
                      <h4 className="text-[10px] text-text-muted uppercase tracking-wider mb-1">Risk Explanation</h4>
                      <p className="text-xs text-text-secondary">{item.riskExplanation}</p>
                    </div>
                  )}
                  <div className="flex gap-6 text-[11px] text-text-muted">
                    <span>Created: {new Date(item.createdAt).toLocaleString()}</span>
                    {item.ttlSeconds && <span>TTL: {item.ttlSeconds}s</span>}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

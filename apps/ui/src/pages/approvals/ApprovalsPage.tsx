/**
 * Approvals — the core product page.
 * Full-width cards showing exactly what the agent wants to do.
 * Keyboard: j/k navigate, a approve, d deny.
 */

import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { useUser, useOrganization } from '@clerk/clerk-react';
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
  const { user } = useUser();
  const { membership } = useOrganization();
  const approverIdentity = user?.id ?? 'dashboard';
  const userOrgRole = (membership?.role ?? 'member').replace(/^org:/, '');

  const { data: approvals, isLoading } = useApprovals();
  const approveMut = useApproveApproval();
  const denyMut = useDenyApproval();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [selectedIdx, setSelectedIdx] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [riskFilter, setRiskFilter] = useState('');
  const [searchFilter, setSearchFilter] = useState('');

  const [argRuleItem, setArgRuleItem] = useState<any>(null);
  const [argRuleKeys, setArgRuleKeys] = useState<string[]>([]);

  const alwaysAllowMut = useMutation({
    mutationFn: ({ item, matchArgs }: { item: any; matchArgs?: string }) => {
      const tc = item.toolCall;
      const toolName = tc?.toolName?.replace(/^(wooblay_|gated_)/, '') ?? '*';
      return createPolicy({
        matchTool: toolName,
        riskTier: tc?.riskTier ?? 'WRITE',
        decision: 'ALLOW',
        matchArgs,
        source: 'from-approval',
        description: matchArgs
          ? `Auto-allow ${toolName} when args match ${matchArgs}`
          : `Auto-allow ${toolName} (from approval)`,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['policies'] });
      setArgRuleItem(null);
      setArgRuleKeys([]);
      toast('Policy created — future similar actions will be auto-approved', 'success');
    },
  });

  const items = approvals ?? [];
  const filteredItems = items
    .filter((item: any) => {
      const tc = item.toolCall;
      if (riskFilter && tc?.riskTier !== riskFilter) return false;
      if (searchFilter) {
        const q = searchFilter.toLowerCase();
        const matchesName = tc?.toolName?.toLowerCase().includes(q);
        const matchesDesc = item.humanDescription?.toLowerCase().includes(q);
        if (!matchesName && !matchesDesc) return false;
      }
      return true;
    })
    .sort((a: any, b: any) => {
      const aRole = (a as any).requiredApproverRole as string | null;
      const bRole = (b as any).requiredApproverRole as string | null;
      const aCanApprove = !aRole || userOrgRole === aRole || userOrgRole === 'admin' || userOrgRole === 'owner';
      const bCanApprove = !bRole || userOrgRole === bRole || userOrgRole === 'admin' || userOrgRole === 'owner';
      if (aCanApprove && !bCanApprove) return -1;
      if (!aCanApprove && bCanApprove) return 1;
      return 0;
    });

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!filteredItems.length) return;
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIdx((i) => Math.min(i + 1, filteredItems.length - 1));
      }
      if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(i - 1, 0));
      }
      if (e.key === 'a' && !e.metaKey && !e.ctrlKey) {
        const item = filteredItems[selectedIdx];
        if (item) {
          approveMut.mutate(
            { id: item.id, body: { approver: approverIdentity } },
            { onSuccess: () => toast('Approved — running in secure container. See Activity for result.', 'success') },
          );
        }
      }
      if (e.key === 'd' && !e.metaKey && !e.ctrlKey) {
        const item = filteredItems[selectedIdx];
        if (item) {
          denyMut.mutate(
            { id: item.id, body: { approver: approverIdentity, reason: 'Denied from dashboard' } },
            { onSuccess: () => toast('Denied', 'info') },
          );
        }
      }
    },
    [filteredItems, selectedIdx, approveMut, denyMut, toast],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    if (selectedIdx >= filteredItems.length) setSelectedIdx(Math.max(0, filteredItems.length - 1));
  }, [filteredItems.length, selectedIdx]);

  return (
    <div className="max-w-3xl mx-auto" data-tour="tour-approvals">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-bold text-text-primary">Approvals</h1>
          <p className="text-xs text-text-muted mt-1">
            {filteredItems.length} of {items.length} pending
            {items.length > 0 && (
              <> · <span className="font-mono">j/k</span> navigate · <span className="font-mono">a</span> approve · <span className="font-mono">d</span> deny</>
            )}
          </p>
        </div>
        {filteredItems.length > 1 && (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => {
                filteredItems.forEach((item) =>
                  approveMut.mutate({ id: item.id, body: { approver: approverIdentity } }),
                );
                toast(`Approved ${filteredItems.length} actions`, 'success');
              }}
            >
              Approve All ({filteredItems.length})
            </Button>
          </div>
        )}
      </div>

      {/* Filter bar */}
      {items.length > 0 && (
        <div className="flex items-center gap-3 mb-4">
          <input
            type="text"
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            placeholder="Search tools or descriptions..."
            className="flex-1 bg-surface-1 border border-border rounded-lg px-3 py-1.5 text-xs text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent"
          />
          <select
            value={riskFilter}
            onChange={(e) => setRiskFilter(e.target.value)}
            className="bg-surface-1 border border-border rounded-lg px-3 py-1.5 text-xs text-text-primary focus:outline-none"
          >
            <option value="">All Risk</option>
            <option value="READ">READ</option>
            <option value="WRITE">WRITE</option>
            <option value="DESTRUCTIVE">DESTRUCTIVE</option>
          </select>
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="text-sm text-text-muted py-12 text-center">Loading...</div>
      )}

      {/* Empty */}
      {!isLoading && items.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="text-3xl mb-3 opacity-20">✓</div>
          <p className="text-sm font-medium text-text-secondary">All clear</p>
          <p className="text-xs text-text-muted mt-1">
            No actions waiting for approval. Approved actions run in a secure container and show up in{' '}
            <Link to="/audit" className="text-accent hover:text-accent-bright underline">Audit</Link> with execution status.
          </p>
        </div>
      )}

      {/* Eligible-approver filtering: split into actionable vs waiting */}
      {(() => {
        const eligible = filteredItems.filter((item: any) => {
          const role = (item as any).requiredApproverRole as string | null;
          return !role || userOrgRole === role || userOrgRole === 'admin' || userOrgRole === 'owner';
        });
        const waiting = filteredItems.filter((item: any) => {
          const role = (item as any).requiredApproverRole as string | null;
          return role && userOrgRole !== role && userOrgRole !== 'admin' && userOrgRole !== 'owner';
        });

        if (eligible.length === 0 && waiting.length > 0) {
          return (
            <div className="flex flex-col items-center justify-center py-12 text-center mb-6">
              <p className="text-sm font-medium text-text-secondary">No actions require your approval right now</p>
              <p className="text-xs text-text-muted mt-1">
                {waiting.length} action{waiting.length > 1 ? 's are' : ' is'} waiting for{' '}
                {[...new Set(waiting.map((w: any) => (w as any).requiredApproverRole))].join(', ')} approval
              </p>
            </div>
          );
        }
        return null;
      })()}

      {/* Cards */}
      <div className="space-y-3" data-tour="tour-approval-cards">
        {filteredItems.map((item, idx) => {
          const tc = item.toolCall;
          const isSelected = idx === selectedIdx;
          const isExpanded = expandedId === item.id;
          const action = humanReadableAction(tc?.toolName ?? '', tc?.args);
          const requiredRole = (item as any).requiredApproverRole as string | null;
          const canApprove = !requiredRole || userOrgRole === requiredRole;

          return (
            <div
              key={item.id}
              className={clsx(
                'rounded-xl border p-5 transition-all',
                isSelected
                  ? 'border-accent/30 bg-surface-1'
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

              {/* Why flagged — AI-powered explanation */}
              {item.whyFlagged && (
                <div className="bg-amber-500/5 border border-amber-500/15 rounded-lg px-3 py-2 mb-3">
                  <p className="text-xs text-amber-300">
                    <span className="font-medium">Why this needs approval:</span> {item.whyFlagged}
                  </p>
                </div>
              )}

              {/* Risk explanation */}
              {item.riskExplanation && (
                <p className="text-[11px] text-text-muted mb-3">
                  {item.riskExplanation}
                </p>
              )}

              {/* Role requirement notice */}
              {requiredRole && !canApprove && (
                <div className="bg-purple-500/5 border border-purple-500/15 rounded-lg px-3 py-2 mb-3">
                  <p className="text-xs text-purple-300">
                    Waiting for <span className="font-medium">{requiredRole}</span> approval
                  </p>
                </div>
              )}

              {/* Agent name */}
              <p className="text-xs text-text-muted mb-4">
                Agent: {tc?.agentPubkey ? tc.agentPubkey.slice(0, 12) + '...' : 'Unknown'}
                {tc?.taskId && <> · Task: {tc.taskId}</>}
              </p>

              {/* Action buttons */}
              <div className={clsx('flex items-center gap-2', !canApprove && 'opacity-50')}>
                <Tooltip content={!canApprove ? `Waiting for ${requiredRole ?? 'role'} approval` : ''}>
                  <Button
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      approveMut.mutate(
                        { id: item.id, body: { approver: approverIdentity } },
                        { onSuccess: () => toast('Approved', 'success') },
                      );
                    }}
                    disabled={approveMut.isPending || !canApprove}
                  >
                    Approve
                  </Button>
                </Tooltip>
                <Tooltip content={!canApprove ? `Waiting for ${requiredRole ?? 'role'} approval` : ''}>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={(e) => {
                      e.stopPropagation();
                      denyMut.mutate(
                        { id: item.id, body: { approver: approverIdentity, reason: 'Denied' } },
                        { onSuccess: () => toast('Denied', 'info') },
                      );
                    }}
                    disabled={denyMut.isPending || !canApprove}
                  >
                    Deny
                  </Button>
                </Tooltip>
                <Tooltip content="Approve this and automatically allow all future similar actions">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      approveMut.mutate(
                        { id: item.id, body: { approver: approverIdentity } },
                        {
                          onSuccess: () => {
                            toast('Approved + policy created — running in secure container. See Activity for result.', 'success');
                            alwaysAllowMut.mutate({ item });
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

                {(() => {
                  const parsedArgs = (() => { try { return typeof tc?.args === 'string' ? JSON.parse(tc.args) : tc?.args; } catch { return null; } })();
                  const argKeys = parsedArgs && typeof parsedArgs === 'object' ? Object.keys(parsedArgs) : [];
                  if (argKeys.length === 0) return null;
                  return (
                    <Tooltip content="Allow this tool only when specific argument values match">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setArgRuleItem(argRuleItem?.id === item.id ? null : item);
                          setArgRuleKeys([]);
                        }}
                        className="px-3 py-1 text-[10px] bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 border border-purple-500/20 rounded-lg transition-colors"
                      >
                        Allow with args
                      </button>
                    </Tooltip>
                  );
                })()}

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

              {/* Arg-based rule picker */}
              {argRuleItem?.id === item.id && (() => {
                const parsedArgs = (() => { try { return typeof tc?.args === 'string' ? JSON.parse(tc.args) : tc?.args; } catch { return null; } })();
                if (!parsedArgs || typeof parsedArgs !== 'object') return null;
                const argEntries = Object.entries(parsedArgs as Record<string, unknown>).filter(([, v]) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean');
                return (
                  <div className="mt-3 p-3 bg-purple-500/5 border border-purple-500/20 rounded-lg space-y-2 animate-fade-in" onClick={e => e.stopPropagation()}>
                    <p className="text-[10px] text-purple-400 font-medium">Select which argument values to lock into the rule:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {argEntries.map(([key, val]) => {
                        const selected = argRuleKeys.includes(key);
                        return (
                          <button key={key} onClick={() => setArgRuleKeys(prev => selected ? prev.filter(k => k !== key) : [...prev, key])}
                            className={clsx('px-2.5 py-1 rounded text-[10px] font-mono border transition-colors',
                              selected ? 'border-purple-500/40 bg-purple-500/15 text-purple-300' : 'border-border text-text-secondary hover:bg-surface-3')}>
                            {key}={String(val)}
                          </button>
                        );
                      })}
                    </div>
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        disabled={argRuleKeys.length === 0 || alwaysAllowMut.isPending}
                        onClick={() => {
                          const pattern: Record<string, unknown> = {};
                          for (const k of argRuleKeys) pattern[k] = (parsedArgs as any)[k];
                          approveMut.mutate(
                            { id: item.id, body: { approver: approverIdentity } },
                            {
                              onSuccess: () => {
                                toast('Approved + per-action rule created', 'success');
                                alwaysAllowMut.mutate({ item, matchArgs: JSON.stringify(pattern) });
                              },
                            },
                          );
                        }}
                        className="px-3 py-1.5 rounded bg-purple-500/20 text-purple-300 text-[10px] font-mono font-medium disabled:opacity-40 hover:bg-purple-500/30 transition-colors"
                      >
                        {alwaysAllowMut.isPending ? 'Creating...' : `Approve + allow when ${argRuleKeys.length ? argRuleKeys.join(', ') : '...'} match`}
                      </button>
                      <button onClick={() => { setArgRuleItem(null); setArgRuleKeys([]); }}
                        className="text-[10px] text-text-tertiary hover:text-text-secondary font-mono">cancel</button>
                    </div>
                  </div>
                );
              })()}

              {/* Expanded details */}
              {isExpanded && (
                <div className="mt-4 pt-4 border-t border-border space-y-3 animate-slide-in-up">
                  {/* Secure Execution Preview */}
                  {tc?.toolName?.startsWith('structured_action') && (
                    <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-3">
                      <h4 className="text-[10px] text-emerald-400 uppercase tracking-wider font-medium mb-2">
                        Secure Execution Preview
                      </h4>
                      <p className="text-[10px] text-text-tertiary mb-2">
                        This action will run in an ephemeral container. Credentials are injected from the vault and destroyed after execution.
                      </p>
                      <div className="grid grid-cols-3 gap-2 text-[10px]">
                        <div className="bg-surface-0 rounded px-2 py-1.5">
                          <span className="text-text-muted block">Layer 1</span>
                          <span className="text-text-primary font-medium">Policy + Scope</span>
                        </div>
                        <div className="bg-surface-0 rounded px-2 py-1.5">
                          <span className="text-text-muted block">Layer 2</span>
                          <span className="text-text-primary font-medium">Simulation</span>
                        </div>
                        <div className="bg-surface-0 rounded px-2 py-1.5">
                          <span className="text-text-muted block">Layer 3</span>
                          <span className="text-text-primary font-medium">Ephemeral Exec</span>
                        </div>
                      </div>
                    </div>
                  )}

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

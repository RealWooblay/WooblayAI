/**
 * Policies — Simple rule management.
 * Table with add/edit/delete. Preset dropdown. Clear explanation.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  getPolicies,
  createPolicy,
  updatePolicy,
  deletePolicy,
  getPolicyPresets,
  applyPolicyPreset,
} from '../../api/client.ts';
import type { PolicyRule, CreatePolicyRequest, UpdatePolicyRequest } from '@wooblay/types';
import { Button } from '../../components/common/Button.tsx';
import { Badge, riskTierVariant } from '../../components/common/Badge.tsx';
import { ConfirmDialog } from '../../components/common/ConfirmDialog.tsx';
import { useToast } from '../../components/common/Toast.tsx';

const RISK_TIERS = ['READ', 'WRITE', 'DESTRUCTIVE'];
const DECISIONS = ['ALLOW', 'DENY', 'APPROVE'];

interface PolicyFormData {
  matchTool: string;
  riskTier: string;
  decision: string;
  priority: number;
}

const EMPTY_FORM: PolicyFormData = { matchTool: '*', riskTier: 'WRITE', decision: 'APPROVE', priority: 50 };

function PolicyModal({
  open,
  title,
  initial,
  onSave,
  onCancel,
  loading,
}: {
  open: boolean;
  title: string;
  initial: PolicyFormData;
  onSave: (data: PolicyFormData) => void;
  onCancel: () => void;
  loading?: boolean;
}) {
  const [form, setForm] = useState(initial);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-void/70 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative bg-surface-1 border border-border rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl animate-float-up">
        <h2 className="text-base font-semibold text-text-primary mb-4">{title}</h2>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-text-secondary mb-1 block">Tool Pattern</label>
            <input
              value={form.matchTool}
              onChange={(e) => setForm({ ...form, matchTool: e.target.value })}
              placeholder="e.g. exec, rm *, * (wildcard)"
              className="w-full bg-surface-0 border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50 font-mono"
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-text-secondary mb-1 block">Priority</label>
              <input
                type="number"
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })}
                className="w-full bg-surface-0 border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent/50"
              />
            </div>
            <div>
              <label className="text-xs text-text-secondary mb-1 block">Risk Tier</label>
              <select
                value={form.riskTier}
                onChange={(e) => setForm({ ...form, riskTier: e.target.value })}
                className="w-full bg-surface-0 border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent/50"
              >
                {RISK_TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-text-secondary mb-1 block">Decision</label>
              <select
                value={form.decision}
                onChange={(e) => setForm({ ...form, decision: e.target.value })}
                className="w-full bg-surface-0 border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent/50"
              >
                {DECISIONS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
          <Button size="sm" onClick={() => onSave(form)} disabled={loading}>
            {loading ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function decisionVariant(d: string): 'green' | 'red' | 'blue' | 'gray' {
  switch (d.toUpperCase()) {
    case 'ALLOW': return 'green';
    case 'DENY': return 'red';
    case 'APPROVE': return 'blue';
    default: return 'gray';
  }
}

export function PoliciesPage() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: policies, isLoading } = useQuery({
    queryKey: ['policies'],
    queryFn: getPolicies,
  });
  const { data: presets } = useQuery({
    queryKey: ['policyPresets'],
    queryFn: getPolicyPresets,
  });

  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<PolicyRule | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PolicyRule | null>(null);

  const createMut = useMutation({
    mutationFn: (data: CreatePolicyRequest) => createPolicy(data),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['policies'] }); toast('Policy created', 'success'); setAddOpen(false); },
  });
  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdatePolicyRequest }) => updatePolicy(id, body),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['policies'] }); toast('Policy updated', 'success'); setEditTarget(null); },
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => deletePolicy(id),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['policies'] }); toast('Policy deleted', 'info'); setDeleteTarget(null); },
  });
  const toggleMut = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => updatePolicy(id, { enabled } as UpdatePolicyRequest),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['policies'] }),
  });
  const presetMut = useMutation({
    mutationFn: (key: string) => applyPolicyPreset(key),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['policies'] }); toast('Preset applied', 'success'); },
  });

  const sorted = [...(policies ?? [])].sort((a, b) => a.priority - b.priority);

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-lg font-bold text-text-primary">Policies</h1>
          <div className="flex items-center gap-2">
            {presets && presets.length > 0 && (
              <select
                onChange={(e) => { if (e.target.value) presetMut.mutate(e.target.value); e.target.value = ''; }}
                className="bg-surface-0 border border-border rounded-lg px-2 py-1.5 text-xs text-text-secondary focus:outline-none"
                defaultValue=""
              >
                <option value="" disabled>Apply Preset...</option>
                {presets.map((p) => <option key={p.key} value={p.key}>{p.name} ({p.ruleCount} rules)</option>)}
              </select>
            )}
            <Button size="sm" onClick={() => setAddOpen(true)}>Add Rule</Button>
          </div>
        </div>
        <p className="text-xs text-text-secondary leading-relaxed">
          Policies determine which agent actions are auto-approved, which need your review, and which are blocked.
          Rules are evaluated by priority (lowest first).
        </p>
      </div>

      {/* Loading */}
      {isLoading && <div className="text-sm text-text-muted py-12 text-center">Loading...</div>}

      {/* Empty */}
      {!isLoading && sorted.length === 0 && (
        <div className="text-center py-16">
          <p className="text-sm text-text-secondary mb-4">No policies configured yet.</p>
          <Button size="sm" onClick={() => setAddOpen(true)}>Create First Rule</Button>
        </div>
      )}

      {/* Table */}
      {sorted.length > 0 && (
        <div className="border border-border rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-surface-0 border-b border-border text-[10px] text-text-muted uppercase tracking-wider">
                <th className="text-left px-4 py-2.5 w-16">Priority</th>
                <th className="text-left px-4 py-2.5">Tool Pattern</th>
                <th className="text-left px-4 py-2.5 w-28">Risk</th>
                <th className="text-left px-4 py-2.5 w-28">Decision</th>
                <th className="text-center px-4 py-2.5 w-16">On</th>
                <th className="text-right px-4 py-2.5 w-20" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((p) => (
                <tr
                  key={p.id}
                  className={clsx(
                    'border-b border-border/50 hover:bg-surface-2/50 transition-colors',
                    !p.enabled && 'opacity-40',
                  )}
                >
                  <td className="px-4 py-3 text-xs text-text-muted font-mono">{p.priority}</td>
                  <td className="px-4 py-3 text-sm text-text-primary font-mono">{p.matchTool}</td>
                  <td className="px-4 py-3"><Badge variant={riskTierVariant(p.riskTier)}>{p.riskTier}</Badge></td>
                  <td className="px-4 py-3"><Badge variant={decisionVariant(p.decision)}>{p.decision}</Badge></td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => toggleMut.mutate({ id: p.id, enabled: !p.enabled })}
                      className={clsx(
                        'h-5 w-9 rounded-full transition-colors relative',
                        p.enabled ? 'bg-emerald-600' : 'bg-surface-3',
                      )}
                    >
                      <span
                        className={clsx(
                          'absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform',
                          p.enabled ? 'left-[18px]' : 'left-0.5',
                        )}
                      />
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => setEditTarget(p)}
                      className="text-[11px] text-text-muted hover:text-text-secondary mr-3"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => setDeleteTarget(p)}
                      className="text-[11px] text-red-400/60 hover:text-red-400"
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add modal */}
      <PolicyModal
        open={addOpen}
        title="Add Policy Rule"
        initial={EMPTY_FORM}
        onSave={(data) => createMut.mutate({ matchTool: data.matchTool, riskTier: data.riskTier, decision: data.decision, priority: data.priority })}
        onCancel={() => setAddOpen(false)}
        loading={createMut.isPending}
      />

      {/* Edit modal */}
      {editTarget && (
        <PolicyModal
          open={!!editTarget}
          title="Edit Policy Rule"
          initial={{
            matchTool: editTarget.matchTool,
            riskTier: editTarget.riskTier,
            decision: editTarget.decision,
            priority: editTarget.priority,
          }}
          onSave={(data) => updateMut.mutate({
            id: editTarget.id,
            body: { matchTool: data.matchTool, riskTier: data.riskTier, decision: data.decision, priority: data.priority },
          })}
          onCancel={() => setEditTarget(null)}
          loading={updateMut.isPending}
        />
      )}

      {/* Delete confirm */}
      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Policy"
        message={`Remove the rule matching "${deleteTarget?.matchTool}"?`}
        confirmLabel="Delete"
        confirmVariant="danger"
        onConfirm={() => { if (deleteTarget) deleteMut.mutate(deleteTarget.id); }}
        onCancel={() => setDeleteTarget(null)}
        loading={deleteMut.isPending}
      />
    </div>
  );
}

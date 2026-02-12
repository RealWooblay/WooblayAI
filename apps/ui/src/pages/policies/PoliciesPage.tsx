import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getPolicies,
  getPresets,
  getSuggestions,
  createPolicy,
  updatePolicy,
  deletePolicy,
  applyPreset,
  type PolicyRule,
} from '../../api/client.ts';

const RISK_TIERS = ['*', 'READ', 'WRITE', 'DESTRUCTIVE'];
const DECISIONS = ['ALLOW', 'APPROVE', 'DENY'];

const decisionColor: Record<string, string> = {
  ALLOW: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
  APPROVE: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  DENY: 'text-red-400 bg-red-500/10 border-red-500/20',
};

const riskColor: Record<string, string> = {
  READ: 'text-blue-400',
  WRITE: 'text-amber-400',
  DESTRUCTIVE: 'text-red-400',
  '*': 'text-zinc-400',
};

export function PoliciesPage() {
  const qc = useQueryClient();
  const { data: rules = [], isLoading } = useQuery({ queryKey: ['policies'], queryFn: getPolicies });
  const { data: presets = [] } = useQuery({ queryKey: ['presets'], queryFn: getPresets });
  const { data: suggestions = [] } = useQuery({ queryKey: ['suggestions'], queryFn: getSuggestions });

  const [newTool, setNewTool] = useState('');
  const [newRisk, setNewRisk] = useState('WRITE');
  const [newDecision, setNewDecision] = useState('APPROVE');
  const [presetConfirm, setPresetConfirm] = useState<string | null>(null);

  const addMutation = useMutation({
    mutationFn: () => createPolicy({ matchTool: newTool, riskTier: newRisk, decision: newDecision }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['policies'] }); setNewTool(''); },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => updatePolicy(id, { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['policies'] }),
  });

  const delMutation = useMutation({
    mutationFn: (id: string) => deletePolicy(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['policies'] }),
  });

  const presetMutation = useMutation({
    mutationFn: (name: string) => applyPreset(name),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['policies'] }); setPresetConfirm(null); },
  });

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-text-primary">Policies</h1>
        <p className="text-sm text-text-muted mt-1">
          Control which agent actions are auto-allowed, require approval, or are blocked.
        </p>
      </div>

      {/* Presets */}
      <div className="bg-surface-1 border border-border rounded-xl p-4">
        <h2 className="text-sm font-medium text-text-primary mb-3">Quick Presets</h2>
        <div className="flex gap-3">
          {presets.map((p) => (
            <div key={p.id} className="flex-1">
              {presetConfirm === p.id ? (
                <div className="bg-surface-2 border border-amber-500/30 rounded-lg p-3 text-center">
                  <p className="text-xs text-amber-400 mb-2">Replace all rules with {p.name}?</p>
                  <div className="flex gap-2 justify-center">
                    <button
                      onClick={() => presetMutation.mutate(p.id)}
                      className="px-3 py-1 text-xs bg-amber-500/20 text-amber-300 rounded-md hover:bg-amber-500/30"
                    >
                      Confirm
                    </button>
                    <button
                      onClick={() => setPresetConfirm(null)}
                      className="px-3 py-1 text-xs bg-surface-3 text-text-muted rounded-md hover:bg-surface-2"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setPresetConfirm(p.id)}
                  className="w-full bg-surface-2 hover:bg-surface-3 border border-border rounded-lg p-3 text-left transition-colors"
                >
                  <div className="text-sm font-medium text-text-primary">{p.name}</div>
                  <div className="text-xs text-text-muted mt-1">{p.description}</div>
                  <div className="text-[10px] text-text-muted mt-1">{p.ruleCount} rules</div>
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Rules Table */}
      <div className="bg-surface-1 border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-sm font-medium text-text-primary">Active Rules</h2>
        </div>

        {isLoading ? (
          <div className="p-8 text-center text-text-muted text-sm animate-pulse">Loading...</div>
        ) : rules.length === 0 ? (
          <div className="p-8 text-center text-text-muted text-sm">No policy rules defined. Apply a preset to get started.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-0 text-text-muted text-[11px] uppercase tracking-wider">
                <th className="text-left px-4 py-2 font-medium">Priority</th>
                <th className="text-left px-4 py-2 font-medium">Tool Pattern</th>
                <th className="text-left px-4 py-2 font-medium">Risk Tier</th>
                <th className="text-left px-4 py-2 font-medium">Decision</th>
                <th className="text-center px-4 py-2 font-medium">Enabled</th>
                <th className="text-right px-4 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rules.map((rule: PolicyRule) => (
                <tr key={rule.id} className={`hover:bg-surface-2 transition-colors ${!rule.enabled ? 'opacity-40' : ''}`}>
                  <td className="px-4 py-2.5 text-text-muted font-mono text-xs">{rule.priority}</td>
                  <td className="px-4 py-2.5 text-text-primary font-mono text-xs">{rule.matchTool}</td>
                  <td className="px-4 py-2.5">
                    <span className={`text-xs font-medium ${riskColor[rule.riskTier] ?? 'text-zinc-400'}`}>
                      {rule.riskTier}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${decisionColor[rule.decision] ?? ''}`}>
                      {rule.decision}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <button
                      onClick={() => toggleMutation.mutate({ id: rule.id, enabled: !rule.enabled })}
                      className={`w-8 h-4 rounded-full transition-colors ${rule.enabled ? 'bg-emerald-500' : 'bg-surface-3'}`}
                    >
                      <div className={`w-3.5 h-3.5 bg-white rounded-full transition-transform ${rule.enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
                    </button>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      onClick={() => delMutation.mutate(rule.id)}
                      className="text-red-400/50 hover:text-red-400 text-xs"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Add Rule */}
      <div className="bg-surface-1 border border-border rounded-xl p-4">
        <h2 className="text-sm font-medium text-text-primary mb-3">Add Rule</h2>
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <label className="block text-[11px] text-text-muted mb-1">Tool Pattern</label>
            <input
              value={newTool}
              onChange={(e) => setNewTool(e.target.value)}
              placeholder="exec, write, *, memory_*"
              className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
            />
          </div>
          <div className="w-32">
            <label className="block text-[11px] text-text-muted mb-1">Risk Tier</label>
            <select
              value={newRisk}
              onChange={(e) => setNewRisk(e.target.value)}
              className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent"
            >
              {RISK_TIERS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="w-32">
            <label className="block text-[11px] text-text-muted mb-1">Decision</label>
            <select
              value={newDecision}
              onChange={(e) => setNewDecision(e.target.value)}
              className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent"
            >
              {DECISIONS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <button
            onClick={() => newTool && addMutation.mutate()}
            disabled={!newTool || addMutation.isPending}
            className="px-4 py-2 bg-accent hover:bg-accent-bright text-white text-sm rounded-lg disabled:opacity-50 transition-colors"
          >
            Add
          </button>
        </div>
      </div>

      {/* Suggestions */}
      {suggestions.length > 0 && (
        <div className="bg-surface-1 border border-indigo-500/20 rounded-xl p-4">
          <h2 className="text-sm font-medium text-indigo-400 mb-3">Policy Suggestions</h2>
          <div className="space-y-2">
            {suggestions.map((s, i) => (
              <div key={i} className="flex items-center justify-between bg-surface-2 rounded-lg p-3">
                <div>
                  <p className="text-sm text-text-primary">{s.reason}</p>
                  <p className="text-xs text-text-muted mt-0.5">
                    {s.tool}: {s.currentDecision} &rarr; {s.suggestedDecision}
                  </p>
                </div>
                <button className="px-3 py-1 text-xs bg-indigo-500/20 text-indigo-300 rounded-md hover:bg-indigo-500/30">
                  Apply
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

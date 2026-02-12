/**
 * Policies — Business-Context, AI-Transparent
 *
 * 1. AI Policy Supervisor toggle
 * 2. Active policy summary (ALWAYS visible, business language)
 * 3. Preset cards
 * 4. AI suggestions (when AI has results)
 * 5. Advanced accordion — full rule table for power users
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getPolicies,
  getPresets,
  createPolicy,
  updatePolicy,
  deletePolicy,
  applyPreset,
  optimizePolicies,
  type PolicyRule,
  type AIPolicySuggestion,
} from '../../api/client.ts';
import { Tooltip } from '../../components/common/Tooltip.tsx';

// ── Business-category display ────────────────────────────────────────────────

const CATEGORY_LABELS: Record<string, string> = {
  code: 'Code changes',
  git: 'Git operations',
  packages: 'Package installs',
  shell: 'Shell commands',
  files: 'File operations',
  network: 'Network requests',
  secrets: 'Secrets/credentials access',
  infra: 'Infrastructure',
  communication: 'Communication',
  destructive: 'Destructive operations',
  data: 'Data access',
};

const DECISION_DISPLAY: Record<string, { label: string; color: string; bg: string }> = {
  ALLOW: { label: 'Auto-allowed', color: 'text-emerald-400', bg: 'bg-emerald-500/8 border-emerald-500/20' },
  APPROVE: { label: 'Require approval', color: 'text-amber-400', bg: 'bg-amber-500/8 border-amber-500/20' },
  DENY: { label: 'Blocked', color: 'text-red-400', bg: 'bg-red-500/8 border-red-500/20' },
};

const SOURCE_LABELS: Record<string, string> = {
  manual: 'manual',
  preset: 'preset',
  'ai-learned': 'AI-learned',
  'from-approval': 'from approval',
};

/** Build a business-context summary from rules. Group by category, show strictest decision per category. */
function buildCategorySummary(rules: PolicyRule[]): Array<{ category: string; label: string; decision: string; source: string }> {
  const categoryDecisions: Record<string, { decision: string; source: string }> = {};

  // Priority: DENY > APPROVE > ALLOW (show strictest)
  const decisionPriority: Record<string, number> = { DENY: 3, APPROVE: 2, ALLOW: 1 };

  for (const rule of rules) {
    if (!rule.enabled) continue;
    const cat = rule.matchCategory ?? (rule.riskTier === 'READ' ? 'files' : rule.riskTier === 'DESTRUCTIVE' ? 'destructive' : 'other');
    const existing = categoryDecisions[cat];
    const currentPriority = decisionPriority[rule.decision] ?? 0;
    const existingPriority = existing ? (decisionPriority[existing.decision] ?? 0) : 0;

    if (!existing || currentPriority > existingPriority) {
      categoryDecisions[cat] = { decision: rule.decision, source: rule.source ?? 'manual' };
    }
  }

  return Object.entries(categoryDecisions).map(([cat, { decision, source }]) => ({
    category: cat,
    label: CATEGORY_LABELS[cat] ?? cat,
    decision,
    source,
  }));
}

export function PoliciesPage() {
  const qc = useQueryClient();
  const { data: rules = [], isLoading } = useQuery({ queryKey: ['policies'], queryFn: getPolicies });
  const { data: presets = [] } = useQuery({ queryKey: ['presets'], queryFn: getPresets });
  const [aiEnabled, setAiEnabled] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [presetConfirm, setPresetConfirm] = useState<string | null>(null);
  const [aiSuggestions, setAiSuggestions] = useState<AIPolicySuggestion[]>([]);
  const [aiSummary, setAiSummary] = useState('');
  const [aiRole, setAiRole] = useState('');

  const presetMutation = useMutation({
    mutationFn: (name: string) => applyPreset(name),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['policies'] }); setPresetConfirm(null); },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => updatePolicy(id, { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['policies'] }),
  });

  const delMutation = useMutation({
    mutationFn: (id: string) => deletePolicy(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['policies'] }),
  });

  const optimizeMutation = useMutation({
    mutationFn: (autoApply: boolean) => optimizePolicies(autoApply),
    onSuccess: (data) => {
      setAiSuggestions(data.suggestions);
      setAiSummary(data.summary);
      setAiRole(data.agentRole);
      if (data.applied) qc.invalidateQueries({ queryKey: ['policies'] });
    },
  });

  const applySuggestion = useMutation({
    mutationFn: (s: AIPolicySuggestion) =>
      createPolicy({
        matchTool: s.matchTool || '*',
        riskTier: s.riskTier || '*',
        decision: s.decision,
        matchCategory: s.matchCategory,
        source: 'ai-learned',
        description: s.description,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['policies'] }),
  });

  const categorySummary = buildCategorySummary(rules);
  const aiRulesCount = rules.filter(r => r.source === 'ai-learned').length;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header + AI Toggle */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">Policies</h1>
          <p className="text-sm text-text-muted mt-1">
            Control which agent actions are auto-allowed, require approval, or blocked.
          </p>
        </div>

        {/* AI Toggle */}
        <div className="flex items-center gap-3">
          <Tooltip content="When enabled, AI analyzes agent behavior and suggests policy optimizations">
            <span className="text-xs text-text-muted">AI Supervisor</span>
          </Tooltip>
          <button
            onClick={() => {
              const next = !aiEnabled;
              setAiEnabled(next);
              if (next) optimizeMutation.mutate(false);
            }}
            className={`w-10 h-5 rounded-full transition-colors ${aiEnabled ? 'bg-accent' : 'bg-surface-3'}`}
          >
            <div className={`w-4 h-4 bg-white rounded-full transition-transform ${aiEnabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
          </button>
        </div>
      </div>

      {/* AI Status */}
      {aiEnabled && (
        <div className="bg-accent/5 border border-accent/20 rounded-xl p-3 flex items-center justify-between">
          <div className="text-xs text-text-secondary">
            {optimizeMutation.isPending ? (
              <span className="animate-pulse">AI is analyzing agent behavior...</span>
            ) : aiSummary ? (
              <span>AI: {aiSummary} {aiRole && <span className="text-text-muted">· Optimizing for: {aiRole}</span>}</span>
            ) : (
              <span>AI Policy Supervisor active. {aiRulesCount > 0 ? `${aiRulesCount} AI-learned rules.` : 'Learning...'}</span>
            )}
          </div>
          <button
            onClick={() => optimizeMutation.mutate(false)}
            disabled={optimizeMutation.isPending}
            className="text-[10px] text-accent hover:underline disabled:opacity-50"
          >
            Re-analyze
          </button>
        </div>
      )}

      {/* Active Policy Summary (ALWAYS visible) */}
      <div className="bg-surface-1 border border-border rounded-xl p-4">
        <h2 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-3">Active Policy Summary</h2>
        {categorySummary.length === 0 ? (
          <p className="text-sm text-text-muted">No policy rules configured. Apply a preset to get started.</p>
        ) : (
          <div className="space-y-1.5">
            {categorySummary.map(({ category, label, decision, source }) => {
              const d = DECISION_DISPLAY[decision] ?? DECISION_DISPLAY.APPROVE;
              return (
                <div key={category} className={`flex items-center justify-between px-3 py-2 rounded-lg border ${d.bg}`}>
                  <span className="text-sm text-text-primary">{label}</span>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-medium ${d.color}`}>{d.label}</span>
                    <Tooltip content={`Source: ${SOURCE_LABELS[source] ?? source}`}>
                      <span className="text-[9px] text-text-muted bg-surface-3 px-1.5 py-0.5 rounded">
                        {SOURCE_LABELS[source] ?? source}
                      </span>
                    </Tooltip>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Preset Cards */}
      <div className="grid grid-cols-3 gap-3">
        {presets.map(p => {
          const isActive = presetConfirm === p.id;
          return (
            <div key={p.id} className="bg-surface-1 border border-border rounded-xl p-4 transition-colors hover:border-border-strong">
              {isActive ? (
                <div className="text-center">
                  <p className="text-xs text-amber-400 mb-3">Replace all rules with {p.name}?</p>
                  <div className="flex gap-2 justify-center">
                    <button
                      onClick={() => presetMutation.mutate(p.id)}
                      className="px-3 py-1.5 text-xs bg-amber-500/20 text-amber-300 rounded-lg hover:bg-amber-500/30"
                    >
                      Confirm
                    </button>
                    <button
                      onClick={() => setPresetConfirm(null)}
                      className="px-3 py-1.5 text-xs bg-surface-3 text-text-muted rounded-lg hover:bg-surface-2"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setPresetConfirm(p.id)} className="w-full text-left">
                  <div className="text-sm font-medium text-text-primary">{p.name}</div>
                  <div className="text-[11px] text-text-muted mt-1">{p.description}</div>
                  <div className="text-[10px] text-text-muted mt-2">{p.ruleCount} rules</div>
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* AI Suggestions */}
      {aiSuggestions.length > 0 && (
        <div className="bg-surface-1 border border-accent/20 rounded-xl p-4">
          <h2 className="text-xs font-medium text-accent uppercase tracking-wider mb-3">AI Suggestions</h2>
          <div className="space-y-2">
            {aiSuggestions.map((s, i) => {
              const d = DECISION_DISPLAY[s.decision] ?? DECISION_DISPLAY.APPROVE;
              return (
                <div key={i} className="flex items-start justify-between bg-surface-2 rounded-lg p-3">
                  <div className="min-w-0 flex-1 mr-3">
                    <p className="text-xs text-text-primary">{s.description}</p>
                    <p className="text-[10px] text-text-muted mt-0.5">{s.reasoning}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`text-[10px] font-medium ${d.color}`}>
                        {CATEGORY_LABELS[s.matchCategory] ?? s.matchCategory} → {d.label}
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <button
                      onClick={() => applySuggestion.mutate(s)}
                      className="px-2.5 py-1 text-[10px] bg-accent/20 text-accent rounded-md hover:bg-accent/30"
                    >
                      Accept
                    </button>
                    <button
                      onClick={() => setAiSuggestions(prev => prev.filter((_, j) => j !== i))}
                      className="px-2.5 py-1 text-[10px] bg-surface-3 text-text-muted rounded-md hover:bg-surface-2"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Advanced — Collapsed rule table */}
      <div className="bg-surface-1 border border-border rounded-xl overflow-hidden">
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-surface-2/50 transition-colors"
        >
          <span className="text-xs font-medium text-text-muted uppercase tracking-wider">
            Advanced — All Rules ({rules.length})
          </span>
          <span className="text-text-muted text-xs">{showAdvanced ? '▾' : '▸'}</span>
        </button>

        {showAdvanced && (
          <>
            {isLoading ? (
              <div className="p-6 text-center text-text-muted text-sm animate-pulse">Loading...</div>
            ) : rules.length === 0 ? (
              <div className="p-6 text-center text-text-muted text-sm">No rules. Apply a preset.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-surface-0 text-text-muted text-[10px] uppercase tracking-wider">
                      <th className="text-left px-3 py-2">#</th>
                      <th className="text-left px-3 py-2">Tool</th>
                      <th className="text-left px-3 py-2">Category</th>
                      <th className="text-left px-3 py-2">Decision</th>
                      <th className="text-left px-3 py-2">Source</th>
                      <th className="text-center px-3 py-2">On</th>
                      <th className="text-right px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {rules.map((rule: PolicyRule) => {
                      const d = DECISION_DISPLAY[rule.decision];
                      return (
                        <tr key={rule.id} className={`hover:bg-surface-2 transition-colors ${!rule.enabled ? 'opacity-40' : ''}`}>
                          <td className="px-3 py-2 text-text-muted font-mono">{rule.priority}</td>
                          <td className="px-3 py-2 text-text-primary font-mono">{rule.matchTool}</td>
                          <td className="px-3 py-2 text-text-secondary">{rule.matchCategory ?? rule.riskTier}</td>
                          <td className="px-3 py-2">
                            <span className={`font-medium ${d?.color ?? 'text-text-muted'}`}>{rule.decision}</span>
                          </td>
                          <td className="px-3 py-2 text-text-muted">{SOURCE_LABELS[rule.source] ?? rule.source}</td>
                          <td className="px-3 py-2 text-center">
                            <button
                              onClick={() => toggleMutation.mutate({ id: rule.id, enabled: !rule.enabled })}
                              className={`w-7 h-3.5 rounded-full transition-colors ${rule.enabled ? 'bg-emerald-500' : 'bg-surface-3'}`}
                            >
                              <div className={`w-3 h-3 bg-white rounded-full transition-transform ${rule.enabled ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
                            </button>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <button onClick={() => delMutation.mutate(rule.id)} className="text-red-400/40 hover:text-red-400">×</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

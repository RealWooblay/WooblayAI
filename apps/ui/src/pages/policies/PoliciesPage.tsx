/**
 * Policies — AI-Driven Security, Transparent, Simple
 *
 * Visual lockdown feel. AI supervisor with pattern recognition.
 * Simple presets, understandable summaries, working buttons.
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
import { useToast } from '../../components/common/Toast.tsx';

// ── Human-readable display ───────────────────────────────────────────────────

const CATEGORY_LABELS: Record<string, string> = {
  code: 'Code changes',
  git: 'Git operations',
  packages: 'Package installs',
  shell: 'Shell commands',
  files: 'File operations',
  network: 'Network requests',
  secrets: 'Secrets & credentials',
  infra: 'Infrastructure',
  communication: 'Communication',
  destructive: 'Destructive operations',
  data: 'Data access',
};

const DECISION_STYLES: Record<string, { label: string; icon: string; color: string; bg: string }> = {
  ALLOW: { label: 'Auto-allowed', icon: '✓', color: 'text-emerald-400', bg: 'bg-emerald-500/8 border-emerald-500/15' },
  APPROVE: { label: 'Needs approval', icon: '?', color: 'text-amber-400', bg: 'bg-amber-500/8 border-amber-500/15' },
  DENY: { label: 'Blocked', icon: '✕', color: 'text-red-400', bg: 'bg-red-500/8 border-red-500/15' },
};

/**
 * Build summary from rules. Shows category-based rules first (what humans understand),
 * then catch-all rules. Skips internal/redundant entries.
 */
function summarizeRules(rules: PolicyRule[]): Array<{ category: string; label: string; decision: string; description?: string }> {
  const result: Array<{ category: string; label: string; decision: string; description?: string }> = [];
  const seenCats = new Set<string>();

  // Sort by priority ascending (most important first)
  const sorted = [...rules].filter(r => r.enabled).sort((a, b) => a.priority - b.priority);

  for (const rule of sorted) {
    if (rule.matchCategory && rule.matchCategory !== '*') {
      // Category-specific rule — this is what humans care about
      if (seenCats.has(rule.matchCategory)) continue;
      seenCats.add(rule.matchCategory);
      result.push({
        category: rule.matchCategory,
        label: CATEGORY_LABELS[rule.matchCategory] ?? rule.matchCategory,
        decision: rule.decision,
        description: rule.description ?? undefined,
      });
    }
  }

  // Add catch-all rules (no category) as a summary line
  const catchAlls = sorted.filter(r => !r.matchCategory || r.matchCategory === '*');
  for (const rule of catchAlls) {
    const key = `_catchall_${rule.riskTier}`;
    if (seenCats.has(key)) continue;
    seenCats.add(key);
    // Only show non-obvious catch-alls
    if (rule.riskTier === 'READ' && rule.decision === 'ALLOW') continue; // obvious
    const tierLabel = rule.riskTier === '*' ? 'All other actions' : rule.riskTier === 'WRITE' ? 'Other writes' : rule.riskTier === 'DESTRUCTIVE' ? 'Destructive (uncategorized)' : rule.riskTier;
    result.push({
      category: key,
      label: tierLabel,
      decision: rule.decision,
      description: rule.description ?? undefined,
    });
  }

  // Sort: DENY first, then APPROVE, then ALLOW
  const decisionOrder: Record<string, number> = { DENY: 0, APPROVE: 1, ALLOW: 2 };
  result.sort((a, b) => (decisionOrder[a.decision] ?? 1) - (decisionOrder[b.decision] ?? 1));

  return result;
}

export function PoliciesPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: rules = [], isLoading } = useQuery({ queryKey: ['policies'], queryFn: getPolicies });
  const { data: presets = [] } = useQuery({ queryKey: ['presets'], queryFn: getPresets });
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [presetConfirm, setPresetConfirm] = useState<string | null>(null);
  const [aiSuggestions, setAiSuggestions] = useState<AIPolicySuggestion[]>([]);
  const [aiSummary, setAiSummary] = useState('');
  const [aiRole, setAiRole] = useState('');

  const presetMutation = useMutation({
    mutationFn: (id: string) => applyPreset(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['policies'] });
      setPresetConfirm(null);
      toast('Preset applied — rules updated', 'success');
    },
    onError: (err: Error) => toast(`Failed: ${err.message}`, 'error'),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => updatePolicy(id, { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['policies'] }),
  });

  const delMutation = useMutation({
    mutationFn: (id: string) => deletePolicy(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['policies'] }); toast('Rule deleted', 'info'); },
  });

  const runAI = async () => {
    setAiLoading(true);
    try {
      const data = await optimizePolicies(false);
      setAiSuggestions(data.suggestions);
      setAiSummary(data.summary);
      setAiRole(data.agentRole);
    } catch (err: any) {
      const msg = err.message ?? '';
      if (msg.includes('OPENAI_API_KEY') || msg.includes('not configured')) {
        toast('AI requires OpenAI API key — configure OPENAI_API_KEY in your environment', 'error');
        setAiSummary('AI not configured — set OPENAI_API_KEY to enable smart policy analysis');
      } else {
        toast(msg || 'AI analysis failed', 'error');
      }
      setAiEnabled(false);
    } finally {
      setAiLoading(false);
    }
  };

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
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['policies'] }); toast('AI rule applied', 'success'); },
    onError: (err: Error) => toast(`Failed: ${err.message}`, 'error'),
  });

  const summary = summarizeRules(rules);
  const aiRulesCount = rules.filter(r => r.source === 'ai-learned').length;
  const enabledCount = rules.filter(r => r.enabled).length;

  return (
    <div className="max-w-4xl mx-auto space-y-5">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div>
        <h1 className="text-lg font-bold text-text-primary font-mono">
          <span className="text-accent">[</span> policies <span className="text-accent">]</span>
        </h1>
        <p className="text-xs text-text-secondary mt-1">
          {enabledCount} active rules controlling agent behavior
        </p>
      </div>

      {/* ── AI Supervisor Section ──────────────────────────────────────────── */}
      <div className={`rounded-xl border p-5 transition-all ${aiEnabled ? 'bg-accent/5 border-accent/25' : 'bg-surface-1 border-border'}`}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <span className={`font-mono text-sm ${aiEnabled ? 'text-accent' : 'text-text-tertiary'}`}>
              {aiEnabled ? '◉' : '○'}
            </span>
            <div>
              <h2 className="text-sm font-semibold text-text-primary">AI Security Supervisor</h2>
              <p className="text-[10px] text-text-secondary">Analyzes agent behavior patterns to optimize your security rules</p>
            </div>
          </div>
          <button
            onClick={() => {
              const next = !aiEnabled;
              setAiEnabled(next);
              if (next) runAI();
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              aiEnabled
                ? 'bg-accent text-white hover:bg-accent-bright'
                : 'bg-surface-3 text-text-secondary hover:bg-surface-2'
            }`}
          >
            {aiEnabled ? 'Active' : 'Enable'}
          </button>
        </div>

        {aiEnabled && (
          <div className="space-y-3">
            {/* AI Status */}
            <div className={`rounded-lg border p-3 font-mono text-xs ${aiLoading ? 'border-accent/20 bg-accent/5' : 'border-border bg-surface-0'}`}>
              {aiLoading ? (
                <div className="flex items-center gap-2">
                  <span className="animate-pulse text-accent">◉</span>
                  <span className="text-text-secondary">Scanning {rules.length} rules against recent agent behavior...</span>
                </div>
              ) : aiSummary ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-emerald-400">✓</span>
                    <span className="text-text-primary">{aiSummary}</span>
                  </div>
                  {aiRole && aiRole !== 'unknown' && (
                    <div className="text-text-tertiary">
                      Agent role detected: <span className="text-text-secondary">{aiRole}</span>
                    </div>
                  )}
                  {aiRulesCount > 0 && (
                    <div className="text-text-tertiary">
                      {aiRulesCount} rules learned from behavior patterns
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-text-tertiary">_</span>
                  <span className="text-text-tertiary">AI supervisor active. Monitoring agent behavior...</span>
                </div>
              )}
            </div>

            {/* Re-analyze button */}
            <button
              onClick={runAI}
              disabled={aiLoading}
              className="text-[10px] text-accent hover:text-accent-bright disabled:opacity-50 font-mono"
            >
              {aiLoading ? 'analyzing...' : '> run analysis'}
            </button>

            {/* AI Suggestions */}
            {aiSuggestions.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-[10px] text-accent uppercase tracking-wider font-medium">AI Recommendations</h3>
                {aiSuggestions.map((s, i) => {
                  const d = DECISION_STYLES[s.decision] ?? DECISION_STYLES.APPROVE;
                  return (
                    <div key={i} className="rounded-lg border border-accent/15 bg-surface-0 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs text-text-primary font-medium">{s.description}</p>
                          <p className="text-[10px] text-text-secondary mt-0.5">{s.reasoning}</p>
                          <div className="flex items-center gap-2 mt-1.5">
                            <span className={`text-[10px] font-mono ${d.color}`}>[{d.icon}]</span>
                            <span className="text-[10px] text-text-tertiary">{CATEGORY_LABELS[s.matchCategory] ?? s.matchCategory}</span>
                            <span className="text-[10px] text-text-tertiary">→</span>
                            <span className={`text-[10px] font-medium ${d.color}`}>{d.label}</span>
                          </div>
                        </div>
                        <div className="flex gap-1.5 shrink-0 mt-0.5">
                          <button
                            onClick={() => applySuggestion.mutate(s)}
                            className="px-2.5 py-1 text-[10px] bg-accent/15 text-accent rounded-md hover:bg-accent/25 font-medium"
                          >
                            Apply
                          </button>
                          <button
                            onClick={() => setAiSuggestions(prev => prev.filter((_, j) => j !== i))}
                            className="px-2.5 py-1 text-[10px] bg-surface-3 text-text-tertiary rounded-md hover:bg-surface-2"
                          >
                            Skip
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Active Policy Summary ──────────────────────────────────────────── */}
      <div className="bg-surface-1 border border-border rounded-xl p-5">
        <h2 className="text-xs font-medium text-text-secondary uppercase tracking-wider mb-3 font-mono">What your agent can do</h2>
        {summary.length === 0 ? (
          <div className="text-center py-6">
            <pre className="text-text-tertiary text-xs font-mono mb-3">{`  ( ?_? ) no rules set  `}</pre>
            <p className="text-xs text-text-secondary">Apply a preset below to configure your security policy.</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {summary.map(({ category, label, decision }) => {
              const d = DECISION_STYLES[decision] ?? DECISION_STYLES.APPROVE;
              return (
                <div key={category} className={`flex items-center justify-between px-3 py-2.5 rounded-lg border ${d.bg}`}>
                  <span className="text-sm text-text-primary">{label}</span>
                  <div className="flex items-center gap-2">
                    <span className={`font-mono text-xs ${d.color}`}>[{d.icon}]</span>
                    <span className={`text-xs font-medium ${d.color}`}>{d.label}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Presets ────────────────────────────────────────────────────────── */}
      <div>
        <h2 className="text-xs font-medium text-text-secondary uppercase tracking-wider mb-3 font-mono">Quick presets</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {presets.map(p => {
            const isConfirming = presetConfirm === p.id;
            const isApplying = presetMutation.isPending && presetConfirm === p.id;
            return (
              <div key={p.id} className="bg-surface-1 border border-border rounded-xl p-4 transition-colors hover:border-accent/20">
                {isConfirming ? (
                  <div className="text-center space-y-3">
                    <p className="text-xs text-amber-400 font-mono">[!] Replace all rules?</p>
                    <p className="text-[10px] text-text-secondary">This will delete existing rules and apply the "{p.name}" preset.</p>
                    <div className="flex gap-2 justify-center">
                      <button
                        onClick={() => presetMutation.mutate(p.id)}
                        disabled={isApplying}
                        className="px-3 py-1.5 text-xs bg-accent text-white rounded-lg hover:bg-accent-bright disabled:opacity-50 font-medium"
                      >
                        {isApplying ? 'Applying...' : 'Confirm'}
                      </button>
                      <button
                        onClick={() => setPresetConfirm(null)}
                        className="px-3 py-1.5 text-xs bg-surface-3 text-text-secondary rounded-lg hover:bg-surface-2"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => setPresetConfirm(p.id)} className="w-full text-left">
                    <div className="text-sm font-semibold text-text-primary mb-1">{p.name}</div>
                    <div className="text-[11px] text-text-secondary leading-relaxed">{p.description}</div>
                    <div className="text-[10px] text-text-tertiary mt-2 font-mono">{p.ruleCount} rules</div>
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Advanced Rules ─────────────────────────────────────────────────── */}
      <div className="bg-surface-1 border border-border rounded-xl overflow-hidden">
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-surface-2/30 transition-colors"
        >
          <span className="text-xs text-text-secondary font-mono">
            advanced: {rules.length} rules
          </span>
          <span className="text-text-tertiary text-xs font-mono">{showAdvanced ? '[-]' : '[+]'}</span>
        </button>

        {showAdvanced && (
          <div className="border-t border-border">
            {isLoading ? (
              <div className="p-6 text-center text-text-secondary text-xs animate-pulse">Loading...</div>
            ) : rules.length === 0 ? (
              <div className="p-6 text-center text-text-secondary text-xs font-mono">no rules configured</div>
            ) : (
              <div className="divide-y divide-border">
                {rules.map((rule: PolicyRule) => {
                  const d = DECISION_STYLES[rule.decision];
                  return (
                    <div key={rule.id} className={`px-4 py-2.5 flex items-center gap-3 text-xs hover:bg-surface-2/30 transition-colors ${!rule.enabled ? 'opacity-40' : ''}`}>
                      <span className="text-text-tertiary font-mono w-6 text-right">#{rule.priority}</span>
                      <span className="text-text-primary font-mono flex-1 truncate">
                        {rule.matchTool}
                        {rule.matchCategory && <span className="text-text-tertiary ml-2">[{rule.matchCategory}]</span>}
                      </span>
                      <span className="text-text-tertiary">{rule.riskTier}</span>
                      <span className={`font-mono font-medium ${d?.color ?? 'text-text-secondary'}`}>{rule.decision}</span>
                      {rule.source !== 'manual' && (
                        <span className="text-[9px] text-text-tertiary bg-surface-3 px-1.5 py-0.5 rounded">{rule.source}</span>
                      )}
                      <button
                        onClick={() => toggleMutation.mutate({ id: rule.id, enabled: !rule.enabled })}
                        className={`w-7 h-3.5 rounded-full transition-colors ${rule.enabled ? 'bg-emerald-500' : 'bg-surface-3'}`}
                      >
                        <div className={`w-3 h-3 bg-white rounded-full transition-transform ${rule.enabled ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
                      </button>
                      <button onClick={() => delMutation.mutate(rule.id)} className="text-red-400/40 hover:text-red-400 font-mono">×</button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

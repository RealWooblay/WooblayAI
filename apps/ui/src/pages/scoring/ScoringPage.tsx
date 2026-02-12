import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useStats, useSuggestions } from '../../api/hooks/useStats.ts';
import { createScore } from '../../api/client.ts';
import { Badge, statusVariant } from '../../components/common/Badge.tsx';
import { Button } from '../../components/common/Button.tsx';
import { Card } from '../../components/common/Card.tsx';

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <Card className="text-center">
      <p className="text-2xl font-bold text-gray-100">{value}</p>
      <p className="mt-1 text-xs text-gray-500">{label}</p>
    </Card>
  );
}

export function ScoringPage() {
  const { data: stats, isLoading: statsLoading } = useStats();
  const { data: suggestions } = useSuggestions();

  const qc = useQueryClient();
  const scoreMut = useMutation({
    mutationFn: createScore,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['stats'] }),
  });

  const [form, setForm] = useState({
    taskId: '',
    agentPubkey: '',
    label: 'SUCCESS',
    notes: '',
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.taskId.trim()) return;
    scoreMut.mutate(
      {
        taskId: form.taskId.trim(),
        agentPubkey: form.agentPubkey.trim() || 'dashboard',
        label: form.label,
        notes: form.notes || undefined,
      },
      {
        onSuccess: () => setForm({ taskId: '', agentPubkey: '', label: 'SUCCESS', notes: '' }),
      },
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <h2 className="text-lg font-semibold text-gray-100">Scoring &amp; Stats</h2>

      {/* Stats cards */}
      {statsLoading ? (
        <div className="py-8 text-center text-gray-500">Loading stats…</div>
      ) : stats ? (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard label="Total Tool Calls" value={stats.totalToolCalls} />
            <StatCard label="Total Receipts" value={stats.totalReceipts} />
            <StatCard label="Pending Approvals" value={stats.pendingApprovals} />
            <StatCard label="Agents Registered" value={stats.agentsRegistered} />
          </div>

          {/* By decision */}
          {Object.keys(stats.byDecision).length > 0 && (
            <Card>
              <h3 className="mb-2 text-sm font-semibold text-gray-300">By Decision</h3>
              <div className="flex flex-wrap gap-3">
                {Object.entries(stats.byDecision).map(([k, v]) => (
                  <div key={k} className="flex items-center gap-2 text-sm">
                    <Badge variant={statusVariant(k)}>{k}</Badge>
                    <span className="text-gray-300">{v}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* By risk tier */}
          {Object.keys(stats.byRiskTier).length > 0 && (
            <Card>
              <h3 className="mb-2 text-sm font-semibold text-gray-300">By Risk Tier</h3>
              <div className="flex flex-wrap gap-3">
                {Object.entries(stats.byRiskTier).map(([k, v]) => (
                  <div key={k} className="flex items-center gap-2 text-sm">
                    <span className="font-mono text-gray-400">{k}</span>
                    <span className="text-gray-300">{v}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      ) : null}

      {/* Suggestions */}
      {suggestions && suggestions.length > 0 && (
        <Card className="space-y-3">
          <h3 className="text-sm font-semibold text-gray-300">Policy Suggestions</h3>
          <div className="space-y-2">
            {suggestions.map((s, i) => (
              <div
                key={i}
                className="flex items-center justify-between rounded-md border border-gray-800 bg-gray-800/50 px-4 py-2"
              >
                <div className="space-y-0.5">
                  <span className="font-mono text-sm text-gray-200">{s.toolName}</span>
                  <p className="text-xs text-gray-500">{s.reason}</p>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <Badge variant={statusVariant(s.currentDecision)}>
                    {s.currentDecision}
                  </Badge>
                  <span className="text-gray-600">→</span>
                  <Badge variant={statusVariant(s.suggestedDecision)}>
                    {s.suggestedDecision}
                  </Badge>
                  <span className="text-gray-500">
                    ({(s.failureRate * 100).toFixed(0)}% fail, n={s.sampleSize})
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Score labeling form */}
      <Card className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-300">Label a Task</h3>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <input
              type="text"
              value={form.taskId}
              onChange={(e) => setForm({ ...form, taskId: e.target.value })}
              placeholder="Task ID"
              required
              className="rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm font-mono text-gray-200 placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
            />
            <select
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              className="rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 focus:border-indigo-500 focus:outline-none"
            >
              <option value="SUCCESS">SUCCESS</option>
              <option value="FAIL">FAIL</option>
              <option value="NEEDS_HUMAN">NEEDS_HUMAN</option>
              <option value="REGRESSION">REGRESSION</option>
            </select>
          </div>
          <textarea
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder="Notes (optional)"
            rows={2}
            className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
          />
          <Button type="submit" size="sm" disabled={scoreMut.isPending}>
            {scoreMut.isPending ? 'Submitting…' : 'Submit Score'}
          </Button>
          {scoreMut.isSuccess && (
            <span className="ml-3 text-xs text-emerald-400">Score saved!</span>
          )}
        </form>
      </Card>
    </div>
  );
}

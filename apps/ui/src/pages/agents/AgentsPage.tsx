/**
 * Agents — registry and management of all agents.
 * Wired to real API: /api/agents CRUD.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { getAgents, createAgent, updateAgent, deleteAgent } from '../../api/client.ts';
import { Badge } from '../../components/common/Badge.tsx';
import { Button } from '../../components/common/Button.tsx';
import clsx from 'clsx';
import type { AgentStatus, TrustLevel } from '@wooblay/types';

function statusVariant(status: AgentStatus) {
  switch (status) {
    case 'active':
      return 'green' as const;
    case 'suspended':
      return 'yellow' as const;
    case 'revoked':
      return 'red' as const;
    default:
      return 'gray' as const;
  }
}

function trustLevelColor(level: TrustLevel | string) {
  switch (level) {
    case 'autonomous':
      return 'text-emerald-400';
    case 'write-with-approvals':
      return 'text-amber-400';
    case 'read-only':
      return 'text-blue-400';
    default:
      return 'text-text-tertiary';
  }
}

function TrustBar({ score, level }: { score: number; level: string }) {
  const pct = Math.max(0, Math.min(100, score));
  const barColor =
    pct >= 75 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-500' : 'bg-red-500';

  return (
    <div className="flex items-center gap-2">
      <div className="w-20 h-1.5 rounded-full bg-surface-3 overflow-hidden">
        <div
          className={clsx('h-full rounded-full transition-all', barColor)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[10px] font-mono text-text-tertiary tabular-nums">{score}</span>
      <span className={clsx('text-[10px] font-medium', trustLevelColor(level))}>
        {level}
      </span>
    </div>
  );
}

export function AgentsPage() {
  const qc = useQueryClient();
  const { data: agents, isLoading } = useQuery({
    queryKey: ['agents'],
    queryFn: getAgents,
  });

  const createMut = useMutation({
    mutationFn: createAgent,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['agents'] }),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Parameters<typeof updateAgent>[1] }) =>
      updateAgent(id, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['agents'] }),
  });

  const deleteMut = useMutation({
    mutationFn: deleteAgent,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['agents'] }),
  });

  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState('');
  const [formPubkey, setFormPubkey] = useState('');

  function handleAdd() {
    if (!formPubkey.trim() || !formName.trim()) return;
    createMut.mutate(
      { pubkey: formPubkey.trim(), name: formName.trim(), allowlisted: true },
      {
        onSuccess: () => {
          setFormName('');
          setFormPubkey('');
          setShowForm(false);
        },
      },
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-text-primary">Agents</h1>
          <p className="text-xs text-text-tertiary mt-0.5">
            {agents?.length ?? 0} registered agents
          </p>
        </div>
        <Button size="sm" variant="secondary" onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Cancel' : '+ Register Agent'}
        </Button>
      </div>

      {/* Add form */}
      {showForm && (
        <div className="rounded-lg border border-accent/30 bg-surface-1 p-4 space-y-3 glow-accent">
          <div className="grid grid-cols-2 gap-3">
            <input
              type="text"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="Agent name"
              className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:border-accent focus:outline-none"
            />
            <input
              type="text"
              value={formPubkey}
              onChange={(e) => setFormPubkey(e.target.value)}
              placeholder="Public key (Ed25519)"
              className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm font-mono text-text-primary placeholder-text-muted focus:border-accent focus:outline-none"
            />
          </div>
          <Button size="sm" onClick={handleAdd} disabled={createMut.isPending}>
            {createMut.isPending ? 'Registering…' : 'Register Agent'}
          </Button>
        </div>
      )}

      {/* Agent list */}
      {isLoading ? (
        <div className="py-12 text-center text-text-muted text-sm">Loading agents...</div>
      ) : !agents?.length ? (
        <div className="rounded-lg border border-border bg-surface-1 py-16 text-center">
          <div className="text-3xl opacity-20 mb-3">🤖</div>
          <p className="text-text-secondary text-sm">No agents registered</p>
          <p className="text-text-muted text-xs mt-1">Register an agent to start supervising</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {/* Header */}
          <div className="flex items-center gap-4 px-5 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
            <span className="w-8" />
            <span className="w-32">Agent</span>
            <span className="flex-1 font-mono">Public Key</span>
            <span className="w-20">Status</span>
            <span className="w-48">Trust</span>
            <span className="w-12 text-center">Allow</span>
            <span className="w-16" />
          </div>

          {agents.map((agent) => (
            <Link
              key={agent.id}
              to={`/agents/${agent.pubkey}`}
              className="flex items-center gap-4 rounded-lg border border-border bg-surface-1 px-5 py-3 transition-all hover:border-border-strong hover:bg-surface-2 group"
            >
              {/* Avatar */}
              <div
                className={clsx(
                  'h-8 w-8 rounded-full flex items-center justify-center text-[12px] font-bold shrink-0',
                  agent.status === 'active'
                    ? 'bg-indigo-500/15 text-indigo-400 ring-1 ring-indigo-500/30'
                    : 'bg-surface-3 text-text-muted ring-1 ring-border',
                )}
              >
                {agent.name.charAt(0).toUpperCase()}
              </div>

              {/* Name */}
              <div className="w-32 min-w-0">
                <span className="text-sm font-medium text-text-primary group-hover:text-accent-bright truncate block">
                  {agent.name}
                </span>
                {agent.parentPubkey && (
                  <span className="text-[9px] text-text-muted">depth {agent.spawnDepth}</span>
                )}
              </div>

              {/* Pubkey */}
              <span className="flex-1 text-[10px] font-mono text-text-muted truncate">
                {agent.pubkey}
              </span>

              {/* Status */}
              <span className="w-20">
                <Badge variant={statusVariant(agent.status)}>{agent.status}</Badge>
              </span>

              {/* Trust */}
              <span className="w-48">
                <TrustBar
                  score={agent.trustScore ?? 50}
                  level={(agent.trustLevel as TrustLevel) ?? 'read-only'}
                />
              </span>

              {/* Allowlist toggle */}
              <span className="w-12 flex justify-center" onClick={(e) => e.preventDefault()}>
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    updateMut.mutate({
                      id: agent.id,
                      body: { allowlisted: !agent.allowlisted },
                    });
                  }}
                  className={clsx(
                    'relative inline-flex h-5 w-9 items-center rounded-full transition-colors cursor-pointer',
                    agent.allowlisted ? 'bg-indigo-600' : 'bg-surface-3',
                  )}
                >
                  <span
                    className={clsx(
                      'inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform',
                      agent.allowlisted ? 'translate-x-4.5' : 'translate-x-0.5',
                    )}
                  />
                </button>
              </span>

              {/* Delete */}
              <span className="w-16 flex justify-end" onClick={(e) => e.preventDefault()}>
                <Button
                  size="xs"
                  variant="ghost"
                  className="!text-red-400 hover:!text-red-300 opacity-0 group-hover:opacity-100"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (confirm(`Delete agent "${agent.name}"?`)) {
                      deleteMut.mutate(agent.id);
                    }
                  }}
                >
                  Delete
                </Button>
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

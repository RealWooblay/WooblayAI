import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getConnections, createConnection, revokeConnection, testConnection, getSensorsStatus } from '../../api/client.ts';
import { Spinner } from '../../components/common/Spinner.tsx';
import { Button } from '../../components/common/Button.tsx';

export function ConnectionsPage() {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [newConn, setNewConn] = useState({ name: '', credential: '' });

  const { data: connections, isLoading } = useQuery({
    queryKey: ['connections'],
    queryFn: getConnections,
    refetchInterval: 30_000,
  });

  const { data: sensors } = useQuery({
    queryKey: ['sensors-status'],
    queryFn: getSensorsStatus,
    refetchInterval: 30_000,
  });

  const createMut = useMutation({
    mutationFn: () => createConnection({
      provider: 'github',
      name: newConn.name,
      credential: newConn.credential,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['connections'] });
      setShowAdd(false);
      setNewConn({ name: '', credential: '' });
    },
  });

  const revokeMut = useMutation({
    mutationFn: (id: string) => revokeConnection(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['connections'] }),
  });

  const testMut = useMutation({
    mutationFn: (id: string) => testConnection(id),
  });

  if (isLoading) {
    return <div className="flex items-center justify-center h-64"><Spinner /></div>;
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-semibold text-text-primary">Connections</h1>
          <p className="text-xs text-text-tertiary mt-0.5">Manage service credentials for the Tool Gateway</p>
        </div>
        <Button size="sm" onClick={() => setShowAdd(true)}>+ Add GitHub</Button>
      </div>

      {/* Add Connection Form */}
      {showAdd && (
        <div className="bg-surface-1 border border-accent/30 rounded-lg p-4 mb-6">
          <h3 className="text-sm font-medium text-text-primary mb-3">Add GitHub Connection</h3>
          <div className="space-y-3">
            <div>
              <label className="text-[10px] text-text-tertiary uppercase tracking-wider block mb-1">Name</label>
              <input
                type="text"
                value={newConn.name}
                onChange={(e) => setNewConn((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="My GitHub Org"
                className="w-full bg-surface-2 border border-border rounded px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
              />
            </div>
            <div>
              <label className="text-[10px] text-text-tertiary uppercase tracking-wider block mb-1">
                Personal Access Token
              </label>
              <input
                type="password"
                value={newConn.credential}
                onChange={(e) => setNewConn((prev) => ({ ...prev, credential: e.target.value }))}
                placeholder="ghp_..."
                className="w-full bg-surface-2 border border-border rounded px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none font-mono"
              />
              <p className="text-[10px] text-text-tertiary mt-1">
                The token is stored encrypted and NEVER exposed to agents. Only the Tool Gateway uses it.
              </p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => createMut.mutate()} disabled={!newConn.name || !newConn.credential || createMut.isPending}>
                {createMut.isPending ? 'Creating...' : 'Create'}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setShowAdd(false)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}

      {/* Connection List */}
      {(connections ?? []).length === 0 && !showAdd && (
        <div className="text-xs text-text-tertiary bg-surface-1 border border-border rounded-lg p-6 text-center">
          No connections yet. Add a GitHub connection to enable the Tool Gateway.
        </div>
      )}

      <div className="space-y-2">
        {(connections ?? []).map((conn: any) => (
          <div
            key={conn.id}
            className="flex items-center justify-between px-4 py-3 rounded-lg bg-surface-1 border border-border"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-surface-3 rounded-lg flex items-center justify-center">
                <GithubIcon />
              </div>
              <div>
                <p className="text-[13px] font-medium text-text-primary">{conn.name}</p>
                <p className="text-[10px] text-text-tertiary">
                  {conn.provider} · {conn.status} · {JSON.parse(conn.scopes || '[]').join(', ')}
                </p>
              </div>
            </div>

            <div className="flex gap-2 items-center">
              <ConnectionStatusBadge status={conn.status} />
              <Button
                size="xs"
                variant="secondary"
                onClick={() => testMut.mutate(conn.id)}
                disabled={conn.status === 'revoked'}
              >
                {testMut.isPending ? '...' : 'Test'}
              </Button>
              {conn.status === 'active' && (
                <Button size="xs" variant="danger" onClick={() => revokeMut.mutate(conn.id)}>
                  Revoke
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Sensors Status */}
      {sensors && (
        <>
          <h2 className="text-sm font-medium text-text-primary mb-3 mt-8">Active Sensors</h2>
          <div className="space-y-2">
            {sensors.sensors?.map((sensor: any) => (
              <div
                key={sensor.id}
                className="flex items-center justify-between px-4 py-3 rounded-lg bg-surface-1 border border-border"
              >
                <div>
                  <p className="text-[13px] font-medium text-text-primary">{sensor.name}</p>
                  <p className="text-[10px] text-text-tertiary">{sensor.description}</p>
                </div>
                <div className="flex items-center gap-3">
                  {sensor.intent && (
                    <span className={`text-[9px] font-medium uppercase px-1.5 py-0.5 rounded ${
                      sensor.intent === 'qa' ? 'bg-blue-500/15 text-blue-400' :
                      sensor.intent === 'review' ? 'bg-purple-500/15 text-purple-400' :
                      'bg-red-500/15 text-red-400'
                    }`}>
                      {sensor.intent}
                    </span>
                  )}
                  <span className="text-[10px] text-text-tertiary">
                    {sensor.incidentsLast24h} incidents (24h)
                  </span>
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded ${
                    sensor.enabled ? 'bg-emerald-500/15 text-emerald-400' : 'bg-zinc-500/15 text-zinc-400'
                  }`}>
                    {sensor.enabled ? 'Active' : 'Disabled'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ConnectionStatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active: 'bg-emerald-500/15 text-emerald-400',
    revoked: 'bg-red-500/15 text-red-400',
    error: 'bg-amber-500/15 text-amber-400',
  };
  return (
    <span className={`text-[10px] font-medium px-2 py-0.5 rounded ${colors[status] ?? colors.error}`}>
      {status}
    </span>
  );
}

function GithubIcon() {
  return (
    <svg className="w-4 h-4 text-text-secondary" viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

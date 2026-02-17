import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getConnections,
  createConnection,
  revokeConnection,
  testConnection,
  getSensorsStatus,
  updateSensorConfig,
  getWebhookUrl,
  initSensor,
} from '../../api/client.ts';
import { Spinner } from '../../components/common/Spinner.tsx';
import { Button } from '../../components/common/Button.tsx';
import { EmptyState } from '../../components/common/EmptyState.tsx';

export function SensorsPage() {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [newConn, setNewConn] = useState({ name: '', credential: '' });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [webhookInfo, setWebhookInfo] = useState<Record<string, any>>({});
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const { data: sensors, isLoading: sensorsLoading } = useQuery({
    queryKey: ['sensors-status'],
    queryFn: getSensorsStatus,
    refetchInterval: 15_000,
  });

  const { data: _connections, isLoading: connectionsLoading } = useQuery({
    queryKey: ['connections'],
    queryFn: getConnections,
    refetchInterval: 30_000,
  });

  const createMut = useMutation({
    mutationFn: () => createConnection({
      provider: 'github',
      name: newConn.name,
      credential: newConn.credential,
    }),
    onSuccess: async (conn: any) => {
      qc.invalidateQueries({ queryKey: ['connections'] });
      qc.invalidateQueries({ queryKey: ['sensors-status'] });
      setShowAdd(false);
      setNewConn({ name: '', credential: '' });
      // Auto-init sensor
      try {
        await initSensor(conn.id);
      } catch { /* best effort */ }
    },
  });

  const revokeMut = useMutation({
    mutationFn: (id: string) => revokeConnection(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['connections'] });
      qc.invalidateQueries({ queryKey: ['sensors-status'] });
    },
  });

  const toggleSensorMut = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      updateSensorConfig(id, { sensorEnabled: enabled }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sensors-status'] });
    },
  });

  const testMut = useMutation({
    mutationFn: (id: string) => testConnection(id),
  });

  const handleCopy = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handleExpand = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    if (!webhookInfo[id]) {
      try {
        const info = await getWebhookUrl(id);
        setWebhookInfo((prev) => ({ ...prev, [id]: info }));
      } catch { /* ignore */ }
    }
  };

  const isLoading = sensorsLoading || connectionsLoading;

  if (isLoading) {
    return <div className="flex items-center justify-center h-64"><Spinner /></div>;
  }

  const sensorList = sensors?.sensors ?? [];

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-semibold text-text-primary">Sensors</h1>
          <p className="text-xs text-text-tertiary mt-0.5">
            {sensorList.length} sensor{sensorList.length !== 1 ? 's' : ''} configured
            {sensors?.totalOperationsLast24h > 0 && ` · ${sensors.totalOperationsLast24h} operations (24h)`}
          </p>
        </div>
        <Button size="sm" onClick={() => setShowAdd(true)}>+ Add GitHub Sensor</Button>
      </div>

      {/* Add Connection Form */}
      {showAdd && (
        <div className="bg-surface-1 border border-accent/30 rounded-lg p-4 mb-6">
          <h3 className="text-sm font-medium text-text-primary mb-3">Add GitHub Sensor</h3>
          <p className="text-[10px] text-text-tertiary mb-3">
            A sensor connects to GitHub and monitors for events. It gives Wooblay both eyes (monitoring) and hands (agent actions via the Tool Gateway).
          </p>
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
                Token is encrypted and never exposed to agents. Only the Tool Gateway uses it.
              </p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => createMut.mutate()} disabled={!newConn.name || !newConn.credential || createMut.isPending}>
                {createMut.isPending ? 'Creating...' : 'Create Sensor'}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setShowAdd(false)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}

      {/* Sensor List */}
      {sensorList.length === 0 && !showAdd && (
        <EmptyState
          title="No sensors configured"
          description="Add a GitHub connection to start monitoring. Sensors detect events and create operations for your agents."
        />
      )}

      <div className="space-y-3">
        {sensorList.map((sensor: any) => (
          <div key={sensor.id} className="rounded-lg bg-surface-1 border border-border overflow-hidden">
            {/* Sensor Header */}
            <div
              className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-surface-2 transition-colors"
              onClick={() => handleExpand(sensor.id)}
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-surface-3 rounded-lg flex items-center justify-center">
                  <GithubIcon />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-[13px] font-medium text-text-primary">{sensor.name}</p>
                    <SensorStatusBadge enabled={sensor.sensorEnabled} status={sensor.status} />
                  </div>
                  <p className="text-[10px] text-text-tertiary">
                    {sensor.provider} · {sensor.operationsLast24h} operations (24h)
                  </p>
                </div>
              </div>

              <div className="flex gap-2 items-center">
                {/* Sensor Toggle */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleSensorMut.mutate({ id: sensor.id, enabled: !sensor.sensorEnabled });
                  }}
                  className={`relative w-9 h-5 rounded-full transition-colors ${
                    sensor.sensorEnabled ? 'bg-accent' : 'bg-surface-3'
                  }`}
                >
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                    sensor.sensorEnabled ? 'translate-x-[18px]' : 'translate-x-0.5'
                  }`} />
                </button>

                <Button
                  size="xs"
                  variant="secondary"
                  onClick={(e) => { e.stopPropagation(); testMut.mutate(sensor.id); }}
                >
                  {testMut.isPending ? '...' : 'Test'}
                </Button>

                <span className="text-[10px] text-text-muted">{expandedId === sensor.id ? '▲' : '▼'}</span>
              </div>
            </div>

            {/* Expanded Panel */}
            {expandedId === sensor.id && (
              <div className="border-t border-border px-4 py-4 space-y-4">
                {/* Webhook URL & Secret */}
                {webhookInfo[sensor.id] && (
                  <div>
                    <h4 className="text-[11px] font-medium text-text-secondary mb-2">Webhook Setup</h4>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <label className="text-[10px] text-text-tertiary w-20 shrink-0">Payload URL</label>
                        <code className="flex-1 text-[11px] font-mono text-text-primary bg-surface-2 border border-border rounded px-2 py-1 truncate">
                          {webhookInfo[sensor.id].webhookUrl}
                        </code>
                        <button
                          onClick={() => handleCopy(webhookInfo[sensor.id].webhookUrl, `url-${sensor.id}`)}
                          className="text-[10px] text-accent hover:text-accent-bright shrink-0"
                        >
                          {copiedField === `url-${sensor.id}` ? '✓ Copied' : 'Copy'}
                        </button>
                      </div>
                      <div className="flex items-center gap-2">
                        <label className="text-[10px] text-text-tertiary w-20 shrink-0">Secret</label>
                        <code className="flex-1 text-[11px] font-mono text-text-primary bg-surface-2 border border-border rounded px-2 py-1 truncate">
                          {webhookInfo[sensor.id].webhookSecret}
                        </code>
                        <button
                          onClick={() => handleCopy(webhookInfo[sensor.id].webhookSecret, `secret-${sensor.id}`)}
                          className="text-[10px] text-accent hover:text-accent-bright shrink-0"
                        >
                          {copiedField === `secret-${sensor.id}` ? '✓ Copied' : 'Copy'}
                        </button>
                      </div>
                    </div>
                    <div className="mt-2 text-[10px] text-text-tertiary bg-surface-2 border border-border rounded p-2">
                      <p className="font-medium mb-1">Setup in GitHub:</p>
                      <ol className="list-decimal list-inside space-y-0.5">
                        <li>Go to your repo Settings → Webhooks → Add webhook</li>
                        <li>Paste the Payload URL above</li>
                        <li>Content type: application/json</li>
                        <li>Paste the Secret above</li>
                        <li>Select events: Push, Pull requests, Check runs</li>
                      </ol>
                    </div>
                  </div>
                )}

                {/* Sensor Config */}
                {sensor.sensorConfig && (
                  <div>
                    <h4 className="text-[11px] font-medium text-text-secondary mb-2">Sensor Configuration</h4>
                    <div className="grid grid-cols-2 gap-2">
                      <ConfigItem label="Watch Events" value={(sensor.sensorConfig.watchEvents ?? []).join(', ')} />
                      <ConfigItem label="Ignore Drafts" value={sensor.sensorConfig.ignoreDrafts ? 'Yes' : 'No'} />
                      <ConfigItem label="Ignore Bots" value={sensor.sensorConfig.ignoreBot ? 'Yes' : 'No'} />
                      <ConfigItem label="Auto-Create Run" value={sensor.sensorConfig.autoCreateRun !== false ? 'Yes' : 'No'} />
                      {sensor.sensorConfig.branchFilter && (
                        <ConfigItem label="Branch Filter" value={sensor.sensorConfig.branchFilter.join(', ')} />
                      )}
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-2 pt-2 border-t border-border">
                  {sensor.status === 'active' && (
                    <Button size="xs" variant="danger" onClick={() => revokeMut.mutate(sensor.id)}>
                      Revoke Connection
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function SensorStatusBadge({ enabled, status }: { enabled: boolean; status: string }) {
  if (status === 'revoked') {
    return <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-red-500/15 text-red-400">Revoked</span>;
  }
  if (!enabled) {
    return <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-zinc-500/15 text-zinc-400">Paused</span>;
  }
  return <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400">Active</span>;
}

function ConfigItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface-2 border border-border rounded px-2.5 py-1.5">
      <p className="text-[9px] text-text-tertiary uppercase tracking-wider">{label}</p>
      <p className="text-[11px] text-text-primary font-mono mt-0.5">{value}</p>
    </div>
  );
}

function GithubIcon() {
  return (
    <svg className="w-4 h-4 text-text-secondary" viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

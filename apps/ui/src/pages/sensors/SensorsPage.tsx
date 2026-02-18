/**
 * Sensors — configure event sensing (webhooks, event rules) per connection.
 * Use the same key as in Credentials, or add a new credential for a sensor separately.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  getConnections,
  getSensorsStatus,
  getWebhookUrl,
  updateSensorConfig,
  getOrgPolicySettings,
} from '../../api/client.ts';
import { EventRulesEditor } from '../connections/ConnectionsPage.tsx';
import { Spinner } from '../../components/common/Spinner.tsx';
import { Button } from '../../components/common/Button.tsx';
import { EmptyState } from '../../components/common/EmptyState.tsx';

const SENSOR_CAPABLE_PROVIDERS = ['github'];

function ProviderIcon({ provider }: { provider: string }) {
  if (provider === 'github') {
    return (
      <svg className="w-4 h-4 text-text-secondary" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
      </svg>
    );
  }
  return <span className="text-[11px] text-text-muted">{provider[0].toUpperCase()}</span>;
}

export function SensorsPage() {
  const qc = useQueryClient();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [webhookInfo, setWebhookInfo] = useState<Record<string, any>>({});
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const { data: orgSettings } = useQuery({
    queryKey: ['org-settings'],
    queryFn: getOrgPolicySettings,
    staleTime: 60_000,
  });
  const isFullPlatform = (orgSettings as any)?.platformMode === 'full';

  const { data: connections, isLoading: connectionsLoading } = useQuery({
    queryKey: ['connections'],
    queryFn: getConnections,
    refetchInterval: 15_000,
  });

  const { data: sensors } = useQuery({
    queryKey: ['sensors-status'],
    queryFn: getSensorsStatus,
    refetchInterval: 15_000,
    enabled: isFullPlatform,
  });

  const toggleSensorMut = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      updateSensorConfig(id, { sensorEnabled: enabled }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['connections'] });
      qc.invalidateQueries({ queryKey: ['sensors-status'] });
    },
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
      } catch {
        /* ignore */
      }
    }
  };

  if (connectionsLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner />
      </div>
    );
  }

  const allConnections = connections ?? [];
  const sensorCapable = allConnections.filter((c: any) => SENSOR_CAPABLE_PROVIDERS.includes(c.provider));
  const sensorMap: Record<string, any> = {};
  for (const s of sensors?.sensors ?? []) {
    sensorMap[s.id] = s;
  }

  // Firewall mode: no sensors
  if (!isFullPlatform) {
    return (
      <div className="max-w-4xl mx-auto">
        <h1 className="text-lg font-semibold text-text-primary">Sensors</h1>
        <p className="text-xs text-text-tertiary mt-0.5 mb-4">
          Event sensing (webhooks, event rules) is part of Full Platform. Request access at the bottom of Setup.
        </p>
        <EmptyState
          title="Full Platform only"
          description="Sensors require Full Platform mode. Add credentials in Credentials; in Full Platform you can configure sensing per connection here."
        />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto" data-tour="tour-sensors">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-semibold text-text-primary">Sensors</h1>
          <p className="text-xs text-text-tertiary mt-0.5">
            Sensors use existing credentials. Add a credential in Credentials first; then enable and configure sensing here for each connection that supports it.
          </p>
        </div>
        <Link
          to="/credentials"
          className="inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-all duration-150 px-3 py-1.5 text-xs whitespace-nowrap bg-indigo-600 text-white hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-0 shadow-sm shadow-indigo-500/20"
        >
          + Add credential
        </Link>
      </div>

      {sensorCapable.length === 0 ? (
        <EmptyState
          title="No sensor-capable credentials yet"
          description="Add a GitHub connection in Credentials first. You can use one key for both execution and sensing, or add a separate credential for this sensor."
          action={
            <Link to="/credentials">
              <Button size="sm">Go to Credentials</Button>
            </Link>
          }
        />
      ) : (
        <div className="space-y-3">
          {sensorCapable.map((conn: any) => {
            const sensing = conn.sensing ?? { enabled: false, config: null };
            return (
              <div key={conn.id} className="rounded-lg bg-surface-1 border border-border overflow-hidden">
                <div
                  className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-surface-2 transition-colors"
                  onClick={() => handleExpand(conn.id)}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-surface-3 rounded-lg flex items-center justify-center">
                      <ProviderIcon provider={conn.provider} />
                    </div>
                    <div>
                      <p className="text-[13px] font-medium text-text-primary">{conn.name}</p>
                      <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded ${sensing.enabled ? 'bg-blue-500/15 text-blue-400' : 'bg-zinc-500/15 text-zinc-400'}`}>
                        Sensing: {sensing.enabled ? 'Active' : 'Off'}
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-2 items-center">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleSensorMut.mutate({ id: conn.id, enabled: !sensing.enabled });
                      }}
                      title={sensing.enabled ? 'Pause sensing' : 'Enable sensing'}
                      className={`relative h-6 w-11 shrink-0 rounded-full p-1 transition-colors ${sensing.enabled ? 'bg-accent' : 'bg-surface-3'}`}
                    >
                      <span
                        className={`absolute top-1 left-1 h-4 w-4 rounded-full bg-white shadow transition-transform duration-200 ${sensing.enabled ? 'translate-x-3' : 'translate-x-0'}`}
                      />
                    </button>
                    <span className="text-[10px] text-text-muted">{expandedId === conn.id ? '▲' : '▼'}</span>
                  </div>
                </div>

                {expandedId === conn.id && (
                  <div className="border-t border-border px-4 py-4 space-y-4">
                    {webhookInfo[conn.id] && (
                      <div>
                        <h4 className="text-[11px] font-medium text-text-secondary mb-2">Webhook Setup</h4>
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <label className="text-[10px] text-text-tertiary w-20 shrink-0">Payload URL</label>
                            <code className="flex-1 text-[11px] font-mono text-text-primary bg-surface-2 border border-border rounded px-2 py-1 truncate">
                              {webhookInfo[conn.id].webhookUrl}
                            </code>
                            <button
                              onClick={() => handleCopy(webhookInfo[conn.id].webhookUrl, `url-${conn.id}`)}
                              className="text-[10px] text-accent hover:text-accent-bright shrink-0"
                            >
                              {copiedField === `url-${conn.id}` ? '✓ Copied' : 'Copy'}
                            </button>
                          </div>
                          <div className="flex items-center gap-2">
                            <label className="text-[10px] text-text-tertiary w-20 shrink-0">Secret</label>
                            <code className="flex-1 text-[11px] font-mono text-text-primary bg-surface-2 border border-border rounded px-2 py-1 truncate">
                              {webhookInfo[conn.id].webhookSecret}
                            </code>
                            <button
                              onClick={() => handleCopy(webhookInfo[conn.id].webhookSecret, `secret-${conn.id}`)}
                              className="text-[10px] text-accent hover:text-accent-bright shrink-0"
                            >
                              {copiedField === `secret-${conn.id}` ? '✓ Copied' : 'Copy'}
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
                    <EventRulesEditor connectionId={conn.id} sensorConfig={sensing.config} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getConnections,
  createConnection,
  revokeConnection,
  deleteConnection,
  testConnection,
  getSensorsStatus,
  updateSensorConfig,
  getWebhookUrl,
  initSensor,
  getOrgPolicySettings,
  getConnectionSecrets,
  addConnectionSecret,
  deleteConnectionSecret,
} from '../../api/client.ts';
import { Spinner } from '../../components/common/Spinner.tsx';
import { Button } from '../../components/common/Button.tsx';
import { EmptyState } from '../../components/common/EmptyState.tsx';

// ── Event Rules Editor (full platform only, sensing-capable connections) ───

const PRIORITY_OPTIONS = ['P0', 'P1', 'P2'] as const;

export function EventRulesEditor({ connectionId, sensorConfig }: { connectionId: string; sensorConfig: any }) {
  const qc = useQueryClient();
  const existing: any[] = sensorConfig?.eventRules ?? [];
  const [rules, setRules] = useState<{ event: string; intent: string; priority: string; enabled: boolean }[]>(() =>
    existing.length > 0 ? existing.map((r: any) => ({ event: r.event, intent: r.intent ?? '', priority: r.priority ?? 'P2', enabled: r.enabled })) : [],
  );
  const [newEvent, setNewEvent] = useState('');
  const [newIntent, setNewIntent] = useState('');

  const saveMut = useMutation({
    mutationFn: (eventRules: any[]) =>
      updateSensorConfig(connectionId, { sensorConfig: { ...sensorConfig, eventRules } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['connections'] }),
  });

  const addRule = () => {
    if (!newEvent.trim()) return;
    setRules((prev) => [...prev, { event: newEvent.trim(), intent: newIntent.trim() || '', priority: 'P2', enabled: true }]);
    setNewEvent('');
    setNewIntent('');
  };

  const removeRule = (idx: number) => setRules((prev) => prev.filter((_, i) => i !== idx));

  const updateRule = (idx: number, field: string, value: any) => {
    setRules((prev) => prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
  };

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h4 className="text-[11px] font-medium text-text-secondary">Event Rules</h4>
          <p className="text-[10px] text-text-tertiary mt-0.5">
            Filter which webhook events create operations. Leave empty to process all events.
          </p>
        </div>
        <Button size="xs" onClick={() => saveMut.mutate(rules)} disabled={saveMut.isPending}>
          {saveMut.isPending ? 'Saving…' : saveMut.isSuccess ? '✓ Saved' : 'Save'}
        </Button>
      </div>

      {rules.length > 0 && (
        <div className="space-y-1.5 mb-3">
          {rules.map((rule, idx) => (
            <div key={idx} className={`bg-surface-2 border rounded-lg px-3 py-2 flex items-center justify-between ${rule.enabled ? 'border-accent/30' : 'border-border opacity-50'}`}>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  className={`relative h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors ${rule.enabled ? 'bg-accent' : 'bg-surface-3'}`}
                  onClick={() => updateRule(idx, 'enabled', !rule.enabled)}
                >
                  <span className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-200 ${rule.enabled ? 'translate-x-4' : 'translate-x-0'}`} />
                </button>
                <code className="text-[11px] font-mono text-text-primary">{rule.event}</code>
                {rule.intent && <span className="text-[9px] text-text-muted bg-surface-3 px-1.5 py-0.5 rounded">{rule.intent}</span>}
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={rule.priority}
                  onChange={(e) => updateRule(idx, 'priority', e.target.value)}
                  className="bg-surface-3 border border-border rounded px-1.5 py-0.5 text-[10px] text-text-primary focus:border-accent focus:outline-none"
                >
                  {PRIORITY_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
                <button onClick={() => removeRule(idx)} className="text-[10px] text-red-400/60 hover:text-red-400">remove</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2 items-end">
        <div className="flex-1 min-w-0">
          <label className="text-[9px] text-text-muted font-mono uppercase block mb-1">Event</label>
          <input
            value={newEvent}
            onChange={(e) => setNewEvent(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addRule()}
            placeholder="e.g. CI failure, PR opened, deploy..."
            className="w-full bg-surface-2 border border-border rounded px-2.5 py-1.5 text-[11px] font-mono text-text-primary placeholder:text-text-muted focus:border-accent/50 outline-none"
          />
        </div>
        <div className="w-28">
          <label className="text-[9px] text-text-muted font-mono uppercase block mb-1">Intent (optional)</label>
          <input
            value={newIntent}
            onChange={(e) => setNewIntent(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addRule()}
            placeholder="fix, review..."
            className="w-full bg-surface-2 border border-border rounded px-2.5 py-1.5 text-[11px] font-mono text-text-primary placeholder:text-text-muted focus:border-accent/50 outline-none"
          />
        </div>
        <button
          onClick={addRule}
          disabled={!newEvent.trim()}
          className="shrink-0 px-3 py-1.5 rounded bg-accent text-surface-0 text-[11px] font-mono font-medium disabled:opacity-40 hover:bg-accent/90 transition-colors"
        >
          Add
        </button>
      </div>

      {rules.length === 0 && (
        <p className="text-[9px] text-text-muted mt-2">
          No rules — all webhook events will create operations and the AI classifies from context.
        </p>
      )}
    </div>
  );
}

// ── Connection Secrets Editor ──────────────────────────────────────────
// Manages exec_only secrets for a connection. Each secret maps to an env
// var injected into L3 ephemeral containers. This is how users configure
// which env var name an MCP server expects (e.g. SLACK_BOT_TOKEN).

function ConnectionSecretsEditor({ connectionId }: { connectionId: string }) {
  const qc = useQueryClient();
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [newMode, setNewMode] = useState<'exec_only' | 'agent'>('exec_only');

  const { data: secretsData, isLoading } = useQuery({
    queryKey: ['connection-secrets', connectionId],
    queryFn: () => getConnectionSecrets(connectionId),
  });

  const addMut = useMutation({
    mutationFn: () => addConnectionSecret(connectionId, { key: newKey.trim(), value: newValue, mode: newMode }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['connection-secrets', connectionId] });
      setNewKey('');
      setNewValue('');
    },
  });

  const deleteMut = useMutation({
    mutationFn: (key: string) => deleteConnectionSecret(connectionId, key),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['connection-secrets', connectionId] }),
  });

  const secrets = secretsData?.secrets ?? [];

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div>
          <h4 className="text-[11px] font-medium text-text-secondary">Environment Variables</h4>
          <p className="text-[10px] text-text-tertiary mt-0.5">
            Environment variables injected into secure containers at runtime.
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="text-[10px] text-text-muted py-2">Loading...</div>
      ) : (
        <>
          {secrets.length > 0 && (
            <div className="space-y-1.5 mb-3">
              {secrets.map((s: { key: string; mode: string }) => (
                <div key={s.key} className="bg-surface-2 border border-border rounded-lg px-3 py-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <code className="text-[11px] font-mono text-text-primary">{s.key}</code>
                    <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded ${s.mode === 'exec_only' ? 'bg-amber-500/15 text-amber-400' : 'bg-blue-500/15 text-blue-400'}`}>
                      {s.mode === 'exec_only' ? 'Secure container' : 'agent'}
                    </span>
                    <span className="text-[9px] text-text-muted">••••••••</span>
                  </div>
                  <button
                    onClick={() => deleteMut.mutate(s.key)}
                    className="text-[10px] text-red-400/60 hover:text-red-400"
                  >
                    remove
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2 items-end">
            <div className="flex-1 min-w-0">
              <label className="text-[9px] text-text-muted font-mono uppercase block mb-1">Env var name</label>
              <input
                value={newKey}
                onChange={(e) => setNewKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_'))}
                onKeyDown={(e) => e.key === 'Enter' && newKey && newValue && addMut.mutate()}
                placeholder="SLACK_BOT_TOKEN"
                className="w-full bg-surface-2 border border-border rounded px-2.5 py-1.5 text-[11px] font-mono text-text-primary placeholder:text-text-muted focus:border-accent/50 outline-none"
              />
            </div>
            <div className="flex-1 min-w-0">
              <label className="text-[9px] text-text-muted font-mono uppercase block mb-1">Secret value</label>
              <input
                type="password"
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && newKey && newValue && addMut.mutate()}
                placeholder="xoxb-..."
                className="w-full bg-surface-2 border border-border rounded px-2.5 py-1.5 text-[11px] font-mono text-text-primary placeholder:text-text-muted focus:border-accent/50 outline-none"
              />
            </div>
            <div className="w-24">
              <label className="text-[9px] text-text-muted font-mono uppercase block mb-1">Scope</label>
              <select
                value={newMode}
                onChange={(e) => setNewMode(e.target.value as 'exec_only' | 'agent')}
                className="w-full bg-surface-2 border border-border rounded px-2 py-1.5 text-[10px] text-text-primary focus:border-accent focus:outline-none"
              >
                <option value="exec_only">Secure container</option>
                <option value="agent">Agent</option>
              </select>
            </div>
            <button
              onClick={() => addMut.mutate()}
              disabled={!newKey.trim() || !newValue || addMut.isPending}
              className="shrink-0 px-3 py-1.5 rounded bg-accent text-surface-0 text-[11px] font-mono font-medium disabled:opacity-40 hover:bg-accent/90 transition-colors"
            >
              {addMut.isPending ? '...' : 'Add'}
            </button>
          </div>

          {secrets.length === 0 && (
            <p className="text-[9px] text-text-muted mt-2">
              No secrets configured. Add env vars that MCP servers need (e.g., GITHUB_TOKEN, SLACK_BOT_TOKEN). Secrets are injected only into isolated execution containers — agents never see them.
            </p>
          )}
        </>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────

export type ConnectionsPageProps = { credentialsOnly?: boolean };

export function ConnectionsPage({ credentialsOnly = false }: ConnectionsPageProps) {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [provider, setProvider] = useState('');
  const [name, setName] = useState('');
  const [credential, setCredential] = useState('');
  const [envVarName, setEnvVarName] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const [webhookInfo, setWebhookInfo] = useState<Record<string, any>>({});
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const { data: connections, isLoading: connectionsLoading } = useQuery({
    queryKey: ['connections'],
    queryFn: getConnections,
    refetchInterval: 15_000,
  });

  const { data: orgSettings } = useQuery({
    queryKey: ['org-settings'],
    queryFn: getOrgPolicySettings,
    staleTime: 60_000,
  });
  const isFullPlatform = (orgSettings as any)?.platformMode === 'full';

  const { data: sensors } = useQuery({
    queryKey: ['sensors-status'],
    queryFn: getSensorsStatus,
    refetchInterval: 15_000,
    enabled: isFullPlatform && !credentialsOnly,
  });

  const createMut = useMutation({
    mutationFn: () => {
      const normalized = provider.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
      return createConnection({
        provider: normalized,
        name: name.trim(),
        credential,
      });
    },
    onSuccess: async (conn: any) => {
      // If user specified a custom env var name, create an exec_only secret
      // so the credential is injected with exactly that name into L3 containers.
      const customKey = envVarName.trim();
      if (customKey && credential) {
        try {
          await addConnectionSecret(conn.id, { key: customKey, value: credential, mode: 'exec_only' });
        } catch { /* best effort — user can add manually in Secrets tab */ }
      }
      qc.invalidateQueries({ queryKey: ['connections'] });
      qc.invalidateQueries({ queryKey: ['sensors-status'] });
      setAddOpen(false);
      setProvider('');
      setName('');
      setCredential('');
      setEnvVarName('');
      if (provider.trim().toLowerCase() === 'github') {
        try { await initSensor(conn.id); } catch { /* best effort */ }
      }
    },
  });

  const revokeMut = useMutation({
    mutationFn: (id: string) => revokeConnection(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['connections'] });
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteConnection(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['connections'] });
      qc.invalidateQueries({ queryKey: ['sensors-status'] });
    },
  });

  const toggleSensorMut = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      updateSensorConfig(id, { sensorEnabled: enabled }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['connections'] });
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
    if (expandedId === id) { setExpandedId(null); return; }
    setExpandedId(id);
    setExpandedSection(null);
    if (!webhookInfo[id]) {
      try {
        const info = await getWebhookUrl(id);
        setWebhookInfo((prev) => ({ ...prev, [id]: info }));
      } catch { /* ignore */ }
    }
  };

  if (connectionsLoading) {
    return <div className="flex items-center justify-center h-64"><Spinner /></div>;
  }

  const connectionList = connections ?? [];
  const sensorMap: Record<string, any> = {};
  for (const s of (sensors?.sensors ?? [])) {
    sensorMap[s.id] = s;
  }

  return (
    <div className="max-w-4xl mx-auto" data-tour={credentialsOnly ? 'tour-credentials' : 'tour-connections'}>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-semibold text-text-primary">{credentialsOnly ? 'Credentials' : 'Connections'}</h1>
          <p className="text-xs text-text-tertiary mt-0.5">
            {credentialsOnly
              ? 'Encrypted credentials injected into secure containers. Agents never see them.'
              : 'Service credentials for secure execution. Encrypted, isolated, ephemeral.'}
          </p>
        </div>
        <Button size="sm" onClick={() => setAddOpen(true)} data-tour={credentialsOnly ? 'tour-add-credential' : 'tour-add-connection'}>
          + Add {credentialsOnly ? 'credential' : 'connection'}
        </Button>
      </div>

      {/* ── Add Connection Form ────────────────────────────────────── */}
      {addOpen && (
        <div className="bg-surface-1 border border-accent/30 rounded-xl p-5 mb-6">
          <h3 className="text-sm font-medium text-text-primary mb-1">Add Connection</h3>
          <p className="text-[10px] text-text-tertiary mb-4">
            Add credentials for any service. Encrypted at rest and injected only into isolated containers at execution time.
          </p>

          <div className="space-y-3">
            <div>
              <label className="text-[10px] text-text-tertiary uppercase tracking-wider block mb-1">Provider</label>
              <input
                type="text"
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                placeholder="github, aws, slack, stripe, linear, vercel..."
                className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none font-mono"
                autoFocus
              />
            </div>
            <div>
              <label className="text-[10px] text-text-tertiary uppercase tracking-wider block mb-1">Connection Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Production GitHub, Staging AWS"
                className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
              />
            </div>
            <div>
              <label className="text-[10px] text-text-tertiary uppercase tracking-wider block mb-1">Credential</label>
              <textarea
                value={credential}
                onChange={(e) => setCredential(e.target.value)}
                placeholder="API key, token, secret, or JSON key..."
                rows={3}
                className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none font-mono"
              />
              <p className="text-[10px] text-text-tertiary mt-1">
                Encrypted at rest. Never exposed to agents. Only used inside isolated secure containers.
              </p>
            </div>
            <div>
              <label className="text-[10px] text-text-tertiary uppercase tracking-wider block mb-1">
                Env var name <span className="text-text-muted normal-case">(for MCP servers)</span>
              </label>
              <input
                type="text"
                value={envVarName}
                onChange={(e) => setEnvVarName(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_'))}
                placeholder="SLACK_BOT_TOKEN, GITHUB_TOKEN, OPENAI_API_KEY..."
                className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none font-mono"
              />
              <p className="text-[10px] text-text-tertiary mt-1">
                The env var name your MCP server expects. Your credential will be injected with this exact name into execution containers. Leave empty for standard providers (GitHub, AWS).
              </p>
            </div>
            <div className="flex gap-2 pt-1">
              <Button
                size="sm"
                onClick={() => createMut.mutate()}
                disabled={!provider.trim() || !name.trim() || !credential.trim() || createMut.isPending}
              >
                {createMut.isPending ? 'Adding...' : 'Add Connection'}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => { setAddOpen(false); setProvider(''); setName(''); setCredential(''); }}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Empty State ────────────────────────────────────────────── */}
      {connectionList.length === 0 && !addOpen && (
        <EmptyState
          title={credentialsOnly ? 'No credentials configured' : 'No connections configured'}
          description="Add service credentials to enable secure execution. Link them to MCP tool servers for isolated container injection."
        />
      )}

      {/* ── Connection List ────────────────────────────────────────── */}
      <div className="space-y-3">
        {connectionList.map((conn: any) => {
          const sensorData = sensorMap[conn.id];
          const sensing = conn.sensing ?? { enabled: false, config: null };
          const isSensingCapable = conn.provider === 'github';

          return (
            <div key={conn.id} className="rounded-xl bg-surface-1 border border-border overflow-hidden">
              <div
                className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-surface-2/50 transition-colors"
                onClick={() => handleExpand(conn.id)}
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-surface-3 rounded-lg flex items-center justify-center">
                    <ProviderIcon provider={conn.provider} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-[13px] font-medium text-text-primary">{conn.name}</p>
                      <span className="text-[9px] font-mono text-text-muted bg-surface-2 px-1.5 py-0.5 rounded">{conn.provider}</span>
                      <ConnectionStatusBadge status={conn.status} />
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      {!credentialsOnly && isFullPlatform && isSensingCapable && (
                        <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded ${sensing.enabled ? 'bg-blue-500/15 text-blue-400' : 'bg-zinc-500/15 text-zinc-400'}`}>
                          Sensing: {sensing.enabled ? 'Active' : 'Off'}
                        </span>
                      )}
                      {!credentialsOnly && isFullPlatform && sensorData && sensorData.operationsLast24h > 0 && (
                        <span className="text-[9px] text-text-tertiary">{sensorData.operationsLast24h} ops (24h)</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex gap-2 items-center">
                  {!credentialsOnly && isFullPlatform && isSensingCapable && (
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleSensorMut.mutate({ id: conn.id, enabled: !sensing.enabled }); }}
                      title={sensing.enabled ? 'Pause sensing' : 'Enable sensing'}
                      className={`relative h-6 w-11 shrink-0 rounded-full p-1 transition-colors ${sensing.enabled ? 'bg-accent' : 'bg-surface-3'}`}
                    >
                      <span className={`absolute top-1 left-1 h-4 w-4 rounded-full bg-white shadow transition-transform duration-200 ${sensing.enabled ? 'translate-x-5' : 'translate-x-0'}`} />
                    </button>
                  )}
                  <Button size="xs" variant="secondary" onClick={(e) => { e.stopPropagation(); testMut.mutate(conn.id); }}>
                    {testMut.isPending ? '...' : 'Test'}
                  </Button>
                  <span className="text-[10px] text-text-muted">{expandedId === conn.id ? '▲' : '▼'}</span>
                </div>
              </div>

              {expandedId === conn.id && (
                <div className="border-t border-border">
                  <div className="flex border-b border-border">
                    <button
                      className={`px-4 py-2 text-[11px] font-medium transition-colors ${!expandedSection || expandedSection === 'secrets' ? 'text-accent border-b-2 border-accent' : 'text-text-tertiary hover:text-text-secondary'}`}
                      onClick={() => setExpandedSection(expandedSection === 'secrets' ? null : 'secrets')}
                    >
                      Secrets
                    </button>
                    {!credentialsOnly && isFullPlatform && isSensingCapable && (
                      <button
                        className={`px-4 py-2 text-[11px] font-medium transition-colors ${expandedSection === 'sensing' ? 'text-accent border-b-2 border-accent' : 'text-text-tertiary hover:text-text-secondary'}`}
                        onClick={() => setExpandedSection(expandedSection === 'sensing' ? null : 'sensing')}
                      >
                        Sensing
                      </button>
                    )}
                  </div>

                  <div className="px-4 py-4 space-y-4">
                    {(!expandedSection || expandedSection === 'secrets') && (
                      <>
                        <div className="text-[11px] text-text-secondary rounded-lg bg-surface-2 border border-border p-3">
                          <p className="font-medium text-text-primary mb-1">Secure Execution</p>
                          <p>Actions run in an isolated container. The policy engine enforces your rules on every call.</p>
                        </div>
                        <ConnectionSecretsEditor connectionId={conn.id} />
                      </>
                    )}

                    {!credentialsOnly && expandedSection === 'sensing' && (
                      <>
                        {webhookInfo[conn.id] && (
                          <div>
                            <h4 className="text-[11px] font-medium text-text-secondary mb-2">Webhook Setup</h4>
                            <div className="space-y-2">
                              <div className="flex items-center gap-2">
                                <label className="text-[10px] text-text-tertiary w-20 shrink-0">Payload URL</label>
                                <code className="flex-1 text-[11px] font-mono text-text-primary bg-surface-2 border border-border rounded px-2 py-1 truncate">
                                  {webhookInfo[conn.id].webhookUrl}
                                </code>
                                <button onClick={() => handleCopy(webhookInfo[conn.id].webhookUrl, `url-${conn.id}`)} className="text-[10px] text-accent hover:text-accent-bright shrink-0">
                                  {copiedField === `url-${conn.id}` ? '✓ Copied' : 'Copy'}
                                </button>
                              </div>
                              <div className="flex items-center gap-2">
                                <label className="text-[10px] text-text-tertiary w-20 shrink-0">Secret</label>
                                <code className="flex-1 text-[11px] font-mono text-text-primary bg-surface-2 border border-border rounded px-2 py-1 truncate">
                                  {webhookInfo[conn.id].webhookSecret}
                                </code>
                                <button onClick={() => handleCopy(webhookInfo[conn.id].webhookSecret, `secret-${conn.id}`)} className="text-[10px] text-accent hover:text-accent-bright shrink-0">
                                  {copiedField === `secret-${conn.id}` ? '✓ Copied' : 'Copy'}
                                </button>
                              </div>
                            </div>
                            <div className="mt-2 text-[10px] text-text-tertiary bg-surface-2 border border-border rounded p-2">
                              <p className="font-medium mb-1">Setup in GitHub:</p>
                              <ol className="list-decimal list-inside space-y-0.5">
                                <li>Repo Settings → Webhooks → Add webhook</li>
                                <li>Paste the Payload URL and Secret above</li>
                                <li>Content type: application/json</li>
                                <li>Events: Push, Pull requests, Check runs</li>
                              </ol>
                            </div>
                          </div>
                        )}
                        {sensing.config && (
                          <div>
                            <h4 className="text-[11px] font-medium text-text-secondary mb-2">Sensor Configuration</h4>
                            <div className="grid grid-cols-2 gap-2">
                              <ConfigItem label="Watch Events" value={(sensing.config.watchEvents ?? []).join(', ')} />
                              <ConfigItem label="Ignore Drafts" value={sensing.config.ignoreDrafts ? 'Yes' : 'No'} />
                              <ConfigItem label="Ignore Bots" value={sensing.config.ignoreBot ? 'Yes' : 'No'} />
                              <ConfigItem label="Auto-Create Run" value={sensing.config.autoCreateRun !== false ? 'Yes' : 'No'} />
                            </div>
                          </div>
                        )}
                        <EventRulesEditor connectionId={conn.id} sensorConfig={sensing.config} />
                      </>
                    )}

                    {(credentialsOnly || !expandedSection) && (
                      <div className="flex gap-2 pt-2 flex-wrap">
                        {conn.status === 'active' && (
                          <Button size="xs" variant="danger" onClick={() => revokeMut.mutate(conn.id)} disabled={revokeMut.isPending}>
                            Revoke
                          </Button>
                        )}
                        <Button
                          size="xs"
                          variant="danger"
                          onClick={() => {
                            if (window.confirm(`Permanently delete "${conn.name}"? This cannot be undone.`)) {
                              deleteMut.mutate(conn.id);
                            }
                          }}
                          disabled={deleteMut.isPending}
                          className="border-red-500/30 text-red-400 hover:bg-red-500/10"
                        >
                          Delete
                        </Button>
                      </div>
                    )}
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

// ── Helper Components ─────────────────────────────────────────────────

function ConnectionStatusBadge({ status }: { status: string }) {
  if (status === 'revoked') return <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-red-500/15 text-red-400">Revoked</span>;
  if (status === 'error') return <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-red-500/15 text-red-400">Error</span>;
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

function ProviderIcon({ provider }: { provider: string }) {
  if (provider === 'github') {
    return (
      <svg className="w-4 h-4 text-text-secondary" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
      </svg>
    );
  }
  const initial = (provider || '?')[0].toUpperCase();
  return <span className="text-[11px] font-bold text-text-secondary">{initial}</span>;
}

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
  updateScopeBoundaries,
  getConnectionSecrets,
  addConnectionSecret,
  deleteConnectionSecret,
} from '../../api/client.ts';
import { Spinner } from '../../components/common/Spinner.tsx';
import { Button } from '../../components/common/Button.tsx';
import { EmptyState } from '../../components/common/EmptyState.tsx';

type AddStep = false | 'select' | 'github' | 'aws' | 'gcp' | 'webhook';

const CONNECTION_TYPES: { id: string; label: string; description: string; available: boolean; hasSensing: boolean; hasExecution: boolean }[] = [
  { id: 'github', label: 'GitHub', description: 'Monitor repos and execute git/PR actions securely.', available: true, hasSensing: true, hasExecution: true },
  { id: 'aws', label: 'AWS', description: 'Deploy, manage S3, ECS, read CloudWatch logs securely.', available: true, hasSensing: false, hasExecution: true },
  { id: 'gcp', label: 'GCP', description: 'Deploy Cloud Run, manage GCS, read logs securely.', available: true, hasSensing: false, hasExecution: true },
  { id: 'webhook', label: 'Generic Webhook', description: 'Receive events from any system via URL. Coming soon.', available: false, hasSensing: true, hasExecution: false },
];

// ── Scope Boundary Editor ─────────────────────────────────────────────

function ScopeBoundaryEditor({ connection, onSave }: { connection: any; onSave: (boundaries: any) => void }) {
  const actions = connection.execution?.actions ?? [];
  const existing = connection.execution?.scopeBoundaries ?? [];

  const [boundaries, setBoundaries] = useState<Record<string, { allowed: string; blocked: string }>>(() => {
    const initial: Record<string, { allowed: string; blocked: string }> = {};
    for (const sb of existing) {
      initial[sb.action] = {
        allowed: sb.allowed.join(', '),
        blocked: sb.blocked.join(', '),
      };
    }
    return initial;
  });

  const handleSave = () => {
    const parsed: Record<string, { allowed: string[]; blocked: string[] }> = {};
    for (const [action, { allowed, blocked }] of Object.entries(boundaries)) {
      const allowList = allowed.split(',').map((s) => s.trim()).filter(Boolean);
      const blockList = blocked.split(',').map((s) => s.trim()).filter(Boolean);
      if (allowList.length > 0 || blockList.length > 0) {
        parsed[action] = { allowed: allowList, blocked: blockList };
      }
    }
    onSave(parsed);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-[11px] font-medium text-text-secondary">Scope Boundaries</h4>
        <Button size="xs" onClick={handleSave}>Save boundaries</Button>
      </div>
      <p className="text-[10px] text-text-tertiary">
        Control what each action can target. Use glob patterns: <code className="bg-surface-2 px-1 rounded">feature-*</code>, <code className="bg-surface-2 px-1 rounded">*</code>. Blocked takes precedence.
      </p>
      {actions.map((action: any) => (
        <div key={action.action} className="bg-surface-2 border border-border rounded-lg p-3">
          <div className="flex items-center gap-2 mb-2">
            <code className="text-[11px] font-mono text-accent">{action.action}</code>
            <span className="text-[10px] text-text-tertiary">{action.description}</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[9px] text-text-tertiary uppercase tracking-wider block mb-0.5">Allowed patterns</label>
              <input
                type="text"
                value={boundaries[action.action]?.allowed ?? ''}
                onChange={(e) => setBoundaries((prev) => ({
                  ...prev,
                  [action.action]: { ...prev[action.action] ?? { allowed: '', blocked: '' }, allowed: e.target.value },
                }))}
                placeholder="feature-*, fix/*"
                className="w-full bg-surface-3 border border-border rounded px-2 py-1 text-[11px] text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none font-mono"
              />
            </div>
            <div>
              <label className="text-[9px] text-text-tertiary uppercase tracking-wider block mb-0.5">Blocked patterns</label>
              <input
                type="text"
                value={boundaries[action.action]?.blocked ?? ''}
                onChange={(e) => setBoundaries((prev) => ({
                  ...prev,
                  [action.action]: { ...prev[action.action] ?? { allowed: '', blocked: '' }, blocked: e.target.value },
                }))}
                placeholder="main, master, production"
                className="w-full bg-surface-3 border border-border rounded px-2 py-1 text-[11px] text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none font-mono"
              />
            </div>
          </div>
        </div>
      ))}
      {actions.length === 0 && (
        <p className="text-[10px] text-text-muted italic">No actions available for this provider.</p>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────

export function ConnectionsPage() {
  const qc = useQueryClient();
  const [addStep, setAddStep] = useState<AddStep>(false);
  const [selectedProvider, setSelectedProvider] = useState<string>('github');
  const [newConn, setNewConn] = useState({ name: '', credential: '', awsSecretKey: '', awsRegion: 'us-east-1', gcpProject: '' });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const [webhookInfo, setWebhookInfo] = useState<Record<string, any>>({});
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const { data: connections, isLoading: connectionsLoading } = useQuery({
    queryKey: ['connections'],
    queryFn: getConnections,
    refetchInterval: 15_000,
  });

  const { data: sensors } = useQuery({
    queryKey: ['sensors-status'],
    queryFn: getSensorsStatus,
    refetchInterval: 15_000,
  });

  const createMut = useMutation({
    mutationFn: () => {
      const payload: any = {
        provider: selectedProvider,
        name: newConn.name,
        credential: newConn.credential,
      };
      if (selectedProvider === 'aws') {
        payload.metadata = {
          awsSecretAccessKey: newConn.awsSecretKey,
          region: newConn.awsRegion || 'us-east-1',
        };
      }
      if (selectedProvider === 'gcp') {
        payload.metadata = {
          project: newConn.gcpProject || undefined,
        };
      }
      return createConnection(payload);
    },
    onSuccess: async (conn: any) => {
      qc.invalidateQueries({ queryKey: ['connections'] });
      qc.invalidateQueries({ queryKey: ['sensors-status'] });
      setAddStep(false);
      setSelectedProvider('github');
      setNewConn({ name: '', credential: '', awsSecretKey: '', awsRegion: 'us-east-1', gcpProject: '' });
      if (selectedProvider === 'github') {
        try { await initSensor(conn.id); } catch { /* best effort */ }
      }
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
      qc.invalidateQueries({ queryKey: ['connections'] });
      qc.invalidateQueries({ queryKey: ['sensors-status'] });
    },
  });

  const scopeMut = useMutation({
    mutationFn: ({ id, boundaries }: { id: string; boundaries: any }) =>
      updateScopeBoundaries(id, boundaries),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['connections'] });
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
    <div className="max-w-4xl mx-auto" data-tour="tour-connections">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-semibold text-text-primary">Connections</h1>
          <p className="text-xs text-text-tertiary mt-0.5">
            Manage your service integrations. Each connection powers both sensing (inbound events) and secure execution (agent actions).
          </p>
        </div>
        <Button size="sm" onClick={() => setAddStep('select')} data-tour="tour-add-connection">+ Add connection</Button>
      </div>

      {/* Three-Layer Security Summary */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="bg-surface-1 border border-border rounded-lg p-3 text-center">
          <div className="text-[10px] text-accent font-medium uppercase tracking-wider mb-1">Layer 1</div>
          <div className="text-[12px] text-text-primary font-medium">Policy + Scope</div>
          <div className="text-[10px] text-text-tertiary mt-0.5">Should this happen?</div>
        </div>
        <div className="bg-surface-1 border border-border rounded-lg p-3 text-center">
          <div className="text-[10px] text-amber-400 font-medium uppercase tracking-wider mb-1">Layer 2</div>
          <div className="text-[12px] text-text-primary font-medium">Simulation</div>
          <div className="text-[10px] text-text-tertiary mt-0.5">Will it do what it claims?</div>
        </div>
        <div className="bg-surface-1 border border-border rounded-lg p-3 text-center">
          <div className="text-[10px] text-emerald-400 font-medium uppercase tracking-wider mb-1">Layer 3</div>
          <div className="text-[12px] text-text-primary font-medium">Secure Execution</div>
          <div className="text-[10px] text-text-tertiary mt-0.5">Ephemeral, credential-free</div>
        </div>
      </div>

      {/* Step 1: Choose type */}
      {addStep === 'select' && (
        <div className="bg-surface-1 border border-accent/30 rounded-lg p-4 mb-6">
          <h3 className="text-sm font-medium text-text-primary mb-2">Add connection</h3>
          <p className="text-[10px] text-text-tertiary mb-3">
            Choose a service to connect. Your credential is encrypted and never exposed to agents — it's only used inside ephemeral execution containers.
          </p>
          <div className="grid gap-2">
            {CONNECTION_TYPES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => { if (t.available) { setSelectedProvider(t.id); setAddStep(t.id as any); } }}
                disabled={!t.available}
                className={`text-left rounded-lg border px-4 py-3 transition-colors ${
                  t.available ? 'border-border hover:border-accent/50 hover:bg-surface-2' : 'border-border/50 opacity-60 cursor-not-allowed'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium text-text-primary">{t.label}</span>
                    <div className="flex gap-1">
                      {t.hasSensing && <span className="text-[8px] font-medium px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400">SENSING</span>}
                      {t.hasExecution && <span className="text-[8px] font-medium px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400">EXECUTION</span>}
                    </div>
                    {!t.available && <span className="text-[10px] text-text-tertiary">Coming soon</span>}
                  </div>
                  {t.available && <span className="text-[10px] text-accent">Select →</span>}
                </div>
                <p className="text-[11px] text-text-tertiary mt-1">{t.description}</p>
              </button>
            ))}
          </div>
          <div className="mt-3">
            <Button size="sm" variant="secondary" onClick={() => setAddStep(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {/* Step 2: GitHub form */}
      {addStep === 'github' && (
        <div className="bg-surface-1 border border-accent/30 rounded-lg p-4 mb-6">
          <h3 className="text-sm font-medium text-text-primary mb-3">Connect GitHub</h3>
          <p className="text-[10px] text-text-tertiary mb-3">
            One key, two roles. Your PAT enables both <strong>sensing</strong> (webhook events create operations) and <strong>secure execution</strong> (agents execute git push, create PRs via ephemeral containers).
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
              <label className="text-[10px] text-text-tertiary uppercase tracking-wider block mb-1">Personal Access Token</label>
              <input
                type="password"
                value={newConn.credential}
                onChange={(e) => setNewConn((prev) => ({ ...prev, credential: e.target.value }))}
                placeholder="ghp_..."
                className="w-full bg-surface-2 border border-border rounded px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none font-mono"
              />
              <p className="text-[10px] text-text-tertiary mt-1">
                Encrypted at rest. Never exposed to agents. Only used inside Gate-controlled ephemeral containers.
              </p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => createMut.mutate()} disabled={!newConn.name || !newConn.credential || createMut.isPending}>
                {createMut.isPending ? 'Connecting...' : 'Connect GitHub'}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setAddStep('select')}>← Back</Button>
              <Button size="sm" variant="secondary" onClick={() => setAddStep(false)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}

      {/* Step 2: AWS form */}
      {addStep === 'aws' && (
        <div className="bg-surface-1 border border-accent/30 rounded-lg p-4 mb-6">
          <h3 className="text-sm font-medium text-text-primary mb-3">Connect AWS</h3>
          <p className="text-[10px] text-text-tertiary mb-3">
            Provide IAM credentials. Your secret key is encrypted at rest and only injected into ephemeral execution containers — agents never see it.
          </p>
          <div className="space-y-3">
            <div>
              <label className="text-[10px] text-text-tertiary uppercase tracking-wider block mb-1">Name</label>
              <input
                type="text"
                value={newConn.name}
                onChange={(e) => setNewConn((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="Production AWS"
                className="w-full bg-surface-2 border border-border rounded px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
              />
            </div>
            <div>
              <label className="text-[10px] text-text-tertiary uppercase tracking-wider block mb-1">Access Key ID</label>
              <input
                type="text"
                value={newConn.credential}
                onChange={(e) => setNewConn((prev) => ({ ...prev, credential: e.target.value }))}
                placeholder="AKIAIOSFODNN7EXAMPLE"
                className="w-full bg-surface-2 border border-border rounded px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none font-mono"
              />
            </div>
            <div>
              <label className="text-[10px] text-text-tertiary uppercase tracking-wider block mb-1">Secret Access Key</label>
              <input
                type="password"
                value={newConn.awsSecretKey}
                onChange={(e) => setNewConn((prev) => ({ ...prev, awsSecretKey: e.target.value }))}
                placeholder="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
                className="w-full bg-surface-2 border border-border rounded px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none font-mono"
              />
              <p className="text-[10px] text-text-tertiary mt-1">
                Encrypted at rest. Never exposed to agents. Only used inside Gate-controlled ephemeral containers.
              </p>
            </div>
            <div>
              <label className="text-[10px] text-text-tertiary uppercase tracking-wider block mb-1">Region</label>
              <input
                type="text"
                value={newConn.awsRegion}
                onChange={(e) => setNewConn((prev) => ({ ...prev, awsRegion: e.target.value }))}
                placeholder="us-east-1"
                className="w-full bg-surface-2 border border-border rounded px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none font-mono"
              />
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => createMut.mutate()} disabled={!newConn.name || !newConn.credential || !newConn.awsSecretKey || createMut.isPending}>
                {createMut.isPending ? 'Connecting...' : 'Connect AWS'}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setAddStep('select')}>← Back</Button>
              <Button size="sm" variant="secondary" onClick={() => setAddStep(false)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}

      {/* Step 2: GCP form */}
      {addStep === 'gcp' && (
        <div className="bg-surface-1 border border-accent/30 rounded-lg p-4 mb-6">
          <h3 className="text-sm font-medium text-text-primary mb-3">Connect GCP</h3>
          <p className="text-[10px] text-text-tertiary mb-3">
            Paste your service account JSON key. Encrypted at rest and only injected into ephemeral containers for secure execution.
          </p>
          <div className="space-y-3">
            <div>
              <label className="text-[10px] text-text-tertiary uppercase tracking-wider block mb-1">Name</label>
              <input
                type="text"
                value={newConn.name}
                onChange={(e) => setNewConn((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="Production GCP"
                className="w-full bg-surface-2 border border-border rounded px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
              />
            </div>
            <div>
              <label className="text-[10px] text-text-tertiary uppercase tracking-wider block mb-1">Service Account Key (JSON)</label>
              <textarea
                value={newConn.credential}
                onChange={(e) => setNewConn((prev) => ({ ...prev, credential: e.target.value }))}
                placeholder='{"type": "service_account", "project_id": "...", ...}'
                rows={4}
                className="w-full bg-surface-2 border border-border rounded px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none font-mono"
              />
              <p className="text-[10px] text-text-tertiary mt-1">
                Encrypted at rest. Never exposed to agents. Only used inside Gate-controlled ephemeral containers.
              </p>
            </div>
            <div>
              <label className="text-[10px] text-text-tertiary uppercase tracking-wider block mb-1">Project ID (optional)</label>
              <input
                type="text"
                value={newConn.gcpProject}
                onChange={(e) => setNewConn((prev) => ({ ...prev, gcpProject: e.target.value }))}
                placeholder="my-project-123"
                className="w-full bg-surface-2 border border-border rounded px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none font-mono"
              />
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => createMut.mutate()} disabled={!newConn.name || !newConn.credential || createMut.isPending}>
                {createMut.isPending ? 'Connecting...' : 'Connect GCP'}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setAddStep('select')}>← Back</Button>
              <Button size="sm" variant="secondary" onClick={() => setAddStep(false)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}

      {/* Connection List */}
      {connectionList.length === 0 && !addStep && (
        <EmptyState
          title="No connections configured"
          description="Connect a service like GitHub to start sensing events and enabling secure agent execution."
        />
      )}

      <div className="space-y-3">
        {connectionList.map((conn: any) => {
          const sensorData = sensorMap[conn.id];
          const sensing = conn.sensing ?? { enabled: false, config: null };
          const execution = conn.execution ?? { actions: [], scopeBoundaries: [] };
          const isSensingCapable = conn.provider === 'github';

          return (
            <div key={conn.id} className="rounded-lg bg-surface-1 border border-border overflow-hidden">
              {/* Connection Header */}
              <div
                className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-surface-2 transition-colors"
                onClick={() => handleExpand(conn.id)}
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-surface-3 rounded-lg flex items-center justify-center">
                    <ProviderIcon provider={conn.provider} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-[13px] font-medium text-text-primary">{conn.name}</p>
                      <ConnectionStatusBadge status={conn.status} />
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      {isSensingCapable && (
                        <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded ${
                          sensing.enabled ? 'bg-blue-500/15 text-blue-400' : 'bg-zinc-500/15 text-zinc-400'
                        }`}>
                          Sensing: {sensing.enabled ? 'Active' : 'Off'}
                        </span>
                      )}
                      <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded ${
                        conn.status === 'active' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-zinc-500/15 text-zinc-400'
                      }`}>
                        Execution: {conn.status === 'active' ? `${execution.actions.length} actions` : 'Inactive'}
                      </span>
                      {sensorData && sensorData.operationsLast24h > 0 && (
                        <span className="text-[9px] text-text-tertiary">{sensorData.operationsLast24h} ops (24h)</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex gap-2 items-center">
                  {isSensingCapable && (
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleSensorMut.mutate({ id: conn.id, enabled: !sensing.enabled }); }}
                      title={sensing.enabled ? 'Pause sensing' : 'Enable sensing'}
                      className={`relative w-9 h-5 rounded-full transition-colors ${sensing.enabled ? 'bg-accent' : 'bg-surface-3'}`}
                    >
                      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${sensing.enabled ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
                    </button>
                  )}
                  <Button size="xs" variant="secondary" onClick={(e) => { e.stopPropagation(); testMut.mutate(conn.id); }}>
                    {testMut.isPending ? '...' : 'Test'}
                  </Button>
                  <span className="text-[10px] text-text-muted">{expandedId === conn.id ? '▲' : '▼'}</span>
                </div>
              </div>

              {/* Expanded Sections */}
              {expandedId === conn.id && (
                <div className="border-t border-border">
                  {/* Section Tabs */}
                  <div className="flex border-b border-border">
                    {isSensingCapable && (
                      <button
                        className={`px-4 py-2 text-[11px] font-medium transition-colors ${expandedSection === 'sensing' ? 'text-accent border-b-2 border-accent' : 'text-text-tertiary hover:text-text-secondary'}`}
                        onClick={() => setExpandedSection(expandedSection === 'sensing' ? null : 'sensing')}
                      >
                        Sensing
                      </button>
                    )}
                    <button
                      className={`px-4 py-2 text-[11px] font-medium transition-colors ${expandedSection === 'execution' ? 'text-accent border-b-2 border-accent' : 'text-text-tertiary hover:text-text-secondary'}`}
                      onClick={() => setExpandedSection(expandedSection === 'execution' ? null : 'execution')}
                    >
                      Execution
                    </button>
                    <button
                      className={`px-4 py-2 text-[11px] font-medium transition-colors ${expandedSection === 'scope' ? 'text-accent border-b-2 border-accent' : 'text-text-tertiary hover:text-text-secondary'}`}
                      onClick={() => setExpandedSection(expandedSection === 'scope' ? null : 'scope')}
                    >
                      Scope Boundaries
                    </button>
                    <button
                      className={`px-4 py-2 text-[11px] font-medium transition-colors ${expandedSection === 'secrets' ? 'text-accent border-b-2 border-accent' : 'text-text-tertiary hover:text-text-secondary'}`}
                      onClick={() => setExpandedSection(expandedSection === 'secrets' ? null : 'secrets')}
                    >
                      Secrets
                    </button>
                  </div>

                  <div className="px-4 py-4 space-y-4">
                    {/* Sensing Section */}
                    {expandedSection === 'sensing' && (
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
                                <li>Go to your repo Settings → Webhooks → Add webhook</li>
                                <li>Paste the Payload URL above</li>
                                <li>Content type: application/json</li>
                                <li>Paste the Secret above</li>
                                <li>Select events: Push, Pull requests, Check runs</li>
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
                      </>
                    )}

                    {/* Execution Section */}
                    {expandedSection === 'execution' && (
                      <div>
                        <h4 className="text-[11px] font-medium text-text-secondary mb-2">Available Actions</h4>
                        <p className="text-[10px] text-text-tertiary mb-3">
                          Actions your agents can execute through this connection. Each runs in an ephemeral container — agent never sees credentials.
                        </p>
                        <div className="grid gap-2">
                          {execution.actions.map((action: any) => (
                            <div key={action.action} className="bg-surface-2 border border-border rounded-lg px-3 py-2 flex items-center justify-between">
                              <div>
                                <code className="text-[11px] font-mono text-accent">{action.action}</code>
                                <p className="text-[10px] text-text-tertiary mt-0.5">{action.description}</p>
                              </div>
                              <div className="flex gap-1">
                                <span className="text-[8px] font-medium px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400">Ready</span>
                              </div>
                            </div>
                          ))}
                          {execution.actions.length === 0 && (
                            <p className="text-[10px] text-text-muted italic">No actions available for this provider.</p>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Scope Boundaries Section */}
                    {expandedSection === 'scope' && (
                      <ScopeBoundaryEditor
                        connection={conn}
                        onSave={(boundaries) => scopeMut.mutate({ id: conn.id, boundaries })}
                      />
                    )}

                    {/* Secrets Section */}
                    {expandedSection === 'secrets' && (
                      <SecretsEditor connectionId={conn.id} />
                    )}

                    {/* Actions */}
                    {!expandedSection && (
                      <div className="flex gap-2 pt-2">
                        {conn.status === 'active' && (
                          <Button size="xs" variant="danger" onClick={() => revokeMut.mutate(conn.id)}>
                            Revoke Connection
                          </Button>
                        )}
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

// ── Secrets Editor Component ──────────────────────────────────────────

function SecretsEditor({ connectionId }: { connectionId: string }) {
  const qc = useQueryClient();
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');

  const { data: secretsData, isLoading } = useQuery({
    queryKey: ['connection-secrets', connectionId],
    queryFn: () => getConnectionSecrets(connectionId),
  });

  const addMut = useMutation({
    mutationFn: (secret: { key: string; value: string; mode: 'agent' | 'exec_only' }) =>
      addConnectionSecret(connectionId, secret),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['connection-secrets', connectionId] });
    },
  });

  const deleteMut = useMutation({
    mutationFn: (key: string) => deleteConnectionSecret(connectionId, key),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['connection-secrets', connectionId] });
    },
  });

  const existing = secretsData?.secrets ?? [];
  const execSecrets = existing.filter((s: any) => s.mode === 'exec_only');
  const agentSecrets = existing.filter((s: any) => s.mode === 'agent');

  const handleAdd = () => {
    if (!newKey.trim() || !newValue.trim()) return;
    const normalizedKey = newKey.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    addMut.mutate({ key: normalizedKey, value: newValue, mode: 'exec_only' });
    setNewKey('');
    setNewValue('');
  };

  return (
    <div className="space-y-3">
      <div>
        <h4 className="text-[11px] font-medium text-text-secondary">Exec-Only Secrets</h4>
        <p className="text-[10px] text-text-tertiary mt-1">
          Credentials injected only into ephemeral secure execution containers. The agent never sees these values
          — use for deploy keys, database passwords, and sensitive tokens.
        </p>
      </div>

      {isLoading ? (
        <Spinner size="sm" />
      ) : (
        <>
          {execSecrets.length > 0 && (
            <div className="space-y-1.5">
              {execSecrets.map((s: any) => (
                <div key={s.key} className="flex items-center gap-2 bg-surface-2 border border-border rounded-lg px-3 py-2">
                  <code className="text-[11px] font-mono text-accent flex-1">{s.key}</code>
                  <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400">
                    EXEC ONLY
                  </span>
                  <span className="text-[10px] text-text-muted font-mono">••••••</span>
                  <button
                    onClick={() => deleteMut.mutate(s.key)}
                    className="text-[10px] text-red-400 hover:text-red-300 transition-colors"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="bg-surface-2 border border-border rounded-lg p-3 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[9px] text-text-tertiary uppercase tracking-wider block mb-0.5">Key Name</label>
                <input
                  type="text"
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                  placeholder="DEPLOY_KEY"
                  className="w-full bg-surface-1 border border-border rounded px-2 py-1 text-[11px] text-text-primary font-mono placeholder:text-text-muted focus:border-accent focus:outline-none"
                />
              </div>
              <div>
                <label className="text-[9px] text-text-tertiary uppercase tracking-wider block mb-0.5">Value</label>
                <input
                  type="password"
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                  placeholder="sk-..."
                  className="w-full bg-surface-1 border border-border rounded px-2 py-1 text-[11px] text-text-primary font-mono placeholder:text-text-muted focus:border-accent focus:outline-none"
                />
              </div>
            </div>
            <Button size="xs" onClick={handleAdd} disabled={!newKey.trim() || !newValue.trim() || addMut.isPending}>
              {addMut.isPending ? 'Adding...' : 'Add Exec-Only Secret'}
            </Button>
          </div>

          {/* Show agent keys as read-only reference */}
          {agentSecrets.length > 0 && (
            <div className="mt-2 pt-3 border-t border-border/50">
              <p className="text-[10px] text-text-muted mb-2">
                Agent-accessible keys (managed from agent detail page):
              </p>
              <div className="space-y-1">
                {agentSecrets.map((s: any) => (
                  <div key={s.key} className="flex items-center gap-2 px-3 py-1.5 rounded bg-surface-2/30">
                    <code className="text-[10px] font-mono text-text-secondary">{s.key}</code>
                    <span className="text-[8px] font-mono px-1 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                      agent env
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
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
  if (provider === 'aws') {
    return <span className="text-[11px] font-bold text-amber-400">AWS</span>;
  }
  if (provider === 'gcp') {
    return <span className="text-[11px] font-bold text-blue-400">GCP</span>;
  }
  return <span className="text-[11px] text-text-muted">{provider[0].toUpperCase()}</span>;
}

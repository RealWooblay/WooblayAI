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
  getOrgPolicySettings,
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

// ── Event Rules Editor ────────────────────────────────────────────────
// User declares WHAT they care about. AI handles the HOW.
// No manual conditions, no workflow chains — that's n8n territory.

const ALL_EVENTS = [
  { event: 'ci_failure' as const, label: 'CI Failure', description: 'Check run fails on default or agent branch', defaultIntent: 'fix' as const },
  { event: 'pr_opened' as const, label: 'PR Opened', description: 'New pull request or synchronize', defaultIntent: 'review' as const },
  { event: 'push' as const, label: 'Push', description: 'Push to a watched branch', defaultIntent: 'review' as const },
  { event: 'pr_merged' as const, label: 'PR Merged', description: 'Pull request merged to base', defaultIntent: 'deploy' as const },
] as const;

const INTENT_OPTIONS = ['fix', 'qa', 'review', 'deploy', 'custom'] as const;
const PRIORITY_OPTIONS = ['P0', 'P1', 'P2'] as const;

const DEFAULT_RULES: { event: string; intent: string; priority: string; enabled: boolean }[] = [
  { event: 'ci_failure', intent: 'fix', priority: 'P1', enabled: true },
  { event: 'pr_opened', intent: 'review', priority: 'P2', enabled: true },
  { event: 'push', intent: 'review', priority: 'P2', enabled: true },
  { event: 'pr_merged', intent: 'deploy', priority: 'P2', enabled: false },
];

const AI_FEATURES = [
  { label: 'Intent Classification', description: 'AI analyzes event context and classifies what action is needed — not hardcoded, adapts per event' },
  { label: 'Smart Escalation', description: 'AI auto-escalates priority from context signals: risk level, change size, sensitive files, force push' },
  { label: 'Agent Matching', description: 'Multi-dimension scoring: role match, specialization, performance history, complexity fit' },
  { label: 'Follow-Up Chaining', description: 'AI decides when a completed operation needs a follow-up and creates it automatically' },
];

export function EventRulesEditor({ connectionId, sensorConfig }: { connectionId: string; sensorConfig: any }) {
  const qc = useQueryClient();

  const existing: any[] = sensorConfig?.eventRules ?? [];
  const [rules, setRules] = useState(() => {
    if (existing.length > 0) return existing.map((r: any) => ({ event: r.event, intent: r.intent, priority: r.priority, enabled: r.enabled }));
    return DEFAULT_RULES.map((r) => ({ ...r }));
  });

  const saveMut = useMutation({
    mutationFn: (eventRules: any[]) =>
      updateSensorConfig(connectionId, {
        sensorConfig: { ...sensorConfig, eventRules },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['connections'] });
    },
  });

  const updateRule = (idx: number, field: string, value: any) => {
    setRules((prev) => prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
  };

  const handleSave = () => {
    saveMut.mutate(rules);
  };

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h4 className="text-[11px] font-medium text-text-secondary">Event Sensing</h4>
          <p className="text-[10px] text-text-tertiary mt-0.5">
            Choose which events create operations. Set a default intent or leave it — the AI classifies from context.
          </p>
        </div>
        <Button size="xs" onClick={handleSave} disabled={saveMut.isPending}>
          {saveMut.isPending ? 'Saving…' : saveMut.isSuccess ? '✓ Saved' : 'Save rules'}
        </Button>
      </div>

      <div className="space-y-2">
        {ALL_EVENTS.map((evt) => {
          const idx = rules.findIndex((r: any) => r.event === evt.event);
          const rule = idx >= 0 ? rules[idx] : null;
          const isEnabled = rule?.enabled ?? false;
          const ruleIdx = idx >= 0 ? idx : -1;

          const ensureRule = () => {
            if (idx < 0) {
              setRules((prev) => [...prev, { event: evt.event, intent: evt.defaultIntent, priority: 'P2', enabled: true }]);
            }
          };

          return (
            <div
              key={evt.event}
              className={`bg-surface-2 border rounded-lg px-3 py-2.5 transition-colors ${isEnabled ? 'border-accent/30' : 'border-border opacity-60'}`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <button
                    className={`w-8 h-4 rounded-full relative transition-colors ${isEnabled ? 'bg-accent' : 'bg-surface-3'}`}
                    onClick={() => {
                      if (idx < 0) {
                        ensureRule();
                      } else {
                        updateRule(ruleIdx, 'enabled', !isEnabled);
                      }
                    }}
                  >
                    <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${isEnabled ? 'left-4' : 'left-0.5'}`} />
                  </button>
                  <div>
                    <span className="text-[11px] font-medium text-text-primary">{evt.label}</span>
                    <p className="text-[9px] text-text-tertiary">{evt.description}</p>
                  </div>
                </div>

                {isEnabled && ruleIdx >= 0 && rule && (
                  <div className="flex items-center gap-2">
                    <div>
                      <label className="text-[8px] text-text-tertiary uppercase tracking-wider block mb-0.5">Default Intent</label>
                      <select
                        value={rule.intent}
                        onChange={(e) => updateRule(ruleIdx, 'intent', e.target.value)}
                        className="bg-surface-3 border border-border rounded px-1.5 py-0.5 text-[10px] text-text-primary focus:border-accent focus:outline-none"
                      >
                        {INTENT_OPTIONS.map((i) => (
                          <option key={i} value={i}>{i}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-[8px] text-text-tertiary uppercase tracking-wider block mb-0.5">Default Priority</label>
                      <select
                        value={rule.priority ?? 'P2'}
                        onChange={(e) => updateRule(ruleIdx, 'priority', e.target.value)}
                        className="bg-surface-3 border border-border rounded px-1.5 py-0.5 text-[10px] text-text-primary focus:border-accent focus:outline-none"
                      >
                        {PRIORITY_OPTIONS.map((p) => (
                          <option key={p} value={p}>{p}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* AI Intelligence Summary */}
      <div className="mt-3 bg-surface-1 border border-accent/10 rounded-lg p-3">
        <div className="flex items-center gap-1.5 mb-2">
          <div className="w-4 h-4 rounded bg-accent/20 flex items-center justify-center">
            <span className="text-[8px] text-accent font-bold">AI</span>
          </div>
          <span className="text-[10px] font-medium text-text-secondary">Intelligent Processing</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {AI_FEATURES.map((f) => (
            <div key={f.label} className="flex items-start gap-1.5">
              <span className="text-[8px] text-accent mt-0.5 shrink-0">+</span>
              <div>
                <span className="text-[9px] font-medium text-text-primary">{f.label}</span>
                <p className="text-[8px] text-text-tertiary leading-tight">{f.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <p className="text-[9px] text-text-muted mt-2">
        If no rules are saved, all matched events create operations and the AI classifies everything from context. Rules let you filter which events you care about and hint at default intent.
      </p>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────

export type ConnectionsPageProps = { credentialsOnly?: boolean };

export function ConnectionsPage({ credentialsOnly = false }: ConnectionsPageProps) {
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
              ? 'Manage your service credentials. Keys are encrypted and only used inside Gate-controlled execution — agents never see them.'
              : isFullPlatform
                ? 'Manage your service integrations. Each connection powers both sensing (inbound events) and secure execution (agent actions).'
                : 'Manage your service integrations. Each connection powers secure execution — credentials are encrypted and isolated.'}
          </p>
        </div>
        <Button size="sm" onClick={() => setAddStep('select')} data-tour={credentialsOnly ? 'tour-add-credential' : 'tour-add-connection'}>
          + Add {credentialsOnly ? 'credential' : 'connection'}
        </Button>
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

      {/* General callout: key must have full access (shown when adding any connection) */}
      {(addStep === 'select' || addStep === 'github' || addStep === 'aws' || addStep === 'gcp') && (
        <div className="bg-accent/5 border border-accent/20 rounded-lg px-4 py-3 mb-4">
          <p className="text-[10px] text-accent/90 font-medium mb-0.5">Use a full-access key</p>
          <p className="text-[10px] text-text-tertiary">
            The agent can perform any action this key allows (push, deploy, merge, etc.). Give the connection a key with the permissions you want the agent to have — Wooblay gates each action, but cannot add permissions the key doesn&apos;t have.
          </p>
        </div>
      )}

      {/* Step 1: Choose type */}
      {addStep === 'select' && (
        <div className="bg-surface-1 border border-accent/30 rounded-lg p-4 mb-6">
          <h3 className="text-sm font-medium text-text-primary mb-2">{credentialsOnly ? 'Add credential' : 'Add connection'}</h3>
          <p className="text-[10px] text-text-tertiary mb-3">
            {credentialsOnly ? 'Choose a service. Your credential is encrypted and only used inside ephemeral execution containers.' : 'Choose a service to connect. Your credential is encrypted and never exposed to agents — it\'s only used inside ephemeral execution containers.'}
          </p>
          <div className="grid gap-2">
            {CONNECTION_TYPES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => { if (t.available) { setSelectedProvider(t.id); setAddStep(t.id as any); } }}
                disabled={!t.available}
                className={`text-left rounded-lg border px-4 py-3 transition-colors ${t.available ? 'border-border hover:border-accent/50 hover:bg-surface-2' : 'border-border/50 opacity-60 cursor-not-allowed'
                  }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium text-text-primary">{t.label}</span>
                    <div className="flex gap-1">
                      {!credentialsOnly && isFullPlatform && t.hasSensing && <span className="text-[8px] font-medium px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400">SENSING</span>}
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
            {credentialsOnly
              ? <>Your PAT powers <strong>secure execution</strong> — agents execute git push, create PRs via ephemeral containers. Credentials are encrypted and never exposed.</>
              : isFullPlatform
                ? <>One key, two roles. Your PAT enables both <strong>sensing</strong> (webhook events create operations) and <strong>secure execution</strong> (agents execute git push, create PRs via ephemeral containers).</>
                : <>Your PAT powers <strong>secure execution</strong> — agents execute git push, create PRs via ephemeral containers. Credentials are encrypted and never exposed.</>}
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
          title={credentialsOnly ? 'No credentials configured' : 'No connections configured'}
          description={credentialsOnly ? 'Add a service credential (e.g. GitHub, AWS) to enable secure agent execution.' : 'Connect a service like GitHub to start sensing events and enabling secure agent execution.'}
        />
      )}

      <div className="space-y-3">
        {connectionList.map((conn: any) => {
          const sensorData = sensorMap[conn.id];
          const sensing = conn.sensing ?? { enabled: false, config: null };
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
                      {!credentialsOnly && isFullPlatform && isSensingCapable && (
                        <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded ${sensing.enabled ? 'bg-blue-500/15 text-blue-400' : 'bg-zinc-500/15 text-zinc-400'
                          }`}>
                          Sensing: {sensing.enabled ? 'Active' : 'Off'}
                        </span>
                      )}
                      <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded ${conn.status === 'active' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-zinc-500/15 text-zinc-400'
                        }`}>
                        {credentialsOnly ? (conn.status === 'active' ? 'Active' : 'Inactive') : `Execution: ${conn.status === 'active' ? 'Active' : 'Inactive'}`}
                      </span>
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
                  {/* Section Tabs — only Sensing in full platform when not credentialsOnly */}
                  {!credentialsOnly && (
                  <div className="flex border-b border-border">
                    {isFullPlatform && isSensingCapable && (
                      <button
                        className={`px-4 py-2 text-[11px] font-medium transition-colors ${expandedSection === 'sensing' ? 'text-accent border-b-2 border-accent' : 'text-text-tertiary hover:text-text-secondary'}`}
                        onClick={() => setExpandedSection(expandedSection === 'sensing' ? null : 'sensing')}
                      >
                        Sensing
                      </button>
                    )}
                  </div>
                  )}

                  <div className="px-4 py-4 space-y-4">
                    {/* One key, any action — no fixed list, no scope boundaries or extra secrets UI */}
                    <div className="text-[11px] text-text-secondary rounded-lg bg-surface-2 border border-border p-3">
                      <p className="font-medium text-text-primary mb-1">Execution</p>
                      <p>One full-access key. Any action from your agent is sent through the gate and runs in an isolated container; the gate enforces your policy on every call. No fixed list of actions — no scope boundaries or extra secrets needed.</p>
                    </div>

                    {/* Sensing Section — hidden when credentialsOnly */}
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
                        <EventRulesEditor connectionId={conn.id} sensorConfig={sensing.config} />
                      </>
                    )}

                    {/* Actions */}
                    {(credentialsOnly || !expandedSection) && (
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

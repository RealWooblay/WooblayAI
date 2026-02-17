import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, useRef } from 'react';
import { useAuth } from '@clerk/clerk-react';
import {
  getOperation,
  createRun as apiCreateRun,
  updateOperation,
  getInstances,
  approveOperationRouting,
  routeOperation,
} from '../../api/client.ts';
import { Spinner } from '../../components/common/Spinner.tsx';
import { Button } from '../../components/common/Button.tsx';

// ── SSE Hook (fetch-based for JWT auth) ─────────────────────────────────

interface LiveEvent {
  id: string;
  type: string;
  data: Record<string, unknown>;
  timestamp: string;
}

function useLiveEvents(operationId: string | undefined) {
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const { getToken } = useAuth();

  useEffect(() => {
    if (!operationId) return;

    const controller = new AbortController();
    abortRef.current = controller;

    async function connect() {
      try {
        const token = await getToken();
        const apiBase = import.meta.env.VITE_API_URL ?? '';
        const url = `${apiBase}/api/events/stream?operationId=${operationId}`;

        const res = await fetch(url, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          credentials: 'include',
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          setConnected(false);
          return;
        }

        setConnected(true);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const parsed = JSON.parse(line.slice(6)) as LiveEvent;
                setEvents((prev) => [
                  ...prev.slice(-200),
                  { ...parsed, id: `${Date.now()}-${Math.random()}` },
                ]);
              } catch {
                // Ignore parse errors
              }
            }
          }
        }
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          setConnected(false);
        }
      }
    }

    connect();

    return () => {
      controller.abort();
      abortRef.current = null;
    };
  }, [operationId, getToken]);

  return { events, connected };
}

// ── Main Component ──────────────────────────────────────────────────────

export function OperationPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { events, connected } = useLiveEvents(id);
  const streamRef = useRef<HTMLDivElement>(null);

  const { data: operation, isLoading } = useQuery({
    queryKey: ['operation', id],
    queryFn: () => getOperation(id!),
    refetchInterval: 5_000,
    enabled: !!id,
  });

  const { data: instances } = useQuery({
    queryKey: ['instances'],
    queryFn: getInstances,
    refetchInterval: 30_000,
  });

  const createRunMut = useMutation({
    mutationFn: () => apiCreateRun({ operationId: id!, recipe: 'ci_replay' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['operation', id] }),
  });

  const updateStatusMut = useMutation({
    mutationFn: (status: string) => updateOperation(id!, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['operation', id] }),
  });

  const approveMut = useMutation({
    mutationFn: () => approveOperationRouting(id!),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['operation', id] }),
  });

  const assignMut = useMutation({
    mutationFn: (instanceId: string) => routeOperation(id!, instanceId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['operation', id] }),
  });

  // Auto-scroll stream to bottom
  useEffect(() => {
    if (streamRef.current) {
      streamRef.current.scrollTop = streamRef.current.scrollHeight;
    }
  }, [events]);

  if (isLoading || !operation) {
    return <div className="flex items-center justify-center h-64"><Spinner /></div>;
  }

  const runs = operation.runs ?? [];
  const assignedAgent = (instances ?? []).find((i: any) => i.id === operation.instanceId);

  return (
    <div className="max-w-5xl mx-auto">
      <Link to="/operations" className="text-xs text-text-tertiary hover:text-accent mb-4 inline-block">
        ← Back to Operations
      </Link>

      {/* Routing Section */}
      {(operation.routingStatus === 'pending' && operation.instanceId) && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 mb-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[12px] font-medium text-amber-400">Routing: Pending Approval</p>
              <p className="text-[11px] text-text-secondary mt-0.5">
                Best match: <strong>{assignedAgent?.name ?? 'Unknown Agent'}</strong>
                {operation.routingConfidence != null && ` (${Math.round(operation.routingConfidence * 100)}% confidence)`}
              </p>
              {operation.routingReason && (
                <p className="text-[10px] text-text-tertiary mt-0.5">{operation.routingReason}</p>
              )}
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => approveMut.mutate()}>
                Approve {assignedAgent?.name}
              </Button>
              {(instances ?? []).filter((i: any) => i.status === 'running' && i.id !== operation.instanceId).length > 0 && (
                <select
                  className="text-[11px] bg-surface-2 border border-border rounded px-2 py-1 text-text-primary"
                  defaultValue=""
                  onChange={(e) => e.target.value && assignMut.mutate(e.target.value)}
                >
                  <option value="">Assign to...</option>
                  {(instances ?? []).filter((i: any) => i.status === 'running' && i.id !== operation.instanceId).map((inst: any) => (
                    <option key={inst.id} value={inst.id}>{inst.name}</option>
                  ))}
                </select>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Auto-routed banner */}
      {(operation.routingStatus === 'auto_routed' || operation.routingStatus === 'approved' || operation.routingStatus === 'manual') && operation.instanceId && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-4 py-2.5 mb-4 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400" />
          <p className="text-[11px] text-emerald-400">
            Routed to <strong>{assignedAgent?.name ?? 'Agent'}</strong>
            {operation.routingConfidence != null && ` (${Math.round(operation.routingConfidence * 100)}%)`}
            {operation.routingReason && ` — ${operation.routingReason}`}
          </p>
        </div>
      )}

      {/* Unassigned banner */}
      {operation.routingStatus === 'pending' && !operation.instanceId && (
        <div className="bg-zinc-500/10 border border-zinc-500/30 rounded-lg px-4 py-2.5 mb-4">
          <p className="text-[11px] text-text-secondary mb-2">
            {operation.routingReason || 'No active agents matched. Assign an agent manually.'}
          </p>
          {(instances ?? []).filter((i: any) => i.status === 'running').length > 0 ? (
            <div className="flex gap-2">
              {(instances ?? []).filter((i: any) => i.status === 'running').map((inst: any) => (
                <Button key={inst.id} size="xs" variant="secondary" onClick={() => assignMut.mutate(inst.id)}>
                  Assign to {inst.name}
                </Button>
              ))}
            </div>
          ) : (
            <p className="text-[10px] text-text-tertiary">No active agents. Start an agent to handle this operation.</p>
          )}
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border bg-amber-500/15 text-amber-400 border-amber-500/30">
              {operation.priority}
            </span>
            <span className="text-[10px] text-text-muted bg-surface-3 px-2 py-0.5 rounded">
              {operation.status}
            </span>
            <IntentBadge intent={operation.intent} suggestedIntent={operation.suggestedIntent} />
            <span className="text-[10px] text-text-tertiary">
              Triggered by sensor: {operation.source}
            </span>
          </div>
          <h1 className="text-lg font-semibold text-text-primary">{operation.title}</h1>
          {operation.summary && (
            <p className="text-xs text-text-secondary mt-1">{operation.summary}</p>
          )}
        </div>

        <div className="flex gap-2 items-center">
          {/* Connection status */}
          <div className="flex items-center gap-1.5 mr-2">
            <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-500'}`} />
            <span className="text-[9px] text-text-tertiary">
              {connected ? 'Live' : 'Offline'}
            </span>
          </div>

          {operation.status !== 'resolved' && (
            <Button size="sm" variant="secondary" onClick={() => updateStatusMut.mutate('resolved')}>
              Resolve
            </Button>
          )}
          <Button size="sm" onClick={() => createRunMut.mutate()} disabled={createRunMut.isPending}>
            {createRunMut.isPending ? 'Creating...' : 'New Run'}
          </Button>
        </div>
      </div>

      {/* Three-Layer Security Summary */}
      <SecuritySummary operation={operation} />

      {/* Metadata */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {operation.repoFullName && (
          <MetaCard label="Repository" value={operation.repoFullName} />
        )}
        {operation.branch && (
          <MetaCard label="Branch" value={operation.branch} />
        )}
        {operation.commitSha && (
          <MetaCard label="Commit" value={operation.commitSha.slice(0, 8)} />
        )}
        {operation.prNumber && (
          <MetaCard label="PR" value={`#${operation.prNumber}`} />
        )}
      </div>

      {/* Two-column layout: Live Stream + Runs */}
      <div className="grid grid-cols-5 gap-4">
        {/* Live Action Stream (3 cols) */}
        <div className="col-span-3">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium text-text-primary">Live Activity</h2>
            <span className="text-[9px] text-text-tertiary">{events.length} events</span>
          </div>
          <div
            ref={streamRef}
            className="bg-surface-1 border border-border rounded-lg overflow-y-auto"
            style={{ maxHeight: '500px', minHeight: '300px' }}
          >
            {events.length === 0 ? (
              <div className="flex items-center justify-center h-64 text-center">
                <div>
                  <div className="text-[10px] text-text-tertiary mb-1">
                    {connected ? 'Waiting for events...' : 'Connecting to live stream...'}
                  </div>
                  <p className="text-[9px] text-text-muted">
                    Tool calls, policy decisions, simulations, and execution results will appear here in real time.
                  </p>
                </div>
              </div>
            ) : (
              <div className="divide-y divide-border/50">
                {events.map((event) => (
                  <LiveEventRow key={event.id} event={event} />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Runs (2 cols) */}
        <div className="col-span-2">
          <h2 className="text-sm font-medium text-text-primary mb-3">Runs ({runs.length})</h2>
          {runs.length === 0 ? (
            <div className="text-xs text-text-tertiary bg-surface-1 border border-border rounded-lg p-6 text-center">
              No runs yet. Click "New Run" to start.
            </div>
          ) : (
            <div className="space-y-2">
              {runs.map((run: any) => (
                <Link
                  key={run.id}
                  to={`/runs/${run.id}`}
                  className="block px-3 py-2.5 rounded-lg bg-surface-1 border border-border hover:border-accent/30 hover:bg-surface-2 transition-all"
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <RunStatusBadge status={run.status} />
                      <span className="text-[10px] font-mono text-text-muted">{run.id.slice(0, 8)}</span>
                    </div>
                    <span className="text-[9px] text-text-tertiary">Attempt {run.attempt}</span>
                  </div>
                  <div className="flex items-center gap-3 text-[9px] text-text-tertiary">
                    <span>{run._count?.proposals ?? 0} proposals</span>
                    <span>{run._count?.evidenceBundles ?? 0} evidence</span>
                    <span>{run.spentCents}¢ / {run.budgetCents}¢</span>
                  </div>
                </Link>
              ))}
            </div>
          )}

          {/* Timeline */}
          <h2 className="text-sm font-medium text-text-primary mb-3 mt-6">Timeline</h2>
          <div className="border-l-2 border-border pl-4 space-y-3">
            <TimelineEntry
              time={operation.createdAt}
              label={`Operation created via ${operation.source}`}
            />
            {operation.routingStatus !== 'pending' && operation.instanceId && (
              <TimelineEntry
                time={operation.updatedAt}
                label={`Routed to ${assignedAgent?.name ?? 'agent'} (${operation.routingStatus})`}
              />
            )}
            {runs.map((run: any) => (
              <TimelineEntry
                key={run.id}
                time={run.createdAt}
                label={`Run ${run.id.slice(0, 8)} (attempt ${run.attempt})`}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Components ──────────────────────────────────────────────────────────

function IntentBadge({ intent, suggestedIntent }: { intent: string; suggestedIntent?: string }) {
  const colors: Record<string, string> = {
    fix: 'bg-red-500/15 text-red-400 border-red-500/30',
    qa: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
    review: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
    deploy: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
    custom: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30',
    pending_classification: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  };

  const displayIntent = intent === 'pending_classification' && suggestedIntent
    ? `${suggestedIntent} (pending)`
    : intent;

  return (
    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${colors[intent] ?? colors.custom}`}>
      {displayIntent}
    </span>
  );
}

function SecuritySummary({ operation: _operation }: { operation: any }) {
  return (
    <div className="grid grid-cols-3 gap-3 mb-6">
      <div className="bg-surface-1 border border-border rounded-lg p-3">
        <div className="flex items-center gap-2 mb-1.5">
          <div className="w-5 h-5 rounded bg-emerald-500/15 flex items-center justify-center">
            <span className="text-[10px] text-emerald-400">1</span>
          </div>
          <p className="text-[11px] font-medium text-text-primary">Policy Gate</p>
        </div>
        <p className="text-[10px] text-text-tertiary leading-relaxed">
          Every action evaluated against org policies + scope boundaries before execution.
        </p>
      </div>
      <div className="bg-surface-1 border border-border rounded-lg p-3">
        <div className="flex items-center gap-2 mb-1.5">
          <div className="w-5 h-5 rounded bg-blue-500/15 flex items-center justify-center">
            <span className="text-[10px] text-blue-400">2</span>
          </div>
          <p className="text-[11px] font-medium text-text-primary">Simulation</p>
        </div>
        <p className="text-[10px] text-text-tertiary leading-relaxed">
          Sandbox execution + AI intent verification. Commands run in isolated containers (no network, no creds) to verify behavior matches stated intent.
        </p>
      </div>
      <div className="bg-surface-1 border border-border rounded-lg p-3">
        <div className="flex items-center gap-2 mb-1.5">
          <div className="w-5 h-5 rounded bg-purple-500/15 flex items-center justify-center">
            <span className="text-[10px] text-purple-400">3</span>
          </div>
          <p className="text-[11px] font-medium text-text-primary">Secure Execution</p>
        </div>
        <p className="text-[10px] text-text-tertiary leading-relaxed">
          Ephemeral containers with scoped credentials. Agent never has direct access to secrets.
        </p>
      </div>
    </div>
  );
}

function LiveEventRow({ event }: { event: LiveEvent }) {
  const typeConfig: Record<string, { label: string; color: string; icon: string }> = {
    'tool_call': { label: 'Tool Call', color: 'text-blue-400', icon: '>' },
    'approval': { label: 'Approval', color: 'text-amber-400', icon: '?' },
    'gateway_exec': { label: 'Gateway', color: 'text-purple-400', icon: '#' },
    'secure_exec.completed': { label: 'Execution', color: 'text-emerald-400', icon: '$' },
    'secure_exec_start': { label: 'Exec Start', color: 'text-blue-300', icon: '>' },
    'secure_exec_complete': { label: 'Exec Done', color: 'text-emerald-400', icon: '$' },
    'secure_exec_simulation': { label: 'Simulation', color: 'text-cyan-400', icon: '~' },
    'simulation.completed': { label: 'Sim Result', color: 'text-cyan-400', icon: '~' },
    'simulation_start': { label: 'Sim Start', color: 'text-cyan-300', icon: '~' },
    'simulation_complete': { label: 'Sim Done', color: 'text-cyan-400', icon: '~' },
    'simulation_sandbox': { label: 'Sandbox', color: 'text-cyan-300', icon: '~' },
    'state_change': { label: 'State', color: 'text-zinc-400', icon: '*' },
    'evidence': { label: 'Evidence', color: 'text-orange-400', icon: 'E' },
    'error': { label: 'Error', color: 'text-red-400', icon: '!' },
    'operation.created': { label: 'Created', color: 'text-zinc-400', icon: '+' },
    'operation.routed': { label: 'Routed', color: 'text-emerald-400', icon: '->' },
    'gateway.executed': { label: 'Gateway', color: 'text-purple-400', icon: '#' },
    'scope_check': { label: 'Scope', color: 'text-yellow-400', icon: '|' },
    'capability': { label: 'Capability', color: 'text-indigo-400', icon: 'K' },
    'budget': { label: 'Budget', color: 'text-orange-400', icon: '$' },
    'verification': { label: 'Verify', color: 'text-emerald-400', icon: 'V' },
  };

  const config = typeConfig[event.type] ?? { label: event.type, color: 'text-text-muted', icon: '.' };
  const data = (event.data ?? {}) as Record<string, any>;
  const time = new Date(event.timestamp);
  const timeStr = time.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });

  // Build summary line based on event type
  let summary = '';

  if (event.type === 'scope_check') {
    summary = `${data.action} → ${data.allowed ? 'ALLOWED' : 'BLOCKED'}`;
    if (data.reason) summary += ` (${String(data.reason).slice(0, 80)})`;
  } else if (event.type === 'simulation_start' || event.type === 'simulation_complete') {
    summary = `${data.action ?? data.toolName ?? ''} [${data.strategy ?? 'sim'}]`;
    if (data.passed !== undefined) summary += data.passed ? ' PASSED' : ' FAILED';
    if (data.intentMatch !== undefined) summary += data.intentMatch ? ' (intent match)' : ' (INTENT MISMATCH)';
    if (data.summary) summary += ` — ${String(data.summary).slice(0, 120)}`;
    if (data.discrepancies && Array.isArray(data.discrepancies) && data.discrepancies.length > 0) {
      summary += ` | Discrepancies: ${(data.discrepancies as string[]).join('; ').slice(0, 100)}`;
    }
    if (data.durationMs) summary += ` (${data.durationMs}ms)`;
  } else if (event.type === 'simulation_sandbox') {
    summary = `${data.action ?? ''} → container ${String(data.containerId ?? '').slice(0, 12)} exit:${data.exitCode ?? '?'}`;
    if (data.command) summary += ` cmd: ${String(data.command).slice(0, 80)}`;
    if (data.durationMs) summary += ` (${data.durationMs}ms)`;
  } else if (event.type === 'secure_exec_start') {
    summary = `${data.action} → container ${String(data.containerId ?? '').slice(0, 12)}`;
    if (data.image) summary += ` [${data.image}]`;
  } else if (event.type === 'secure_exec_complete') {
    summary = `${data.action} → exit ${data.exitCode}`;
    if (data.success !== undefined) summary += data.success ? ' OK' : ' FAIL';
    if (data.durationMs) summary += ` (${data.durationMs}ms)`;
    if (data.stdout) summary += ` — ${String(data.stdout).slice(0, 60)}`;
  } else if (event.type === 'gateway_exec' || event.type === 'gateway.executed') {
    summary = `${data.actionClass ?? data.action ?? ''}`;
    if (data.success !== undefined) summary += data.success ? ' [OK]' : ' [FAIL]';
    if (data.containerId) summary += ` → ${String(data.containerId).slice(0, 12)}`;
    if (data.durationMs) summary += ` (${data.durationMs}ms)`;
  } else {
    if (data.action) summary += `${data.action}`;
    if (data.toolName) summary += `${data.toolName}`;
    if (data.description) summary += ` — ${data.description}`;
    if (data.success !== undefined) summary += data.success ? ' [OK]' : ' [FAIL]';
    if (data.decision) summary += ` → ${data.decision}`;
    if (data.passed !== undefined) summary += data.passed ? ' PASSED' : ' FAILED';
    if (data.reason) summary += ` (${String(data.reason).slice(0, 80)})`;
    if (data.durationMs) summary += ` ${data.durationMs}ms`;
    if (!summary && data.title) summary = String(data.title);
    if (!summary) summary = JSON.stringify(data).slice(0, 120);
  }

  const isSimEvent = event.type.startsWith('simulation') || event.type === 'simulation.completed';
  const hasSandboxOutput = data.stdoutPreview || data.stderrPreview || data.sandboxStdout || data.sandboxStderr;
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="px-3 py-2 hover:bg-surface-2/50 transition-colors group">
      <div
        className={`flex items-start gap-2 ${isSimEvent && hasSandboxOutput ? 'cursor-pointer' : ''}`}
        onClick={() => isSimEvent && hasSandboxOutput && setExpanded(!expanded)}
      >
        <span className="text-[9px] font-mono text-text-muted w-16 shrink-0 pt-0.5">
          {timeStr}
        </span>
        <span className={`text-[9px] font-mono ${config.color} w-2 shrink-0 pt-0.5`}>
          {config.icon}
        </span>
        <span className={`text-[10px] font-medium ${config.color} w-16 shrink-0`}>
          {config.label}
        </span>
        <span className="text-[10px] text-text-secondary truncate flex-1">
          {summary}
        </span>
        {isSimEvent && hasSandboxOutput && (
          <span className="text-[9px] text-text-muted opacity-0 group-hover:opacity-100 transition-opacity">
            {expanded ? 'collapse' : 'expand'}
          </span>
        )}
      </div>

      {expanded && isSimEvent && (
        <div className="ml-[7.5rem] mt-1.5 space-y-1.5 text-[10px]">
          {(data.stdoutPreview || data.sandboxStdout) && (
            <div>
              <span className="text-text-muted font-medium">stdout:</span>
              <pre className="mt-0.5 p-1.5 bg-black/30 rounded text-text-secondary text-[9px] font-mono overflow-x-auto max-h-24 overflow-y-auto">
                {String(data.stdoutPreview ?? data.sandboxStdout ?? '').slice(0, 1000) || '(empty)'}
              </pre>
            </div>
          )}
          {(data.stderrPreview || data.sandboxStderr) && (
            <div>
              <span className="text-red-400/70 font-medium">stderr:</span>
              <pre className="mt-0.5 p-1.5 bg-black/30 rounded text-red-400/60 text-[9px] font-mono overflow-x-auto max-h-24 overflow-y-auto">
                {String(data.stderrPreview ?? data.sandboxStderr ?? '').slice(0, 1000) || '(empty)'}
              </pre>
            </div>
          )}
          {data.intentMatch !== undefined && (
            <div className={`flex items-center gap-1 ${data.intentMatch ? 'text-emerald-400' : 'text-red-400'}`}>
              <span>{data.intentMatch ? 'Intent Match' : 'Intent Mismatch'}</span>
            </div>
          )}
          {data.discrepancies && Array.isArray(data.discrepancies) && data.discrepancies.length > 0 && (
            <div className="text-red-400/80">
              <span className="font-medium">Discrepancies:</span>
              <ul className="list-disc list-inside ml-1">
                {(data.discrepancies as string[]).map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MetaCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface-1 border border-border rounded-lg px-3 py-2.5">
      <p className="text-[9px] text-text-tertiary uppercase tracking-wider">{label}</p>
      <p className="text-[12px] font-mono text-text-primary mt-0.5 truncate">{value}</p>
    </div>
  );
}

function RunStatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: 'bg-zinc-500/15 text-zinc-400',
    scheduled: 'bg-blue-500/15 text-blue-400',
    running: 'bg-green-500/15 text-green-400',
    paused: 'bg-amber-500/15 text-amber-400',
    completed: 'bg-emerald-500/15 text-emerald-400',
    failed: 'bg-red-500/15 text-red-400',
    quarantined: 'bg-red-500/15 text-red-400',
    cancelled: 'bg-zinc-500/15 text-zinc-400',
  };

  return (
    <span className={`text-[10px] font-medium px-2 py-0.5 rounded ${colors[status] ?? colors.pending}`}>
      {status}
    </span>
  );
}

function TimelineEntry({ time, label }: { time: string; label: string }) {
  const date = new Date(time);
  return (
    <div className="relative">
      <div className="absolute -left-[21px] top-1.5 w-2 h-2 rounded-full bg-accent/50" />
      <p className="text-[11px] text-text-secondary">{label}</p>
      <p className="text-[10px] text-text-tertiary">{date.toLocaleString()}</p>
    </div>
  );
}

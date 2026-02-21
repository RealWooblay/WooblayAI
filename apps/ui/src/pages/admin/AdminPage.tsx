/**
 * Admin Security Dashboard — password-protected visibility into L2/L3.
 *
 * Shows: L3 executions (containers, durations, exit codes),
 *        L2 pre-execution verifications (blocked/passed),
 *        Post-execution verifications, audit flags.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  getAdminSummary,
  getAdminSecurityEvents,
  getAdminExecutions,
  getAdminFlags,
} from '../../api/client.ts';

const BADGE = {
  safe: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  blocked: 'bg-red-500/10 text-red-400 border-red-500/20',
  passed: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  failed: 'bg-red-500/10 text-red-400 border-red-500/20',
  SUCCESS: 'bg-emerald-500/10 text-emerald-400',
  FAILED: 'bg-red-500/10 text-red-400',
};

export function AdminPage() {
  const [password, setPassword] = useState('');
  const [authenticated, setAuthenticated] = useState(false);
  const [authError, setAuthError] = useState(false);
  const [tab, setTab] = useState<'overview' | 'executions' | 'events' | 'flags'>('overview');

  const handleLogin = async () => {
    try {
      await getAdminSummary(password);
      setAuthenticated(true);
      setAuthError(false);
    } catch {
      setAuthError(true);
    }
  };

  if (!authenticated) {
    return (
      <div className="max-w-sm mx-auto mt-24">
        <h1 className="text-lg font-bold text-text-primary mb-1">Admin Security Dashboard</h1>
        <p className="text-xs text-text-muted mb-4">Password required to view L2/L3 execution details.</p>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
          placeholder="Admin password"
          className="w-full px-3 py-2 bg-surface-1 border border-border rounded-lg text-sm text-text-primary mb-2 focus:outline-none focus:border-accent"
        />
        {authError && <p className="text-xs text-red-400 mb-2">Invalid password</p>}
        <button
          onClick={handleLogin}
          className="w-full px-3 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent-bright transition-colors"
        >
          Enter
        </button>
      </div>
    );
  }

  return <AdminDashboard password={password} tab={tab} setTab={setTab} />;
}

function AdminDashboard({
  password,
  tab,
  setTab,
}: {
  password: string;
  tab: string;
  setTab: (t: 'overview' | 'executions' | 'events' | 'flags') => void;
}) {
  const { data: summary } = useQuery({
    queryKey: ['admin-summary', password],
    queryFn: () => getAdminSummary(password),
    refetchInterval: 5_000,
  });

  const { data: executionsData } = useQuery({
    queryKey: ['admin-executions', password],
    queryFn: () => getAdminExecutions(password),
    refetchInterval: 5_000,
    enabled: tab === 'overview' || tab === 'executions',
  });

  const { data: eventsData } = useQuery({
    queryKey: ['admin-events', password],
    queryFn: () => getAdminSecurityEvents(password),
    refetchInterval: 5_000,
    enabled: tab === 'overview' || tab === 'events',
  });

  const { data: flagsData } = useQuery({
    queryKey: ['admin-flags', password],
    queryFn: () => getAdminFlags(password),
    refetchInterval: 10_000,
    enabled: tab === 'overview' || tab === 'flags',
  });

  const tabs = [
    { id: 'overview' as const, label: 'Overview' },
    { id: 'executions' as const, label: 'L3 Executions' },
    { id: 'events' as const, label: 'L2 Verifications' },
    { id: 'flags' as const, label: 'Audit Flags' },
  ];

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-text-primary">Security Dashboard</h1>
        <span className="text-[10px] text-emerald-400 font-mono bg-emerald-500/10 px-2 py-0.5 rounded">ADMIN</span>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
        <StatCard label="L3 Executions" value={summary?.totalExecutions ?? 0} />
        <StatCard label="Last Hour" value={summary?.recentExecutions ?? 0} accent />
        <StatCard label="L2 Pre-checks" value={summary?.totalPreChecks ?? 0} />
        <StatCard label="Blocked" value={summary?.blockedPreChecks ?? 0} danger={!!summary?.blockedPreChecks} />
        <StatCard label="Audit Flags" value={summary?.totalFlags ?? 0} danger={!!summary?.totalFlags} />
        <StatCard label="Flags (24h)" value={summary?.recentFlags ?? 0} danger={!!summary?.recentFlags} />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${
              tab === t.id
                ? 'text-accent border-b-2 border-accent'
                : 'text-text-muted hover:text-text-primary'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {(tab === 'overview' || tab === 'executions') && (
        <Section title="L3 Secure Executions" subtitle="Ephemeral containers with vault-injected credentials">
          {!executionsData?.executions.length ? (
            <Empty text="No executions recorded yet" />
          ) : (
            <div className="space-y-1.5">
              {executionsData.executions.slice(0, tab === 'overview' ? 10 : 50).map(e => (
                <ExecutionRow key={e.id} exec={e} />
              ))}
            </div>
          )}
        </Section>
      )}

      {(tab === 'overview' || tab === 'events') && (
        <Section title="L2 Security Verifications" subtitle="Pre-execution (blocks before creds injected) + post-execution (verifies result)">
          {!eventsData?.events.length ? (
            <Empty text="No verification events yet" />
          ) : (
            <div className="space-y-1.5">
              {eventsData.events.slice(0, tab === 'overview' ? 10 : 50).map(e => (
                <EventRow key={e.id} event={e} />
              ))}
            </div>
          )}
        </Section>
      )}

      {(tab === 'overview' || tab === 'flags') && (
        <Section title="Audit Flags" subtitle="AI-detected anomalies and intent mismatches">
          {!flagsData?.flags.length ? (
            <Empty text="No flags — all clear" />
          ) : (
            <div className="space-y-1.5">
              {flagsData.flags.slice(0, tab === 'overview' ? 5 : 50).map(f => (
                <FlagRow key={f.id} flag={f} />
              ))}
            </div>
          )}
        </Section>
      )}
    </div>
  );
}

function StatCard({ label, value, accent, danger }: { label: string; value: number; accent?: boolean; danger?: boolean }) {
  const color = danger ? 'text-red-400' : accent ? 'text-accent' : 'text-text-primary';
  return (
    <div className="bg-surface-1 border border-border rounded-lg p-2.5">
      <div className="text-[9px] text-text-muted uppercase tracking-wider">{label}</div>
      <div className={`text-xl font-bold tabular-nums ${color}`}>{value}</div>
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div>
        <h2 className="text-xs font-medium text-text-primary">{title}</h2>
        <p className="text-[10px] text-text-muted">{subtitle}</p>
      </div>
      {children}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="bg-surface-1 border border-border rounded-lg p-6 text-center">
      <p className="text-xs text-text-muted">{text}</p>
    </div>
  );
}

function ExecutionRow({ exec }: { exec: any }) {
  const [expanded, setExpanded] = useState(false);
  const statusBadge = exec.status === 'SUCCESS' ? BADGE.SUCCESS : BADGE.FAILED;

  return (
    <div className="bg-surface-1 border border-border rounded-lg overflow-hidden">
      <button onClick={() => setExpanded(!expanded)} className="w-full px-3 py-2 flex items-center gap-3 text-left hover:bg-surface-2 transition-colors">
        <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${statusBadge}`}>{exec.status}</span>
        <span className="text-xs text-text-primary font-mono flex-1 truncate">{exec.toolCall.toolName}</span>
        {exec.exitCode !== null && <span className="text-[10px] text-text-muted font-mono">exit:{exec.exitCode}</span>}
        {exec.durationMs !== null && <span className="text-[10px] text-text-muted font-mono">{exec.durationMs}ms</span>}
        <span className="text-[10px] text-text-muted">{new Date(exec.createdAt).toLocaleTimeString()}</span>
        <span className="text-[10px] text-text-muted">{expanded ? '▲' : '▼'}</span>
      </button>
      {expanded && (
        <div className="px-3 py-2 border-t border-border bg-surface-2/50 space-y-1.5">
          <Detail label="Tool" value={exec.toolCall.toolName} />
          <Detail label="Risk" value={exec.toolCall.riskTier} />
          {exec.toolCall.approval && (
            <Detail label="Approval" value={`${exec.toolCall.approval.status} by ${exec.toolCall.approval.approver ?? 'system'}`} />
          )}
          {exec.stdout && <Detail label="stdout" value={exec.stdout} mono />}
          {exec.stderr && <Detail label="stderr" value={exec.stderr} mono danger />}
        </div>
      )}
    </div>
  );
}

function EventRow({ event }: { event: any }) {
  const [expanded, setExpanded] = useState(false);
  const data = event.data;
  const isPre = event.type === 'mcp_pre_verification.completed';
  const isPost = event.type === 'mcp_verification.completed';
  const isExec = event.type === 'secure_exec.completed';

  const passed = isPre ? data.safe : isPost ? data.passed : isExec ? data.success : true;
  const badge = passed ? BADGE.passed : BADGE.blocked;
  const label = isPre ? 'L2 PRE-EXEC' : isPost ? 'L2 POST-EXEC' : isExec ? 'L3 EXEC' : event.type;

  return (
    <div className="bg-surface-1 border border-border rounded-lg overflow-hidden">
      <button onClick={() => setExpanded(!expanded)} className="w-full px-3 py-2 flex items-center gap-3 text-left hover:bg-surface-2 transition-colors">
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${badge}`}>{passed ? 'PASS' : 'BLOCK'}</span>
        <span className="text-[10px] font-mono text-text-muted">{label}</span>
        <span className="text-xs text-text-primary font-mono flex-1 truncate">
          {data.toolName ?? data.serverCommand ?? event.type}
        </span>
        {data.durationMs && <span className="text-[10px] text-text-muted font-mono">{data.durationMs}ms</span>}
        <span className="text-[10px] text-text-muted">{new Date(event.createdAt).toLocaleTimeString()}</span>
        <span className="text-[10px] text-text-muted">{expanded ? '▲' : '▼'}</span>
      </button>
      {expanded && (
        <div className="px-3 py-2 border-t border-border bg-surface-2/50 space-y-1.5">
          {data.reasoning && <Detail label="Reasoning" value={data.reasoning} />}
          {data.threatLevel && <Detail label="Threat level" value={data.threatLevel} />}
          {data.concerns?.length > 0 && <Detail label="Concerns" value={data.concerns.join('; ')} danger />}
          {data.credentialEnvVars?.length > 0 && <Detail label="Credentials" value={data.credentialEnvVars.join(', ')} mono />}
          {data.serverCommand && <Detail label="Server" value={data.serverCommand} mono />}
          {data.discrepancies?.length > 0 && <Detail label="Discrepancies" value={data.discrepancies.join('; ')} danger />}
          <Detail label="Source" value={data.source ?? 'ai'} />
        </div>
      )}
    </div>
  );
}

function FlagRow({ flag }: { flag: any }) {
  const severityColor: Record<string, string> = {
    CRITICAL: 'text-red-400 bg-red-500/10',
    HIGH: 'text-orange-400 bg-orange-500/10',
    MEDIUM: 'text-amber-400 bg-amber-500/10',
    LOW: 'text-blue-400 bg-blue-500/10',
  };
  return (
    <div className="bg-surface-1 border border-border rounded-lg px-3 py-2 flex items-start gap-3">
      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${severityColor[flag.severity] ?? ''}`}>{flag.severity}</span>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-text-primary font-medium">{flag.title}</p>
        <p className="text-[10px] text-text-muted mt-0.5 line-clamp-2">{flag.description}</p>
      </div>
      <span className="text-[10px] text-text-muted shrink-0">{new Date(flag.createdAt).toLocaleTimeString()}</span>
    </div>
  );
}

function Detail({ label, value, mono, danger }: { label: string; value: string; mono?: boolean; danger?: boolean }) {
  return (
    <div>
      <span className="text-[9px] text-text-muted uppercase tracking-wider">{label}</span>
      <p className={`text-[11px] break-all ${mono ? 'font-mono' : ''} ${danger ? 'text-red-400' : 'text-text-secondary'}`}>{value}</p>
    </div>
  );
}

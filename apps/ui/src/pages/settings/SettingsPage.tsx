/**
 * Settings — instance config, server keys, connection info.
 * Uses real /health endpoint data.
 */

import { useQuery } from '@tanstack/react-query';
import { getHealth } from '../../api/client.ts';
import { Badge } from '../../components/common/Badge.tsx';
import { Button } from '../../components/common/Button.tsx';
import { Card } from '../../components/common/Card.tsx';

export function SettingsPage() {
  const { data: health } = useQuery({
    queryKey: ['health'],
    queryFn: getHealth,
    refetchInterval: 30_000,
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-lg font-bold text-text-primary">Settings</h1>
        <p className="text-xs text-text-tertiary mt-0.5">
          Instance configuration and connection details.
        </p>
      </div>

      {/* Health */}
      <Card className="space-y-3">
        <h3 className="text-xs font-semibold text-text-tertiary uppercase tracking-wider">
          Instance Health
        </h3>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-3 w-3 rounded-full bg-emerald-400" />
            <Badge variant={health?.status === 'ok' ? 'green' : 'yellow'}>
              {health?.status === 'ok' ? 'Healthy' : 'Unknown'}
            </Badge>
          </div>
          {health && (
            <span className="text-xs text-text-muted">
              v{health.version} · {new Date(health.timestamp).toLocaleString()}
            </span>
          )}
        </div>
      </Card>

      {/* Connection info */}
      <Card className="space-y-4">
        <h3 className="text-xs font-semibold text-text-tertiary uppercase tracking-wider">
          Connection
        </h3>
        <div className="space-y-2">
          {[
            { label: 'Gate URL', value: 'http://localhost:4800' },
            { label: 'Dashboard', value: 'http://localhost:5173' },
            { label: 'Tenant', value: 'default' },
            { label: 'Version', value: health?.version ?? '0.1.0' },
          ].map((item) => (
            <div
              key={item.label}
              className="flex items-center justify-between rounded-lg bg-surface-0 border border-border px-4 py-3"
            >
              <span className="text-xs text-text-muted">{item.label}</span>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-text-secondary">{item.value}</span>
                <button
                  onClick={() => void navigator.clipboard.writeText(item.value)}
                  className="text-text-muted hover:text-text-primary transition-colors cursor-pointer"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Server keys */}
      <Card className="space-y-4">
        <h3 className="text-xs font-semibold text-text-tertiary uppercase tracking-wider">
          Server Keys
        </h3>
        <div className="space-y-2">
          <div className="rounded-lg bg-surface-0 border border-border px-4 py-3">
            <span className="text-[10px] text-text-muted block mb-1">
              Public Key (Ed25519)
            </span>
            <p className="text-xs font-mono text-text-secondary">
              Configured via WOOBLAY_SERVER_PUBLIC_KEY env
            </p>
          </div>
          <div className="rounded-lg bg-surface-0 border border-border px-4 py-3">
            <span className="text-[10px] text-text-muted block mb-1">Private Key</span>
            <p className="text-xs text-text-muted italic">Hidden for security</p>
          </div>
        </div>
      </Card>

      {/* Danger zone */}
      <Card className="space-y-3 border-l-2 border-l-red-500/50">
        <h3 className="text-xs font-semibold text-red-400 uppercase tracking-wider">
          Danger Zone
        </h3>
        <p className="text-xs text-text-muted">
          These actions are destructive and cannot be undone.
        </p>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="danger">
            Reset All Policies
          </Button>
          <Button size="sm" variant="danger">
            Revoke All Agents
          </Button>
        </div>
      </Card>
    </div>
  );
}

import { useQuery } from '@tanstack/react-query';
import { getHealth, getStats, getAdapters } from '../../api/client.ts';
import { Badge, adapterVariant } from '../../components/common/Badge.tsx';
import { Card } from '../../components/common/Card.tsx';

export function InstancePage() {
  const { data: health, isLoading: healthLoading } = useQuery({
    queryKey: ['health'],
    queryFn: getHealth,
    refetchInterval: 30_000,
  });

  const { data: stats } = useQuery({
    queryKey: ['stats'],
    queryFn: getStats,
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h2 className="text-lg font-semibold text-gray-100">Instance</h2>

      {/* Health status */}
      <Card className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-300">Health</h3>
        {healthLoading ? (
          <p className="text-sm text-gray-500">Checking health…</p>
        ) : health ? (
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span
                className={`inline-block h-3 w-3 rounded-full ${
                  health.status === 'ok' ? 'bg-emerald-500' : 'bg-amber-500'
                }`}
              />
              <Badge variant={health.status === 'ok' ? 'green' : 'yellow'}>
                {health.status.toUpperCase()}
              </Badge>
            </div>
            <span className="text-sm text-gray-400">
              Version: <span className="font-mono text-gray-200">{health.version}</span>
            </span>
            <span className="text-xs text-gray-500">
              {new Date(health.timestamp).toLocaleString()}
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-full bg-red-500" />
            <span className="text-sm text-red-400">Unreachable</span>
          </div>
        )}
      </Card>

      {/* Tenant Info */}
      <Card className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-300">Tenant Info</h3>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-gray-500">Tenant Name</span>
            <p className="text-gray-200">default</p>
          </div>
          <div>
            <span className="text-gray-500">Agent Runtime</span>
            <p className="font-mono text-gray-200">OpenClaw v1</p>
          </div>
          <div>
            <span className="text-gray-500">Gate URL</span>
            <p className="font-mono text-xs text-gray-300">http://localhost:4800</p>
          </div>
          <div>
            <span className="text-gray-500">Dashboard</span>
            <p className="font-mono text-xs text-gray-300">http://localhost:5173</p>
          </div>
        </div>
      </Card>

      {/* Connected Adapters */}
      <AdaptersSection />

      {/* Stats summary */}
      {stats && (
        <Card className="space-y-3">
          <h3 className="text-sm font-semibold text-gray-300">Stats Summary</h3>
          <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <div className="text-center">
              <p className="text-xl font-bold text-gray-100">{stats.totalToolCalls}</p>
              <p className="text-xs text-gray-500">Tool Calls</p>
            </div>
            <div className="text-center">
              <p className="text-xl font-bold text-gray-100">{stats.totalReceipts}</p>
              <p className="text-xs text-gray-500">Receipts</p>
            </div>
            <div className="text-center">
              <p className="text-xl font-bold text-gray-100">{stats.pendingApprovals}</p>
              <p className="text-xs text-gray-500">Pending</p>
            </div>
            <div className="text-center">
              <p className="text-xl font-bold text-gray-100">{stats.agentsRegistered}</p>
              <p className="text-xs text-gray-500">Agents</p>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Connected Adapters Section
// ---------------------------------------------------------------------------

const ADAPTER_TYPE_LABELS: Record<string, string> = {
  plugin: 'In-Process Plugin',
  sidecar: 'Sidecar Process',
  sdk: 'HTTP SDK',
};

function AdaptersSection() {
  const { data: adapters, isLoading } = useQuery({
    queryKey: ['adapters'],
    queryFn: getAdapters,
  });

  if (isLoading || !adapters) return null;

  return (
    <Card className="space-y-3">
      <h3 className="text-sm font-semibold text-gray-300">Available Adapters</h3>
      <p className="text-xs text-gray-500">
        Adapters bridge agent frameworks to Wooblay Gate for supervision.
      </p>
      <div className="space-y-2">
        {adapters.map((adapter) => (
          <div
            key={adapter.id}
            className="flex items-start justify-between gap-3 rounded-lg border border-gray-800 bg-gray-900/50 p-3"
          >
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-center gap-2">
                <Badge variant={adapterVariant(adapter.id)}>{adapter.name}</Badge>
                <span className="text-xs text-gray-500">
                  {ADAPTER_TYPE_LABELS[adapter.type] ?? adapter.type}
                </span>
              </div>
              {adapter.description && (
                <p className="text-xs text-gray-400 leading-relaxed">
                  {adapter.description}
                </p>
              )}
            </div>
            <span className="shrink-0 text-xs font-mono text-gray-600">
              {adapter.agentRuntime}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

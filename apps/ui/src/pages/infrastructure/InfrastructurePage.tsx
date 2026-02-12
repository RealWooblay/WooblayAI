/**
 * Infrastructure — deployment, health, adapters, and setup instructions.
 * Wired to real APIs: /health, /api/stats, /api/adapters, /api/canaries
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  getHealth,
  getStats,
  getAdapters,
  getCanaries,
  createCanary,
  deleteCanary,
  getRuntimeConfig,
  updateRuntimeConfig,
  restartRuntime,
  getRuntimeStatus,
} from '../../api/client.ts';
import { Badge, adapterVariant } from '../../components/common/Badge.tsx';
import { Button } from '../../components/common/Button.tsx';
import { Card } from '../../components/common/Card.tsx';

// ---------------------------------------------------------------------------
// Adapter type labels
// ---------------------------------------------------------------------------

const ADAPTER_TYPE_LABELS: Record<string, string> = {
  plugin: 'In-Process Plugin',
  sidecar: 'Sidecar Process',
  sdk: 'HTTP SDK',
};

// ---------------------------------------------------------------------------
// Health Section
// ---------------------------------------------------------------------------

function HealthPanel() {
  const { data: health, isLoading } = useQuery({
    queryKey: ['health'],
    queryFn: getHealth,
    refetchInterval: 30_000,
  });

  return (
    <Card>
      <h3 className="text-xs font-semibold text-text-tertiary uppercase tracking-wider mb-3">
        Gate Health
      </h3>
      {isLoading ? (
        <div className="text-xs text-text-muted">Checking...</div>
      ) : health ? (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <div
              className={clsx(
                'h-3 w-3 rounded-full',
                health.status === 'ok' ? 'bg-emerald-400 glow-success' : 'bg-amber-400',
              )}
            />
            <span className="text-sm font-semibold text-text-primary">
              {health.status === 'ok' ? 'Healthy' : 'Degraded'}
            </span>
            <span className="text-xs font-mono text-text-tertiary">
              v{health.version}
            </span>
          </div>
          <div className="text-[10px] text-text-muted">
            Last checked: {new Date(health.timestamp).toLocaleString()}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-full bg-red-500" />
          <span className="text-sm text-red-400">Unreachable</span>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Stats Panel
// ---------------------------------------------------------------------------

function StatsPanel() {
  const { data: stats } = useQuery({
    queryKey: ['stats'],
    queryFn: getStats,
  });

  if (!stats) return null;

  const items = [
    { label: 'Tool Calls', value: stats.totalToolCalls },
    { label: 'Receipts', value: stats.totalReceipts },
    { label: 'Pending', value: stats.pendingApprovals },
    { label: 'Agents', value: stats.agentsRegistered },
  ];

  return (
    <Card>
      <h3 className="text-xs font-semibold text-text-tertiary uppercase tracking-wider mb-3">
        Instance Stats
      </h3>
      <div className="grid grid-cols-4 gap-4">
        {items.map((item) => (
          <div key={item.label} className="text-center">
            <div className="text-xl font-bold text-text-primary tabular-nums">
              {item.value.toLocaleString()}
            </div>
            <div className="text-[10px] text-text-muted">{item.label}</div>
          </div>
        ))}
      </div>

      {/* By risk tier */}
      {Object.keys(stats.byRiskTier).length > 0 && (
        <div className="mt-4 pt-3 border-t border-border">
          <div className="flex items-center gap-4">
            {Object.entries(stats.byRiskTier).map(([tier, count]) => (
              <div key={tier} className="flex items-center gap-2 text-xs">
                <span className="font-mono text-text-tertiary">{tier}</span>
                <div className="h-1.5 rounded-full bg-surface-3" style={{ width: 60 }}>
                  <div
                    className={clsx('h-full rounded-full', {
                      'bg-emerald-500': tier === 'READ',
                      'bg-amber-500': tier === 'WRITE',
                      'bg-red-500': tier === 'DESTRUCTIVE',
                    })}
                    style={{
                      width: `${Math.min(100, (count / stats.totalToolCalls) * 100)}%`,
                    }}
                  />
                </div>
                <span className="text-text-secondary tabular-nums">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Adapters
// ---------------------------------------------------------------------------

function AdaptersPanel() {
  const { data: adapters, isLoading } = useQuery({
    queryKey: ['adapters'],
    queryFn: getAdapters,
  });

  if (isLoading || !adapters) return null;

  return (
    <Card>
      <h3 className="text-xs font-semibold text-text-tertiary uppercase tracking-wider mb-1">
        Available Adapters
      </h3>
      <p className="text-[10px] text-text-muted mb-3">
        Adapters bridge agent frameworks to Wooblay Gate.
      </p>
      <div className="space-y-2">
        {adapters.map((adapter) => (
          <div
            key={adapter.id}
            className="flex items-start justify-between gap-3 rounded-lg border border-border bg-surface-0 p-3"
          >
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-center gap-2">
                <Badge variant={adapterVariant(adapter.id)}>{adapter.name}</Badge>
                <span className="text-[10px] text-text-muted">
                  {ADAPTER_TYPE_LABELS[adapter.type] ?? adapter.type}
                </span>
              </div>
              {adapter.description && (
                <p className="text-[11px] text-text-secondary leading-relaxed">
                  {adapter.description}
                </p>
              )}
            </div>
            <span className="shrink-0 text-[10px] font-mono text-text-muted">
              {adapter.agentRuntime}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Canaries
// ---------------------------------------------------------------------------

function CanariesPanel() {
  const { data: canaries, isLoading } = useQuery({
    queryKey: ['canaries'],
    queryFn: getCanaries,
  });

  const qc = useQueryClient();
  const createMut = useMutation({
    mutationFn: createCanary,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['canaries'] }),
  });
  const deleteMut = useMutation({
    mutationFn: deleteCanary,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['canaries'] }),
  });

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ type: 'file', value: '', description: '' });

  function handleCreate() {
    if (!form.value.trim()) return;
    createMut.mutate(
      {
        type: form.type as 'file' | 'env' | 'url' | 'command',
        value: form.value.trim(),
        description: form.description || undefined,
      },
      { onSuccess: () => { setForm({ type: 'file', value: '', description: '' }); setShowForm(false); } },
    );
  }

  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-xs font-semibold text-text-tertiary uppercase tracking-wider">
            Canary Traps
          </h3>
          <p className="text-[10px] text-text-muted mt-0.5">
            Honeypot triggers that detect agent misbehavior
          </p>
        </div>
        <Button size="xs" variant="secondary" onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Cancel' : '+ Add Canary'}
        </Button>
      </div>

      {showForm && (
        <div className="space-y-2 p-3 rounded-lg border border-border bg-surface-0 mb-3">
          <div className="flex gap-2">
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
              className="rounded-md border border-border bg-surface-2 px-2 py-1.5 text-xs text-text-primary focus:border-accent focus:outline-none"
            >
              <option value="file">File</option>
              <option value="env">Env Var</option>
              <option value="url">URL</option>
              <option value="command">Command</option>
            </select>
            <input
              type="text"
              value={form.value}
              onChange={(e) => setForm({ ...form, value: e.target.value })}
              placeholder="Canary value..."
              className="flex-1 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-xs font-mono text-text-primary placeholder-text-muted focus:border-accent focus:outline-none"
            />
          </div>
          <input
            type="text"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Description (optional)"
            className="w-full rounded-md border border-border bg-surface-2 px-3 py-1.5 text-xs text-text-primary placeholder-text-muted focus:border-accent focus:outline-none"
          />
          <Button size="xs" onClick={handleCreate} disabled={createMut.isPending}>
            Create
          </Button>
        </div>
      )}

      {isLoading ? (
        <div className="text-xs text-text-muted py-4 text-center">Loading canaries...</div>
      ) : !canaries?.length ? (
        <div className="text-xs text-text-muted py-4 text-center">No canaries set up yet</div>
      ) : (
        <div className="space-y-1.5">
          {canaries.map((canary) => (
            <div
              key={canary.id}
              className={clsx(
                'flex items-center justify-between gap-3 rounded-lg border p-3',
                canary.trippedAt
                  ? 'border-red-500/30 bg-red-500/5 glow-danger'
                  : 'border-border bg-surface-0',
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Badge variant={canary.trippedAt ? 'red' : 'gray'}>
                    {canary.type}
                  </Badge>
                  <span className="text-xs font-mono text-text-secondary truncate">
                    {canary.value}
                  </span>
                </div>
                {canary.description && (
                  <p className="text-[10px] text-text-muted mt-0.5">{canary.description}</p>
                )}
                {canary.trippedAt && (
                  <p className="text-[10px] text-red-400 mt-1 font-semibold">
                    TRIPPED by {canary.trippedBy} at{' '}
                    {new Date(canary.trippedAt).toLocaleString()}
                  </p>
                )}
              </div>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => {
                  if (confirm('Delete this canary?')) deleteMut.mutate(canary.id);
                }}
              >
                ×
              </Button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Instance Configuration (Runtime Config)
// ---------------------------------------------------------------------------

function RuntimeConfigPanel() {
  const qc = useQueryClient();
  const { data: config, isLoading } = useQuery({
    queryKey: ['runtimeConfig'],
    queryFn: getRuntimeConfig,
  });

  const { data: status } = useQuery({
    queryKey: ['runtimeStatus'],
    queryFn: getRuntimeStatus,
    refetchInterval: 15_000,
  });

  const updateMut = useMutation({
    mutationFn: updateRuntimeConfig,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['runtimeConfig'] }),
  });

  const restartMut = useMutation({
    mutationFn: restartRuntime,
  });

  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [hasChanges, setHasChanges] = useState(false);

  function handleChange(key: string, value: string) {
    setEditValues((prev) => ({ ...prev, [key]: value }));
    setHasChanges(true);
  }

  function handleSave() {
    updateMut.mutate(editValues, {
      onSuccess: () => {
        setHasChanges(false);
        setEditValues({});
      },
    });
  }

  const categories = ['agent', 'gate', 'security'] as const;

  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-xs font-semibold text-text-tertiary uppercase tracking-wider">
            Instance Configuration
          </h3>
          <p className="text-[10px] text-text-muted mt-0.5">
            Configure environment variables for the managed runtime. Secrets are stored securely.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {hasChanges && (
            <Button size="xs" onClick={handleSave} disabled={updateMut.isPending}>
              {updateMut.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          )}
          <Button
            size="xs"
            variant="secondary"
            onClick={() => {
              if (confirm('Restart the agent container? Active sessions will be interrupted.')) {
                restartMut.mutate();
              }
            }}
            disabled={restartMut.isPending}
          >
            {restartMut.isPending ? 'Restarting...' : 'Restart Agent'}
          </Button>
        </div>
      </div>

      {/* Status bar */}
      {status && (
        <div className="flex items-center gap-4 mb-4 text-[10px] text-text-muted border border-border rounded-lg p-2 bg-surface-0">
          <span>Gate uptime: <span className="text-text-secondary">{Math.round(status.gate.uptime / 60)}m</span></span>
          <span>Memory: <span className="text-text-secondary">{status.gate.memoryMB}MB</span></span>
          <span>Node: <span className="text-text-secondary">{status.gate.nodeVersion}</span></span>
          <span>Env: <span className="text-text-secondary">{status.environment}</span></span>
          {status.containers.length > 0 && (
            <span>Containers: <span className="text-text-secondary">{status.containers.length}</span></span>
          )}
        </div>
      )}

      {/* Mutation results */}
      {updateMut.isSuccess && (
        <div className="mb-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-2 text-[11px] text-emerald-400">
          {updateMut.data?.message}
        </div>
      )}
      {restartMut.isSuccess && (
        <div className="mb-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-2 text-[11px] text-emerald-400">
          {restartMut.data?.message}
        </div>
      )}
      {restartMut.isError && (
        <div className="mb-3 rounded-lg border border-red-500/20 bg-red-500/5 p-2 text-[11px] text-red-400">
          Restart failed. You may need to restart manually via SSH.
        </div>
      )}

      {isLoading ? (
        <div className="py-6 text-center text-xs text-text-muted">Loading configuration...</div>
      ) : config ? (
        <div className="space-y-4">
          {categories.map((category) => {
            const vars = config.values.filter((v) => v.category === category);
            if (vars.length === 0) return null;
            return (
              <div key={category}>
                <h4 className="text-[10px] font-bold text-text-muted uppercase tracking-wider mb-2 capitalize">{category}</h4>
                <div className="space-y-2">
                  {vars.map((v) => (
                    <div key={v.key} className="flex items-start gap-3 rounded-lg border border-border bg-surface-0 p-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-xs font-semibold text-text-primary">{v.label}</span>
                          {v.secret && (
                            <span className="text-[8px] font-bold text-amber-400 bg-amber-500/10 rounded px-1 py-0.5">SECRET</span>
                          )}
                          {v.isSet && (
                            <span className="text-[8px] font-bold text-emerald-400 bg-emerald-500/10 rounded px-1 py-0.5">SET</span>
                          )}
                        </div>
                        <p className="text-[10px] text-text-muted">{v.description}</p>
                      </div>
                      <input
                        type={v.secret ? 'password' : 'text'}
                        defaultValue={v.value}
                        placeholder={v.defaultValue || 'Not set'}
                        onChange={(e) => handleChange(v.key, e.target.value)}
                        className="w-64 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-xs font-mono text-text-primary placeholder-text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent shrink-0"
                      />
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Connect Your Agent (Agent-Agnostic Guide)
// ---------------------------------------------------------------------------

function ConnectYourAgent() {
  const [tab, setTab] = useState<'http' | 'openclaw' | 'mcp'>('http');

  return (
    <Card>
      <h3 className="text-xs font-semibold text-text-tertiary uppercase tracking-wider mb-1">
        Connect Your Agent
      </h3>
      <p className="text-[10px] text-text-muted mb-3">
        Wooblay is agent-agnostic. Any agent that can make HTTP calls can integrate.
      </p>

      <div className="flex gap-1 border-b border-border mb-4">
        {([
          { key: 'http' as const, label: 'HTTP SDK (Any Agent)' },
          { key: 'openclaw' as const, label: 'OpenClaw' },
          { key: 'mcp' as const, label: 'MCP Sidecar' },
        ]).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={clsx(
              'px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors cursor-pointer',
              tab === t.key
                ? 'border-accent text-accent-bright'
                : 'border-transparent text-text-muted hover:text-text-secondary',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'http' && (
        <div className="space-y-3">
          <p className="text-xs text-text-secondary">
            The simplest integration: make a POST request to Wooblay Gate before executing any tool call. Works with any language or framework.
          </p>
          <CodeBlock
            title="Route a tool call through Wooblay"
            code={`curl -X POST http://localhost:4800/api/tool/execute \\
  -H "Content-Type: application/json" \\
  -d '{
    "toolName": "exec",
    "args": { "command": "rm -rf /tmp/test" },
    "agentPubkey": "your-agent-pubkey",
    "requestSignature": "optional-ed25519-signature",
    "adapter": "http-sdk",
    "taskId": "task-123",
    "sessionId": "session-abc"
  }'`}
          />
          <p className="text-[10px] text-text-muted">
            Response will be one of: <code className="bg-surface-2 px-1 rounded">EXECUTE</code> (proceed),
            <code className="bg-surface-2 px-1 rounded ml-1">DENY</code> (blocked),
            or <code className="bg-surface-2 px-1 rounded ml-1">PENDING_APPROVAL</code> (needs human approval — poll the returned <code className="bg-surface-2 px-1 rounded">approvalId</code>).
          </p>
          <CodeBlock
            title="Poll for approval decision"
            code={`curl http://localhost:4800/api/approvals/{approvalId}`}
          />
        </div>
      )}

      {tab === 'openclaw' && (
        <div className="space-y-3">
          <p className="text-xs text-text-secondary">
            OpenClaw integration uses the Wooblay plugin + exec approvals bridge. Pre-installed in managed runtimes.
          </p>
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
            <p className="text-[11px] text-emerald-400 font-medium">Managed Runtime: Pre-configured</p>
            <p className="text-[10px] text-text-secondary mt-1">
              When you deploy an OpenClaw instance through Wooblay, the plugin is automatically installed and configured.
              All exec/process tool calls are routed through Wooblay Gate.
            </p>
          </div>
          <CodeBlock
            title="Manual setup (if running your own OpenClaw)"
            code={`# Copy the Wooblay plugin to OpenClaw's plugin directory
cp -r packages/adapters/openclaw/plugin ~/.openclaw/plugins/wooblay/

# Add exec-approvals config
cp docker/runtimes/openclaw/exec-approvals.json ~/.openclaw/

# Set environment variables
export GATE_URL=http://localhost:4800
export WOOBLAY_TOOL_FILTER=risky

# Restart OpenClaw
openclaw gateway restart`}
          />
        </div>
      )}

      {tab === 'mcp' && (
        <div className="space-y-3">
          <p className="text-xs text-text-secondary">
            For MCP-compatible agents (Claude Desktop, etc.), Wooblay can run as a sidecar that wraps
            MCP tool calls and routes them through Gate before executing.
          </p>
          <CodeBlock
            title="MCP sidecar configuration"
            code={`{
  "mcpServers": {
    "wooblay": {
      "command": "npx",
      "args": ["@wooblay/mcp-toolhost", "--gate", "http://localhost:4800"]
    }
  }
}`}
          />
          <p className="text-[10px] text-text-muted">
            The MCP toolhost exposes wrapped versions of configured tools. Each call is evaluated by Gate policy before execution.
          </p>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Deployment Instructions
// ---------------------------------------------------------------------------

function DeploymentGuide() {
  const [tab, setTab] = useState<'docker' | 'terraform' | 'manual'>('docker');

  return (
    <Card>
      <h3 className="text-xs font-semibold text-text-tertiary uppercase tracking-wider mb-3">
        Deployment Guide
      </h3>

      <div className="flex gap-1 border-b border-border mb-4">
        {(['docker', 'terraform', 'manual'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={clsx(
              'px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors capitalize',
              tab === t
                ? 'border-accent text-accent-bright'
                : 'border-transparent text-text-muted hover:text-text-secondary',
            )}
          >
            {t === 'terraform' ? 'Terraform (AWS)' : t}
          </button>
        ))}
      </div>

      {tab === 'docker' && (
        <div className="space-y-3">
          <p className="text-xs text-text-secondary">
            Fastest way to run Wooblay locally or on any server with Docker.
          </p>
          <CodeBlock
            title="1. Clone and start"
            code={`git clone https://github.com/wooblay/wooblay.git
cd wooblay
cp .env.example .env
docker compose up -d`}
          />
          <CodeBlock
            title="2. Verify"
            code={`curl http://localhost:4800/health`}
          />
          <CodeBlock
            title="3. Open dashboard"
            code={`open http://localhost:5173`}
          />
          <p className="text-[10px] text-text-muted">
            PostgreSQL runs in Docker. Gate serves on port 4800, UI on port 5173.
          </p>
        </div>
      )}

      {tab === 'terraform' && (
        <div className="space-y-3">
          <p className="text-xs text-text-secondary">
            Production deployment to AWS using Terraform. Creates VPC, ALB, ECS Fargate, RDS PostgreSQL, and Secrets Manager resources.
          </p>
          <CodeBlock
            title="1. Configure backend"
            code={`cd infra/base
# Edit terraform.tf to set your S3 state bucket
terraform init`}
          />
          <CodeBlock
            title="2. Deploy base infrastructure"
            code={`terraform plan -var="domain=gate.yourdomain.com"
terraform apply`}
          />
          <CodeBlock
            title="3. Deploy tenant"
            code={`cd ../tenant
terraform init
terraform plan \\
  -var="tenant_name=production" \\
  -var="gate_image=your-ecr-repo/wooblay-gate:latest"
terraform apply`}
          />
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
            <p className="text-[11px] text-amber-400 font-medium">AWS Resources Created:</p>
            <ul className="text-[10px] text-text-secondary mt-1 space-y-0.5 list-disc list-inside">
              <li>VPC with public/private subnets, NAT Gateway</li>
              <li>Application Load Balancer with SSL termination</li>
              <li>ECS Fargate service (Gate + agent runtime containers)</li>
              <li>RDS PostgreSQL (per-tenant isolated database)</li>
              <li>Secrets Manager (DB URL, signing keys, toolhost keys)</li>
              <li>KMS encryption keys, CloudWatch log groups</li>
              <li>VPC endpoints for SSM, ECR, S3, Secrets Manager</li>
            </ul>
          </div>
          <CodeBlock
            title="4. Configure via CLI"
            code={`npx wooblay provision --tenant production
npx wooblay status`}
          />
        </div>
      )}

      {tab === 'manual' && (
        <div className="space-y-3">
          <p className="text-xs text-text-secondary">
            Run Wooblay directly on any machine with Node.js 20+ and PostgreSQL.
          </p>
          <CodeBlock
            title="1. Install dependencies"
            code={`git clone https://github.com/wooblay/wooblay.git
cd wooblay
npm install`}
          />
          <CodeBlock
            title="2. Configure environment"
            code={`cp .env.example .env
# Edit .env:
#   DATABASE_URL=postgresql://user:pass@localhost:5432/wooblay
#   WOOBLAY_SERVER_PRIVATE_KEY=<ed25519-private-key>
#   WOOBLAY_SERVER_PUBLIC_KEY=<ed25519-public-key>`}
          />
          <CodeBlock
            title="3. Set up database"
            code={`npx prisma migrate deploy`}
          />
          <CodeBlock
            title="4. Start Gate server"
            code={`npm run dev:gate   # Development
npm run build:gate && npm start  # Production`}
          />
          <CodeBlock
            title="5. (Optional) GitHub App"
            code={`# Create a GitHub App and add to .env:
#   GITHUB_APP_ID=<app-id>
#   GITHUB_APP_PRIVATE_KEY=<pem-key>
#   GITHUB_WEBHOOK_SECRET=<secret>
#   WOOBLAY_DASHBOARD_URL=https://your-dashboard.com`}
          />
        </div>
      )}
    </Card>
  );
}

function CodeBlock({ title, code }: { title: string; code: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div>
      <div className="text-[10px] font-semibold text-text-tertiary mb-1">{title}</div>
      <div className="relative group">
        <pre className="text-[11px] font-mono text-text-secondary bg-surface-0 border border-border rounded-lg p-3 overflow-x-auto">
          {code}
        </pre>
        <button
          onClick={() => {
            void navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
          className="absolute top-2 right-2 px-2 py-1 rounded text-[10px] bg-surface-2 text-text-muted hover:text-text-primary opacity-0 group-hover:opacity-100 transition-opacity"
        >
          {copied ? '✓' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export function InfrastructurePage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-lg font-bold text-text-primary">Infrastructure</h1>
        <p className="text-xs text-text-tertiary mt-0.5">
          Instance health, adapters, canary traps, and deployment guides.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <HealthPanel />
        <StatsPanel />
      </div>

      <RuntimeConfigPanel />
      <AdaptersPanel />
      <ConnectYourAgent />
      <CanariesPanel />
      <DeploymentGuide />
    </div>
  );
}

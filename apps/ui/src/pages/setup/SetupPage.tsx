/**
 * Setup — Integration guide, API keys, and quick-start for connecting external agents.
 * This is the primary onboarding surface for the firewall product.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../components/common/Button.tsx';
import { getApiKeys, createApiKey, revokeApiKey, type ApiKeyInfo, type ApiKeyCreated } from '../../api/client.ts';
import { useToast } from '../../components/common/Toast.tsx';

export function SetupPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: apiKeys = [] } = useQuery({ queryKey: ['api-keys'], queryFn: getApiKeys });
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyExpiry, setNewKeyExpiry] = useState('');
  const [createdKey, setCreatedKey] = useState<ApiKeyCreated | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);

  const createKeyMut = useMutation({
    mutationFn: () => createApiKey({
      name: newKeyName,
      expiresInDays: newKeyExpiry ? parseInt(newKeyExpiry) : undefined,
    }),
    onSuccess: (data) => {
      setCreatedKey(data);
      setNewKeyName('');
      setNewKeyExpiry('');
      qc.invalidateQueries({ queryKey: ['api-keys'] });
      toast('API key created — copy it now, it won\'t be shown again', 'success');
    },
    onError: () => toast('Failed to create API key', 'error'),
  });

  const revokeKeyMut = useMutation({
    mutationFn: revokeApiKey,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['api-keys'] }); toast('API key revoked', 'info'); },
  });

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <h1 className="text-lg font-bold text-text-primary mb-1">Setup</h1>
      <p className="text-xs text-text-muted mb-6">
        Connect any AI agent to Wooblay in under 5 minutes. All policy enforcement, credential isolation,
        and secure execution applies automatically.
      </p>

      {/* Quick Start Guide */}
      <div className="bg-surface-1 border border-border rounded-xl p-5">
        <h2 className="text-sm font-semibold text-text-primary mb-3">Quick Start</h2>
        <div className="space-y-3 text-[11px]">
          <div className="flex gap-3 items-start">
            <span className="shrink-0 w-6 h-6 rounded-full bg-accent/10 text-accent flex items-center justify-center text-xs font-bold">1</span>
            <div>
              <p className="text-text-primary font-medium">Add a Connection</p>
              <p className="text-text-muted mt-0.5">
                Go to <a href="/connections" className="text-accent hover:text-accent-bright">Connections</a> and
                add your service credentials (API keys, tokens). They're encrypted in the vault — your agents never see them.
              </p>
            </div>
          </div>
          <div className="flex gap-3 items-start">
            <span className="shrink-0 w-6 h-6 rounded-full bg-accent/10 text-accent flex items-center justify-center text-xs font-bold">2</span>
            <div>
              <p className="text-text-primary font-medium">Configure Policies</p>
              <p className="text-text-muted mt-0.5">
                Set <a href="/policies" className="text-accent hover:text-accent-bright">Policies</a> to control
                what actions are allowed, denied, or require human approval.
              </p>
            </div>
          </div>
          <div className="flex gap-3 items-start">
            <span className="shrink-0 w-6 h-6 rounded-full bg-accent/10 text-accent flex items-center justify-center text-xs font-bold">3</span>
            <div>
              <p className="text-text-primary font-medium">Create an API Key</p>
              <p className="text-text-muted mt-0.5">
                Generate a key below and give it to your agent. The key inherits your connections and policies automatically.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* API Keys */}
      <div className="bg-surface-1 border border-border rounded-xl p-5">
        <h2 className="text-sm font-semibold text-text-primary mb-1">API Keys</h2>
        <p className="text-xs text-text-muted mb-4">
          Each key authenticates an external agent or framework against the Wooblay gateway.
          Same policy enforcement, credential vault, and secure execution as hosted agents.
        </p>

        {/* Created key banner */}
        {createdKey && (
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-4 mb-4">
            <p className="text-xs font-semibold text-emerald-400 mb-2">
              Key created — copy it now. It won't be shown again.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs bg-black/30 rounded px-3 py-2 text-emerald-300 font-mono break-all select-all">
                {createdKey.key}
              </code>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(createdKey.key);
                  setCopiedKey(true);
                  setTimeout(() => setCopiedKey(false), 2000);
                }}
                className="px-3 py-2 text-xs bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 rounded-lg transition-colors"
              >
                {copiedKey ? 'Copied' : 'Copy'}
              </button>
            </div>
            <button
              onClick={() => setCreatedKey(null)}
              className="text-[10px] text-text-muted hover:text-text-secondary mt-2"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Existing keys */}
        {apiKeys.length > 0 && (
          <div className="space-y-2 mb-4">
            {apiKeys.map((k: ApiKeyInfo) => (
              <div key={k.id} className="flex items-center gap-3 bg-surface-2 rounded-lg p-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-xs text-text-primary font-medium">{k.name}</p>
                    <code className="text-[10px] text-text-muted font-mono">{k.prefix}...</code>
                  </div>
                  <div className="flex gap-3 mt-0.5">
                    <p className="text-[10px] text-text-muted">
                      Created {new Date(k.createdAt).toLocaleDateString()}
                    </p>
                    {k.lastUsedAt && (
                      <p className="text-[10px] text-text-muted">
                        Last used {new Date(k.lastUsedAt).toLocaleDateString()}
                      </p>
                    )}
                    {k.expiresAt && (
                      <p className="text-[10px] text-amber-400/70">
                        Expires {new Date(k.expiresAt).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => revokeKeyMut.mutate(k.id)}
                  className="text-[10px] text-red-400/50 hover:text-red-400"
                >
                  Revoke
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Create new key */}
        <div className="space-y-3">
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="block text-[11px] text-text-muted mb-1">Key Name</label>
              <input
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                placeholder="e.g. GPT Action, Claude MCP, CI Pipeline"
                className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
              />
            </div>
            <div className="w-32">
              <label className="block text-[11px] text-text-muted mb-1">Expires in (days)</label>
              <input
                value={newKeyExpiry}
                onChange={(e) => setNewKeyExpiry(e.target.value)}
                placeholder="Never"
                type="number"
                min="1"
                className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
              />
            </div>
          </div>
          <Button
            size="sm"
            onClick={() => newKeyName && createKeyMut.mutate()}
            disabled={!newKeyName || createKeyMut.isPending}
          >
            Create API Key
          </Button>
        </div>
      </div>

      {/* Integration Guide */}
      <div className="bg-surface-1 border border-border rounded-xl p-5 space-y-3">
        <h2 className="text-sm font-semibold text-text-primary mb-1">Integration</h2>

        {/* How it works */}
        <div className="p-3 bg-surface-2 rounded-lg">
          <p className="text-[11px] font-medium text-text-secondary mb-2">How it works</p>
          <p className="text-[10px] text-text-muted">
            External agents call the gateway with an action and parameters. Wooblay authenticates via API key,
            resolves credentials from the vault, evaluates your policies, and executes in an ephemeral container.
            The agent never sees the raw credentials — they're injected server-side and destroyed after execution.
          </p>
        </div>

        {/* Example call */}
        <div className="p-3 bg-surface-2 rounded-lg">
          <p className="text-[11px] font-medium text-text-secondary mb-2">Example request</p>
          <div className="space-y-1.5 text-[10px] text-text-muted font-mono bg-black/20 rounded p-2.5">
            <p className="text-indigo-300">POST https://gate.wooblay.com/api/gateway/execute</p>
            <p className="text-zinc-500">Authorization: Bearer wbl_ak_your_key_here</p>
            <p className="text-zinc-500">Content-Type: application/json</p>
            <p className="text-zinc-400 mt-1">{'{'} "action": "...", "params": {'{'} ... {'}'} {'}'}</p>
          </div>
          <p className="text-[10px] text-text-muted mt-2">
            Any action can be executed — provide the action name, command, and which provider&apos;s credentials to use.
            Call <code className="text-[10px] bg-black/20 px-1 rounded">GET /api/gateway/capabilities</code> with
            your API key to see which providers are connected.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <div className="p-3 bg-surface-2 rounded-lg">
            <p className="text-[11px] font-medium text-text-secondary mb-1">GPT Actions</p>
            <p className="text-[10px] text-text-muted">
              Import the OpenAPI spec as a custom action. Set Bearer auth with your API key.
            </p>
          </div>
          <div className="p-3 bg-surface-2 rounded-lg">
            <p className="text-[11px] font-medium text-text-secondary mb-1">Claude MCP</p>
            <p className="text-[10px] text-text-muted">
              Bridge tool calls to the gateway via a thin MCP server.
            </p>
          </div>
          <div className="p-3 bg-surface-2 rounded-lg">
            <p className="text-[11px] font-medium text-text-secondary mb-1">Any Agent / Framework</p>
            <p className="text-[10px] text-text-muted">
              Any agent that can make HTTP calls can use the gateway as a secure execution backend.
            </p>
          </div>
        </div>

        <div className="p-3 bg-indigo-500/5 border border-indigo-500/15 rounded-lg">
          <p className="text-[11px] font-medium text-indigo-300 mb-1">Security model</p>
          <p className="text-[10px] text-indigo-400/60">
            API key authenticates the caller and resolves the org. Credentials are pulled from the vault,
            policy rules are evaluated, and the action executes in an ephemeral container that's destroyed
            after. The external agent never touches raw secrets — they're injected server-side at execution time.
            Everything you configure in Wooblay (connections, policies, scope boundaries) applies to external agents automatically.
          </p>
        </div>
      </div>
    </div>
  );
}

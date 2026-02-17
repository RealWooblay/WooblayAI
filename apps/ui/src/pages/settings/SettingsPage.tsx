/**
 * Settings — Account management, webhook config, preferences.
 */

import { useState } from 'react';
import { useUser as useClerkUser, useClerk as useClerkInstance, OrganizationProfile } from '@clerk/clerk-react';

const HAS_CLERK = !!import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
function useUser() {
  if (!HAS_CLERK) return { user: null };
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useClerkUser();
}
function useClerk() {
  if (!HAS_CLERK) return { signOut: () => {} };
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useClerkInstance();
}
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../components/common/Button.tsx';
import { getWebhooks, createWebhook, deleteWebhook, testWebhook, type Webhook, getApiKeys, createApiKey, revokeApiKey, type ApiKeyInfo, type ApiKeyCreated } from '../../api/client.ts';
import { useToast } from '../../components/common/Toast.tsx';

const WEBHOOK_EVENTS = [
  { id: 'approval.pending', label: 'New Approval Pending' },
  { id: 'approval.stale', label: 'Stale Approval (>15 min)' },
  { id: 'flag.critical', label: 'Critical Flag Raised' },
  { id: 'flag.high', label: 'High Severity Flag' },
  { id: 'agent.trust_low', label: 'Low Trust Score (<40)' },
];

export function SettingsPage() {
  const { user } = useUser();
  const { signOut } = useClerk();
  const { toast } = useToast();
  const qc = useQueryClient();

  // API Keys
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

  // Webhooks
  const { data: webhooks = [] } = useQuery({ queryKey: ['webhooks'], queryFn: getWebhooks });
  const [newUrl, setNewUrl] = useState('');
  const [newEvents, setNewEvents] = useState<string[]>(['approval.pending', 'flag.critical']);

  const addWebhookMut = useMutation({
    mutationFn: () => createWebhook({ url: newUrl, events: newEvents }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['webhooks'] }); setNewUrl(''); toast('Webhook added', 'success'); },
  });

  const deleteWebhookMut = useMutation({
    mutationFn: deleteWebhook,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['webhooks'] }); toast('Webhook deleted', 'info'); },
  });

  const testWebhookMut = useMutation({
    mutationFn: testWebhook,
    onSuccess: (data) => toast(data.success ? 'Test sent successfully' : 'Test failed', data.success ? 'success' : 'error'),
  });

  const toggleEvent = (eventId: string) => {
    setNewEvents((prev) =>
      prev.includes(eventId)
        ? prev.filter((e) => e !== eventId)
        : [...prev, eventId],
    );
  };

  return (
    <div className="max-w-2xl mx-auto space-y-4" data-tour="tour-settings">
      <h1 className="text-lg font-bold text-text-primary mb-1">Settings</h1>
      <p className="text-xs text-text-muted mb-6">Account, notifications, and preferences</p>

      {/* Profile */}
      <div className="bg-surface-1 border border-border rounded-xl p-5">
        <h2 className="text-sm font-semibold text-text-primary mb-4">Profile</h2>
        <div className="flex items-center gap-4">
          {user?.imageUrl && (
            <img src={user.imageUrl} alt="" className="h-12 w-12 rounded-full border border-border" />
          )}
          <div>
            <p className="text-sm font-medium text-text-primary">
              {user?.fullName || user?.primaryEmailAddress?.emailAddress || 'User'}
            </p>
            <p className="text-xs text-text-secondary">
              {user?.primaryEmailAddress?.emailAddress}
            </p>
          </div>
        </div>
      </div>

      {/* Account */}
      <div className="bg-surface-1 border border-border rounded-xl p-5">
        <h2 className="text-sm font-semibold text-text-primary mb-4">Account</h2>
        <div className="space-y-3 text-sm">
          <div className="flex justify-between items-center">
            <span className="text-text-secondary">Plan</span>
            <span className="text-text-primary font-medium px-2 py-0.5 bg-accent-subtle rounded text-xs">Beta Access</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-text-secondary">Member since</span>
            <span className="text-text-primary text-xs">
              {user?.createdAt ? new Date(user.createdAt).toLocaleDateString() : '-'}
            </span>
          </div>
        </div>
      </div>

      {/* Organization — Clerk handles invites, roles, member management */}
      {HAS_CLERK && (
        <div className="bg-surface-1 border border-border rounded-xl p-5 overflow-hidden">
          <h2 className="text-sm font-semibold text-text-primary mb-1">Organization</h2>
          <p className="text-xs text-text-muted mb-4">
            Invite team members, manage roles, and configure your organization.
          </p>
          <div className="clerk-org-embed [&_.cl-organizationProfile-root]:w-full [&_.cl-card]:bg-transparent [&_.cl-card]:shadow-none [&_.cl-card]:border-0 [&_.cl-card]:p-0 [&_.cl-navbar]:hidden [&_.cl-pageScrollBox]:p-0 [&_.cl-profilePage]:p-0 [&_.cl-headerTitle]:text-inherit [&_.cl-headerSubtitle]:text-inherit [&_.cl-profileSectionTitle]:text-inherit [&_.cl-profileSectionContent]:text-inherit [&_.cl-tableHead]:text-inherit [&_.cl-tableCell]:text-inherit [&_.cl-badge]:text-inherit [&_.cl-breadcrumbs]:text-inherit [&_.cl-breadcrumbsItem]:text-inherit">
            <OrganizationProfile
              appearance={{
                elements: {
                  rootBox: 'w-full max-w-full',
                  card: 'bg-transparent shadow-none border-0 w-full p-0 m-0',
                  navbar: 'hidden',
                  pageScrollBox: 'p-0',
                  page: 'gap-4',
                  profilePage: 'p-0',
                  profileSection: 'gap-2',
                  headerTitle: 'text-[#e4e4e7]',
                  headerSubtitle: 'text-[#a1a1aa]',
                  profileSectionTitle: 'text-[#e4e4e7]',
                  profileSectionTitleText: 'text-[#e4e4e7]',
                  profileSectionContent: 'text-[#e4e4e7]',
                  profileSectionPrimaryButton: 'text-[#e4e4e7]',
                  tableHead: 'text-[#a1a1aa]',
                  tableCell: 'text-[#e4e4e7]',
                  badge: 'text-[#e4e4e7]',
                  breadcrumbs: 'text-[#a1a1aa]',
                  breadcrumbsItem: 'text-[#a1a1aa]',
                  breadcrumbsItemDivider: 'text-[#52525b]',
                  formFieldInput: 'bg-[#1a1a1e] border-white/10 text-[#e4e4e7]',
                  formFieldLabel: 'text-[#a1a1aa]',
                  tagInputContainer: 'bg-[#1a1a1e] border-white/10 text-[#e4e4e7]',
                  membersPageInviteButton: 'bg-indigo-500 hover:bg-indigo-600',
                },
              }}
            />
          </div>
        </div>
      )}

      {/* External API Keys */}
      <div className="bg-surface-1 border border-border rounded-xl p-5">
        <h2 className="text-sm font-semibold text-text-primary mb-1">External API Keys</h2>
        <p className="text-xs text-text-muted mb-4">
          Let any external agent or framework call Wooblay's secure gateway.
          API keys authenticate external callers — same policy enforcement, credential vault, and secure execution as hosted agents.
        </p>

        {/* Created key banner — shown once */}
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

        {/* Integration guide */}
        <div className="mt-4 space-y-3">
          {/* Setup steps */}
          <div className="p-3 bg-surface-2 rounded-lg">
            <p className="text-[11px] font-medium text-text-secondary mb-2">Setup (one-time)</p>
            <div className="space-y-2 text-[10px] text-text-muted">
              <div className="flex gap-2">
                <span className="text-accent font-mono shrink-0">1.</span>
                <span>Add a <a href="/connections" className="text-accent hover:text-accent-bright">Connection</a> — your service credentials are encrypted in the vault</span>
              </div>
              <div className="flex gap-2">
                <span className="text-accent font-mono shrink-0">2.</span>
                <span>Set <a href="/policies" className="text-accent hover:text-accent-bright">Policies</a> — what actions are allowed, denied, or require approval</span>
              </div>
              <div className="flex gap-2">
                <span className="text-accent font-mono shrink-0">3.</span>
                <span>Create an API key above — give it to your external agent</span>
              </div>
            </div>
            <p className="text-[10px] text-text-muted mt-2">
              The API key inherits your connections and policies automatically. No extra config.
            </p>
          </div>

          {/* How it works */}
          <div className="p-3 bg-surface-2 rounded-lg">
            <p className="text-[11px] font-medium text-text-secondary mb-2">How it works</p>
            <p className="text-[10px] text-text-muted">
              External agents call the gateway with an action and parameters. Wooblay authenticates via API key,
              resolves credentials from the vault, evaluates your policies, and executes in an ephemeral container.
              The agent never sees the raw credentials — they're injected server-side and destroyed after execution.
              Available actions depend on which connections you've configured.
              If an action requires a hosted workspace, the gateway will respond with a clear error and alternatives.
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

      {/* Webhook Notifications */}
      <div className="bg-surface-1 border border-border rounded-xl p-5" data-tour="tour-webhooks">
        <h2 className="text-sm font-semibold text-text-primary mb-1">Notifications</h2>
        <p className="text-xs text-text-muted mb-4">
          Receive alerts via Slack, Discord, or any webhook endpoint.
        </p>

        {/* Existing webhooks */}
        {webhooks.length > 0 && (
          <div className="space-y-2 mb-4">
            {webhooks.map((wh: Webhook) => {
              let events: string[] = [];
              try { events = JSON.parse(wh.events); } catch { /* empty */ }
              return (
                <div key={wh.id} className="flex items-center gap-3 bg-surface-2 rounded-lg p-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-text-primary font-mono truncate">{wh.url}</p>
                    <p className="text-[10px] text-text-muted mt-0.5">{events.join(', ')}</p>
                  </div>
                  <button
                    onClick={() => testWebhookMut.mutate(wh.id)}
                    className="text-[10px] text-accent hover:text-accent-bright"
                  >
                    Test
                  </button>
                  <button
                    onClick={() => deleteWebhookMut.mutate(wh.id)}
                    className="text-[10px] text-red-400/50 hover:text-red-400"
                  >
                    Remove
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Add webhook */}
        <div className="space-y-3">
          <div>
            <label className="block text-[11px] text-text-muted mb-1">Webhook URL</label>
            <input
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              placeholder="https://hooks.slack.com/services/..."
              className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
            />
            <p className="text-[10px] text-text-muted mt-1">
              Paste your Slack incoming webhook URL, Discord webhook, or any HTTP endpoint.
            </p>
          </div>
          <div>
            <label className="block text-[11px] text-text-muted mb-2">Events</label>
            <div className="flex flex-wrap gap-2">
              {WEBHOOK_EVENTS.map((evt) => (
                <button
                  key={evt.id}
                  onClick={() => toggleEvent(evt.id)}
                  className={`px-2.5 py-1 rounded-lg text-xs border transition-colors ${
                    newEvents.includes(evt.id)
                      ? 'bg-accent/10 border-accent/30 text-accent-bright'
                      : 'bg-surface-2 border-border text-text-muted hover:border-border-strong'
                  }`}
                >
                  {evt.label}
                </button>
              ))}
            </div>
          </div>
          <Button
            size="sm"
            onClick={() => newUrl && addWebhookMut.mutate()}
            disabled={!newUrl || addWebhookMut.isPending}
          >
            Add Webhook
          </Button>
        </div>
      </div>

      {/* Session */}
      <div className="bg-surface-1 border border-border rounded-xl p-5">
        <h2 className="text-sm font-semibold text-text-primary mb-4">Session</h2>
        <Button variant="danger" size="sm" onClick={() => signOut()}>
          Sign Out
        </Button>
      </div>
    </div>
  );
}

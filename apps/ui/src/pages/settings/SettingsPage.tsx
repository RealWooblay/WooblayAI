/**
 * Settings — Account management, webhook config, preferences.
 */

import { useState } from 'react';
import { useUser as useClerkUser, useClerk as useClerkInstance } from '@clerk/clerk-react';

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
import { getWebhooks, createWebhook, deleteWebhook, testWebhook, type Webhook } from '../../api/client.ts';
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
    <div className="max-w-2xl mx-auto space-y-4">
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

      {/* Webhook Notifications */}
      <div className="bg-surface-1 border border-border rounded-xl p-5">
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

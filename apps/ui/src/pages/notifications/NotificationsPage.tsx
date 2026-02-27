/**
 * Notifications — Webhook configuration and alert management.
 */

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../components/common/Button.tsx';
import {
  getWebhooks, createWebhook, deleteWebhook, testWebhook, type Webhook,
  getApprovals, getOrgPolicySettings,
  getNotificationSettings, updateNotificationSettings, testNotifications,
} from '../../api/client.ts';
import { useToast } from '../../components/common/Toast.tsx';

const WEBHOOK_EVENTS: { id: string; label: string; fullPlatformOnly?: boolean }[] = [
  { id: 'approval.pending', label: 'New Approval Pending' },
  { id: 'approval.stale', label: 'Stale Approval (>15 min)' },
  { id: 'flag.critical', label: 'Critical Flag Raised' },
  { id: 'flag.high', label: 'High Severity Flag' },
  { id: 'agent.trust_low', label: 'Low Trust Score (<40)', fullPlatformOnly: true },
];

const CHANNELS = [
  { id: 'telegram', label: 'Telegram', desc: 'DM via Telegram bot — recommended' },
  { id: 'slack', label: 'Slack', desc: 'Alerts via Slack incoming webhook' },
  { id: 'whatsapp', label: 'WhatsApp', desc: 'Messages via WhatsApp Business' },
  { id: 'email', label: 'Email', desc: 'Receive alerts at your registered email' },
] as const;

export function NotificationsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: orgSettings } = useQuery({
    queryKey: ['org-settings'],
    queryFn: getOrgPolicySettings,
    staleTime: 60_000,
  });
  const isFullPlatform = (orgSettings as { platformMode?: string })?.platformMode === 'full';
  const visibleEvents = isFullPlatform
    ? WEBHOOK_EVENTS
    : WEBHOOK_EVENTS.filter((e) => !e.fullPlatformOnly);

  // Pending approvals for the alert summary
  const { data: approvals = [] } = useQuery({
    queryKey: ['approvals', 'pending'],
    queryFn: getApprovals,
    refetchInterval: 5_000,
  });

  // Notification channel settings
  const { data: notifSettings } = useQuery({
    queryKey: ['notification-settings'],
    queryFn: getNotificationSettings,
    staleTime: 30_000,
  });

  const [editPhone, setEditPhone] = useState('');
  const [editTelegramId, setEditTelegramId] = useState('');
  const [editSlackWebhookUrl, setEditSlackWebhookUrl] = useState('');
  const [channelsDirty, setChannelsDirty] = useState(false);
  const [selectedChannels, setSelectedChannels] = useState<string[]>([]);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (notifSettings && !initialized) {
      if (notifSettings.phone) setEditPhone(notifSettings.phone);
      if (notifSettings.telegramChatId) setEditTelegramId(notifSettings.telegramChatId);
      if (notifSettings.slackWebhookUrl) setEditSlackWebhookUrl(notifSettings.slackWebhookUrl);
      if (notifSettings.channels.length > 0) setSelectedChannels(notifSettings.channels);
      setInitialized(true);
    }
  }, [notifSettings, initialized]);

  const updateNotifMut = useMutation({
    mutationFn: updateNotificationSettings,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notification-settings'] });
      setChannelsDirty(false);
      toast('Notification settings saved', 'success');
    },
    onError: (err: any) => toast(err.message || 'Failed to save', 'error'),
  });

  const testNotifMut = useMutation({
    mutationFn: testNotifications,
    onSuccess: () => toast('Test notification sent', 'success'),
    onError: (err: any) => toast(err.message || 'Failed to send test', 'error'),
  });

  const toggleChannel = (id: string) => {
    setChannelsDirty(true);
    setSelectedChannels((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id],
    );
  };

  const saveChannelSettings = () => {
    updateNotifMut.mutate({
      phone: editPhone || null,
      telegramChatId: editTelegramId || null,
      slackWebhookUrl: editSlackWebhookUrl || null,
      channels: selectedChannels.length > 0 ? selectedChannels : ['telegram'],
    });
  };

  // Webhooks
  const { data: webhooks = [] } = useQuery({ queryKey: ['webhooks'], queryFn: getWebhooks });
  const [newUrl, setNewUrl] = useState('');
  const [newEvents, setNewEvents] = useState<string[]>(['approval.pending', 'flag.critical']);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editUrl, setEditUrl] = useState('');
  const [editEvents, setEditEvents] = useState<string[]>([]);

  const addWebhookMut = useMutation({
    mutationFn: () =>
      createWebhook({
        url: newUrl,
        events: newEvents.filter((id) => visibleEvents.some((e) => e.id === id)),
      }),
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

  const updateWebhookMut = useMutation({
    mutationFn: ({ id, url, events }: { id: string; url: string; events: string[] }) =>
      deleteWebhook(id).then(() => createWebhook({ url, events })),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['webhooks'] }); setEditingId(null); toast('Webhook updated', 'success'); },
  });

  const toggleEvent = (eventId: string) => {
    setNewEvents((prev) =>
      prev.includes(eventId)
        ? prev.filter((e) => e !== eventId)
        : [...prev, eventId],
    );
  };

  const startEdit = (wh: Webhook) => {
    setEditingId(wh.id);
    setEditUrl(wh.url);
    try { setEditEvents(JSON.parse(wh.events)); } catch { setEditEvents([]); }
  };

  const toggleEditEvent = (eventId: string) => {
    setEditEvents((prev) =>
      prev.includes(eventId)
        ? prev.filter((e) => e !== eventId)
        : [...prev, eventId],
    );
  };

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <h1 className="text-lg font-bold text-text-primary mb-1">Notifications</h1>
      <p className="text-xs text-text-muted mb-6">
        Stay informed when agents need attention — approvals, blocks, and critical alerts.
      </p>

      {/* Pending Alerts Summary */}
      {approvals.length > 0 && (
        <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-amber-400 text-sm">⬡</span>
            <h2 className="text-sm font-semibold text-amber-400">
              {approvals.length} Pending Approval{approvals.length !== 1 ? 's' : ''}
            </h2>
          </div>
          <p className="text-xs text-amber-400/60">
            Actions are waiting for human review.{' '}
            <a href="/approvals" className="text-amber-400 hover:text-amber-300 underline">
              Review now
            </a>
          </p>
        </div>
      )}

      {/* Notification Channels */}
      <div className="bg-surface-1 border border-border rounded-xl p-5">
        <h2 className="text-sm font-semibold text-text-primary mb-1">Notification Channels</h2>
        <p className="text-xs text-text-muted mb-4">
          Choose how you receive approvals, alerts, and anomaly notifications.
        </p>

        <div className="space-y-3 mb-4">
          {CHANNELS.map((ch) => {
            const available = notifSettings?.availableChannels?.[ch.id as keyof typeof notifSettings.availableChannels] ?? false;
            const active = selectedChannels.includes(ch.id);
            return (
              <div key={ch.id}
                className={`flex items-center gap-3 p-3 rounded-lg border transition-colors cursor-pointer ${
                  active ? 'border-accent/30 bg-accent/5' : 'border-border bg-surface-2'
                } ${!available ? 'opacity-40' : ''}`}
                onClick={() => available && toggleChannel(ch.id)}
              >
                <div className={`w-8 h-5 rounded-full relative transition-colors ${active ? 'bg-accent' : 'bg-surface-3'}`}>
                  <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${active ? 'left-3.5' : 'left-0.5'}`} />
                </div>
                <div className="flex-1">
                  <span className="text-xs font-medium text-text-primary">{ch.label}</span>
                  <p className="text-[10px] text-text-muted">{ch.desc}</p>
                </div>
                {!available && (
                  <span className="text-[9px] text-text-muted bg-surface-1 px-2 py-0.5 rounded">
                    {ch.id === 'telegram' ? 'Telegram bot not configured by admin' :
                     ch.id === 'whatsapp' ? 'WhatsApp not configured by admin' :
                     ch.id === 'email' ? 'Email not configured by admin' : 'Not configured'}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* Channel-specific config */}
        {selectedChannels.includes('telegram') && (
          <div className="mb-3">
            <label className="block text-[11px] text-text-muted mb-1">Telegram Chat ID</label>
            <input
              value={editTelegramId}
              onChange={(e) => { setEditTelegramId(e.target.value); setChannelsDirty(true); }}
              placeholder="e.g. 123456789"
              className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
            />
            <p className="text-[10px] text-text-muted mt-1">
              Message <span className="font-mono text-accent">@userinfobot</span> on Telegram to get your chat ID.
            </p>
          </div>
        )}

        {selectedChannels.includes('slack') && (
          <div className="mb-3">
            <label className="block text-[11px] text-text-muted mb-1">Slack Incoming Webhook URL</label>
            <input
              value={editSlackWebhookUrl}
              onChange={(e) => { setEditSlackWebhookUrl(e.target.value); setChannelsDirty(true); }}
              placeholder="https://hooks.slack.com/services/T.../B.../..."
              className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent font-mono"
            />
            <p className="text-[10px] text-text-muted mt-1">
              Create an incoming webhook in your Slack workspace settings. Approval notifications will include interactive approve/deny buttons.
            </p>
          </div>
        )}

        {selectedChannels.includes('whatsapp') && (
          <div className="mb-3">
            <label className="block text-[11px] text-text-muted mb-1">WhatsApp Phone Number</label>
            <input
              value={editPhone}
              onChange={(e) => { setEditPhone(e.target.value); setChannelsDirty(true); }}
              placeholder="+14155551234"
              className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
            />
            <p className="text-[10px] text-text-muted mt-1">
              E.164 format — include country code.
            </p>
          </div>
        )}

        <div className="flex gap-2">
          <Button size="sm" onClick={saveChannelSettings}
            disabled={!channelsDirty || updateNotifMut.isPending}>
            {updateNotifMut.isPending ? 'Saving...' : 'Save'}
          </Button>
          <button onClick={() => testNotifMut.mutate()}
            disabled={testNotifMut.isPending}
            className="text-[11px] text-accent hover:text-accent-bright disabled:opacity-40 transition-colors">
            {testNotifMut.isPending ? 'Sending...' : 'Send test notification'}
          </button>
        </div>
      </div>

      {/* Webhook Configuration */}
      <div className="bg-surface-1 border border-border rounded-xl p-5">
        <h2 className="text-sm font-semibold text-text-primary mb-1">Webhook Alerts</h2>
        <p className="text-xs text-text-muted mb-4">
          Receive real-time alerts via Slack, Discord, or any webhook endpoint.
        </p>

        {/* Existing webhooks */}
        {webhooks.length > 0 && (
          <div className="space-y-2 mb-4">
            {webhooks.map((wh: Webhook) => {
              let events: string[] = [];
              try { events = JSON.parse(wh.events); } catch { /* empty */ }
              const isEditing = editingId === wh.id;
              return (
                <div key={wh.id} className="bg-surface-2 rounded-lg overflow-hidden">
                  <div className="flex items-center gap-3 p-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-text-primary font-mono truncate">{wh.url}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <p className="text-[10px] text-text-muted">{events.join(', ')}</p>
                        {(wh as any).lastDeliveryAt && (
                          <span className={`text-[9px] px-1.5 py-0.5 rounded ${
                            (wh as any).lastDeliverySuccess ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
                          }`}>
                            {(wh as any).lastDeliverySuccess ? 'Last delivery OK' : 'Last delivery failed'}
                          </span>
                        )}
                      </div>
                    </div>
                    <button onClick={() => testWebhookMut.mutate(wh.id)}
                      className="text-[10px] text-accent hover:text-accent-bright">
                      Test
                    </button>
                    <button onClick={() => isEditing ? setEditingId(null) : startEdit(wh)}
                      className="text-[10px] text-text-secondary hover:text-text-primary">
                      {isEditing ? 'Cancel' : 'Edit'}
                    </button>
                    <button onClick={() => deleteWebhookMut.mutate(wh.id)}
                      className="text-[10px] text-red-400/50 hover:text-red-400">
                      Remove
                    </button>
                  </div>
                  {isEditing && (
                    <div className="border-t border-border p-3 space-y-3">
                      <div>
                        <label className="block text-[10px] text-text-muted mb-1">URL</label>
                        <input value={editUrl} onChange={(e) => setEditUrl(e.target.value)}
                          className="w-full bg-surface-1 border border-border rounded-lg px-3 py-1.5 text-xs text-text-primary font-mono focus:outline-none focus:border-accent" />
                      </div>
                      <div>
                        <label className="block text-[10px] text-text-muted mb-1">Events</label>
                        <div className="flex flex-wrap gap-1.5">
                          {visibleEvents.map((evt) => (
                            <button key={evt.id} onClick={() => toggleEditEvent(evt.id)}
                              className={`px-2 py-0.5 rounded text-[10px] border transition-colors ${
                                editEvents.includes(evt.id) ? 'bg-accent/10 border-accent/30 text-accent' : 'bg-surface-1 border-border text-text-muted'
                              }`}>
                              {evt.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <button onClick={() => updateWebhookMut.mutate({ id: wh.id, url: editUrl, events: editEvents })}
                        disabled={!editUrl || updateWebhookMut.isPending}
                        className="px-3 py-1.5 bg-accent text-white text-xs rounded-lg hover:bg-accent-bright disabled:opacity-40 transition-colors">
                        {updateWebhookMut.isPending ? 'Saving...' : 'Save Changes'}
                      </button>
                    </div>
                  )}
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
            <div className="flex items-center justify-between mb-2">
              <label className="text-[11px] text-text-muted">Events</label>
              <button type="button" onClick={() => setNewEvents(visibleEvents.map(e => e.id))} className="text-[10px] text-accent hover:text-accent-bright">
                Select all
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {visibleEvents.map((evt) => (
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
    </div>
  );
}

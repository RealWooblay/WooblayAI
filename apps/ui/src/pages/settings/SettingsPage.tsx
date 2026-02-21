/**
 * Settings — Account management, platform mode, preferences.
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
import { getOrgPolicySettings, updateOrgPolicySettings } from '../../api/client.ts';
import { useToast } from '../../components/common/Toast.tsx';
import { useTheme, type ThemeId } from '../../contexts/ThemeContext.tsx';

const APPEARANCES: { id: ThemeId; label: string }[] = [
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
  { id: 'system', label: 'System' },
];

export function SettingsPage() {
  const { user } = useUser();
  const { signOut } = useClerk();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { theme, setTheme } = useTheme();

  // Platform mode
  const { data: orgSettings } = useQuery({
    queryKey: ['org-settings'],
    queryFn: getOrgPolicySettings,
    staleTime: 30_000,
  });
  const platformMode = (orgSettings as any)?.platformMode ?? 'firewall';

  const [unlockPassword, setUnlockPassword] = useState('');

  const toggleModeMut = useMutation({
    mutationFn: (mode: 'firewall' | 'full') => {
      if (mode === 'full') {
        return updateOrgPolicySettings({ platformMode: 'full', unlockPassword });
      }
      return updateOrgPolicySettings({ platformMode: 'firewall' });
    },
    onSuccess: () => {
      setUnlockPassword('');
      qc.invalidateQueries({ queryKey: ['org-settings'] });
      toast(platformMode === 'firewall' ? 'Full Platform mode enabled' : 'Switched to Firewall mode', 'success');
    },
    onError: (err: any) => {
      let msg = 'Failed to switch mode';
      if (err?.body) {
        try {
          const o = JSON.parse(err.body);
          msg = o.detail || o.error || msg;
        } catch {
          msg = err.message || msg;
        }
      } else {
        msg = err?.message || err?.error || msg;
      }
      if (msg.includes('not configured') || msg.includes('Contact Wooblay')) {
        toast('Full Platform access is gated. Contact Wooblay for the unlock password.', 'error');
      } else {
        toast(msg.includes('Incorrect') ? 'Incorrect platform password.' : msg, 'error');
      }
    },
  });

  return (
    <div className="max-w-2xl mx-auto space-y-4" data-tour="tour-settings">
      <h1 className="text-lg font-bold text-text-primary mb-1">Settings</h1>
      <p className="text-xs text-text-muted mb-6">Account, platform mode, and preferences</p>

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

      {/* Appearance */}
      <div className="bg-surface-1 border border-border rounded-xl p-5">
        <h2 className="text-sm font-semibold text-text-primary mb-1">Appearance</h2>
        <p className="text-xs text-text-muted mb-4">
          Choose how Wooblay looks. System follows your device preference.
        </p>
        <div className="flex flex-wrap gap-2">
          {APPEARANCES.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTheme(id)}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                theme === id
                  ? 'bg-accent text-white'
                  : 'bg-surface-2 text-text-secondary hover:text-text-primary hover:bg-surface-3'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Platform Mode */}
      <div className="bg-surface-1 border border-border rounded-xl p-5">
        <h2 className="text-sm font-semibold text-text-primary mb-1">Platform Mode</h2>
        <p className="text-xs text-text-muted mb-4">
          Firewall mode is the default. Full Platform (hosted agents, sensors, orchestration) is gated — we decide who gets access and provide the unlock password.
        </p>

        <div className="space-y-3">
          {/* Current mode indicator */}
          <div className="flex items-center gap-3 p-3 bg-surface-2 rounded-lg">
            <div className={`w-2 h-2 rounded-full ${platformMode === 'full' ? 'bg-purple-400' : 'bg-emerald-400'}`} />
            <div className="flex-1">
              <p className="text-xs font-medium text-text-primary">
                {platformMode === 'full' ? 'Full Platform' : 'Firewall'}
              </p>
              <p className="text-[10px] text-text-muted">
                {platformMode === 'full'
                  ? 'All features visible: agents, sensors, operations, insights'
                  : 'Focused on API gateway: setup, connections, policies, audit'}
              </p>
            </div>
          </div>

          {/* Toggle actions */}
          {platformMode === 'firewall' ? (
            <div className="space-y-2">
              <p className="text-[10px] text-text-muted">Enter the Full Platform password we provided to unlock.</p>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={unlockPassword}
                  onChange={(e) => setUnlockPassword(e.target.value)}
                  placeholder="Platform password (from Wooblay)"
                  className="flex-1 bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
                />
                <Button
                  size="sm"
                  onClick={() => unlockPassword && toggleModeMut.mutate('full')}
                  disabled={!unlockPassword || toggleModeMut.isPending}
                >
                  Unlock Full Platform
                </Button>
              </div>
            </div>
          ) : (
            <Button
              size="sm"
              variant="danger"
              onClick={() => toggleModeMut.mutate('firewall')}
              disabled={toggleModeMut.isPending}
            >
              Switch to Firewall Mode
            </Button>
          )}
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

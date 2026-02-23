/**
 * Settings — Account management, platform mode, preferences.
 */

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
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button } from '../../components/common/Button.tsx';
import { getOrgPolicySettings } from '../../api/client.ts';
import { useTheme, type ThemeId } from '../../contexts/ThemeContext.tsx';

const APPEARANCES: { id: ThemeId; label: string }[] = [
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
  { id: 'system', label: 'System' },
];

export function SettingsPage() {
  const { user } = useUser();
  const { signOut } = useClerk();
  const { theme, setTheme } = useTheme();

  // Platform mode
  const { data: orgSettings } = useQuery({
    queryKey: ['org-settings'],
    queryFn: getOrgPolicySettings,
    staleTime: 30_000,
  });
  const platformMode = (orgSettings as any)?.platformMode ?? 'firewall';

  return (
    <div className="max-w-2xl mx-auto space-y-4" data-tour="tour-settings">
      <h1 className="text-lg font-bold text-text-primary mb-1">Settings</h1>
      <p className="text-xs text-text-muted mb-6">Account, appearance, and preferences</p>

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

      {/* Organization */}
      <div className="bg-surface-1 border border-border rounded-xl p-5">
        <h2 className="text-sm font-semibold text-text-primary mb-4">Organization</h2>
        <div className="space-y-3 text-sm">
          <div className="flex justify-between items-center">
            <span className="text-text-secondary">Mode</span>
            <span className="text-text-primary font-medium text-xs">
              {platformMode === 'full' ? 'Full Platform' : 'Firewall'}
            </span>
          </div>
        </div>
      </div>

      {/* Quick Links */}
      <div className="bg-surface-1 border border-border rounded-xl p-5">
        <h2 className="text-sm font-semibold text-text-primary mb-4">Quick Links</h2>
        <div className="grid grid-cols-2 gap-3">
          <Link to="/setup" className="flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-surface-2 transition-colors">
            <span className="text-xs text-text-primary font-medium">API Keys</span>
            <span className="text-[10px] text-text-muted ml-auto">→</span>
          </Link>
          <Link to="/usage" className="flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-surface-2 transition-colors">
            <span className="text-xs text-text-primary font-medium">Usage & Billing</span>
            <span className="text-[10px] text-text-muted ml-auto">→</span>
          </Link>
          <Link to="/policies" className="flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-surface-2 transition-colors">
            <span className="text-xs text-text-primary font-medium">Policies</span>
            <span className="text-[10px] text-text-muted ml-auto">→</span>
          </Link>
          <Link to="/notifications" className="flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-surface-2 transition-colors">
            <span className="text-xs text-text-primary font-medium">Notifications</span>
            <span className="text-[10px] text-text-muted ml-auto">→</span>
          </Link>
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

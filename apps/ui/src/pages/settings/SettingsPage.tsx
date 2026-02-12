/**
 * Settings — Account management and preferences.
 */

import { useUser, useClerk } from '@clerk/clerk-react';
import { Button } from '../../components/common/Button.tsx';

export function SettingsPage() {
  const { user } = useUser();
  const { signOut } = useClerk();

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-lg font-bold text-text-primary mb-1">Settings</h1>
      <p className="text-xs text-text-muted mb-6">Account and preferences</p>

      {/* Profile */}
      <div className="bg-surface-1 border border-border rounded-xl p-5 mb-4">
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
      <div className="bg-surface-1 border border-border rounded-xl p-5 mb-4">
        <h2 className="text-sm font-semibold text-text-primary mb-4">Account</h2>
        <div className="space-y-3 text-sm">
          <div className="flex justify-between items-center">
            <span className="text-text-secondary">Plan</span>
            <span className="text-text-primary font-medium px-2 py-0.5 bg-accent-subtle rounded text-xs">
              Beta Access
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-text-secondary">Member since</span>
            <span className="text-text-primary text-xs">
              {user?.createdAt ? new Date(user.createdAt).toLocaleDateString() : '-'}
            </span>
          </div>
        </div>
      </div>

      {/* Danger zone */}
      <div className="bg-surface-1 border border-border rounded-xl p-5">
        <h2 className="text-sm font-semibold text-text-primary mb-4">Session</h2>
        <Button
          variant="danger"
          size="sm"
          onClick={() => signOut()}
        >
          Sign Out
        </Button>
      </div>
    </div>
  );
}

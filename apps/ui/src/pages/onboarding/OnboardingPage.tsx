/**
 * Onboarding — Enter access code to activate account.
 *
 * Shown after Clerk sign-up when user.activated === false.
 * Validates coupon code against the backend.
 */

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { redeemCoupon } from '../../api/client.ts';
import { Button } from '../../components/common/Button.tsx';

export function OnboardingPage({ onActivated }: { onActivated: () => void }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');

  const redeemMut = useMutation({
    mutationFn: () => redeemCoupon(code),
    onSuccess: (data) => {
      if (data.ok) {
        onActivated();
      } else {
        setError(data.message || 'Unexpected error');
      }
    },
    onError: (err: Error) => {
      const msg = err.message;
      if (msg.includes('Invalid access code')) {
        setError('Invalid access code. Please check and try again.');
      } else if (msg.includes('maximum uses')) {
        setError('This access code has reached its limit.');
      } else if (msg.includes('expired')) {
        setError('This access code has expired.');
      } else {
        setError('Something went wrong. Please try again.');
      }
    },
  });

  return (
    <div className="min-h-screen bg-void flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-text-primary mb-2">
            Welcome to Wooblay
          </h1>
          <p className="text-sm text-text-secondary leading-relaxed">
            Enter your access code to activate your organization's
            agent governance platform.
          </p>
        </div>

        <div className="bg-surface-1 border border-border rounded-xl p-6 space-y-4">
          <div>
            <label className="text-xs text-text-secondary mb-1.5 block">Access Code</label>
            <input
              value={code}
              onChange={(e) => { setCode(e.target.value.toUpperCase()); setError(''); }}
              onKeyDown={(e) => e.key === 'Enter' && code.trim() && redeemMut.mutate()}
              placeholder="WOOBLAY-BETA-2026"
              className="w-full bg-surface-0 border border-border rounded-lg px-4 py-3 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50 font-mono tracking-wider text-center uppercase"
              autoFocus
            />
          </div>

          {error && (
            <p className="text-xs text-danger text-center">{error}</p>
          )}

          <Button
            onClick={() => redeemMut.mutate()}
            disabled={!code.trim() || redeemMut.isPending}
            className="w-full"
          >
            {redeemMut.isPending ? 'Activating...' : 'Activate Account'}
          </Button>
        </div>

        <p className="text-[11px] text-text-muted text-center mt-4">
          Don't have an access code?{' '}
          <a href="mailto:support@wooblay.com" className="text-accent-bright hover:underline">
            Request access
          </a>
        </p>
      </div>
    </div>
  );
}

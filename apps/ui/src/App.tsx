/**
 * App root — handles auth routing:
 *
 * 1. Not signed in → Clerk sign-in page
 * 2. Signed in but not activated → Onboarding (coupon entry)
 * 3. Activated → Main app with sidebar navigation
 */

import { useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { SignIn, SignUp, useUser, useAuth } from '@clerk/clerk-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { Sidebar } from './components/layout/Sidebar.tsx';
import { useAuthSetup } from './hooks/useAuthSetup.ts';
import { getMe } from './api/client.ts';

// Pages
import { CommandCenter as DashboardPage } from './pages/command-center/CommandCenter.tsx';
import { ApprovalsPage } from './pages/approvals/ApprovalsPage.tsx';
import { InstancesPage } from './pages/instances/InstancesPage.tsx';
import { OnboardingPage } from './pages/onboarding/OnboardingPage.tsx';
import { SettingsPage } from './pages/settings/SettingsPage.tsx';
import { ComingSoon } from './components/common/ComingSoon.tsx';

// Has Clerk key? If not, skip auth entirely (local dev / instance mode)
const HAS_CLERK = !!import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

export default function App() {
  if (!HAS_CLERK) {
    // No Clerk configured — run without auth (backwards compatible, local dev)
    return <AuthenticatedApp />;
  }

  return <ClerkApp />;
}

/** Clerk-wrapped app with sign-in/sign-up/onboarding flow. */
function ClerkApp() {
  const { isSignedIn, isLoaded } = useUser();

  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-void flex items-center justify-center">
        <div className="text-text-muted text-sm animate-pulse">Loading...</div>
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <Routes>
        <Route path="/sign-up/*" element={
          <AuthPage>
            <SignUp routing="path" path="/sign-up" signInUrl="/sign-in" />
          </AuthPage>
        } />
        <Route path="*" element={
          <AuthPage>
            <SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" />
          </AuthPage>
        } />
      </Routes>
    );
  }

  return <ActivationGate />;
}

/** After Clerk auth, check if user has redeemed a coupon. */
function ActivationGate() {
  useAuthSetup();
  const { isSignedIn } = useAuth();
  const qc = useQueryClient();
  const [forceActivated, setForceActivated] = useState(false);

  const { data: me, isLoading } = useQuery({
    queryKey: ['me'],
    queryFn: getMe,
    enabled: isSignedIn,
    retry: 2,
  });

  const activated = forceActivated || me?.activated;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-void flex items-center justify-center">
        <div className="text-text-muted text-sm animate-pulse">Checking account...</div>
      </div>
    );
  }

  if (!activated) {
    return (
      <OnboardingPage
        onActivated={() => {
          setForceActivated(true);
          void qc.invalidateQueries({ queryKey: ['me'] });
        }}
      />
    );
  }

  return <AuthenticatedApp />;
}

/** Main authenticated application shell. */
function AuthenticatedApp() {
  // Set up auth token forwarding (no-op if no Clerk)
  if (HAS_CLERK) {
    // Already called in ActivationGate, but safe to re-render
  }

  return (
    <div className="h-screen flex bg-void overflow-hidden">
      <Sidebar />

      <main className="flex-1 overflow-hidden relative">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/approvals" element={<PageShell><ApprovalsPage /></PageShell>} />
          <Route path="/instances" element={<PageShell><InstancesPage /></PageShell>} />
          <Route path="/settings" element={<PageShell><SettingsPage /></PageShell>} />

          {/* Coming Soon */}
          <Route path="/policies" element={<PageShell><ComingSoon feature="Policies" description="Custom policy rules for fine-grained tool control." /></PageShell>} />
          <Route path="/activity" element={<PageShell><ComingSoon feature="Activity Feed" description="Real-time agent activity monitoring." /></PageShell>} />

          {/* Catch-all */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

function AuthPage({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#09090b] flex flex-col items-center justify-center p-4">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold text-white tracking-tight">wooblay</h1>
        <p className="text-sm text-zinc-400 mt-2">Supervised autonomy for AI agents</p>
      </div>
      <div className="w-full max-w-md flex justify-center">
        {children}
      </div>
    </div>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full overflow-y-auto p-6 canvas-bg animate-fade-in">
      {children}
    </div>
  );
}

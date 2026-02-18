/**
 * App root — handles auth routing:
 *
 * 1. Not signed in → Clerk sign-in page
 * 2. Signed in but not activated → Onboarding (coupon entry)
 * 3. Activated → Main app with sidebar navigation
 */

import { useState, Component, type ErrorInfo, type ReactNode } from 'react';
import { Routes, Route, Navigate, Link } from 'react-router-dom';
import { SignIn, SignUp, useUser, useAuth } from '@clerk/clerk-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { Sidebar } from './components/layout/Sidebar.tsx';
import { TourProvider } from './contexts/TourContext.tsx';
import { TourOverlay } from './components/tour/TourOverlay.tsx';
import { useAuthSetup } from './hooks/useAuthSetup.ts';
import { getMe } from './api/client.ts';

// Pages
import { CommandCenter as DashboardPage } from './pages/command-center/CommandCenter.tsx';
import { ApprovalsPage } from './pages/approvals/ApprovalsPage.tsx';
import { InstanceDetailPage } from './pages/instances/InstanceDetailPage.tsx';
import { OnboardingPage } from './pages/onboarding/OnboardingPage.tsx';
import { SettingsPage } from './pages/settings/SettingsPage.tsx';
import { PoliciesPage } from './pages/policies/PoliciesPage.tsx';
import { ActivityPage } from './pages/activity/ActivityPage.tsx';
import { SetupPage } from './pages/setup/SetupPage.tsx';
import { NotificationsPage } from './pages/notifications/NotificationsPage.tsx';

// Operation-first pages
import { OperationsPage } from './pages/operations/OperationsPage.tsx';
import { OperationPage } from './pages/operations/OperationPage.tsx';
import { CredentialsPage } from './pages/credentials/CredentialsPage.tsx';
import { SensorsPage } from './pages/sensors/SensorsPage.tsx';
import { RunPage } from './pages/runs/RunPage.tsx';
import { InsightsPage } from './pages/insights/InsightsPage.tsx';

// Has Clerk key? If not, skip auth entirely (local dev / instance mode)
const HAS_CLERK = !!import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

export default function App() {
  if (!HAS_CLERK) {
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
        <Route path="/sign-up" element={
          <AuthPage>
            <SignUp />
          </AuthPage>
        } />
        <Route path="*" element={
          <AuthPage>
            <SignIn />
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
  return (
    <TourProvider>
      <div className="h-screen flex bg-void overflow-hidden">
        <Sidebar />

        <main className="flex-1 overflow-hidden relative">
          <Routes>
          {/* Primary routes — sensor-first */}
          <Route path="/operations" element={<PageShell><OperationsPage /></PageShell>} />
          <Route path="/operations/:id" element={<PageShell><OperationPage /></PageShell>} />
          <Route path="/credentials" element={<PageShell><CredentialsPage /></PageShell>} />
          <Route path="/sensors" element={<PageShell><SensorsPage /></PageShell>} />
          <Route path="/connections" element={<Navigate to="/credentials" replace />} />
          <Route path="/runs/:id" element={<PageShell><RunPage /></PageShell>} />
          <Route path="/insights" element={<PageShell><InsightsPage /></PageShell>} />

          {/* Legacy redirects */}
          <Route path="/inbox" element={<Navigate to="/operations" replace />} />
          <Route path="/incidents/:id" element={<RedirectIncidentToOperation />} />

          {/* Core pages */}
          <Route path="/" element={<DashboardPage />} />
          <Route path="/setup" element={<PageShell><SetupPage /></PageShell>} />
          <Route path="/notifications" element={<PageShell><NotificationsPage /></PageShell>} />
          <Route path="/approvals" element={<PageShell><ApprovalsPage /></PageShell>} />
          <Route path="/instances" element={<Navigate to="/" replace />} />
          <Route path="/instances/:id" element={<PageShell><InstanceDetailPage /></PageShell>} />
          <Route path="/settings" element={<PageShell><SettingsPage /></PageShell>} />
          <Route path="/policies" element={<PageShell><PoliciesPage /></PageShell>} />
          <Route path="/activity" element={<PageShell><ActivityPage /></PageShell>} />
          <Route path="/audit" element={<Navigate to="/activity" replace />} />

          {/* Catch-all */}
          <Route path="*" element={<Navigate to="/operations" replace />} />
        </Routes>
      </main>
      </div>
      <TourOverlay />
    </TourProvider>
  );
}

/** Redirect /incidents/:id → /operations/:id */
function RedirectIncidentToOperation() {
  const params = new URL(window.location.href);
  const id = params.pathname.split('/incidents/')[1];
  return <Navigate to={`/operations/${id}`} replace />;
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

/** Error boundary — catches crashes in any page so the whole app doesn't unmount. */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('[ErrorBoundary]', error, info); }
  render() {
    if (this.state.error) {
      return (
        <div className="h-full flex flex-col items-center justify-center p-6 canvas-bg">
          <pre className="text-red-400 font-mono text-lg mb-2">( x_x )</pre>
          <p className="text-text-primary font-mono text-sm mb-1">Something crashed</p>
          <p className="text-text-tertiary font-mono text-xs mb-4 max-w-md text-center">{this.state.error.message}</p>
          <Link to="/" onClick={() => this.setState({ error: null })}
            className="text-accent hover:text-accent-bright text-xs font-mono">← back to dashboard</Link>
        </div>
      );
    }
    return this.props.children;
  }
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary>
      <div className="h-full overflow-y-auto p-6 canvas-bg animate-fade-in relative">
        {children}
        <div className="scanline-overlay pointer-events-none" />
      </div>
    </ErrorBoundary>
  );
}

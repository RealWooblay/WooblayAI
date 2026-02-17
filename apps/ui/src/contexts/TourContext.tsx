/**
 * Platform tutorial walkthrough: highlights + modals + auto-navigation.
 * Steps define route, optional target (data-tour), title, and content.
 */

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

const TOUR_STORAGE_KEY = 'wooblay-tour-completed';

export interface TourStep {
  path: string;
  target: string | null;
  title: string;
  content: string;
}

export const TOUR_STEPS: TourStep[] = [
  {
    path: '/',
    target: 'tour-dashboard',
    title: 'Command Center',
    content: "Your agent control plane. Deploy agents, monitor trust scores, cost, and action output in real time. Each card is a live agent capable of writing code, creating PRs, deploying services \u2014 all within Wooblay's three-layer secure execution environment.",
  },
  {
    path: '/operations',
    target: 'tour-operations',
    title: 'Operations',
    content: "Operations are work items created by connections or manually. Each one can be routed to an agent. You'll see routing status (auto-routed, pending approval, or unassigned) and can approve, assign, or dismiss from here.",
  },
  {
    path: '/connections',
    target: 'tour-connections',
    title: 'Connections \u2014 Your Keys & Services',
    content: "Connections link external services to Wooblay. They detect events (sensing) and provide credentials for secure execution. Add secrets per connection \u2014 choose agent-accessible (env var) for fast API testing, or exec-only for sensitive deploy credentials. The agent never sees exec-only secrets.",
  },
  {
    path: '/connections',
    target: 'tour-add-connection',
    title: 'Add Connection',
    content: "Click \u201cAdd connection\u201d to link a new service. Choose a provider, enter your credentials \u2014 they're encrypted at rest. You can also add custom secrets (API keys, tokens) with visibility control. Connections power both event sensing and secure execution.",
  },
  {
    path: '/policies',
    target: 'tour-policies',
    title: 'Policies \u2014 Layer 1 Security',
    content: 'The first security layer. Policies evaluate every action against rules: auto-allow safe operations, require approval for risky ones, or block entirely. Combined with scope boundaries on connections, this controls what agents can and cannot do.',
  },
  {
    path: '/approvals',
    target: 'tour-approvals',
    title: 'Approvals \u2014 Human In The Loop',
    content: "When an action needs review, it appears here with full context and simulation results. Approve to execute securely in an ephemeral container \u2014 credentials never touch the agent. Deny to block. Everything cryptographically signed.",
  },
  {
    path: '/insights',
    target: 'tour-insights',
    title: 'Insights \u2014 Measure Everything',
    content: 'Track agent performance across all three security layers: policy pass rate, simulation success rate, execution outcomes, and time-to-resolution. Tune policies based on real data.',
  },
  {
    path: '/activity',
    target: 'tour-activity',
    title: 'Activity \u2014 Full Audit Trail',
    content: 'Complete audit log of every action, decision, and execution. Every entry cryptographically receipted and hash-chained for tamper evidence. Filter by risk, agent, or date. Export for compliance.',
  },
  {
    path: '/settings',
    target: 'tour-settings',
    title: 'Settings',
    content: 'Manage your profile, organization (members and roles), and outbound webhooks for notifications. Organization membership is synced from Clerk.',
  },
];

interface TourContextValue {
  isActive: boolean;
  stepIndex: number;
  step: TourStep | null;
  startTour: () => void;
  nextStep: () => void;
  prevStep: () => void;
  closeTour: () => void;
  setTourCompleted: () => void;
}

const TourContext = createContext<TourContextValue | null>(null);

export function TourProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [isActive, setIsActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);

  const step = isActive && stepIndex >= 0 && stepIndex < TOUR_STEPS.length ? TOUR_STEPS[stepIndex] : null;

  const startTour = useCallback(() => {
    setStepIndex(0);
    setIsActive(true);
    navigate(TOUR_STEPS[0].path);
  }, [navigate]);

  const nextStep = useCallback(() => {
    if (stepIndex >= TOUR_STEPS.length - 1) {
      setIsActive(false);
      try { localStorage.setItem(TOUR_STORAGE_KEY, 'true'); } catch { /* ignore */ }
      return;
    }
    const next = stepIndex + 1;
    setStepIndex(next);
    navigate(TOUR_STEPS[next].path);
  }, [stepIndex, navigate]);

  const prevStep = useCallback(() => {
    if (stepIndex <= 0) return;
    const prev = stepIndex - 1;
    setStepIndex(prev);
    navigate(TOUR_STEPS[prev].path);
  }, [stepIndex, navigate]);

  const closeTour = useCallback(() => {
    setIsActive(false);
  }, []);

  const setTourCompleted = useCallback(() => {
    try { localStorage.setItem(TOUR_STORAGE_KEY, 'true'); } catch { /* ignore */ }
  }, []);

  const value: TourContextValue = {
    isActive,
    stepIndex,
    step,
    startTour,
    nextStep,
    prevStep,
    closeTour,
    setTourCompleted,
  };

  return (
    <TourContext.Provider value={value}>
      {children}
    </TourContext.Provider>
  );
}

export function useTour() {
  const ctx = useContext(TourContext);
  if (!ctx) throw new Error('useTour must be used within TourProvider');
  return ctx;
}

export function useTourOptional() {
  return useContext(TourContext);
}

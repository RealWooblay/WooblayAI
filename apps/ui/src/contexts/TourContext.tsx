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
    title: 'Dashboard',
    content: 'Your command center. Here you see all agent instances — deploy new ones, start or stop them, and monitor trust scores and cost. Each card is a live agent that can run operations.',
  },
  {
    path: '/operations',
    target: 'tour-operations',
    title: 'Operations',
    content: 'Operations are work items created by sensors or manually. Each one can be routed to an agent. You’ll see routing status (auto-routed, pending approval, or unassigned) and can approve, assign, or dismiss from here.',
  },
  {
    path: '/sensors',
    target: 'tour-sensors',
    title: 'Sensors',
    content: 'A sensor connects an external system (like GitHub) to Wooblay. It gives Wooblay both eyes (monitoring events) and hands (executing actions via the Tool Gateway). Add a sensor to start creating operations from pushes, PRs, or CI events.',
  },
  {
    path: '/sensors',
    target: 'tour-add-sensor',
    title: 'Add sensor',
    content: 'Click “Add sensor” to connect a new source. Choose a provider (e.g. GitHub); you’ll get a unique webhook URL and secret to configure in that system. Sensors create operations that Wooblay routes to the right agent.',
  },
  {
    path: '/policies',
    target: 'tour-policies',
    title: 'Policies',
    content: 'Policies control what actions agents can take. You can auto-allow low-risk actions, require approval for risky ones, or deny by tool or risk tier. Presets (Balanced, Strict, Permissive) apply a full set of rules at once.',
  },
  {
    path: '/approvals',
    target: 'tour-approvals',
    title: 'Approvals',
    content: 'When an agent needs permission for a risky action, it appears here. You see a human-readable description of what the agent wants to do; approve or deny. Approved actions run through the Tool Gateway without exposing credentials to the agent.',
  },
  {
    path: '/insights',
    target: 'tour-insights',
    title: 'Insights',
    content: 'Insights show metrics across your agents: success rate, override rate, rollback rate, and time-to-resolution. Use this to tune policies and see how often humans need to step in.',
  },
  {
    path: '/activity',
    target: 'tour-activity',
    title: 'Activity',
    content: 'Activity is the full audit log of tool calls, approvals, and events. Filter by risk, agent, or date. Export JSON or CSV for compliance. Every decision is receipted and hash-chained.',
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

/**
 * Platform tutorial — highlights + auto-navigation + tab switching.
 *
 * Steps are built dynamically: if the user has agents deployed,
 * the tour walks through the actual instance detail page tabs.
 */

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getInstances } from '../api/client.ts';

const TOUR_STORAGE_KEY = 'wooblay-tour-completed';

export interface TourStep {
  path: string;
  target: string | null;
  title: string;
  content: string;
  /** Dispatched as a custom event so pages can react (e.g. switch tab) */
  action?: string;
}

/** Build steps dynamically — includes real instance walkthrough if one exists */
function buildSteps(firstInstanceId: string | null): TourStep[] {
  const steps: TourStep[] = [
    // ── Agents (Command Center) ──
    {
      path: '/',
      target: 'tour-agents',
      title: 'Agents',
      content: 'Deployed agents show here with status, trust score, and cost. Start, stop, or open one to configure it.',
    },
    {
      path: '/',
      target: 'tour-deploy',
      title: 'Deploy an agent',
      content: 'Click to deploy a new agent. Any runtime works \u2014 OpenClaw, LangChain, or custom. The Gate secures every action.',
    },
  ];

  // ── Instance Detail walkthrough ──
  if (firstInstanceId) {
    const base = `/instances/${firstInstanceId}`;
    steps.push(
      {
        path: base,
        target: 'tour-instance-header',
        title: 'Meet your agent',
        content: 'Status, role, trust weather, and sub-agents \u2014 everything about this agent at a glance.',
      },
      {
        path: base,
        target: 'tour-tab-overview',
        title: 'Overview tab',
        content: 'Trust score, running cost, contribution graph, and a live activity feed of every action the agent takes.',
        action: 'tour:tab:overview',
      },
      {
        path: base,
        target: 'tour-tab-profile',
        title: 'Profile tab',
        content: 'The agent\u2019s identity. Edit its name, role, and goal inline. This shapes how it introduces itself to other systems.',
        action: 'tour:tab:profile',
      },
      {
        path: base,
        target: 'tour-tab-security',
        title: 'Security tab',
        content: 'Manage what this agent has direct access to. Add API keys, see exec-only secrets, and jump to policies.',
        action: 'tour:tab:security',
      },
      {
        path: base,
        target: 'tour-agent-keys',
        title: 'Agent API keys',
        content: 'Keys you add here are injected as environment variables \u2014 the agent can read and use them freely. Only give it what you trust it with.',
        action: 'tour:tab:security',
      },
      {
        path: base,
        target: 'tour-tab-workspace',
        title: 'Workspace tab',
        content: 'A live file browser into the agent\u2019s container. Browse files, read logs, see exactly what it\u2019s building.',
        action: 'tour:tab:workspace',
      },
    );
  } else {
    steps.push({
      path: '/',
      target: 'tour-deploy',
      title: 'Deploy your first agent',
      content: 'Use the button above to deploy. When it\u2019s running, open its card for a short walkthrough of the agent page.',
    });
  }

  // ── Platform pages ──
  steps.push(
    {
      path: '/credentials',
      target: 'tour-add-credential',
      title: 'Credentials',
      content: 'Add GitHub, AWS, or GCP. Secrets stay in the vault and are only injected into short-lived execution containers \u2014 agents never see them.',
    },
    {
      path: '/policies',
      target: 'tour-policy-summary',
      title: 'Policies',
      content: 'Global rules for all agents: auto-allow, require approval, or block. Category and risk-based. Presets and AI suggestions available.',
    },
    {
      path: '/operations',
      target: 'tour-operations-list',
      title: 'Operations',
      content: 'Work items from sensors or manual creation. Each is routed to an agent; you can auto-route or assign manually.',
    },
    {
      path: '/approvals',
      target: 'tour-approval-cards',
      title: 'Approvals',
      content: 'Flagged actions wait here. Review context and simulation, then approve or deny. Create rules from decisions to automate next time.',
    },
    {
      path: '/activity',
      target: 'tour-activity-log',
      title: 'Activity',
      content: 'Full audit trail: every action and decision, signed and hash-chained. Filter by agent, tool, or risk.',
    },
    {
      path: '/insights',
      target: 'tour-insights-metrics',
      title: 'Insights',
      content: 'Trust trends, cost breakdowns, and contribution metrics. See how agents perform and where to adjust policies.',
    },
    {
      path: '/settings',
      target: 'tour-webhooks',
      title: 'Settings',
      content: 'Webhooks for approvals and alerts. Notify Slack, Discord, or any HTTP endpoint when attention is needed.',
    },
  );

  return steps;
}

interface TourContextValue {
  isActive: boolean;
  stepIndex: number;
  totalSteps: number;
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
  const [steps, setSteps] = useState<TourStep[]>(() => buildSteps(null));

  // Fetch instances to build dynamic steps
  const { data: instances } = useQuery({
    queryKey: ['instances'],
    queryFn: getInstances,
    staleTime: 30_000,
  });

  useEffect(() => {
    const list = instances ?? [];
    const firstId = list.length > 0 ? list[0].id : null;
    setSteps(buildSteps(firstId));
  }, [instances]);

  const step = isActive && stepIndex >= 0 && stepIndex < steps.length ? steps[stepIndex] : null;

  // Dispatch action events so pages can react (e.g. tab switching)
  useEffect(() => {
    if (!step?.action) return;
    window.dispatchEvent(new CustomEvent(step.action));
  }, [step]);

  const startTour = useCallback(() => {
    setStepIndex(0);
    setIsActive(true);
    navigate(steps[0].path);
  }, [navigate, steps]);

  const nextStep = useCallback(() => {
    if (stepIndex >= steps.length - 1) {
      setIsActive(false);
      try { localStorage.setItem(TOUR_STORAGE_KEY, 'true'); } catch { /* ignore */ }
      return;
    }
    const next = stepIndex + 1;
    setStepIndex(next);
    navigate(steps[next].path);
  }, [stepIndex, navigate, steps]);

  const prevStep = useCallback(() => {
    if (stepIndex <= 0) return;
    const prev = stepIndex - 1;
    setStepIndex(prev);
    navigate(steps[prev].path);
  }, [stepIndex, navigate, steps]);

  const closeTour = useCallback(() => {
    setIsActive(false);
  }, []);

  const setTourCompleted = useCallback(() => {
    try { localStorage.setItem(TOUR_STORAGE_KEY, 'true'); } catch { /* ignore */ }
  }, []);

  const value: TourContextValue = {
    isActive,
    stepIndex,
    totalSteps: steps.length,
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

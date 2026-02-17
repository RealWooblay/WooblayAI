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
    // ── Command Center ──
    {
      path: '/',
      target: 'tour-dashboard',
      title: 'This is your control plane',
      content: 'Every agent you deploy appears here as a live card \u2014 trust score, cost, and actions streaming in real time.',
    },
    {
      path: '/',
      target: 'tour-deploy',
      title: 'Deploy any runtime',
      content: 'Wooblay doesn\u2019t care what agent framework you use. OpenClaw, LangChain, CrewAI, AutoGen, or your own custom runtime. Hit the Gate endpoint and it\u2019s secured.',
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
      content: 'Click here to deploy. Once it\u2019s running, click its card \u2014 you\u2019ll get a guided walkthrough of the agent detail page automatically.',
    });
  }

  // ── Platform pages ──
  steps.push(
    {
      path: '/connections',
      target: 'tour-add-connection',
      title: 'Connect your services',
      content: 'Link GitHub, AWS, GCP, or anything else. Exec-only secrets here are never seen by the agent \u2014 they only appear inside ephemeral secure containers.',
    },
    {
      path: '/policies',
      target: 'tour-policy-summary',
      title: 'Set your guardrails',
      content: 'Agents are unrestricted by default. Policies let you auto-allow safe actions, require human approval for risky ones, or block entire categories.',
    },
    {
      path: '/operations',
      target: 'tour-operations-list',
      title: 'Live operations',
      content: 'Work items stream in from connections or get created manually. Each one routes to the right agent \u2014 auto, approval-required, or your call.',
    },
    {
      path: '/approvals',
      target: 'tour-approval-cards',
      title: 'Human in the loop',
      content: 'When an action gets flagged, it lands here with full context and simulation results. Approve to execute securely. Deny to stop it cold.',
    },
    {
      path: '/activity',
      target: 'tour-activity-log',
      title: 'Complete audit trail',
      content: 'Every action, decision, and execution \u2014 cryptographically signed and hash-chained. Filter by agent, risk, or date.',
    },
    {
      path: '/insights',
      target: 'tour-insights-metrics',
      title: 'Performance at a glance',
      content: 'Incidents, runs, proposals, and intervention rate. See how your agents are performing and where to tighten (or loosen) your policies.',
    },
    {
      path: '/settings',
      target: 'tour-webhooks',
      title: 'Stay in the loop',
      content: 'Send alerts to Slack, Discord, or any HTTP endpoint. Get notified the moment an action needs your attention or trust drops.',
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

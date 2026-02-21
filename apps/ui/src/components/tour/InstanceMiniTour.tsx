import { useState, useEffect, useCallback } from 'react';

type Tab = 'overview' | 'profile' | 'security' | 'workspace';
const KEY = 'wooblay-instance-tour-seen';

const STEPS: { target: string; title: string; content: string; tab?: Tab }[] = [
  { target: 'tour-instance-header', title: 'Meet your agent', content: 'Status, role, trust weather at a glance.' },
  { target: 'tour-tab-overview', tab: 'overview', title: 'Overview', content: 'Trust score, cost, contributions, live activity.' },
  { target: 'tour-tab-profile', tab: 'profile', title: 'Profile', content: 'Edit name, role, identity inline.' },
  { target: 'tour-tab-security', tab: 'security', title: 'Security', content: 'Agent API keys, exec-only secrets, policy links.' },
  { target: 'tour-agent-keys', tab: 'security', title: 'Agent API keys', content: 'Fully visible to the agent. Only add what you trust it with.' },
  { target: 'tour-tab-workspace', tab: 'workspace', title: 'Workspace', content: 'Live file browser, logs. See what it is building.' },
];

export function InstanceMiniTour(props: { activeTab: string; onSwitchTab: (t: Tab) => void }) {
  const { activeTab, onSwitchTab } = props;
  const [on, setOn] = useState(false);
  const [idx, setIdx] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  // Auto-start on first instance visit
  useEffect(() => {
    try { if (localStorage.getItem(KEY)) return; } catch { return; }
    const t = setTimeout(() => setOn(true), 600);
    return () => clearTimeout(t);
  }, []);

  const step = on ? STEPS[idx] : null;

  // Switch tab when step requires it
  useEffect(() => {
    if (step?.tab && step.tab !== activeTab) onSwitchTab(step.tab);
  }, [step, activeTab, onSwitchTab]);

  // Measure target element
  useEffect(() => {
    if (!on || !step) { setRect(null); return; }
    const t = setTimeout(() => {
      const el = document.querySelector('[data-tour="' + step.target + '"]');
      if (!el) { setRect(null); return; }
      const r = el.getBoundingClientRect();
      setRect(new DOMRect(r.left - 10, r.top - 10, r.width + 20, r.height + 20));
    }, 150);
    return () => clearTimeout(t);
  }, [on, step, idx, activeTab]);

  // Re-measure on scroll
  useEffect(() => {
    if (!on || !step) return;
    const m = () => {
      const el = document.querySelector('[data-tour="' + step.target + '"]');
      if (!el) return;
      const r = el.getBoundingClientRect();
      setRect(new DOMRect(r.left - 10, r.top - 10, r.width + 20, r.height + 20));
    };
    window.addEventListener('scroll', m, true);
    return () => window.removeEventListener('scroll', m, true);
  }, [on, step]);

  const done = useCallback(() => {
    setOn(false);
    try { localStorage.setItem(KEY, 'true'); } catch { /* noop */ }
  }, []);

  if (!on || !step) return null;

  const pct = ((idx + 1) / STEPS.length) * 100;
  const isLast = idx === STEPS.length - 1;

  return (
    <div className="fixed inset-0 z-[9999] pointer-events-auto">
      {!rect && <div className="absolute inset-0 bg-black/60" />}
      {rect && (
        <div
          className="absolute rounded-xl border-2 border-accent/80 bg-transparent transition-all duration-300 ease-out"
          style={{
            left: rect.left, top: rect.top, width: rect.width, height: rect.height,
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.6), 0 0 30px 4px rgba(99,102,241,0.15)',
          }}
        />
      )}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 w-full max-w-[420px] px-4">
        <div
          className="bg-surface-1 border border-accent/20 rounded-2xl shadow-2xl overflow-hidden"
          style={{ boxShadow: '0 0 40px 8px rgba(99,102,241,0.08), 0 25px 50px -12px rgba(0,0,0,0.5)' }}
        >
          <div className="h-[3px] bg-surface-2">
            <div
              className="h-full bg-gradient-to-r from-accent to-accent-bright transition-all duration-300 ease-out rounded-full"
              style={{ width: pct + '%' }}
            />
          </div>
          <div className="p-5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <span className="text-[10px] font-mono text-accent/70 font-medium tabular-nums">
                  {idx + 1}/{STEPS.length}
                </span>
                <h3 className="text-[15px] font-semibold text-text-primary leading-tight">
                  {step.title}
                </h3>
              </div>
              <button
                type="button"
                onClick={done}
                className="text-[10px] text-text-muted hover:text-text-secondary font-mono transition-colors"
              >
                skip
              </button>
            </div>
            <p className="text-[13px] text-text-secondary leading-relaxed">
              {step.content}
            </p>
            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => setIdx(Math.max(0, idx - 1))}
                disabled={idx === 0}
                className="text-[12px] font-mono text-text-tertiary hover:text-text-primary disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
              >
                back
              </button>
              <button
                type="button"
                onClick={() => { if (isLast) done(); else setIdx(idx + 1); }}
                className="px-5 py-2 rounded-lg bg-accent hover:bg-accent-bright text-white text-[12px] font-mono font-medium transition-colors shadow-lg shadow-accent/20"
              >
                {isLast ? 'done' : 'next'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Tour overlay — spotlight highlight, progress bar, minimal card.
 * Re-measures target on navigation, scroll, and resize.
 */

import { useEffect, useState, useLayoutEffect } from 'react';
import { useTour } from '../../contexts/TourContext.tsx';

const PAD = 10;

export function TourOverlay() {
  const { isActive, step, stepIndex, totalSteps, nextStep, prevStep, closeTour, setTourCompleted } = useTour();
  const [rect, setRect] = useState<DOMRect | null>(null);

  // Measure after route + render
  useLayoutEffect(() => {
    if (!isActive || !step?.target) { setRect(null); return; }
    // Small delay to let React render the new page
    const t = setTimeout(() => {
      const el = document.querySelector(`[data-tour="${step.target}"]`);
      if (!el) { setRect(null); return; }
      const r = el.getBoundingClientRect();
      setRect(new DOMRect(r.left - PAD, r.top - PAD, r.width + PAD * 2, r.height + PAD * 2));
    }, 120);
    return () => clearTimeout(t);
  }, [isActive, step?.path, step?.target, step?.action, stepIndex]);

  // Live re-measure on scroll/resize
  useEffect(() => {
    if (!isActive || !step?.target) return;
    const measure = () => {
      const el = document.querySelector(`[data-tour="${step.target}"]`);
      if (!el) return;
      const r = el.getBoundingClientRect();
      setRect(new DOMRect(r.left - PAD, r.top - PAD, r.width + PAD * 2, r.height + PAD * 2));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(document.documentElement);
    window.addEventListener('scroll', measure, true);
    return () => { ro.disconnect(); window.removeEventListener('scroll', measure, true); };
  }, [isActive, step?.target, stepIndex]);

  if (!isActive || !step) return null;

  const isFirst = stepIndex === 0;
  const isLast = stepIndex === totalSteps - 1;
  const pct = ((stepIndex + 1) / totalSteps) * 100;

  return (
    <div className="fixed inset-0 z-[9999] pointer-events-auto">
      {!rect && <div className="absolute inset-0 bg-black/30" aria-hidden />}

      {rect && (
        <div
          className="absolute rounded-xl border-2 border-accent/70 bg-transparent transition-all duration-300 ease-out"
          style={{
            left: rect.left, top: rect.top, width: rect.width, height: rect.height,
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.28), 0 0 24px 2px rgba(99,102,241,0.12)',
          }}
        />
      )}

      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 w-full max-w-[420px] px-4">
        <div className="bg-surface-1 border border-border rounded-2xl overflow-hidden shadow-xl"
          style={{ boxShadow: '0 0 24px 4px rgba(99,102,241,0.06), 0 16px 40px -12px rgba(0,0,0,0.25)' }}>
          {/* Progress */}
          <div className="h-[3px] bg-surface-2">
            <div className="h-full bg-gradient-to-r from-accent to-accent-bright transition-all duration-300 ease-out rounded-full" style={{ width: `${pct}%` }} />
          </div>

          <div className="p-5 space-y-3">
            {/* Header */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <span className="text-[10px] font-mono text-accent/70 font-medium tabular-nums">{stepIndex + 1}/{totalSteps}</span>
                <h3 className="text-[15px] font-semibold text-text-primary leading-tight">{step.title}</h3>
              </div>
              <button type="button" onClick={() => { closeTour(); setTourCompleted(); }}
                className="text-[10px] text-text-muted hover:text-text-secondary font-mono transition-colors">
                skip
              </button>
            </div>

            {/* Body */}
            <p className="text-[13px] text-text-secondary leading-relaxed">{step.content}</p>

            {/* Nav */}
            <div className="flex items-center justify-between pt-2">
              <button type="button" onClick={prevStep} disabled={isFirst}
                className="text-[12px] font-mono text-text-tertiary hover:text-text-primary disabled:opacity-20 disabled:cursor-not-allowed transition-colors">
                \u2190 back
              </button>
              <button type="button"
                onClick={() => { if (isLast) setTourCompleted(); nextStep(); }}
                className="px-5 py-2 rounded-lg bg-accent hover:bg-accent-bright text-white text-[12px] font-mono font-medium transition-colors shadow-lg shadow-accent/20">
                {isLast ? 'done \u2713' : 'next \u2192'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

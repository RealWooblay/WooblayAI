/**
 * Renders the tutorial overlay: dimmed background, highlight around target element, modal with content and Next/Back.
 */

import { useEffect, useState, useLayoutEffect } from 'react';
import { useTour, TOUR_STEPS } from '../../contexts/TourContext.tsx';

const HIGHLIGHT_PADDING = 8;

export function TourOverlay() {
  const { isActive, step, stepIndex, nextStep, prevStep, closeTour, setTourCompleted } = useTour();
  const [highlightRect, setHighlightRect] = useState<DOMRect | null>(null);

  // After route + render, find target and measure
  useLayoutEffect(() => {
    if (!isActive || !step?.target) {
      setHighlightRect(null);
      return;
    }
    const el = document.querySelector(`[data-tour="${step.target}"]`);
    if (!el) {
      setHighlightRect(null);
      return;
    }
    const rect = el.getBoundingClientRect();
    setHighlightRect(new DOMRect(rect.left - HIGHLIGHT_PADDING, rect.top - HIGHLIGHT_PADDING, rect.width + HIGHLIGHT_PADDING * 2, rect.height + HIGHLIGHT_PADDING * 2));
  }, [isActive, step?.path, step?.target, stepIndex]);

  // Re-measure on scroll/resize
  useEffect(() => {
    if (!isActive || !step?.target) return;
    const el = document.querySelector(`[data-tour="${step.target}"]`);
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      setHighlightRect(new DOMRect(rect.left - HIGHLIGHT_PADDING, rect.top - HIGHLIGHT_PADDING, rect.width + HIGHLIGHT_PADDING * 2, rect.height + HIGHLIGHT_PADDING * 2));
    };
    const ro = new ResizeObserver(update);
    ro.observe(document.documentElement);
    window.addEventListener('scroll', update, true);
    return () => {
      ro.disconnect();
      window.removeEventListener('scroll', update, true);
    };
  }, [isActive, step?.target, stepIndex]);

  if (!isActive || !step) return null;

  const isFirst = stepIndex === 0;
  const isLastStep = stepIndex === TOUR_STEPS.length - 1;

  return (
    <div className="fixed inset-0 z-[9999] pointer-events-auto">
      {/* Dimmed backdrop when no target; otherwise spotlight cutout is the only overlay */}
      {!highlightRect && <div className="absolute inset-0 bg-black/50" aria-hidden />}

      {/* Spotlight: transparent box with huge box-shadow = dimmed everywhere except the hole */}
      {highlightRect && (
        <div
          className="absolute rounded-lg border-2 border-accent bg-transparent"
          style={{
            left: highlightRect.left,
            top: highlightRect.top,
            width: highlightRect.width,
            height: highlightRect.height,
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)',
          }}
        />
      )}

      {/* Modal card — bottom center */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 w-full max-w-md px-4">
        <div className="bg-surface-1 border border-border rounded-xl shadow-xl p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-medium text-text-tertiary uppercase tracking-wider">
              {stepIndex + 1} of {TOUR_STEPS.length}
            </span>
            <button
              type="button"
              onClick={() => {
                closeTour();
                setTourCompleted();
              }}
              className="text-[11px] text-text-tertiary hover:text-text-primary"
            >
              Skip tour
            </button>
          </div>
          <h3 className="text-base font-semibold text-text-primary">{step.title}</h3>
          <p className="text-sm text-text-secondary leading-relaxed">{step.content}</p>
          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={prevStep}
              disabled={isFirst}
              className="text-sm font-medium text-accent hover:text-accent-bright disabled:opacity-40 disabled:cursor-not-allowed"
            >
              ← Back
            </button>
            <button
              type="button"
              onClick={() => {
                if (isLastStep) setTourCompleted();
                nextStep();
              }}
              className="px-4 py-2 rounded-lg bg-accent hover:bg-accent-bright text-white text-sm font-medium"
            >
              {isLastStep ? 'Finish' : 'Next →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

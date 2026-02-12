import type { ReactNode } from 'react';

/**
 * Standalone InspectorPanel component for use outside LayoutShell context
 * (e.g. inline in a page). For the LayoutShell-managed inspector, use
 * the useInspector() hook instead.
 */

interface InspectorPanelProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

export function InspectorPanel({ title, onClose, children, footer }: InspectorPanelProps) {
  return (
    <aside className="w-[420px] flex-shrink-0 border-l border-stone-200 bg-white flex flex-col animate-slide-in-right overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-stone-200">
        <h3 className="text-sm font-semibold text-stone-900 truncate">{title}</h3>
        <button
          onClick={onClose}
          className="rounded-md p-1 text-stone-400 hover:text-stone-600 hover:bg-stone-100 transition-colors cursor-pointer"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {children}
      </div>

      {/* Sticky footer */}
      {footer && (
        <div className="border-t border-stone-200 px-5 py-3 bg-stone-50">
          {footer}
        </div>
      )}
    </aside>
  );
}

/**
 * CSS-only hover tooltip. No library dependency.
 */
import type { ReactNode } from 'react';

interface TooltipProps {
  content: string;
  children: ReactNode;
  position?: 'top' | 'bottom' | 'left' | 'right';
}

export function Tooltip({ content, children, position = 'top' }: TooltipProps) {
  if (!content) return <>{children}</>;

  const positionClasses: Record<string, string> = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    left: 'right-full top-1/2 -translate-y-1/2 mr-2',
    right: 'left-full top-1/2 -translate-y-1/2 ml-2',
  };

  return (
    <span className="relative inline-flex group">
      {children}
      <span
        className={`absolute ${positionClasses[position]} z-50 px-2.5 py-1.5 text-[11px] leading-tight text-text-primary bg-surface-2 border border-border rounded-lg shadow-lg whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity duration-150 max-w-[260px]`}
        style={{ whiteSpace: 'normal' }}
      >
        {content}
      </span>
    </span>
  );
}

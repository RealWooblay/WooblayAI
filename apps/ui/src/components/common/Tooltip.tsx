/**
 * Clean tooltip — positions below trigger by default, never overlaps cards.
 */
import type { ReactNode } from 'react';

interface TooltipProps {
  content: string;
  children: ReactNode;
  position?: 'top' | 'bottom';
}

export function Tooltip({ content, children, position = 'bottom' }: TooltipProps) {
  if (!content) return <>{children}</>;

  return (
    <span className="relative inline-flex group/tip">
      {children}
      <span
        className={`
          absolute z-[100] px-3 py-2 text-[11px] leading-snug
          text-text-primary bg-surface-3 border border-border-strong
          rounded-lg shadow-xl shadow-black/40
          whitespace-normal max-w-[280px] w-max
          opacity-0 pointer-events-none
          group-hover/tip:opacity-100
          transition-opacity duration-150
          ${position === 'top'
            ? 'bottom-full left-1/2 -translate-x-1/2 mb-2'
            : 'top-full left-1/2 -translate-x-1/2 mt-2'
          }
        `}
      >
        {/* Arrow */}
        <span className={`
          absolute left-1/2 -translate-x-1/2 w-2 h-2
          bg-surface-3 border-border-strong rotate-45
          ${position === 'top'
            ? 'top-full -mt-1 border-r border-b'
            : 'bottom-full -mb-1 border-l border-t'
          }
        `} />
        {content}
      </span>
    </span>
  );
}

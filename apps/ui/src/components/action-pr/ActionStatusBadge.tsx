import clsx from 'clsx';
import { IconCheck, IconX, IconClock, IconUndo, IconPlay } from '../icons.tsx';

interface ActionStatusBadgeProps {
  status: string;
  size?: 'sm' | 'md';
}

export function ActionStatusBadge({ status, size = 'sm' }: ActionStatusBadgeProps) {
  const normalized = status.toLowerCase();

  const config: Record<string, { icon: typeof IconCheck; label: string; classes: string }> = {
    pending: {
      icon: IconClock,
      label: 'Pending',
      classes: 'text-blue-700 bg-blue-50',
    },
    approved: {
      icon: IconCheck,
      label: 'Approved',
      classes: 'text-green-700 bg-green-50',
    },
    executed: {
      icon: IconPlay,
      label: 'Executed',
      classes: 'text-green-700 bg-green-50',
    },
    denied: {
      icon: IconX,
      label: 'Denied',
      classes: 'text-red-700 bg-red-50',
    },
    rolled_back: {
      icon: IconUndo,
      label: 'Rolled Back',
      classes: 'text-stone-600 bg-stone-100',
    },
  };

  const c = config[normalized] ?? config.pending;
  const StatusIcon = c.icon;

  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-md font-medium',
        c.classes,
        size === 'sm' && 'px-2 py-0.5 text-[11px]',
        size === 'md' && 'px-2.5 py-1 text-xs',
      )}
    >
      <StatusIcon size={size === 'sm' ? 12 : 14} />
      {c.label}
    </span>
  );
}

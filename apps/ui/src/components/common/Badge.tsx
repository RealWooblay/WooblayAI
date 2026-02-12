import clsx from 'clsx';

export type BadgeVariant =
  | 'green'
  | 'yellow'
  | 'red'
  | 'blue'
  | 'gray'
  | 'indigo'
  | 'orange'
  | 'cyan'
  | 'rose'
  | 'purple';

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  green: 'bg-emerald-500/10 text-emerald-400 ring-emerald-500/20',
  yellow: 'bg-amber-500/10 text-amber-400 ring-amber-500/20',
  red: 'bg-red-500/10 text-red-400 ring-red-500/20',
  blue: 'bg-blue-500/10 text-blue-400 ring-blue-500/20',
  gray: 'bg-gray-500/10 text-gray-400 ring-gray-500/20',
  indigo: 'bg-indigo-500/10 text-indigo-400 ring-indigo-500/20',
  orange: 'bg-orange-500/10 text-orange-400 ring-orange-500/20',
  cyan: 'bg-cyan-500/10 text-cyan-400 ring-cyan-500/20',
  rose: 'bg-rose-500/10 text-rose-400 ring-rose-500/20',
  purple: 'bg-purple-500/10 text-purple-400 ring-purple-500/20',
};

/** Map risk tier strings to badge variant. */
export function riskTierVariant(tier: string): BadgeVariant {
  switch (tier.toUpperCase()) {
    case 'READ':
      return 'green';
    case 'WRITE':
      return 'yellow';
    case 'DESTRUCTIVE':
      return 'red';
    default:
      return 'gray';
  }
}

/** Map approval / decision status to variant. */
export function statusVariant(status: string): BadgeVariant {
  switch (status.toUpperCase()) {
    case 'APPROVED':
    case 'ALLOW':
    case 'EXECUTE':
    case 'EXECUTED':
      return 'green';
    case 'PENDING':
    case 'PENDING_APPROVAL':
    case 'APPROVE':
      return 'blue';
    case 'DENIED':
    case 'DENY':
      return 'red';
    case 'EXPIRED':
      return 'orange';
    case 'ROLLED_BACK':
      return 'purple';
    default:
      return 'gray';
  }
}

/** Map adapter ID to badge variant. */
export function adapterVariant(adapter: string | null | undefined): BadgeVariant {
  if (!adapter) return 'gray';
  switch (adapter) {
    case 'openclaw-plugin':
      return 'blue';
    case 'mcp-toolhost':
      return 'indigo';
    case 'http-sdk':
      return 'orange';
    case 'simulator':
      return 'gray';
    default:
      return 'gray';
  }
}

/** Human-readable adapter label. */
export function adapterLabel(adapter: string | null | undefined): string {
  if (!adapter) return 'Unknown';
  switch (adapter) {
    case 'openclaw-plugin':
      return 'OpenClaw';
    case 'mcp-toolhost':
      return 'MCP';
    case 'http-sdk':
      return 'HTTP SDK';
    case 'simulator':
      return 'Simulator';
    default:
      return adapter;
  }
}

interface BadgeProps {
  variant?: BadgeVariant;
  children: React.ReactNode;
  className?: string;
}

export function Badge({ variant = 'gray', children, className }: BadgeProps) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider ring-1 ring-inset',
        VARIANT_CLASSES[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}

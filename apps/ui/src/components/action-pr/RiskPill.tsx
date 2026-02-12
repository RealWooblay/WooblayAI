import clsx from 'clsx';
import { IconAlert, IconShield } from '../icons.tsx';

interface RiskPillProps {
  tier: string;
  size?: 'sm' | 'md';
}

export function RiskPill({ tier, size = 'sm' }: RiskPillProps) {
  const normalized = tier.toUpperCase();

  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 font-medium',
        size === 'sm' && 'text-[11px]',
        size === 'md' && 'text-xs',
        normalized === 'READ' && 'text-emerald-400',
        normalized === 'WRITE' && 'text-amber-400',
        normalized === 'DESTRUCTIVE' && 'rounded-md bg-red-500/10 px-2 py-0.5 text-red-400 ring-1 ring-inset ring-red-500/20',
      )}
    >
      {normalized === 'DESTRUCTIVE' ? (
        <IconAlert size={size === 'sm' ? 12 : 14} />
      ) : (
        <IconShield size={size === 'sm' ? 12 : 14} />
      )}
      {normalized}
    </span>
  );
}

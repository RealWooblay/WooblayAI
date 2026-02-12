import { NavLink, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getApprovals } from '../../api/client.ts';
import clsx from 'clsx';
import { useState } from 'react';

const MAIN_NAV: ReadonlyArray<{ to: string; label: string; icon: string; end?: boolean; badge?: boolean }> = [
  { to: '/', label: 'Dashboard', icon: '◉', end: true },
  { to: '/approvals', label: 'Approvals', icon: '⬡', badge: true },
  { to: '/instances', label: 'Instances', icon: '◎' },
];

const MORE_NAV = [
  { to: '/policies', label: 'Policies' },
  { to: '/agents', label: 'Agents' },
  { to: '/audit', label: 'Audit Trail' },
  { to: '/receipts', label: 'Receipts' },
  { to: '/scoring', label: 'Scoring' },
] as const;

export function Sidebar() {
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);

  const { data: approvals } = useQuery({
    queryKey: ['approvals', 'pending'],
    queryFn: getApprovals,
    refetchInterval: 5_000,
  });
  const pendingCount = approvals?.length ?? 0;

  return (
    <aside className="w-[220px] h-full flex flex-col bg-surface-0 border-r border-border shrink-0 select-none">
      {/* Brand */}
      <div className="px-5 pt-5 pb-4">
        <span className="text-sm font-bold tracking-tight text-text-primary">
          wooblay
        </span>
      </div>

      {/* Main Nav */}
      <nav className="flex-1 px-3 space-y-0.5">
        {MAIN_NAV.map((item) => {
          const isActive = item.end
            ? location.pathname === item.to
            : location.pathname.startsWith(item.to);

          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end || undefined}
              className={() =>
                clsx(
                  'flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium transition-all relative',
                  isActive
                    ? 'bg-accent-subtle text-accent-bright'
                    : 'text-text-secondary hover:text-text-primary hover:bg-surface-2',
                )
              }
            >
              {isActive && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 rounded-full bg-accent" />
              )}
              <span className={clsx('text-[11px] w-5 text-center', isActive ? 'opacity-100' : 'opacity-40')}>
                {item.icon}
              </span>
              <span className="flex-1">{item.label}</span>
              {item.badge && pendingCount > 0 && (
                <span className="min-w-[18px] h-[18px] rounded-full bg-amber-500/15 text-amber-400 text-[10px] font-bold flex items-center justify-center px-1 tabular-nums">
                  {pendingCount}
                </span>
              )}
            </NavLink>
          );
        })}

        {/* More section */}
        <div className="pt-3">
          <button
            onClick={() => setMoreOpen(!moreOpen)}
            className="flex items-center gap-2 px-3 py-1.5 text-[11px] text-text-muted hover:text-text-secondary transition-colors w-full"
          >
            <span className={clsx('transition-transform text-[9px]', moreOpen && 'rotate-90')}>
              ▸
            </span>
            More
          </button>

          {moreOpen && (
            <div className="space-y-0.5 mt-0.5 animate-slide-in-up">
              {MORE_NAV.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={() =>
                    clsx(
                      'flex items-center gap-3 px-3 py-1.5 rounded-lg text-[12px] transition-all',
                      location.pathname.startsWith(item.to)
                        ? 'text-text-primary bg-surface-2'
                        : 'text-text-muted hover:text-text-secondary hover:bg-surface-1',
                    )
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </div>
          )}
        </div>
      </nav>

      {/* Bottom: Command palette */}
      <div className="px-4 py-3 border-t border-border">
        <button
          onClick={() => window.dispatchEvent(new CustomEvent('open-command-palette'))}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-1 border border-border hover:border-border-strong text-[11px] text-text-muted hover:text-text-secondary transition-all cursor-pointer"
        >
          <span className="flex-1 text-left">Search...</span>
          <kbd className="text-[9px] font-mono bg-surface-2 px-1.5 py-0.5 rounded text-text-muted">
            ⌘K
          </kbd>
        </button>
      </div>
    </aside>
  );
}

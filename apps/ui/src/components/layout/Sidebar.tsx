import { NavLink, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useUser as useClerkUser } from '@clerk/clerk-react';
import { getApprovals } from '../../api/client.ts';
import clsx from 'clsx';

const HAS_CLERK = !!import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

function useSafeUser(): { user: any } {
  if (!HAS_CLERK) return { user: null };
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useClerkUser();
}

const NAV_ITEMS: ReadonlyArray<{
  to: string;
  label: string;
  icon: string;
  end?: boolean;
  badge?: boolean;
}> = [
  { to: '/', label: 'Dashboard', icon: '◉', end: true },
  { to: '/instances', label: 'Instances', icon: '◎' },
  { to: '/approvals', label: 'Approvals', icon: '⬡', badge: true },
  { to: '/policies', label: 'Policies', icon: '◇' },
  { to: '/activity', label: 'Activity', icon: '◈' },
  { to: '/audit', label: 'Audit', icon: '⬢' },
];

export function Sidebar() {
  const location = useLocation();
  const { user } = useSafeUser();

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
        <span className="text-[9px] text-accent-bright ml-1.5 font-medium">beta</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 space-y-0.5">
        {NAV_ITEMS.map((item) => {
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
      </nav>

      {/* Bottom: User + Settings */}
      <div className="px-3 pb-4 space-y-1">
        <NavLink
          to="/settings"
          className={() =>
            clsx(
              'flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium transition-all',
              location.pathname === '/settings'
                ? 'bg-accent-subtle text-accent-bright'
                : 'text-text-secondary hover:text-text-primary hover:bg-surface-2',
            )
          }
        >
          <span className="text-[11px] w-5 text-center opacity-40">⚙</span>
          <span className="flex-1">Settings</span>
        </NavLink>

        {user && (
          <div className="flex items-center gap-2.5 px-3 py-2 mt-1">
            {user.imageUrl ? (
              <img src={user.imageUrl} alt="" className="h-6 w-6 rounded-full border border-border" />
            ) : (
              <div className="h-6 w-6 rounded-full bg-surface-3 border border-border flex items-center justify-center text-[9px] text-text-muted">
                {(user.firstName?.[0] || user.primaryEmailAddress?.emailAddress?.[0] || '?').toUpperCase()}
              </div>
            )}
            <span className="text-[11px] text-text-muted truncate">
              {user.firstName || user.primaryEmailAddress?.emailAddress || 'User'}
            </span>
          </div>
        )}
      </div>
    </aside>
  );
}

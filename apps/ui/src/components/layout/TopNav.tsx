import { NavLink, useLocation } from 'react-router-dom';
import clsx from 'clsx';

const NAV_ITEMS = [
  { to: '/', label: 'Command Center', end: true },
  { to: '/approvals', label: 'Approvals' },
  { to: '/agents', label: 'Agents' },
  { to: '/github', label: 'GitHub' },
  { to: '/audit', label: 'Audit' },
  { to: '/policies', label: 'Policies' },
  { to: '/receipts', label: 'Receipts' },
  { to: '/infrastructure', label: 'Infra' },
];

export function TopNav() {
  const location = useLocation();

  return (
    <header className="flex items-center h-11 bg-surface-1 border-b border-border px-4 shrink-0 z-20">
      {/* Brand */}
      <div className="flex items-center gap-2 mr-6">
        <div className="h-5 w-5 rounded bg-accent flex items-center justify-center">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2" />
          </svg>
        </div>
        <span className="text-xs font-bold text-text-primary tracking-tight">wooblay</span>
      </div>

      {/* Nav tabs */}
      <nav className="flex items-center gap-0.5 flex-1">
        {NAV_ITEMS.map((item) => {
          const isActive = item.end
            ? location.pathname === item.to
            : location.pathname.startsWith(item.to);

          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={() =>
                clsx(
                  'px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors',
                  isActive
                    ? 'bg-accent-subtle text-accent-bright'
                    : 'text-text-secondary hover:text-text-primary hover:bg-surface-2',
                )
              }
            >
              {item.label}
            </NavLink>
          );
        })}
      </nav>

      {/* Right: connection status */}
      <div className="flex items-center gap-3 text-[11px] text-text-tertiary">
        <div className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-success live-dot" />
          <span>Gate</span>
        </div>
      </div>
    </header>
  );
}

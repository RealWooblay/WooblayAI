import { NavLink, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useUser as useClerkUser, OrganizationSwitcher } from '@clerk/clerk-react';
import { getApprovals, getOperations, getOrgPolicySettings } from '../../api/client.ts';
import { useTourOptional } from '../../contexts/TourContext.tsx';
import clsx from 'clsx';

const HAS_CLERK = !!import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

function useSafeUser(): { user: any } {
  if (!HAS_CLERK) return { user: null };
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useClerkUser();
}

interface NavItem {
  to: string;
  label: string;
  icon: string;
  end?: boolean;
  badge?: 'approvals' | 'operations';
  section: 'agents' | 'connect' | 'secure' | 'monitor' | 'platform';
}

const NAV_ITEMS: ReadonlyArray<NavItem> = [
  // AGENTS — only in full platform mode (above Setup)
  { to: '/', label: 'Agents', icon: '◎', end: true, section: 'agents' },
  // CONNECT
  { to: '/setup', label: 'Setup', icon: '⚡', section: 'connect' },
  { to: '/credentials', label: 'Credentials', icon: '🔑', section: 'connect' },
  { to: '/sensors', label: 'Sensors', icon: '◈', section: 'connect' },
  // SECURE
  { to: '/policies', label: 'Policies', icon: '◇', section: 'secure' },
  { to: '/approvals', label: 'Approvals', icon: '⬡', badge: 'approvals', section: 'secure' },
  // MONITOR
  { to: '/activity', label: 'Activity', icon: '◈', section: 'monitor' },
  { to: '/notifications', label: 'Notifications', icon: '◈', section: 'monitor' },
  // PLATFORM — only in full platform mode
  { to: '/operations', label: 'Operations', icon: '◉', badge: 'operations', section: 'platform' },
  { to: '/insights', label: 'Insights', icon: '◈', section: 'platform' },
];

const SECTION_LABELS: Record<string, string> = {
  agents: 'AGENTS',
  connect: 'CONNECT',
  secure: 'SECURE',
  monitor: 'MONITOR',
  platform: 'PLATFORM',
};

export function Sidebar() {
  const location = useLocation();
  const { user } = useSafeUser();
  const tour = useTourOptional();

  const { data: approvals } = useQuery({
    queryKey: ['approvals', 'pending'],
    queryFn: getApprovals,
    refetchInterval: 5_000,
  });
  const pendingCount = approvals?.length ?? 0;

  const { data: operationsData } = useQuery({
    queryKey: ['operations', 'active'],
    queryFn: () => getOperations({ limit: 100 }),
    refetchInterval: 10_000,
  });
  const activeOperations = (operationsData?.operations ?? []).filter(
    (i: any) => !['resolved', 'closed'].includes(i.status),
  ).length;

  // Platform mode from org settings
  const { data: orgSettings } = useQuery({
    queryKey: ['org-settings'],
    queryFn: getOrgPolicySettings,
    staleTime: 60_000,
  });
  const platformMode = (orgSettings as any)?.platformMode ?? 'firewall';
  const isFullPlatform = platformMode === 'full';

  // Group nav items: agents only when full platform; platform section only when full
  const visibleItems = NAV_ITEMS.filter((item) => {
    if (item.section === 'agents') return isFullPlatform;
    if (item.section === 'platform') return isFullPlatform;
    return true;
  });

  const sections = [
    ...(isFullPlatform ? ['agents'] : []),
    'connect',
    'secure',
    'monitor',
    ...(isFullPlatform ? ['platform'] : []),
  ];
  const groupedSections = sections.map((section) => ({
    key: section,
    label: SECTION_LABELS[section],
    items: visibleItems.filter((item) => item.section === section),
  }));

  return (
    <aside className="w-[220px] h-full flex flex-col bg-surface-0 border-r border-border shrink-0 select-none">
      {/* Brand + Org Switcher */}
      <div className="px-4 pt-5 pb-3">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold tracking-tight text-text-primary">
              wooblay
            </span>
            <span className="text-[9px] text-accent-bright font-medium">beta</span>
          </div>
          {/* Notification bell */}
          <NavLink
            to="/notifications"
            className="relative p-1.5 rounded-lg hover:bg-surface-2 transition-colors"
          >
            <span className="text-[13px] text-text-muted">🔔</span>
            {pendingCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] rounded-full bg-amber-500 text-[8px] font-bold text-black flex items-center justify-center px-0.5">
                {pendingCount > 9 ? '9+' : pendingCount}
              </span>
            )}
          </NavLink>
        </div>
        {HAS_CLERK && (
          <div className="mt-2 [&_.cl-organizationSwitcher-root]:w-full [&_.cl-organizationSwitcherTrigger]:w-full [&_.cl-organizationSwitcherTrigger]:justify-between">
            <OrganizationSwitcher
              hidePersonal={true}
              afterCreateOrganizationUrl="/"
              afterSelectOrganizationUrl="/"
              appearance={{
                elements: {
                  rootBox: 'w-full',
                  organizationSwitcherTrigger:
                    'w-full bg-surface-2 border border-border rounded-lg px-2.5 py-1.5 text-xs hover:bg-surface-3 transition-colors',
                  organizationPreview: 'text-[#e4e4e7]',
                  organizationPreviewTextContainer: 'text-[#e4e4e7]',
                  organizationSwitcherTriggerIcon: 'text-[#a1a1aa]',
                  organizationPreviewSecondaryIdentifier: 'text-[#a1a1aa]',
                  organizationSwitcherPopoverCard: 'bg-[#111113] border border-white/10',
                  organizationSwitcherPopoverActions: 'text-[#e4e4e7]',
                  organizationSwitcherPopoverActionButton: 'text-[#e4e4e7] hover:bg-white/5',
                  organizationSwitcherPopoverActionButtonText: 'text-[#e4e4e7]',
                  organizationSwitcherPopoverActionButtonIcon: 'text-[#a1a1aa]',
                  organizationSwitcherPopoverFooter: 'border-white/10',
                },
              }}
            />
          </div>
        )}
      </div>

      {/* Navigation — sectioned */}
      <nav className="flex-1 px-3 overflow-y-auto">
        {groupedSections.map((section) => (
          <div key={section.key} className="mb-3">
            <p className="text-[9px] font-bold text-text-muted tracking-widest uppercase px-3 mb-1.5 mt-2">
              {section.label}
            </p>
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const isActive = item.end
                  ? location.pathname === item.to
                  : location.pathname.startsWith(item.to);

                const badgeCount = item.badge === 'approvals' ? pendingCount
                  : item.badge === 'operations' ? activeOperations
                  : 0;

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
                    {badgeCount > 0 && (
                      <span className={clsx(
                        'min-w-[18px] h-[18px] rounded-full text-[10px] font-bold flex items-center justify-center px-1 tabular-nums',
                        item.badge === 'operations' ? 'bg-red-500/15 text-red-400' : 'bg-amber-500/15 text-amber-400',
                      )}>
                        {badgeCount}
                      </span>
                    )}
                  </NavLink>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Bottom: Tutorial + Settings + User */}
      <div className="px-3 pb-4 space-y-1">
        {tour && (
          <button
            type="button"
            onClick={tour.startTour}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium transition-all text-text-secondary hover:text-text-primary hover:bg-surface-2"
          >
            <span className="text-[11px] w-5 text-center opacity-40">◇</span>
            <span className="flex-1 text-left">Tutorial</span>
          </button>
        )}
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

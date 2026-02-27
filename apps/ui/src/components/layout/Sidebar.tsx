import { NavLink, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useUser as useClerkUser, OrganizationSwitcher } from '@clerk/clerk-react';
import { getApprovals, getOperations, getOrgPolicySettings } from '../../api/client.ts';
import { useTourOptional } from '../../contexts/TourContext.tsx';
import { useThemeOptional } from '../../contexts/ThemeContext.tsx';
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
  end?: boolean;
  badge?: 'approvals' | 'operations';
  section: 'agents' | 'connect' | 'secure' | 'monitor' | 'platform';
}

const NAV_ITEMS: ReadonlyArray<NavItem> = [
  { to: '/', label: 'Dashboard', end: true, section: 'agents' },
  { to: '/setup', label: 'Gateway', section: 'connect' },
  { to: '/credentials', label: 'Credentials', section: 'connect' },
  { to: '/sensors', label: 'Sensors', section: 'connect' },
  { to: '/approvals', label: 'Approvals', badge: 'approvals', section: 'secure' },
  { to: '/policies', label: 'Policies', section: 'secure' },
  { to: '/operations', label: 'Operations', badge: 'operations', section: 'platform' },
  { to: '/insights', label: 'Insights', section: 'platform' },
  { to: '/notifications', label: 'Notifications', section: 'monitor' },
  { to: '/audit', label: 'Audit', section: 'monitor' },
  { to: '/usage', label: 'Usage', section: 'monitor' },
];

const SECTION_LABELS: Record<string, string> = {
  agents: 'AGENTS',
  connect: 'CONNECT',
  secure: 'SECURE',
  monitor: 'MONITOR',
  platform: 'PLATFORM',
};

const CLERK_DARK = {
  elements: {
    rootBox: 'w-full',
    organizationSwitcherTrigger: 'w-full bg-surface-2 border border-border rounded-lg px-2.5 py-1.5 text-xs hover:bg-surface-3 transition-colors',
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
};

const CLERK_LIGHT = {
  elements: {
    rootBox: 'w-full',
    organizationSwitcherTrigger: 'w-full bg-[#f8f8fc] border border-[#d8d8e4] rounded-lg px-2.5 py-1.5 text-xs hover:bg-[#eeeef4] transition-colors',
    organizationPreview: 'text-[#1a1a2e]',
    organizationPreviewTextContainer: 'text-[#1a1a2e]',
    organizationSwitcherTriggerIcon: 'text-[#6a6a8a]',
    organizationPreviewSecondaryIdentifier: 'text-[#4a4a6a]',
    organizationSwitcherPopoverCard: 'bg-white border border-[#d8d8e4] shadow-xl',
    organizationSwitcherPopoverActions: 'text-[#1a1a2e]',
    organizationSwitcherPopoverActionButton: 'text-[#1a1a2e] hover:bg-[#f4f4f8]',
    organizationSwitcherPopoverActionButtonText: 'text-[#1a1a2e]',
    organizationSwitcherPopoverActionButtonIcon: 'text-[#6a6a8a]',
    organizationSwitcherPopoverFooter: 'border-[#e8e8f0]',
  },
};

export function Sidebar() {
  const location = useLocation();
  const { user } = useSafeUser();
  const tour = useTourOptional();
  const theme = useThemeOptional();
  const clerkAppearance = theme?.resolved === 'light' ? CLERK_LIGHT : CLERK_DARK;

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

  const visibleItems = NAV_ITEMS.filter((item) => {
    if (item.section === 'agents') return isFullPlatform;
    if (item.section === 'platform') return isFullPlatform;
    if (item.to === '/sensors') return isFullPlatform;
    return true;
  });

  // Section order: Agents → Connect → Secure (Approvals/Policies) → Platform (Operations/Insights) → Monitor (Notifications/Audit) — priority top to bottom
  const sections = [
    ...(isFullPlatform ? ['agents'] : []),
    'connect',
    'secure',
    ...(isFullPlatform ? ['platform'] : []),
    'monitor',
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
          </div>
        </div>
        {HAS_CLERK && (
          <div className="mt-2 [&_.cl-organizationSwitcher-root]:w-full [&_.cl-organizationSwitcherTrigger]:w-full [&_.cl-organizationSwitcherTrigger]:justify-between">
            <OrganizationSwitcher
              hidePersonal={true}
              afterCreateOrganizationUrl="/"
              afterSelectOrganizationUrl="/"
              appearance={{ elements: clerkAppearance.elements }}
            />
          </div>
        )}
      </div>

      {/* Navigation — sectioned, indentation only, no icons */}
      <nav className="flex-1 overflow-y-auto">
        {groupedSections.map((section) => (
          <div key={section.key} className="mb-4">
            <p className="text-[9px] font-medium text-text-tertiary tracking-[0.15em] uppercase pl-4 pr-3 mb-1 mt-5 first:mt-2">
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
                        'flex items-center gap-2 pl-4 pr-3 py-2 rounded-r-lg text-[13px] font-medium transition-all relative',
                        isActive
                          ? 'bg-surface-2 text-text-primary border-transparent font-semibold'
                          : 'border-transparent text-text-secondary hover:text-text-primary hover:bg-surface-1',
                      )
                    }
                  >
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

      {/* Bottom: Tutorial + Settings + User — same indentation, no icons */}
      <div className="pb-4 space-y-0.5">
        {tour && (
          <button
            type="button"
            onClick={tour.startTour}
            className="w-full flex items-center gap-2 pl-4 pr-3 py-2 rounded-r-lg text-[13px] font-medium transition-all text-text-secondary hover:text-text-primary hover:bg-surface-1 text-left"
          >
            <span className="flex-1">Tutorial</span>
          </button>
        )}
        <NavLink
          to="/settings"
          className={() =>
            clsx(
              'flex items-center gap-2 pl-4 pr-3 py-2 rounded-r-lg text-[13px] font-medium transition-all',
              location.pathname === '/settings'
                ? 'bg-surface-2 text-text-primary border-transparent font-semibold'
                : 'border-transparent text-text-secondary hover:text-text-primary hover:bg-surface-1',
            )
          }
        >
          <span className="flex-1">Settings</span>
        </NavLink>

        {user && (
          <div className="flex items-center gap-2.5 pl-4 pr-3 py-2 mt-1">
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

import { useLocation } from 'react-router-dom';
import { IconSearch } from '../icons.tsx';
import { MOCK_ACTION_PRS, MOCK_AGENTS } from '../../lib/mock-data.ts';

function getPageTitle(pathname: string): string {
  if (pathname === '/') return 'Feed';
  if (pathname === '/approvals') return 'Approvals';
  if (pathname.startsWith('/actions/')) return 'Action Detail';
  if (pathname.startsWith('/agents/')) return 'Agent Profile';
  if (pathname === '/agents') return 'Agents';
  if (pathname === '/rewind') return 'Rewind';
  if (pathname === '/receipts') return 'Receipts';
  if (pathname.startsWith('/receipts/')) return 'Receipt Detail';
  if (pathname === '/policies') return 'Policies';
  if (pathname === '/settings') return 'Settings';
  return 'Wooblay';
}

export function Header() {
  const { pathname } = useLocation();
  const title = getPageTitle(pathname);

  const pendingCount = MOCK_ACTION_PRS.filter(a => a.status === 'pending').length;
  const activeAgents = MOCK_AGENTS.filter(a => a.status === 'active').length;

  return (
    <header className="flex h-12 items-center justify-between border-b border-stone-200 bg-white px-6">
      {/* Left: Page title */}
      <h1 className="text-[13px] font-semibold text-stone-900">{title}</h1>

      {/* Right: Compact inline stats + search */}
      <div className="flex items-center gap-4">
        {/* Inline stats */}
        <div className="hidden md:flex items-center gap-3 text-[12px] text-stone-500">
          {pendingCount > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="inline-flex h-1.5 w-1.5 rounded-full bg-blue-500" />
              <span>{pendingCount} pending</span>
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <span className="inline-flex h-1.5 w-1.5 rounded-full bg-green-500" />
            <span>{activeAgents} agents</span>
          </div>
        </div>

        {/* Search trigger */}
        <button className="flex items-center gap-2 rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs text-stone-400 hover:border-stone-300 hover:text-stone-500 transition-colors cursor-pointer">
          <IconSearch size={14} />
          <span>Search...</span>
          <kbd className="ml-4 rounded border border-stone-200 bg-stone-50 px-1.5 py-0.5 text-[10px] text-stone-400 font-mono">/</kbd>
        </button>
      </div>
    </header>
  );
}

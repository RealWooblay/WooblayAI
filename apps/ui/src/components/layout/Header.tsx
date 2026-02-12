import { useLocation } from 'react-router-dom';
import { IconSearch } from '../icons.tsx';

function getPageTitle(pathname: string): string {
  if (pathname === '/') return 'Dashboard';
  if (pathname === '/approvals') return 'Approvals';
  if (pathname === '/instances') return 'Instances';
  return 'Wooblay';
}

export function Header() {
  const { pathname } = useLocation();
  const title = getPageTitle(pathname);

  return (
    <header className="flex h-12 items-center justify-between border-b border-stone-200 bg-white px-6">
      {/* Left: Page title */}
      <h1 className="text-[13px] font-semibold text-stone-900">{title}</h1>

      {/* Right: Search */}
      <div className="flex items-center gap-4">
        <button className="flex items-center gap-2 rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs text-stone-400 hover:border-stone-300 hover:text-stone-500 transition-colors cursor-pointer">
          <IconSearch size={14} />
          <span>Search...</span>
          <kbd className="ml-4 rounded border border-stone-200 bg-stone-50 px-1.5 py-0.5 text-[10px] text-stone-400 font-mono">/</kbd>
        </button>
      </div>
    </header>
  );
}

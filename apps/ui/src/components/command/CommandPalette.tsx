/**
 * Command Palette — search & navigate interface.
 * Triggered by Cmd+K or the sidebar search button.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getApprovals } from '../../api/client.ts';
import clsx from 'clsx';

interface CommandItem {
  id: string;
  label: string;
  description?: string;
  icon: string;
  action: () => void;
  category: string;
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const { data: approvals } = useQuery({
    queryKey: ['approvals', 'pending'],
    queryFn: getApprovals,
    enabled: open,
  });

  const commands = useMemo<CommandItem[]>(() => {
    const items: CommandItem[] = [];

    // Navigation
    items.push(
      { id: 'nav-home', label: 'Dashboard', description: 'Agents overview', icon: '◉', action: () => navigate('/'), category: 'Navigate' },
      { id: 'nav-instances', label: 'Instances', description: 'Deploy & manage', icon: '◎', action: () => navigate('/instances'), category: 'Navigate' },
      { id: 'nav-approvals', label: 'Approvals', description: `${approvals?.length ?? 0} pending`, icon: '⬡', action: () => navigate('/approvals'), category: 'Navigate' },
      { id: 'nav-settings', label: 'Settings', description: 'Account', icon: '⚙', action: () => navigate('/settings'), category: 'Navigate' },
    );

    // Pending approvals
    if (approvals) {
      for (const approval of approvals) {
        items.push({
          id: `approval-${approval.id}`,
          label: approval.humanDescription || approval.toolCall?.toolName || 'Tool call',
          description: `${approval.toolCall?.riskTier ?? 'READ'}`,
          icon: '⏳',
          action: () => navigate('/approvals'),
          category: 'Pending Approvals',
        });
      }
    }

    return items;
  }, [approvals, navigate]);

  const filtered = useMemo(() => {
    if (!query.trim()) return commands;
    const q = query.toLowerCase();
    return commands.filter(
      (c) =>
        c.label.toLowerCase().includes(q) ||
        c.description?.toLowerCase().includes(q) ||
        c.category.toLowerCase().includes(q),
    );
  }, [commands, query]);

  useEffect(() => { setSelectedIdx(0); }, [query]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
        setQuery('');
        return;
      }

      if (!open) return;

      if (e.key === 'Escape') { setOpen(false); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx((i) => Math.min(i + 1, filtered.length - 1)); }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIdx((i) => Math.max(i - 1, 0)); }
      if (e.key === 'Enter') {
        e.preventDefault();
        const item = filtered[selectedIdx];
        if (item) { item.action(); setOpen(false); setQuery(''); }
      }
    },
    [open, filtered, selectedIdx],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    const handler = () => { setOpen(true); setQuery(''); };
    window.addEventListener('open-command-palette', handler);
    return () => window.removeEventListener('open-command-palette', handler);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  if (!open) return null;

  const groups = new Map<string, CommandItem[]>();
  for (const item of filtered) {
    if (!groups.has(item.category)) groups.set(item.category, []);
    groups.get(item.category)!.push(item);
  }

  let flatIdx = 0;

  return (
    <div
      className="fixed inset-0 z-50 command-overlay flex items-start justify-center pt-[20vh] animate-fade-in"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-[520px] glass-panel rounded-2xl overflow-hidden shadow-2xl animate-float-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/[0.04]">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-text-muted shrink-0">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search or navigate..."
            className="command-input flex-1 text-sm text-text-primary outline-none"
          />
          <kbd className="text-[9px] font-mono bg-surface-2 px-1.5 py-0.5 rounded text-text-muted">esc</kbd>
        </div>

        <div className="max-h-[360px] overflow-y-auto py-2">
          {filtered.length === 0 ? (
            <div className="px-5 py-8 text-center text-text-muted text-xs">
              No results for &ldquo;{query}&rdquo;
            </div>
          ) : (
            Array.from(groups.entries()).map(([category, items]) => (
              <div key={category}>
                <div className="px-5 py-1.5 text-[9px] font-semibold text-text-muted uppercase tracking-[0.15em]">
                  {category}
                </div>
                {items.map((item) => {
                  const idx = flatIdx++;
                  const isSelected = idx === selectedIdx;
                  return (
                    <button
                      key={item.id}
                      onClick={() => { item.action(); setOpen(false); setQuery(''); }}
                      onMouseEnter={() => setSelectedIdx(idx)}
                      className={clsx(
                        'w-full flex items-center gap-3 px-5 py-2 text-left transition-colors cursor-pointer',
                        isSelected ? 'bg-accent/8 text-text-primary' : 'text-text-secondary hover:bg-surface-2',
                      )}
                    >
                      <span className={clsx(
                        'w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-bold shrink-0',
                        isSelected ? 'bg-accent/15 text-accent-bright' : 'bg-surface-3 text-text-muted',
                      )}>
                        {item.icon}
                      </span>
                      <div className="flex-1 min-w-0">
                        <span className="text-[13px] font-medium">{item.label}</span>
                        {item.description && (
                          <span className="text-[10px] text-text-muted ml-2">{item.description}</span>
                        )}
                      </div>
                      {isSelected && <span className="text-[9px] text-text-muted">enter</span>}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div className="px-5 py-2.5 border-t border-white/[0.04] flex items-center gap-4 text-[9px] text-text-muted">
          <span><kbd className="font-mono bg-surface-2 px-1 py-0.5 rounded">arrow keys</kbd> navigate</span>
          <span><kbd className="font-mono bg-surface-2 px-1 py-0.5 rounded">enter</kbd> select</span>
          <span><kbd className="font-mono bg-surface-2 px-1 py-0.5 rounded">esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}

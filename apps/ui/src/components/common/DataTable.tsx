import { useCallback, useEffect, useState } from 'react';
import clsx from 'clsx';

/* ------------------------------------------------------------------ */
/*  Column definition                                                 */
/* ------------------------------------------------------------------ */

export interface Column<T> {
  key: string;
  header: string;
  width?: string;           // e.g. '120px', '20%'
  render: (row: T) => React.ReactNode;
}

/* ------------------------------------------------------------------ */
/*  Props                                                             */
/* ------------------------------------------------------------------ */

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  rowKey: (row: T) => string;
  selectedId?: string | null;
  onRowClick?: (row: T) => void;
  keyboardNav?: boolean;
  /** Render a checkbox column for batch selection */
  selectable?: boolean;
  selectedIds?: Set<string>;
  onSelectionChange?: (ids: Set<string>) => void;
  emptyMessage?: string;
}

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */

export function DataTable<T>({
  columns,
  data,
  rowKey,
  selectedId,
  onRowClick,
  keyboardNav = false,
  selectable = false,
  selectedIds,
  onSelectionChange,
  emptyMessage = 'No data',
}: DataTableProps<T>) {
  const [focusIdx, setFocusIdx] = useState(0);

  // Keyboard navigation
  useEffect(() => {
    if (!keyboardNav) return;

    function handler(e: KeyboardEvent) {
      // Don't capture when typing in inputs
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') return;

      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusIdx((prev) => Math.min(prev + 1, data.length - 1));
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusIdx((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter' && onRowClick && data[focusIdx]) {
        e.preventDefault();
        onRowClick(data[focusIdx]);
      }
    }

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [keyboardNav, data, focusIdx, onRowClick]);

  const toggleRow = useCallback(
    (id: string) => {
      if (!onSelectionChange || !selectedIds) return;
      const next = new Set(selectedIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      onSelectionChange(next);
    },
    [selectedIds, onSelectionChange],
  );

  const toggleAll = useCallback(() => {
    if (!onSelectionChange || !selectedIds) return;
    if (selectedIds.size === data.length) {
      onSelectionChange(new Set());
    } else {
      onSelectionChange(new Set(data.map(rowKey)));
    }
  }, [data, rowKey, selectedIds, onSelectionChange]);

  if (data.length === 0) {
    return (
      <div className="py-16 text-center text-sm text-text-tertiary">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border">
            {selectable && (
              <th className="w-10 px-3 py-2.5 text-left">
                <input
                  type="checkbox"
                  className="rounded border-border text-accent focus:ring-accent cursor-pointer"
                  checked={selectedIds?.size === data.length && data.length > 0}
                  onChange={toggleAll}
                />
              </th>
            )}
            {columns.map((col) => (
              <th
                key={col.key}
                style={col.width ? { width: col.width } : undefined}
                className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-text-tertiary"
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, idx) => {
            const id = rowKey(row);
            const isSelected = selectedId === id;
            const isFocused = keyboardNav && focusIdx === idx;
            const isChecked = selectedIds?.has(id) ?? false;

            return (
              <tr
                key={id}
                onClick={() => onRowClick?.(row)}
                className={clsx(
                  'border-b border-border transition-colors cursor-pointer',
                  isSelected
                    ? 'bg-surface-2 border-l-2 border-l-accent'
                    : 'hover:bg-surface-1 border-l-2 border-l-transparent',
                  isFocused && !isSelected && 'bg-surface-1',
                )}
              >
                {selectable && (
                  <td className="px-3 py-2.5">
                    <input
                      type="checkbox"
                      className="rounded border-border text-accent focus:ring-accent cursor-pointer"
                      checked={isChecked}
                      onChange={(e) => {
                        e.stopPropagation();
                        toggleRow(id);
                      }}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </td>
                )}
                {columns.map((col) => (
                  <td key={col.key} className="px-3 py-2.5 text-text-secondary">
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

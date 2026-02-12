import clsx from 'clsx';
import { IconExternalLink, IconHash, IconClock } from '../icons.tsx';
import { relativeTime, truncateHash } from '../../lib/utils.ts';
import type { MockCitation } from '../../lib/mock-data.ts';

interface CitationsListProps {
  citations: MockCitation[];
}

function citationTypeLabel(type: string): string {
  switch (type) {
    case 'url': return 'URL';
    case 'tool_output': return 'Tool Output';
    case 'file': return 'File';
    default: return 'Other';
  }
}

function citationTypeColor(type: string): string {
  switch (type) {
    case 'url': return 'bg-sky-50 text-sky-700 ring-sky-200';
    case 'tool_output': return 'bg-violet-50 text-violet-700 ring-violet-200';
    case 'file': return 'bg-amber-50 text-amber-700 ring-amber-200';
    default: return 'bg-stone-100 text-stone-600 ring-stone-200';
  }
}

export function CitationsList({ citations }: CitationsListProps) {
  if (citations.length === 0) {
    return (
      <div className="text-xs text-stone-400 italic py-3">
        No citations available
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {citations.map((citation, i) => (
        <div
          key={i}
          className="group/cite rounded-md border border-stone-200 bg-white px-3 py-2 hover:bg-stone-50 transition-colors"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-start gap-2 min-w-0">
              {/* Type badge */}
              <span className={clsx(
                'inline-flex items-center shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset',
                citationTypeColor(citation.type),
              )}>
                {citationTypeLabel(citation.type)}
              </span>

              {/* Ref */}
              <div className="min-w-0">
                <p className="text-xs text-stone-700 font-mono truncate">
                  {citation.ref}
                </p>
                {citation.preview && (
                  <p className="mt-0.5 text-[11px] text-stone-400 line-clamp-1">
                    {citation.preview}
                  </p>
                )}
              </div>
            </div>

            {citation.type === 'url' && (
              <IconExternalLink size={14} className="shrink-0 text-stone-300 group-hover/cite:text-blue-500 transition-colors" />
            )}
          </div>

          {/* Hash + Timestamp */}
          <div className="mt-1 flex items-center gap-3 text-[10px] text-stone-400">
            {citation.hash && (
              <span className="flex items-center gap-1 font-mono">
                <IconHash size={10} />
                {truncateHash(citation.hash, 6)}
              </span>
            )}
            <span className="flex items-center gap-1">
              <IconClock size={10} />
              {relativeTime(citation.timestamp)}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

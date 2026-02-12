/**
 * Vertical timeline of events on a PR.
 *
 * Displays reviews, pushes, CI runs, comments in chronological order.
 * Agent-originated events styled in cyan, human events in amber.
 */

import clsx from 'clsx';

interface PREvent {
  id: string;
  eventType: string;
  actorLogin: string;
  payload: string;
  createdAt: string;
}

interface PREventTimelineProps {
  events: PREvent[];
  agentLogins?: Set<string>;
  className?: string;
}

const EVENT_CONFIG: Record<string, { icon: string; label: string }> = {
  'pull_request.opened': { icon: '📝', label: 'PR Opened' },
  'pull_request.closed': { icon: '🔒', label: 'PR Closed' },
  'pull_request.merged': { icon: '🔀', label: 'PR Merged' },
  'pull_request.reopened': { icon: '🔓', label: 'PR Reopened' },
  'pull_request.synchronize': { icon: '🔄', label: 'PR Synchronized' },
  'pull_request.labeled': { icon: '🏷️', label: 'Label Added' },
  review: { icon: '👀', label: 'Review' },
  comment: { icon: '💬', label: 'Comment' },
  push: { icon: '⬆️', label: 'Push' },
  check_run: { icon: '✅', label: 'Check Run' },
  workflow_run: { icon: '⚙️', label: 'Workflow Run' },
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function parsePayload(payloadStr: string): Record<string, unknown> {
  try {
    return JSON.parse(payloadStr) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function eventDetail(event: PREvent): string {
  const payload = parsePayload(event.payload);

  switch (event.eventType) {
    case 'review': {
      const state = (payload.state as string) ?? 'commented';
      return state === 'changes_requested'
        ? 'Requested changes'
        : state === 'approved'
          ? 'Approved'
          : 'Left a review';
    }
    case 'push':
      return `Pushed ${payload.commitCount ?? '?'} commit(s)`;
    case 'check_run':
    case 'workflow_run': {
      const name = (payload.name as string) ?? 'Unknown';
      const conclusion = (payload.conclusion as string) ?? (payload.status as string) ?? '';
      return `${name}: ${conclusion}`;
    }
    case 'comment': {
      const body = (payload.body as string) ?? '';
      return body.length > 80 ? body.slice(0, 80) + '...' : body;
    }
    default:
      return '';
  }
}

export function PREventTimeline({
  events,
  agentLogins = new Set(),
  className,
}: PREventTimelineProps) {
  if (events.length === 0) {
    return (
      <div className={clsx('text-center text-sm text-gray-500 py-8', className)}>
        No events recorded yet.
      </div>
    );
  }

  return (
    <div className={clsx('relative', className)}>
      {/* Vertical line */}
      <div className="absolute left-4 top-0 bottom-0 w-px bg-gray-800" />

      <div className="space-y-4">
        {events.map((event) => {
          const isAgent = agentLogins.has(event.actorLogin) || event.actorLogin.endsWith('[bot]');
          const config = EVENT_CONFIG[event.eventType] ?? { icon: '📌', label: event.eventType };
          const detail = eventDetail(event);

          return (
            <div key={event.id} className="relative flex gap-4 pl-1">
              {/* Timeline dot */}
              <div
                className={clsx(
                  'relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm',
                  isAgent
                    ? 'bg-cyan-950/70 ring-1 ring-cyan-500/30'
                    : 'bg-gray-800/70 ring-1 ring-gray-600/30',
                )}
              >
                {config.icon}
              </div>

              {/* Content */}
              <div className="min-w-0 flex-1 pt-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-gray-300">
                    {config.label}
                  </span>
                  <span
                    className={clsx(
                      'text-xs font-mono',
                      isAgent ? 'text-cyan-500' : 'text-amber-500',
                    )}
                  >
                    {event.actorLogin}
                  </span>
                  <span className="text-xs text-gray-600">{formatTime(event.createdAt)}</span>
                </div>
                {detail && (
                  <p className="mt-0.5 text-xs text-gray-500 truncate">{detail}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

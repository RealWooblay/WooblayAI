import clsx from 'clsx';

type Status = 'active' | 'running' | 'blocked' | 'idle' | 'stopped' | 'error' | 'provisioning' | 'starting' | 'restarting' | 'stopping';

const STATUS_COLORS: Record<Status, string> = {
  active: 'bg-emerald-400',
  running: 'bg-emerald-400',
  blocked: 'bg-amber-400 animate-breathe',
  idle: 'bg-gray-400',
  stopped: 'bg-gray-500',
  error: 'bg-red-400',
  provisioning: 'bg-blue-400 animate-breathe',
  starting: 'bg-amber-400 animate-breathe',
  restarting: 'bg-amber-400 animate-breathe',
  stopping: 'bg-amber-400 animate-breathe',
};

const STATUS_LABELS: Record<Status, string> = {
  active: 'Active',
  running: 'Running',
  blocked: 'Blocked',
  idle: 'Idle',
  stopped: 'Stopped',
  error: 'Error',
  provisioning: 'Provisioning',
  starting: 'Starting…',
  restarting: 'Restarting…',
  stopping: 'Stopping…',
};

export function StatusDot({ status, showLabel = false, className }: {
  status: string;
  showLabel?: boolean;
  className?: string;
}) {
  const s = (status?.toLowerCase() ?? 'idle') as Status;
  const color = STATUS_COLORS[s] ?? STATUS_COLORS.idle;
  const label = STATUS_LABELS[s] ?? status;

  return (
    <span className={clsx('inline-flex items-center gap-1.5', className)}>
      <span className={clsx('h-2 w-2 rounded-full shrink-0', color)} />
      {showLabel && <span className="text-xs text-text-secondary">{label}</span>}
    </span>
  );
}

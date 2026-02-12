import clsx from 'clsx';
import type { Severity } from '@wooblay/types';

const FINDING_LABELS: Record<string, string> = {
  DESTRUCTIVE_CMD: 'Destructive',
  DOMAIN_DRIFT: 'Drift',
  RETRY_LOOP: 'Retry',
  APPROVAL_BYPASS: 'Bypass',
  READONLY_VIOLATION: 'Write Violation',
  COST_TIME_BASELINE: 'Anomaly',
  HUMAN_INTERVENTION: 'Human',
  IDENTITY_DRIFT: 'Identity',
  CROSS_AGENT_CORRELATION: 'Correlated',
  CANARY_TRIP: 'Canary',
  SPAWN_CHAIN_ANOMALY: 'Spawn',
};

const SEVERITY_STYLES: Record<Severity, string> = {
  CRITICAL: 'bg-red-500/20 text-red-300 border-red-500/40',
  HIGH: 'bg-orange-500/20 text-orange-300 border-orange-500/40',
  MEDIUM: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  LOW: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
  INFO: 'bg-gray-500/20 text-gray-300 border-gray-500/40',
};

interface InsightChipProps {
  code: string;
  severity: Severity;
  message?: string;
  confidence?: number;
  className?: string;
}

export function InsightChip({ code, severity, message, confidence, className }: InsightChipProps) {
  const label = FINDING_LABELS[code] ?? code.toLowerCase().replace(/_/g, ' ');
  const styles = SEVERITY_STYLES[severity] ?? SEVERITY_STYLES.INFO;

  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
        styles,
        className,
      )}
      title={message ?? `${code} (${severity})`}
    >
      <span>{label}</span>
      {confidence !== undefined && (
        <span className="opacity-60">{Math.round(confidence * 100)}%</span>
      )}
    </span>
  );
}

/**
 * Render a list of InsightChips for an array of tags with a severity.
 */
export function InsightChipList({
  tags,
  severity,
  className,
}: {
  tags: string[];
  severity: Severity;
  className?: string;
}) {
  if (!tags || tags.length === 0) return null;

  return (
    <div className={clsx('flex flex-wrap gap-1', className)}>
      {tags.map((tag) => (
        <InsightChip
          key={tag}
          code={tag.toUpperCase().replace(/-/g, '_')}
          severity={severity}
        />
      ))}
    </div>
  );
}

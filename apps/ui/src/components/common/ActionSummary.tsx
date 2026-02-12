import clsx from 'clsx';

/** Extract a human-readable summary from tool call args */
export function humanReadableAction(toolName: string, args: unknown): string {
  if (!args) return toolName;
  const parsed = typeof args === 'string'
    ? (() => { try { return JSON.parse(args); } catch { return null; } })()
    : args;
  if (!parsed || typeof parsed !== 'object') {
    return typeof args === 'string' ? args.slice(0, 120) : toolName;
  }
  const p = parsed as Record<string, unknown>;
  if (p.command) return `$ ${p.command}`;
  if (p.cmd) return `$ ${p.cmd}`;
  if (p.path && toolName.includes('file')) return `${toolName}: ${p.path}`;
  if (p.url) return `${toolName}: ${p.url}`;
  const firstVal = Object.values(p).find((v) => typeof v === 'string' && v.length > 0);
  if (firstVal) return `${toolName}: ${(firstVal as string).slice(0, 100)}`;
  return toolName;
}

interface ActionSummaryProps {
  toolName: string;
  args: unknown;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

export function ActionSummary({ toolName, args, className, size = 'md' }: ActionSummaryProps) {
  const text = humanReadableAction(toolName, args);

  return (
    <code
      className={clsx(
        'font-mono text-text-primary block truncate',
        size === 'sm' && 'text-xs',
        size === 'md' && 'text-sm',
        size === 'lg' && 'text-base',
        className,
      )}
    >
      {text}
    </code>
  );
}

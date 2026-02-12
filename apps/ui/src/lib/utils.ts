/** Shared utility functions */

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 5) return 'just now';
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '...' : s;
}

export function truncatePubkey(s: string): string {
  if (s.length <= 12) return s;
  return s.slice(0, 6) + '\u2026' + s.slice(-4);
}

export function truncateHash(s: string, chars = 8): string {
  if (s.length <= chars * 2) return s;
  return s.slice(0, chars) + '\u2026' + s.slice(-chars);
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.floor((ms % 60_000) / 1000);
  return `${mins}m ${secs}s`;
}

/** Risk tier color classes for dark theme */
export function riskColor(tier: string): { text: string; bg: string } {
  switch (tier.toUpperCase()) {
    case 'READ':
      return { text: 'text-emerald-400', bg: '' };
    case 'WRITE':
      return { text: 'text-amber-400', bg: '' };
    case 'DESTRUCTIVE':
      return { text: 'text-red-400', bg: 'bg-red-500/10' };
    default:
      return { text: 'text-gray-500', bg: '' };
  }
}

/** Status color classes for dark theme */
export function statusColor(status: string): string {
  switch (status.toUpperCase()) {
    case 'PENDING':
    case 'PENDING_APPROVAL':
      return 'text-blue-400';
    case 'APPROVED':
    case 'ALLOW':
    case 'EXECUTE':
    case 'EXECUTED':
      return 'text-emerald-400';
    case 'DENIED':
    case 'DENY':
      return 'text-red-400';
    case 'ROLLED_BACK':
      return 'text-purple-400';
    case 'EXPIRED':
      return 'text-gray-500';
    default:
      return 'text-gray-500';
  }
}

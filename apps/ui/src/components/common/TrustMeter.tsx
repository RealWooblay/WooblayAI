import clsx from 'clsx';

interface TrustMeterProps {
  score: number;       // 0–100
  width?: string;      // CSS width, default '64px'
  showLabel?: boolean;
}

function barColor(score: number): string {
  if (score >= 80) return 'bg-green-500';
  if (score >= 40) return 'bg-amber-500';
  return 'bg-red-500';
}

export function TrustMeter({ score, width = '64px', showLabel = true }: TrustMeterProps) {
  const clamped = Math.max(0, Math.min(100, score));

  return (
    <div className="inline-flex items-center gap-2" style={{ minWidth: width }}>
      <div className="flex-1 h-1.5 rounded-full bg-stone-100 overflow-hidden" style={{ width }}>
        <div
          className={clsx('h-full rounded-full transition-all duration-300', barColor(clamped))}
          style={{ width: `${clamped}%` }}
        />
      </div>
      {showLabel && (
        <span className="text-[11px] font-medium text-stone-500 tabular-nums w-7 text-right">
          {clamped}
        </span>
      )}
    </div>
  );
}

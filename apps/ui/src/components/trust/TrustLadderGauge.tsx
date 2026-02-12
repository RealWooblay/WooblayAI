import clsx from 'clsx';

interface TrustLadderGaugeProps {
  score: number; // 0-100
  level: 'read-only' | 'write-with-approvals' | 'autonomous';
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
}

const LEVELS = [
  { key: 'read-only', label: 'Read Only', threshold: 0, color: 'text-gray-400' },
  { key: 'write-with-approvals', label: 'Write + Approvals', threshold: 40, color: 'text-amber-400' },
  { key: 'autonomous', label: 'Autonomous', threshold: 80, color: 'text-cyan-400' },
] as const;

function getScoreColor(score: number): string {
  if (score >= 80) return '#06b6d4'; // cyan
  if (score >= 60) return '#10b981'; // emerald
  if (score >= 40) return '#f59e0b'; // amber
  return '#ef4444'; // red
}

export function TrustLadderGauge({ score, level, size = 'md', showLabel = true }: TrustLadderGaugeProps) {
  const color = getScoreColor(score);
  const circumference = 2 * Math.PI * 40;
  const dashOffset = circumference * (1 - score / 100);

  const currentLevel = LEVELS.find(l => l.key === level) ?? LEVELS[0];

  const svgSize = size === 'sm' ? 64 : size === 'md' ? 96 : 128;
  const fontSize = size === 'sm' ? 'text-sm' : size === 'md' ? 'text-xl' : 'text-3xl';

  return (
    <div className="flex flex-col items-center gap-2">
      {/* Circular gauge */}
      <div className="relative" style={{ width: svgSize, height: svgSize }}>
        <svg width={svgSize} height={svgSize} viewBox="0 0 100 100" className="-rotate-90">
          {/* Background track */}
          <circle
            cx="50" cy="50" r="40"
            stroke="#1e1e30"
            strokeWidth="6"
            fill="none"
          />
          {/* Score arc */}
          <circle
            cx="50" cy="50" r="40"
            stroke={color}
            strokeWidth="6"
            fill="none"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            className="transition-all duration-1000 ease-out"
            style={{ filter: `drop-shadow(0 0 6px ${color}40)` }}
          />
          {/* Level markers */}
          {LEVELS.map((l) => {
            const angle = (l.threshold / 100) * 360 - 90;
            const rad = (angle * Math.PI) / 180;
            const x = 50 + 40 * Math.cos(rad);
            const y = 50 + 40 * Math.sin(rad);
            return (
              <circle
                key={l.key}
                cx={x} cy={y} r="2"
                fill={l.key === level ? color : '#2d2d4a'}
              />
            );
          })}
        </svg>
        {/* Score number */}
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={clsx('font-bold', fontSize)} style={{ color }}>
            {score}
          </span>
        </div>
      </div>

      {/* Label */}
      {showLabel && (
        <div className="text-center">
          <div className={clsx('text-xs font-semibold', currentLevel.color)}>
            {currentLevel.label}
          </div>
          <div className="text-[10px] text-gray-600 mt-0.5">Trust Score</div>
        </div>
      )}
    </div>
  );
}

// Horizontal bar version for compact displays
export function TrustLadderBar({ score, level }: { score: number; level: string }) {
  const color = getScoreColor(score);
  const currentLevel = LEVELS.find(l => l.key === level) ?? LEVELS[0];

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className={clsx('text-[11px] font-semibold', currentLevel.color)}>
          {currentLevel.label}
        </span>
        <span className="text-[11px] font-mono font-bold" style={{ color }}>
          {score}/100
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-[#1e1e30] overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-1000 ease-out"
          style={{
            width: `${score}%`,
            background: `linear-gradient(90deg, ${color}cc, ${color})`,
            boxShadow: `0 0 8px ${color}40`,
          }}
        />
      </div>
      {/* Level markers */}
      <div className="flex justify-between px-0.5">
        {LEVELS.map((l) => (
          <div key={l.key} className="flex flex-col items-center">
            <div className={clsx(
              'h-1 w-1 rounded-full',
              l.key === level ? 'bg-current' : 'bg-[#2d2d4a]',
            )} style={l.key === level ? { color } : undefined} />
            <span className="text-[9px] text-gray-600 mt-0.5">{l.threshold}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

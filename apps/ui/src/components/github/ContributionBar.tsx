/**
 * Horizontal split bar showing agent vs human contribution ratio.
 *
 * Agent portion in cyan, human portion in amber.
 */

import clsx from 'clsx';

interface ContributionBarProps {
  agentLOC: number;
  humanLOC: number;
  className?: string;
  showLabels?: boolean;
}

export function ContributionBar({
  agentLOC,
  humanLOC,
  className,
  showLabels = true,
}: ContributionBarProps) {
  const total = agentLOC + humanLOC;
  const agentPct = total > 0 ? (agentLOC / total) * 100 : 100;
  const humanPct = total > 0 ? (humanLOC / total) * 100 : 0;

  return (
    <div className={clsx('space-y-2', className)}>
      {/* Bar */}
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-gray-800">
        {agentPct > 0 && (
          <div
            className="bg-cyan-500 transition-all duration-500"
            style={{ width: `${agentPct}%` }}
            title={`Agent: ${agentLOC} LOC (${Math.round(agentPct)}%)`}
          />
        )}
        {humanPct > 0 && (
          <div
            className="bg-amber-500 transition-all duration-500"
            style={{ width: `${humanPct}%` }}
            title={`Human: ${humanLOC} LOC (${Math.round(humanPct)}%)`}
          />
        )}
      </div>

      {/* Labels */}
      {showLabels && (
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-cyan-500" />
            <span className="text-gray-400">
              Agent: <span className="font-medium text-gray-200">{agentLOC.toLocaleString()} LOC</span>
              <span className="text-gray-600 ml-1">({Math.round(agentPct)}%)</span>
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-amber-500" />
            <span className="text-gray-400">
              Human: <span className="font-medium text-gray-200">{humanLOC.toLocaleString()} LOC</span>
              <span className="text-gray-600 ml-1">({Math.round(humanPct)}%)</span>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

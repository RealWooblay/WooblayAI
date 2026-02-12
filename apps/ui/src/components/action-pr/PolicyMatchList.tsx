import clsx from 'clsx';
import { IconShield, IconCheck, IconX, IconClock } from '../icons.tsx';
import type { MockPolicyMatch } from '../../lib/mock-data.ts';

interface PolicyMatchListProps {
  matches: MockPolicyMatch[];
}

function decisionIcon(decision: string) {
  switch (decision.toUpperCase()) {
    case 'ALLOW': return <IconCheck size={12} className="text-green-600" />;
    case 'DENY': return <IconX size={12} className="text-red-600" />;
    case 'APPROVE': return <IconClock size={12} className="text-blue-600" />;
    default: return <IconShield size={12} className="text-stone-400" />;
  }
}

function decisionBorderColor(decision: string): string {
  switch (decision.toUpperCase()) {
    case 'ALLOW': return 'border-l-green-500';
    case 'DENY': return 'border-l-red-500';
    case 'APPROVE': return 'border-l-blue-500';
    default: return 'border-l-stone-300';
  }
}

export function PolicyMatchList({ matches }: PolicyMatchListProps) {
  if (matches.length === 0) {
    return (
      <div className="text-xs text-stone-400 italic py-3">
        No policies matched
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {matches.map((match, i) => (
        <div
          key={i}
          className={clsx(
            'rounded-md border border-stone-200 border-l-2 bg-white px-3 py-2',
            decisionBorderColor(match.decision),
          )}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {decisionIcon(match.decision)}
              <span className="text-xs font-semibold text-stone-800">
                {match.decision}
              </span>
              <span className="text-[10px] text-stone-400 font-mono">
                P{match.priority}
              </span>
            </div>
            <span className="text-[10px] font-mono text-stone-400">
              {match.policyId}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-3 text-[11px] text-stone-400">
            <span className="font-mono">
              tool: <span className="text-stone-600">{match.matchTool}</span>
            </span>
            <span className="font-mono">
              risk: <span className="text-stone-600">{match.riskTier}</span>
            </span>
          </div>
          <p className="mt-1 text-[11px] text-stone-500 leading-relaxed">
            {match.reason}
          </p>
        </div>
      ))}
    </div>
  );
}

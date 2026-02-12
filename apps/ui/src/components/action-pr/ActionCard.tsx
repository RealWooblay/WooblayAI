import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { Card } from '../common/Card.tsx';
import { RiskPill } from './RiskPill.tsx';
import { ActionStatusBadge } from './ActionStatusBadge.tsx';
import { AgentIdentityBadge } from './AgentIdentityBadge.tsx';
import { Badge } from '../common/Badge.tsx';
import { Button } from '../common/Button.tsx';
import { IconCheck, IconX, IconEye, IconClock, IconHash, IconGitBranch } from '../icons.tsx';
import { relativeTime } from '../../lib/utils.ts';
import type { MockActionPR } from '../../lib/mock-data.ts';

interface ActionCardProps {
  action: MockActionPR;
  selected?: boolean;
  onApprove?: (id: string) => void;
  onDeny?: (id: string) => void;
  compact?: boolean;
}

export function ActionCard({ action, selected, onApprove, onDeny, compact }: ActionCardProps) {
  const isPending = action.status === 'pending';

  return (
    <Card
      hover
      className={clsx(
        'group animate-slide-in relative',
        selected && 'ring-1 ring-blue-500/40',
        isPending && 'border-l-2 border-l-blue-500',
        action.status === 'denied' && 'border-l-2 border-l-red-400 opacity-80',
        action.status === 'rolled_back' && 'border-l-2 border-l-stone-400',
      )}
    >
      {/* Top row: Agent + Status + Risk */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <AgentIdentityBadge
            agentId={action.agentId}
            agentName={action.agentName}
            agentPubkey={action.agentPubkey}
            showPubkey={!compact}
          />
          <RiskPill tier={action.riskTier} />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <ActionStatusBadge status={action.status} />
        </div>
      </div>

      {/* Title + Summary */}
      <div className="mt-3">
        <Link
          to={`/actions/${action.id}`}
          className="text-sm font-semibold text-stone-900 hover:text-blue-700 transition-colors leading-snug no-underline"
        >
          {action.title}
        </Link>
        {!compact && (
          <p className="mt-1 text-xs text-stone-500 leading-relaxed line-clamp-2">
            {action.summary}
          </p>
        )}
      </div>

      {/* Command preview */}
      {action.command && !compact && (
        <pre className="mt-3 rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-xs font-mono text-stone-600 overflow-x-auto">
          <span className="text-stone-400 select-none">$ </span>
          {action.command.length > 100 ? action.command.slice(0, 100) + '...' : action.command}
        </pre>
      )}

      {/* Meta row */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-stone-500">
        <span className="flex items-center gap-1">
          <IconGitBranch size={12} />
          <span className="font-mono text-stone-600">{action.toolName}</span>
        </span>

        {action.adapter && (
          <Badge variant={action.adapter === 'openclaw-plugin' ? 'blue' : action.adapter === 'mcp-toolhost' ? 'indigo' : 'orange'}>
            {action.adapter === 'openclaw-plugin' ? 'OpenClaw' : action.adapter === 'mcp-toolhost' ? 'MCP' : 'HTTP SDK'}
          </Badge>
        )}

        <span className="flex items-center gap-1">
          <IconHash size={12} />
          {action.evidenceCount} citations
        </span>

        {action.requiredApprovals > 0 && (
          <span className="flex items-center gap-1">
            <IconCheck size={12} />
            {action.currentApprovals}/{action.requiredApprovals} approvals
          </span>
        )}

        <span className="flex items-center gap-1">
          <IconClock size={12} />
          {relativeTime(action.createdAt)}
        </span>

        {action.rollbackAvailable && (
          <span className="text-stone-400 text-[10px] uppercase tracking-wider font-semibold">
            rollback ready
          </span>
        )}
      </div>

      {/* Quick actions for pending */}
      {isPending && (
        <div className="mt-3 flex items-center gap-2 pt-3 border-t border-stone-100">
          {onApprove && (
            <Button size="xs" variant="primary" onClick={(e) => { e.preventDefault(); onApprove(action.id); }}>
              <IconCheck size={14} />
              Approve
            </Button>
          )}
          {onDeny && (
            <Button size="xs" variant="danger" onClick={(e) => { e.preventDefault(); onDeny(action.id); }}>
              <IconX size={14} />
              Deny
            </Button>
          )}
          <Link
            to={`/actions/${action.id}`}
            className="ml-auto inline-flex items-center gap-1 text-[11px] text-stone-500 hover:text-blue-600 transition-colors no-underline"
            onClick={(e) => e.stopPropagation()}
          >
            <IconEye size={14} />
            Review
          </Link>
        </div>
      )}
    </Card>
  );
}

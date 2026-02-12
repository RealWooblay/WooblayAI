import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import clsx from 'clsx';
import { Card } from '../../components/common/Card.tsx';
import { Button } from '../../components/common/Button.tsx';
import { Badge } from '../../components/common/Badge.tsx';
import { RiskPill } from '../../components/action-pr/RiskPill.tsx';
import { ActionStatusBadge } from '../../components/action-pr/ActionStatusBadge.tsx';
import { AgentIdentityBadge } from '../../components/action-pr/AgentIdentityBadge.tsx';
import { ActionDiffViewer } from '../../components/action-pr/ActionDiffViewer.tsx';
import { CitationsList } from '../../components/action-pr/CitationsList.tsx';
import { PolicyMatchList } from '../../components/action-pr/PolicyMatchList.tsx';
import { TimelineStepper } from '../../components/timeline/TimelineStepper.tsx';
import {
  IconCheck,
  IconX,
  IconClock,
  IconHash,
  IconChevronDown,
} from '../../components/icons.tsx';
import { getMockActionPR } from '../../lib/mock-data.ts';
import { truncateHash } from '../../lib/utils.ts';

export function ActionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const action = getMockActionPR(id ?? '');
  const [approveReason, setApproveReason] = useState('');
  const [showApproveForm, setShowApproveForm] = useState(false);
  const [trailExpanded, setTrailExpanded] = useState(false);

  if (!action) {
    return (
      <div className="flex items-center justify-center py-20 text-stone-400">
        Action PR not found
      </div>
    );
  }

  const isPending = action.status === 'pending';

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* Header bar */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <Link to="/" className="text-xs text-stone-400 hover:text-stone-600 transition-colors no-underline">
              Feed
            </Link>
            <span className="text-stone-300">/</span>
            <span className="text-xs text-stone-600 font-mono">{action.id}</span>
          </div>
          <h1 className="text-xl font-bold text-stone-900">{action.title}</h1>
          <p className="text-sm text-stone-500 leading-relaxed max-w-2xl">{action.summary}</p>
          <div className="flex items-center gap-3 pt-1">
            <AgentIdentityBadge
              agentId={action.agentId}
              agentName={action.agentName}
              agentPubkey={action.agentPubkey}
              size="md"
            />
            <RiskPill tier={action.riskTier} size="md" />
            <ActionStatusBadge status={action.status} size="md" />
          </div>
        </div>

        {/* Approve / Deny actions */}
        {isPending && (
          <div className="flex flex-col gap-2 shrink-0">
            <Button onClick={() => setShowApproveForm(!showApproveForm)}>
              <IconCheck size={16} />
              Approve
            </Button>
            <Button variant="danger">
              <IconX size={16} />
              Deny
            </Button>
          </div>
        )}
      </div>

      {/* Approve form */}
      {showApproveForm && isPending && (
        <Card className="space-y-3 ring-1 ring-blue-200">
          <h3 className="text-sm font-semibold text-stone-800">Approve Action</h3>
          <textarea
            value={approveReason}
            onChange={e => setApproveReason(e.target.value)}
            placeholder="Reason for approval (optional)..."
            rows={2}
            className="w-full rounded-lg border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-700 placeholder-stone-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <label className="text-[11px] text-stone-500">Constraint:</label>
              <select className="rounded-md border border-stone-200 bg-white px-2 py-1 text-xs text-stone-600 focus:outline-none focus:ring-1 focus:ring-blue-500">
                <option value="">None</option>
                <option value="once">Allow once</option>
                <option value="spend_cap">Spend cap</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-[11px] text-stone-500">TTL:</label>
              <select className="rounded-md border border-stone-200 bg-white px-2 py-1 text-xs text-stone-600 focus:outline-none focus:ring-1 focus:ring-blue-500">
                <option value="300">5 minutes</option>
                <option value="600">10 minutes</option>
                <option value="1800">30 minutes</option>
                <option value="3600">1 hour</option>
              </select>
            </div>
            <div className="flex-1" />
            <Button size="sm">Confirm Approval</Button>
            <Button size="sm" variant="ghost" onClick={() => setShowApproveForm(false)}>Cancel</Button>
          </div>
        </Card>
      )}

      {/* Main 3-column layout */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* LEFT: Diff View */}
        <div className="lg:col-span-5 space-y-4">
          <Card className="space-y-4">
            <div className="flex items-center gap-2">
              <div className="h-5 w-1 rounded-full bg-blue-500" />
              <h3 className="text-sm font-semibold text-stone-800">Proposed Change</h3>
            </div>
            <ActionDiffViewer action={action} />
          </Card>
        </div>

        {/* MIDDLE: Evidence */}
        <div className="lg:col-span-4 space-y-4">
          <Card className="space-y-4">
            <div className="flex items-center gap-2">
              <div className="h-5 w-1 rounded-full bg-violet-500" />
              <h3 className="text-sm font-semibold text-stone-800">Evidence</h3>
            </div>
            <CitationsList citations={action.citations} />
          </Card>
        </div>

        {/* RIGHT: Risk + Policy */}
        <div className="lg:col-span-3 space-y-4">
          <Card className="space-y-4">
            <div className="flex items-center gap-2">
              <div className="h-5 w-1 rounded-full bg-amber-500" />
              <h3 className="text-sm font-semibold text-stone-800">Risk & Policy</h3>
            </div>

            {/* Risk summary */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-stone-500">Risk Tier</span>
                <RiskPill tier={action.riskTier} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-stone-500">Approvals</span>
                <span className="text-xs text-stone-700">
                  {action.currentApprovals}/{action.requiredApprovals} required
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-stone-500">Idempotency Key</span>
                <span className="text-[10px] font-mono text-stone-400">
                  {truncateHash(action.idempotencyKey, 8)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-stone-500">Rollback</span>
                {action.rollbackAvailable ? (
                  <Badge variant="purple">Available</Badge>
                ) : (
                  <span className="text-[11px] text-stone-400">N/A</span>
                )}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-stone-500">TTL</span>
                <span className="text-xs text-stone-500 flex items-center gap-1">
                  <IconClock size={12} />
                  {action.ttlSeconds}s
                </span>
              </div>
            </div>

            <div className="border-t border-stone-200 pt-3">
              <PolicyMatchList matches={action.policyMatches} />
            </div>
          </Card>

          {/* Receipt link */}
          {action.receiptHash && (
            <Card className="!p-3">
              <Link
                to={`/receipts/${action.receiptHash}`}
                className="flex items-center gap-2 text-xs text-stone-500 hover:text-blue-600 transition-colors no-underline"
              >
                <IconHash size={14} />
                <span className="font-mono">{truncateHash(action.receiptHash, 8)}</span>
                <span className="ml-auto text-[10px] text-stone-400">View Receipt →</span>
              </Link>
            </Card>
          )}
        </div>
      </div>

      {/* BOTTOM: Decision Trail */}
      <Card className="space-y-4">
        <button
          onClick={() => setTrailExpanded(!trailExpanded)}
          className="flex w-full items-center gap-2 cursor-pointer bg-transparent border-none p-0"
        >
          <div className="h-5 w-1 rounded-full bg-green-500" />
          <h3 className="text-sm font-semibold text-stone-800">Decision Trail</h3>
          <IconChevronDown
            size={16}
            className={clsx(
              'text-stone-400 transition-transform ml-auto',
              trailExpanded && 'rotate-180',
            )}
          />
        </button>

        {/* Always visible: Plan + Reason */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="rounded-md border border-stone-200 bg-stone-50 p-4">
            <h5 className="text-[10px] font-semibold uppercase tracking-wider text-stone-500 mb-1.5">Plan Summary</h5>
            <p className="text-xs text-stone-700 leading-relaxed">
              {action.decisionTrail.plan_summary}
            </p>
          </div>
          <div className="rounded-md border border-stone-200 bg-stone-50 p-4">
            <h5 className="text-[10px] font-semibold uppercase tracking-wider text-stone-500 mb-1.5">Reason Summary</h5>
            <p className="text-xs text-stone-700 leading-relaxed">
              {action.decisionTrail.reason_summary}
            </p>
          </div>
        </div>

        {/* Expandable: Tool calls */}
        {trailExpanded && (
          <div className="pt-2">
            <TimelineStepper steps={action.decisionTrail.tool_calls} />
          </div>
        )}
      </Card>
    </div>
  );
}

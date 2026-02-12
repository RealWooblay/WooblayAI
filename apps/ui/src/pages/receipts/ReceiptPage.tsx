import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useReceipt, useVerifyReceipt } from '../../api/hooks/useReceipts.ts';
// getTaskAnalysis available for future use
import { Badge, riskTierVariant, statusVariant } from '../../components/common/Badge.tsx';
import { Card } from '../../components/common/Card.tsx';
import { AnalysisPanel } from '../../components/analysis/AnalysisPanel.tsx';
import type { Analysis } from '@wooblay/types';
import clsx from 'clsx';

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function Collapsible({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-gray-800 pt-3">
      <button
        className="flex w-full items-center justify-between text-sm font-medium text-gray-300 hover:text-gray-100"
        onClick={() => setOpen(!open)}
      >
        {title}
        <span className="text-gray-500">{open ? '▴' : '▾'}</span>
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
}

function ReceiptAnalysisSection({ receiptId }: { receiptId: string }) {
  // We query all analyses that reference this receipt ID
  // The API doesn't have a direct receiptId endpoint, so we use the ID
  const { data: analyses } = useQuery({
    queryKey: ['analysis', 'receipt', receiptId],
    queryFn: async () => {
      // Use a GET to the task analysis endpoint with a workaround
      // or directly query by receipt ID. For now, use the receipt-level query.
      const res = await fetch(`/api/tasks/${receiptId}/analysis`);
      if (!res.ok) return [];
      return res.json() as Promise<Analysis[]>;
    },
    refetchInterval: 30_000,
  });

  if (!analyses || analyses.length === 0) return null;

  return (
    <Collapsible title="Analysis" defaultOpen>
      <AnalysisPanel analyses={analyses} />
    </Collapsible>
  );
}

export function ReceiptPage() {
  const { hash } = useParams<{ hash: string }>();
  const { data: receipt, isLoading, error } = useReceipt(hash);
  const { data: verification } = useVerifyReceipt(hash);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-gray-500">
        Loading receipt…
      </div>
    );
  }

  if (error || !receipt) {
    return (
      <div className="flex items-center justify-center py-20 text-red-400">
        {error ? (error as Error).message : 'Receipt not found'}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-100">Receipt</h2>
        {verification && (
          <Badge variant={verification.valid ? 'green' : 'red'}>
            {verification.valid ? 'Signature Verified' : 'Invalid Signature'}
          </Badge>
        )}
      </div>

      {/* Overview */}
      <Card className="space-y-3">
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <div>
            <span className="text-gray-500">Hash</span>
            <p className="font-mono text-xs text-gray-200 break-all">{receipt.hash}</p>
          </div>
          <div>
            <span className="text-gray-500">Tool</span>
            <p className="font-mono text-gray-200">{receipt.toolName}</p>
          </div>
          <div>
            <span className="text-gray-500">Risk Tier</span>
            <div className="mt-0.5">
              <Badge variant={riskTierVariant(receipt.riskTier)}>{receipt.riskTier}</Badge>
            </div>
          </div>
          <div>
            <span className="text-gray-500">Policy Decision</span>
            <div className="mt-0.5">
              <Badge variant={statusVariant(receipt.policyDecision)}>
                {receipt.policyDecision}
              </Badge>
            </div>
          </div>
          <div>
            <span className="text-gray-500">Agent Pubkey</span>
            <p className="font-mono text-xs text-gray-200">
              {truncate(receipt.agentPubkey, 32)}
            </p>
          </div>
          <div>
            <span className="text-gray-500">Timestamp</span>
            <p className="text-gray-200">
              {new Date(receipt.timestamp).toLocaleString()}
            </p>
          </div>
        </div>

        {receipt.approvalDecision && (
          <div>
            <span className="text-sm text-gray-500">Approval</span>
            <div className="mt-0.5 flex items-center gap-2">
              <Badge variant={statusVariant(receipt.approvalDecision)}>
                {receipt.approvalDecision}
              </Badge>
              {receipt.approver && (
                <span className="text-xs text-gray-400">by {receipt.approver}</span>
              )}
            </div>
          </div>
        )}
      </Card>

      {/* Decision Trail */}
      <Card className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-200">Decision Trail</h3>

        <div className="space-y-2 text-sm">
          <div>
            <span className="text-gray-500">Plan Summary</span>
            <p className="text-gray-300">{receipt.decisionTrail.plan_summary}</p>
          </div>
          <div>
            <span className="text-gray-500">Reason Summary</span>
            <p className="text-gray-300">{receipt.decisionTrail.reason_summary}</p>
          </div>
        </div>

        {receipt.decisionTrail.citations.length > 0 && (
          <div>
            <span className="text-sm text-gray-500">Citations</span>
            <ul className="mt-1 space-y-1">
              {receipt.decisionTrail.citations.map((c, i) => (
                <li key={i} className="flex items-center gap-2 text-xs">
                  <Badge variant="blue" className="text-[10px]">
                    {c.type}
                  </Badge>
                  <span className="font-mono text-gray-300">{truncate(c.ref, 60)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      {/* Execution Summary */}
      {receipt.executionSummary && (
        <Collapsible title="Execution Summary" defaultOpen>
          <Card>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <span className="text-gray-500">Status</span>
                <p className="text-gray-200">{receipt.executionSummary.status}</p>
              </div>
              <div>
                <span className="text-gray-500">Exit Code</span>
                <p className="text-gray-200">{receipt.executionSummary.exitCode ?? '—'}</p>
              </div>
              <div>
                <span className="text-gray-500">Duration</span>
                <p className="text-gray-200">{receipt.executionSummary.durationMs}ms</p>
              </div>
            </div>
            {receipt.executionSummary.stdoutPreview && (
              <pre className="mt-3 max-h-40 overflow-auto rounded bg-gray-800 p-3 text-xs text-gray-300">
                {receipt.executionSummary.stdoutPreview}
              </pre>
            )}
          </Card>
        </Collapsible>
      )}

      {/* Analysis */}
      <ReceiptAnalysisSection receiptId={receipt.id} />

      {/* Signature */}
      <Collapsible title="Signature &amp; Chain">
        <Card className="space-y-2 text-xs">
          <div>
            <span className="text-gray-500">Signature</span>
            <p className="font-mono text-gray-300 break-all">{receipt.signature}</p>
          </div>
          <div>
            <span className="text-gray-500">Chain Previous</span>
            {receipt.chainPrev ? (
              <Link
                to={`/receipts/${receipt.chainPrev}`}
                className="block font-mono text-indigo-400 hover:text-indigo-300"
              >
                {receipt.chainPrev}
              </Link>
            ) : (
              <p className="text-gray-600">Genesis (no previous)</p>
            )}
          </div>
        </Card>
      </Collapsible>

      {/* Raw JSON */}
      <Collapsible title="Raw JSON">
        <pre
          className={clsx(
            'max-h-96 overflow-auto rounded-md bg-gray-800 p-4 text-xs text-gray-300',
          )}
        >
          {JSON.stringify(receipt, null, 2)}
        </pre>
      </Collapsible>
    </div>
  );
}

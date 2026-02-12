/**
 * Receipt bridge panel — shows receipt coverage and links to individual receipts.
 *
 * Displays "X of Y agent changes backed by supervised tool calls" and
 * provides clickable links to the existing receipt detail pages.
 */

import { Link } from 'react-router-dom';
import { Card } from '../common/Card.tsx';
import { Badge } from '../common/Badge.tsx';

interface TaskLink {
  id: string;
  taskId: string;
  receiptHashes: string[] | null;
  createdAt: string;
}

interface ReceiptBridgePanelProps {
  receiptCoverage: number | null;
  taskLinks: TaskLink[];
  className?: string;
}

function coverageVariant(coverage: number | null): 'green' | 'yellow' | 'red' | 'gray' {
  if (coverage === null) return 'gray';
  if (coverage >= 0.8) return 'green';
  if (coverage >= 0.5) return 'yellow';
  return 'red';
}

function truncateHash(hash: string): string {
  if (hash.length <= 16) return hash;
  return hash.slice(0, 8) + '...' + hash.slice(-6);
}

export function ReceiptBridgePanel({
  receiptCoverage,
  taskLinks,
  className,
}: ReceiptBridgePanelProps) {
  const allHashes = taskLinks.flatMap((l) => l.receiptHashes ?? []);
  const uniqueHashes = [...new Set(allHashes)];

  return (
    <Card className={className}>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-200">Receipt Coverage</h3>
          <Badge variant={coverageVariant(receiptCoverage)}>
            {receiptCoverage !== null
              ? `${Math.round(receiptCoverage * 100)}%`
              : 'No task links'}
          </Badge>
        </div>

        {/* Coverage bar */}
        {receiptCoverage !== null && (
          <div className="space-y-1">
            <div className="h-2 w-full overflow-hidden rounded-full bg-gray-800">
              <div
                className={`h-full transition-all duration-500 ${
                  receiptCoverage >= 0.8
                    ? 'bg-emerald-500'
                    : receiptCoverage >= 0.5
                      ? 'bg-amber-500'
                      : 'bg-red-500'
                }`}
                style={{ width: `${Math.round(receiptCoverage * 100)}%` }}
              />
            </div>
            <p className="text-xs text-gray-500">
              Agent changes backed by supervised tool calls
            </p>
          </div>
        )}

        {/* Task links */}
        {taskLinks.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-medium text-gray-400">Linked Tasks</h4>
            {taskLinks.map((link) => (
              <div
                key={link.id}
                className="flex items-center gap-2 text-xs text-gray-500"
              >
                <span className="font-mono text-gray-300">{link.taskId}</span>
                <span className="text-gray-700">|</span>
                <span>{(link.receiptHashes ?? []).length} receipts</span>
              </div>
            ))}
          </div>
        )}

        {/* Receipt hashes */}
        {uniqueHashes.length > 0 && (
          <div className="space-y-1.5">
            <h4 className="text-xs font-medium text-gray-400">
              Linked Receipts ({uniqueHashes.length})
            </h4>
            <div className="flex flex-wrap gap-1.5">
              {uniqueHashes.slice(0, 10).map((hash) => (
                <Link
                  key={hash}
                  to={`/receipts/${hash}`}
                  className="rounded bg-gray-800/80 px-2 py-1 font-mono text-[10px] text-indigo-400 hover:text-indigo-300 hover:bg-gray-700/80 transition-colors"
                >
                  {truncateHash(hash)}
                </Link>
              ))}
              {uniqueHashes.length > 10 && (
                <span className="rounded bg-gray-800/80 px-2 py-1 text-[10px] text-gray-500">
                  +{uniqueHashes.length - 10} more
                </span>
              )}
            </div>
          </div>
        )}

        {/* Empty state */}
        {taskLinks.length === 0 && (
          <p className="text-xs text-gray-600">
            No task links. Use <code className="text-gray-400">Wooblay-Task-Id</code> commit
            trailers or <code className="text-gray-400">/wooblay link &lt;taskId&gt;</code> comments
            to link this PR to Wooblay tasks.
          </p>
        )}
      </div>
    </Card>
  );
}

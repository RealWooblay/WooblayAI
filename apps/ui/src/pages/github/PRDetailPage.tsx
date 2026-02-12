/**
 * PR Detail Page — full attribution view for a single agent PR.
 *
 * Shows:
 *   - Attribution panel (contribution bar, score, factors)
 *   - Event timeline
 *   - Receipt bridge panel
 *   - Commit breakdown table
 */

import { useParams, Link } from 'react-router-dom';
import { useGitHubAttribution } from '../../api/hooks/useGitHub.ts';
import { Card } from '../../components/common/Card.tsx';
import { Badge } from '../../components/common/Badge.tsx';
import { Spinner } from '../../components/common/Spinner.tsx';
import { AttributionPanel } from '../../components/github/AttributionPanel.tsx';
import { PREventTimeline } from '../../components/github/PREventTimeline.tsx';
import { ReceiptBridgePanel } from '../../components/github/ReceiptBridgePanel.tsx';
import { InterventionBadge } from '../../components/github/InterventionBadge.tsx';

function truncateSha(sha: string): string {
  return sha.slice(0, 7);
}

export function PRDetailPage() {
  const { repoId, number } = useParams<{ repoId: string; number: string }>();
  const prNumber = parseInt(number ?? '0', 10);

  const { data, isLoading, error } = useGitHubAttribution(repoId ?? '', prNumber);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-5xl py-20 text-center text-red-400">
        Error: {(error as Error).message}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-5xl py-20 text-center text-gray-500">
        PR not found.
      </div>
    );
  }

  const { pr, attribution, commits, events, checkResults, taskLinks, metrics } = data;

  // Determine which logins are agent logins
  const agentLogins = new Set(
    commits.filter((c) => c.isAgent).map((c) => c.authorLogin),
  );

  const stateVariant =
    pr.state === 'merged' ? 'green' : pr.state === 'closed' ? 'red' : 'cyan';

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <Link to="/github" className="hover:text-gray-300 transition-colors">
          GitHub
        </Link>
        <span>/</span>
        <span className="text-gray-300">PR #{pr.number}</span>
      </div>

      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-gray-100">{pr.title}</h1>
            <p className="text-sm text-gray-500 mt-1">
              #{pr.number} &middot; {pr.authorLogin} &middot; {pr.headBranch ?? 'unknown'} &rarr;{' '}
              {pr.baseBranch ?? 'main'}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge variant={stateVariant}>{pr.state}</Badge>
            {pr.detectionMode && (
              <Badge variant="gray">{pr.detectionMode}</Badge>
            )}
            {attribution && (
              <InterventionBadge score={attribution.interventionScore} />
            )}
          </div>
        </div>
      </div>

      {/* Attribution panel */}
      {attribution ? (
        <AttributionPanel
          agentLOC={attribution.agentLOC}
          humanLOC={attribution.humanLOC}
          agentCommitCount={attribution.agentCommitShas.length}
          humanCommitCount={attribution.humanCommitShas.length}
          interventionScore={attribution.interventionScore}
          interventionBreakdown={attribution.interventionBreakdown}
          receiptCoverage={attribution.receiptCoverage}
          timeToMergeHours={metrics.timeToMergeHours}
          reviewCycles={metrics.reviewCycles}
          ciFailureCount={metrics.ciFailureCount}
        />
      ) : (
        <Card className="py-8 text-center text-gray-500">
          Attribution has not been computed for this PR yet.
        </Card>
      )}

      {/* Two-column layout: Timeline + Receipt Bridge */}
      <div className="grid gap-6 lg:grid-cols-5">
        {/* Timeline (wider) */}
        <div className="lg:col-span-3 space-y-3">
          <h2 className="text-sm font-semibold text-gray-300">Event Timeline</h2>
          <Card>
            <PREventTimeline events={events} agentLogins={agentLogins} />
          </Card>
        </div>

        {/* Receipt bridge (narrower) */}
        <div className="lg:col-span-2 space-y-3">
          <h2 className="text-sm font-semibold text-gray-300">Receipts</h2>
          <ReceiptBridgePanel
            receiptCoverage={attribution?.receiptCoverage ?? null}
            taskLinks={taskLinks}
          />
        </div>
      </div>

      {/* Commits table */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-300">
          Commits ({commits.length})
        </h2>
        <Card className="overflow-hidden !p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-800 text-gray-500">
                  <th className="px-4 py-3 text-left font-medium">SHA</th>
                  <th className="px-4 py-3 text-left font-medium">Author</th>
                  <th className="px-4 py-3 text-left font-medium">Message</th>
                  <th className="px-4 py-3 text-right font-medium">+/-</th>
                  <th className="px-4 py-3 text-center font-medium">Source</th>
                </tr>
              </thead>
              <tbody>
                {commits.map((commit) => (
                  <tr
                    key={commit.id}
                    className="border-b border-gray-800/50 hover:bg-gray-900/30 transition-colors"
                  >
                    <td className="px-4 py-2.5 font-mono text-gray-400">
                      {truncateSha(commit.sha)}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={
                          commit.isAgent ? 'text-cyan-400' : 'text-amber-400'
                        }
                      >
                        {commit.authorLogin}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-gray-300 max-w-xs truncate">
                      {commit.message.split('\n')[0]}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono">
                      <span className="text-emerald-400">+{commit.linesAdded}</span>
                      {' / '}
                      <span className="text-red-400">-{commit.linesRemoved}</span>
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <Badge variant={commit.isAgent ? 'cyan' : 'orange'}>
                        {commit.isAgent ? 'Agent' : 'Human'}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {/* CI Results */}
      {checkResults.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-300">
            CI Results ({checkResults.length})
          </h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {checkResults.map((check) => {
              const variant =
                check.conclusion === 'success'
                  ? 'green'
                  : check.conclusion === 'failure'
                    ? 'red'
                    : check.conclusion === 'neutral'
                      ? 'gray'
                      : 'yellow';
              return (
                <Card key={check.id} className="!p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-300 font-medium truncate">
                      {check.checkName}
                    </span>
                    <Badge variant={variant}>
                      {check.conclusion ?? check.status}
                    </Badge>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

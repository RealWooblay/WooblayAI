import { useState } from 'react';
import type { Analysis, Finding, CausalChainNode, Severity } from '@wooblay/types';
import { Card } from '../common/Card.tsx';
import { Badge } from '../common/Badge.tsx';
import { InsightChip } from './InsightChip.tsx';
import clsx from 'clsx';

function severityVariant(severity: string): 'red' | 'yellow' | 'blue' | 'gray' | 'green' {
  switch (severity) {
    case 'CRITICAL': return 'red';
    case 'HIGH': return 'yellow';
    case 'MEDIUM': return 'yellow';
    case 'LOW': return 'blue';
    default: return 'gray';
  }
}

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = pct >= 80 ? '#ef4444' : pct >= 50 ? '#f59e0b' : '#06b6d4';
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 rounded-full bg-gray-800 overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <span className="text-[10px] text-gray-400">{pct}%</span>
    </div>
  );
}

function FindingRow({ finding }: { finding: Finding }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border-b border-gray-800/50 py-2 last:border-0">
      <button
        className="flex w-full items-center gap-2 text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <InsightChip code={finding.code} severity={findingSeverity(finding)} confidence={finding.confidence} />
        <span className="flex-1 text-xs text-gray-300 truncate">{finding.message}</span>
        <span className="text-gray-600 text-xs">{expanded ? '▴' : '▾'}</span>
      </button>

      {expanded && (
        <div className="mt-2 ml-2 space-y-1 text-xs text-gray-400">
          <div>Suggested action: <span className="text-gray-200">{finding.suggestedAction}</span></div>
          <div>Confidence: <ConfidenceBar value={finding.confidence} /></div>
          {finding.evidenceRefs.length > 0 && (
            <div>
              Evidence: {finding.evidenceRefs.map((r, i) => (
                <span key={i} className="font-mono text-indigo-400">{r.slice(0, 12)}…{i < finding.evidenceRefs.length - 1 ? ', ' : ''}</span>
              ))}
            </div>
          )}
          <div>Detected: {new Date(finding.detectedAt).toLocaleString()}</div>
        </div>
      )}
    </div>
  );
}

function CausalChainViz({ chain }: { chain: CausalChainNode[] }) {
  return (
    <div className="space-y-1">
      {chain.map((node, i) => {
        const icon = node.verdict === 'malicious' ? 'X' : node.verdict === 'suspicious' ? '!' : '-';
        const color = node.verdict === 'malicious' ? 'text-red-400' : node.verdict === 'suspicious' ? 'text-amber-400' : 'text-gray-400';

        return (
          <div key={node.receiptHash} className="flex items-start gap-2">
            <div className="flex flex-col items-center">
              <span className={clsx('flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-bold', color, `border-current`)}>
                {icon}
              </span>
              {i < chain.length - 1 && <div className="h-3 w-px bg-gray-700" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-gray-300 truncate">{node.action}</p>
              <p className="text-[10px] text-gray-500">{new Date(node.timestamp).toLocaleTimeString()}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function findingSeverity(finding: Finding): Severity {
  switch (finding.code) {
    case 'CANARY_TRIP':
    case 'APPROVAL_BYPASS':
      return 'CRITICAL';
    case 'DESTRUCTIVE_CMD':
      return finding.confidence >= 0.9 ? 'CRITICAL' : 'HIGH';
    case 'RETRY_LOOP':
    case 'READONLY_VIOLATION':
    case 'IDENTITY_DRIFT':
    case 'CROSS_AGENT_CORRELATION':
    case 'SPAWN_CHAIN_ANOMALY':
      return 'HIGH';
    case 'DOMAIN_DRIFT':
    case 'COST_TIME_BASELINE':
      return 'MEDIUM';
    case 'HUMAN_INTERVENTION':
      return 'LOW';
    default:
      return 'INFO';
  }
}

interface AnalysisPanelProps {
  analyses: Analysis[];
}

export function AnalysisPanel({ analyses }: AnalysisPanelProps) {
  const [briefOpen, setBriefOpen] = useState(false);

  if (analyses.length === 0) {
    return (
      <Card className="py-4 text-center text-sm text-gray-500">
        No analysis findings for this receipt.
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {analyses.map((analysis) => (
        <Card key={analysis.id} className="space-y-3">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Badge variant={severityVariant(analysis.severity)}>{analysis.severity}</Badge>
              <span className="text-xs text-gray-400">{new Date(analysis.createdAt).toLocaleString()}</span>
            </div>
          </div>

          {/* Summary */}
          <pre className="whitespace-pre-wrap text-xs text-gray-300 leading-relaxed">{analysis.summary}</pre>

          {/* Tags */}
          {analysis.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {analysis.tags.map((tag) => (
                <InsightChip
                  key={tag}
                  code={tag.toUpperCase().replace(/-/g, '_')}
                  severity={analysis.severity as Severity}
                />
              ))}
            </div>
          )}

          {/* Findings */}
          {analysis.findings.length > 0 && (
            <div className="rounded-md border border-gray-800 p-2">
              <h4 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Findings</h4>
              {analysis.findings.map((finding, i) => (
                <FindingRow key={`${finding.code}-${i}`} finding={finding} />
              ))}
            </div>
          )}

          {/* Causal Chain */}
          {analysis.causalChain && analysis.causalChain.length > 0 && (
            <div className="rounded-md border border-gray-800 p-2">
              <h4 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Causal Chain</h4>
              <CausalChainViz chain={analysis.causalChain} />
            </div>
          )}

          {/* Prosecution Brief */}
          {analysis.briefMarkdown && (
            <div>
              <button
                className="text-xs text-indigo-400 hover:text-indigo-300"
                onClick={() => setBriefOpen(!briefOpen)}
              >
                {briefOpen ? 'Hide' : 'View'} Prosecution Brief
              </button>
              {briefOpen && (
                <div className="mt-2 rounded-md border border-red-900/40 bg-red-950/20 p-4">
                  <pre className="whitespace-pre-wrap text-xs text-gray-300 leading-relaxed">
                    {analysis.briefMarkdown}
                  </pre>
                </div>
              )}
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

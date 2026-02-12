/**
 * DESTRUCTIVE_CMD Detector (Layer 0)
 *
 * Detects dangerous command patterns: rm -rf, chmod -R 777, curl|bash,
 * dd, mkfs, pipe-to-shell, etc. Identity-aware: checks spawn scope.
 */

import type { Finding } from '@wooblay/types';
import type { Detector } from '../detector.js';
import type { DetectorContext, CollectedToolCall } from '../collector.js';

const DESTRUCTIVE_PATTERNS: Array<{ pattern: RegExp; description: string; confidence: number }> = [
  { pattern: /\brm\s+(-\w*r\w*f|\w*f\w*r)/, description: 'Recursive forced deletion (rm -rf)', confidence: 1.0 },
  { pattern: /\brm\s+-\w*r/, description: 'Recursive deletion (rm -r)', confidence: 0.9 },
  { pattern: /\bchmod\s+(-R\s+)?777\b/, description: 'World-writable permissions (chmod 777)', confidence: 1.0 },
  { pattern: /\bchmod\s+-R\b/, description: 'Recursive permission change (chmod -R)', confidence: 0.8 },
  { pattern: /\bcurl\b.*\|\s*(bash|sh|zsh)\b/, description: 'Pipe from internet to shell (curl|bash)', confidence: 1.0 },
  { pattern: /\bwget\b.*\|\s*(bash|sh|zsh)\b/, description: 'Pipe from internet to shell (wget|bash)', confidence: 1.0 },
  { pattern: /\b(curl|wget)\b.*-o\s*-\s*\|\s*(bash|sh)/, description: 'Download and execute', confidence: 1.0 },
  { pattern: /\bdd\s+if=/, description: 'Direct disk write (dd)', confidence: 0.9 },
  { pattern: /\bmkfs\b/, description: 'Filesystem creation (mkfs)', confidence: 0.95 },
  { pattern: /\bfdisk\b/, description: 'Partition modification (fdisk)', confidence: 0.95 },
  { pattern: /\b>\s*\/dev\/sd[a-z]/, description: 'Direct device write', confidence: 1.0 },
  { pattern: /\bsudo\s+rm\b/, description: 'Privileged deletion (sudo rm)', confidence: 0.95 },
  { pattern: /\b:(){ :\|:& };:/, description: 'Fork bomb', confidence: 1.0 },
  { pattern: /\beval\b.*\$\(.*curl/, description: 'Eval of downloaded code', confidence: 0.95 },
  { pattern: /\bnc\b.*-e\s*(\/bin\/|)(bash|sh)\b/, description: 'Reverse shell (netcat)', confidence: 1.0 },
  { pattern: /\/dev\/tcp\//, description: 'Bash reverse shell via /dev/tcp', confidence: 1.0 },
];

export const destructiveCmdDetector: Detector = {
  code: 'DESTRUCTIVE_CMD',

  detect(ctx: DetectorContext): Finding[] {
    const findings: Finding[] = [];
    const now = new Date().toISOString();

    for (const tc of ctx.toolCalls) {
      if (tc.toolName !== 'wooblay_exec') continue;

      const command = String(tc.parsedArgs['command'] ?? tc.parsedArgs['cmd'] ?? '');
      if (!command) continue;

      for (const { pattern, description, confidence } of DESTRUCTIVE_PATTERNS) {
        if (pattern.test(command)) {
          // Check if agent's scope allows destructive operations
          let adjustedConfidence = confidence;
          if (ctx.agent.spawnScope?.riskCeiling === 'READ') {
            adjustedConfidence = Math.min(1.0, confidence + 0.1); // extra suspicious
          }

          findings.push({
            code: 'DESTRUCTIVE_CMD',
            message: `${description}: "${command.slice(0, 120)}"`,
            evidenceRefs: [tc.id],
            confidence: adjustedConfidence,
            suggestedAction: confidence >= 0.9 ? 'suspend-agent' : 'needs-human',
            decayRate: 0.98, // slow decay for destructive findings
            detectedAt: now,
          });
          break; // one finding per tool call
        }
      }
    }

    return findings;
  },
};

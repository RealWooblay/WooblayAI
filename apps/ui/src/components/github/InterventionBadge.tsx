/**
 * Color-coded intervention score badge.
 *
 *   0      → green  "No Intervention"
 *   1-2    → yellow "Minor"
 *   3-4    → red    "Significant"
 *   5      → red    "Heavy"
 */

import { Badge } from '../common/Badge.tsx';
import type { BadgeVariant } from '../common/Badge.tsx';

interface InterventionBadgeProps {
  score: number;
  className?: string;
  showLabel?: boolean;
}

function scoreVariant(score: number): BadgeVariant {
  if (score === 0) return 'green';
  if (score <= 2) return 'yellow';
  return 'red';
}

function scoreLabel(score: number): string {
  if (score === 0) return 'No Intervention';
  if (score <= 2) return 'Minor';
  if (score <= 4) return 'Significant';
  return 'Heavy';
}

export function InterventionBadge({ score, className, showLabel = true }: InterventionBadgeProps) {
  return (
    <Badge
      variant={scoreVariant(score)}
      className={className}
    >
      {score}/5{showLabel && ` · ${scoreLabel(score)}`}
    </Badge>
  );
}

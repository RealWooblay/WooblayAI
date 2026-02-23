/** Risk classification types. */

import type { RiskTier } from '@wooblay/types';

export type BusinessCategory =
  | 'code'
  | 'git'
  | 'packages'
  | 'shell'
  | 'files'
  | 'network'
  | 'secrets'
  | 'infra'
  | 'communication'
  | 'destructive'
  | 'data'
  | 'other';

export interface AIRiskResult {
  riskTier: RiskTier;
  category: BusinessCategory;
  reasoning: string;
  description: string;
  whyReview: string | null;
}

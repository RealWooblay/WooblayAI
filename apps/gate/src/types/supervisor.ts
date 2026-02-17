/** AI supervisor analysis types. */

export interface ThreatAssessment {
  threatLevel: 'none' | 'low' | 'medium' | 'high' | 'critical';
  summary: string;
  concerns: string[];
  recommendation: 'allow' | 'review' | 'block';
}

export interface ContributionAssessment {
  summary: string;
  qualityScore: number;
  keyAccomplishments: string[];
  concerns: string[];
  productivity: 'high' | 'medium' | 'low' | 'spinning';
}

export interface SessionSummary {
  headline: string;
  narrative: string;
  keyActions: string[];
  flaggedBehaviors: string[];
  outcome: 'successful' | 'partial' | 'blocked' | 'failed' | 'in_progress';
}

export interface BehaviorAnalysis {
  pattern: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  title: string;
  description: string;
  evidence: string[];
}

export interface RoleInference {
  role: string;
  confidence: 'high' | 'medium' | 'low';
}

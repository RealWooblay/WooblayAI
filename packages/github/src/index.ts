// Webhook verification
export { verifyWebhookSignature } from './webhook-verify.js';

// Octokit factory
export {
  createAppOctokit,
  createInstallationOctokit,
  evictInstallationToken,
  clearTokenCache,
} from './octokit-factory.js';
export type { GitHubAppConfig } from './octokit-factory.js';

// Agent detection
export {
  detectAgentPR,
  detectAgentCommit,
  detectByTrailer,
  detectByLabel,
  detectByBot,
  parseTrailers,
} from './agent-detection.js';
export type {
  DetectionMode,
  AgentDetectionResult,
  CommitInfo,
  PRInfo,
} from './agent-detection.js';

// Attribution
export {
  computeAttribution,
  interventionSummary,
} from './attribution.js';
export type {
  CommitAttribution,
  PRReview,
  CIResult,
  RevertSignal,
  AttributionInput,
  AttributionResult,
  AttributionConfig,
  InterventionFactor,
} from './attribution.js';

// Check run
export {
  createCheckRun,
  updateCheckRun,
  findCheckRun,
  upsertCheckRun,
} from './check-run.js';
export type {
  CheckRunContext,
  CheckRunAttribution,
} from './check-run.js';

// Receipt bridge
export {
  computeReceiptCoverage,
  extractTaskIdFromComment,
} from './receipt-bridge.js';
export type {
  ReceiptRecord,
  AgentCommitRecord,
  ReceiptBridgeResult,
  ReceiptBridgeConfig,
} from './receipt-bridge.js';

/**
 * Mock data fixtures for the Wooblay UI.
 * Used when real API endpoints don't return data.
 * Structured to match the real API response shapes.
 */

// ---------------------------------------------------------------------------
// Types for mock data
// ---------------------------------------------------------------------------

export interface MockAgent {
  id: string;
  name: string;
  pubkey: string;
  status: 'active' | 'suspended' | 'revoked';
  allowlisted: boolean;
  avatarSeed: string; // seed for procedural avatar
  autonomyLevel: 'read-only' | 'write-with-approvals' | 'autonomous';
  trustScore: number; // 0–100
  stats: {
    totalActions: number;
    successRate: number;
    avgDuration: number;
    failureReasons: { reason: string; count: number }[];
    byRiskTier: { READ: number; WRITE: number; DESTRUCTIVE: number };
    avgCostPerAction: number;
    lastActive: string;
  };
}

export interface MockActionPR {
  id: string;
  taskId: string;
  sessionId: string;
  agentId: string;
  agentName: string;
  agentPubkey: string;
  toolName: string;
  adapter: string;
  riskTier: 'READ' | 'WRITE' | 'DESTRUCTIVE';
  status: 'pending' | 'approved' | 'executed' | 'denied' | 'rolled_back';
  title: string;
  summary: string;
  command?: string;
  targetDomain?: string;
  affectedPaths?: string[];
  steps?: string[];
  evidenceCount: number;
  requiredApprovals: number;
  currentApprovals: number;
  policyMatches: MockPolicyMatch[];
  citations: MockCitation[];
  decisionTrail: {
    plan_summary: string;
    reason_summary: string;
    inputs_used: string[];
    tool_calls: MockToolCall[];
  };
  idempotencyKey: string;
  rollbackAvailable: boolean;
  ttlSeconds: number;
  createdAt: string;
  resolvedAt?: string;
  receiptHash?: string;
}

export interface MockPolicyMatch {
  policyId: string;
  priority: number;
  matchTool: string;
  riskTier: string;
  decision: string;
  reason: string;
}

export interface MockCitation {
  type: 'url' | 'tool_output' | 'file';
  ref: string;
  hash?: string;
  timestamp: string;
  preview?: string;
}

export interface MockToolCall {
  step: number;
  toolName: string;
  args: string;
  status: 'success' | 'failed' | 'pending';
  duration?: number;
  output?: string;
}

export interface MockCheckpoint {
  id: string;
  taskId: string;
  toolName: string;
  scope: string;
  label: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
  actionCount: number;
  agentName: string;
}

export interface MockReceipt {
  id: string;
  hash: string;
  signature: string;
  chainPrev: string | null;
  toolName: string;
  agentPubkey: string;
  riskTier: string;
  policyDecision: string;
  approvalDecision?: string;
  approver?: string;
  timestamp: string;
  decisionTrail: {
    plan_summary: string;
    reason_summary: string;
    inputs_used: string[];
    citations: MockCitation[];
  };
  executionSummary?: {
    status: string;
    exitCode?: number;
    stdoutPreview: string;
    durationMs: number;
  };
  verified: boolean;
}

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

function ago(minutes: number): string {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString();
}

// ---------------------------------------------------------------------------
// Mock Agents
// ---------------------------------------------------------------------------

export const MOCK_AGENTS: MockAgent[] = [
  {
    id: 'agent-001',
    name: 'Atlas',
    pubkey: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2',
    status: 'active',
    allowlisted: true,
    avatarSeed: 'atlas',
    autonomyLevel: 'write-with-approvals',
    trustScore: 78,
    stats: {
      totalActions: 1247,
      successRate: 0.94,
      avgDuration: 3200,
      failureReasons: [
        { reason: 'Command timeout', count: 23 },
        { reason: 'Permission denied', count: 18 },
        { reason: 'File not found', count: 12 },
      ],
      byRiskTier: { READ: 823, WRITE: 367, DESTRUCTIVE: 57 },
      avgCostPerAction: 0.023,
      lastActive: ago(2),
    },
  },
  {
    id: 'agent-002',
    name: 'Sentinel',
    pubkey: 'f1e2d3c4b5a6f7e8d9c0b1a2f3e4d5c6b7a8f9e0d1c2b3a4f5e6d7c8b9a0f1e2',
    status: 'active',
    allowlisted: true,
    avatarSeed: 'sentinel',
    autonomyLevel: 'autonomous',
    trustScore: 92,
    stats: {
      totalActions: 3891,
      successRate: 0.98,
      avgDuration: 1800,
      failureReasons: [
        { reason: 'Rate limited', count: 42 },
        { reason: 'API error', count: 18 },
      ],
      byRiskTier: { READ: 2890, WRITE: 892, DESTRUCTIVE: 109 },
      avgCostPerAction: 0.018,
      lastActive: ago(0.5),
    },
  },
  {
    id: 'agent-003',
    name: 'Forge',
    pubkey: 'c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2',
    status: 'active',
    allowlisted: true,
    avatarSeed: 'forge',
    autonomyLevel: 'write-with-approvals',
    trustScore: 65,
    stats: {
      totalActions: 456,
      successRate: 0.87,
      avgDuration: 5400,
      failureReasons: [
        { reason: 'Build failed', count: 28 },
        { reason: 'Test failures', count: 19 },
        { reason: 'Merge conflict', count: 8 },
      ],
      byRiskTier: { READ: 234, WRITE: 198, DESTRUCTIVE: 24 },
      avgCostPerAction: 0.041,
      lastActive: ago(15),
    },
  },
  {
    id: 'agent-004',
    name: 'Echo',
    pubkey: 'e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4c5d6e7f8a9b0c1d2',
    status: 'suspended',
    allowlisted: false,
    avatarSeed: 'echo',
    autonomyLevel: 'read-only',
    trustScore: 31,
    stats: {
      totalActions: 89,
      successRate: 0.62,
      avgDuration: 8200,
      failureReasons: [
        { reason: 'Policy violation', count: 18 },
        { reason: 'Privilege escalation attempt', count: 7 },
        { reason: 'Outside allowlist', count: 12 },
      ],
      byRiskTier: { READ: 45, WRITE: 32, DESTRUCTIVE: 12 },
      avgCostPerAction: 0.067,
      lastActive: ago(1440),
    },
  },
  {
    id: 'agent-005',
    name: 'Nexus',
    pubkey: 'b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2',
    status: 'active',
    allowlisted: true,
    avatarSeed: 'nexus',
    autonomyLevel: 'read-only',
    trustScore: 45,
    stats: {
      totalActions: 178,
      successRate: 0.91,
      avgDuration: 2100,
      failureReasons: [
        { reason: 'Network timeout', count: 9 },
        { reason: 'Invalid response', count: 5 },
      ],
      byRiskTier: { READ: 156, WRITE: 22, DESTRUCTIVE: 0 },
      avgCostPerAction: 0.012,
      lastActive: ago(30),
    },
  },
];

// ---------------------------------------------------------------------------
// Mock Action PRs
// ---------------------------------------------------------------------------

export const MOCK_ACTION_PRS: MockActionPR[] = [
  {
    id: 'apr-001',
    taskId: 'task-2f8a9c',
    sessionId: 'sess-001',
    agentId: 'agent-001',
    agentName: 'Atlas',
    agentPubkey: MOCK_AGENTS[0].pubkey,
    toolName: 'wooblay_exec',
    adapter: 'openclaw-plugin',
    riskTier: 'DESTRUCTIVE',
    status: 'pending',
    title: 'Drop and recreate staging database schema',
    summary: 'Agent wants to run destructive SQL migration on staging-db. This will drop all existing tables in the public schema and recreate them from the latest migration files.',
    command: 'psql -h staging-db.internal -U deploy -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;" && npm run migrate:latest',
    affectedPaths: ['staging-db.internal/public/*', 'migrations/*.sql'],
    evidenceCount: 4,
    requiredApprovals: 2,
    currentApprovals: 1,
    policyMatches: [
      { policyId: 'pol-001', priority: 1, matchTool: 'wooblay_exec', riskTier: 'DESTRUCTIVE', decision: 'APPROVE', reason: 'Destructive commands require human approval' },
      { policyId: 'pol-005', priority: 5, matchTool: '*', riskTier: 'DESTRUCTIVE', decision: 'APPROVE', reason: 'Global destructive action gate' },
    ],
    citations: [
      { type: 'tool_output', ref: 'pg_dump --schema-only staging-db', hash: '7a2f8c...', timestamp: ago(8), preview: 'Schema contains 42 tables, 12 views' },
      { type: 'file', ref: 'migrations/20260209_rebuild_schema.sql', hash: '3b1e9d...', timestamp: ago(7) },
      { type: 'url', ref: 'https://jira.internal/PLAT-1234', timestamp: ago(60), preview: 'Ticket: Rebuild staging schema for v2 migration' },
      { type: 'tool_output', ref: 'npm run migrate:status', hash: 'c4d5e6...', timestamp: ago(6), preview: '3 pending migrations' },
    ],
    decisionTrail: {
      plan_summary: 'Rebuild staging database schema to match production v2 migration path',
      reason_summary: 'Current staging schema is 3 migrations behind and has manual drift. Clean rebuild is safer than incremental migration.',
      inputs_used: ['jira ticket PLAT-1234', 'current schema dump', 'migration status check'],
      tool_calls: [
        { step: 1, toolName: 'wooblay_exec', args: 'pg_dump --schema-only staging-db > /tmp/backup.sql', status: 'success', duration: 2300, output: 'Schema exported (42 tables)' },
        { step: 2, toolName: 'wooblay_http', args: 'GET https://jira.internal/api/PLAT-1234', status: 'success', duration: 450, output: 'Ticket status: In Progress' },
        { step: 3, toolName: 'wooblay_exec', args: 'npm run migrate:status', status: 'success', duration: 1200, output: '3 pending migrations' },
        { step: 4, toolName: 'wooblay_exec', args: 'DROP SCHEMA + migrate (pending approval)', status: 'pending' },
      ],
    },
    idempotencyKey: 'idem-2f8a9c-drop-schema',
    rollbackAvailable: true,
    ttlSeconds: 300,
    createdAt: ago(5),
    receiptHash: undefined,
  },
  {
    id: 'apr-002',
    taskId: 'task-7b3d1e',
    sessionId: 'sess-002',
    agentId: 'agent-002',
    agentName: 'Sentinel',
    agentPubkey: MOCK_AGENTS[1].pubkey,
    toolName: 'wooblay_http',
    adapter: 'mcp-toolhost',
    riskTier: 'WRITE',
    status: 'approved',
    title: 'Deploy canary release to production ECS cluster',
    summary: 'Push new container image tag v2.4.1 to production ECS service with 10% traffic canary weight.',
    targetDomain: 'ecs.us-east-1.amazonaws.com',
    steps: [
      'Update ECS task definition with image tag v2.4.1',
      'Set desired count to 1 canary instance',
      'Configure ALB target group weight: 10% canary, 90% stable',
      'Monitor error rate for 15 minutes',
    ],
    evidenceCount: 6,
    requiredApprovals: 1,
    currentApprovals: 1,
    policyMatches: [
      { policyId: 'pol-003', priority: 3, matchTool: 'wooblay_http', riskTier: 'WRITE', decision: 'APPROVE', reason: 'Cloud API mutations require approval' },
    ],
    citations: [
      { type: 'tool_output', ref: 'docker build + push', hash: '8f2a1b...', timestamp: ago(22), preview: 'Image sha256:8f2a1b pushed' },
      { type: 'url', ref: 'https://github.com/org/app/releases/tag/v2.4.1', timestamp: ago(30), preview: '14 commits, 3 contributors' },
      { type: 'tool_output', ref: 'aws ecs describe-services', hash: 'e3c4d5...', timestamp: ago(20), preview: 'Running count: 4, desired: 4' },
    ],
    decisionTrail: {
      plan_summary: 'Canary deploy v2.4.1 with 10% traffic split and automated rollback trigger',
      reason_summary: 'Release v2.4.1 fixes critical payment processing bug. Canary strategy minimizes blast radius.',
      inputs_used: ['release notes v2.4.1', 'current service state', 'deployment playbook'],
      tool_calls: [
        { step: 1, toolName: 'wooblay_exec', args: 'docker build -t app:v2.4.1 .', status: 'success', duration: 45000, output: 'Built successfully' },
        { step: 2, toolName: 'wooblay_exec', args: 'docker push ecr/app:v2.4.1', status: 'success', duration: 12000, output: 'Pushed to ECR' },
        { step: 3, toolName: 'wooblay_http', args: 'PUT ecs/update-service (canary)', status: 'success', duration: 3200, output: 'Task definition updated' },
      ],
    },
    idempotencyKey: 'idem-7b3d1e-canary-v241',
    rollbackAvailable: true,
    ttlSeconds: 600,
    createdAt: ago(20),
    resolvedAt: ago(18),
    receiptHash: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2',
  },
  {
    id: 'apr-003',
    taskId: 'task-4e9f2a',
    sessionId: 'sess-003',
    agentId: 'agent-003',
    agentName: 'Forge',
    agentPubkey: MOCK_AGENTS[2].pubkey,
    toolName: 'wooblay_exec',
    adapter: 'openclaw-plugin',
    riskTier: 'WRITE',
    status: 'executed',
    title: 'Create feature branch and push initial scaffold',
    summary: 'Initialize new feature branch `feat/user-preferences` with scaffolded components and tests.',
    command: 'git checkout -b feat/user-preferences && npx plop component UserPreferences && git add -A && git commit -m "scaffold: user preferences" && git push -u origin feat/user-preferences',
    affectedPaths: ['src/components/UserPreferences/*', 'src/tests/UserPreferences.test.tsx'],
    evidenceCount: 2,
    requiredApprovals: 1,
    currentApprovals: 1,
    policyMatches: [
      { policyId: 'pol-002', priority: 2, matchTool: 'wooblay_exec', riskTier: 'WRITE', decision: 'APPROVE', reason: 'Git push operations require approval' },
    ],
    citations: [
      { type: 'url', ref: 'https://jira.internal/FEAT-567', timestamp: ago(120), preview: 'Feature: User Preferences Panel' },
      { type: 'tool_output', ref: 'git status', hash: 'f1e2d3...', timestamp: ago(45), preview: '5 new files, 0 modified' },
    ],
    decisionTrail: {
      plan_summary: 'Scaffold user preferences feature with standard component template',
      reason_summary: 'Following established project scaffold pattern for new feature development.',
      inputs_used: ['jira ticket FEAT-567', 'project scaffold templates'],
      tool_calls: [
        { step: 1, toolName: 'wooblay_exec', args: 'git checkout -b feat/user-preferences', status: 'success', duration: 200 },
        { step: 2, toolName: 'wooblay_exec', args: 'npx plop component UserPreferences', status: 'success', duration: 3400 },
        { step: 3, toolName: 'wooblay_exec', args: 'git add -A && git commit && git push', status: 'success', duration: 2800, output: 'Branch pushed' },
      ],
    },
    idempotencyKey: 'idem-4e9f2a-scaffold',
    rollbackAvailable: true,
    ttlSeconds: 300,
    createdAt: ago(45),
    resolvedAt: ago(42),
    receiptHash: 'b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3',
  },
  {
    id: 'apr-004',
    taskId: 'task-9c1d3f',
    sessionId: 'sess-004',
    agentId: 'agent-001',
    agentName: 'Atlas',
    agentPubkey: MOCK_AGENTS[0].pubkey,
    toolName: 'wooblay_exec',
    adapter: 'openclaw-plugin',
    riskTier: 'READ',
    status: 'executed',
    title: 'Analyze production log patterns for anomaly detection',
    summary: 'Read last 24h of production logs and generate anomaly report.',
    command: 'aws logs filter-log-events --log-group-name prod-api --start-time $(date -d "24 hours ago" +%s000) | python3 analyze.py',
    evidenceCount: 1,
    requiredApprovals: 0,
    currentApprovals: 0,
    policyMatches: [
      { policyId: 'pol-010', priority: 10, matchTool: '*', riskTier: 'READ', decision: 'ALLOW', reason: 'Read operations auto-allowed' },
    ],
    citations: [
      { type: 'tool_output', ref: 'aws logs filter-log-events', hash: 'd4e5f6...', timestamp: ago(65), preview: '12,847 log events analyzed' },
    ],
    decisionTrail: {
      plan_summary: 'Pull and analyze production logs for anomaly patterns',
      reason_summary: 'Routine monitoring task - read-only log analysis.',
      inputs_used: ['CloudWatch log group'],
      tool_calls: [
        { step: 1, toolName: 'wooblay_exec', args: 'aws logs filter-log-events ...', status: 'success', duration: 8900, output: '12,847 events' },
        { step: 2, toolName: 'wooblay_exec', args: 'python3 analyze.py', status: 'success', duration: 3200, output: 'Report generated: 2 anomalies detected' },
      ],
    },
    idempotencyKey: 'idem-9c1d3f-log-analysis',
    rollbackAvailable: false,
    ttlSeconds: 300,
    createdAt: ago(65),
    resolvedAt: ago(63),
    receiptHash: 'c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4',
  },
  {
    id: 'apr-005',
    taskId: 'task-5a2b8e',
    sessionId: 'sess-005',
    agentId: 'agent-004',
    agentName: 'Echo',
    agentPubkey: MOCK_AGENTS[3].pubkey,
    toolName: 'wooblay_exec',
    adapter: 'openclaw-plugin',
    riskTier: 'DESTRUCTIVE',
    status: 'denied',
    title: 'Attempt to modify system firewall rules',
    summary: 'Agent attempted to run iptables command to open port 4444 on production host.',
    command: 'sudo iptables -A INPUT -p tcp --dport 4444 -j ACCEPT',
    affectedPaths: ['/etc/iptables/rules.v4'],
    evidenceCount: 0,
    requiredApprovals: 2,
    currentApprovals: 0,
    policyMatches: [
      { policyId: 'pol-000', priority: 0, matchTool: 'wooblay_exec', riskTier: 'DESTRUCTIVE', decision: 'DENY', reason: 'Firewall modifications are explicitly blocked' },
    ],
    citations: [],
    decisionTrail: {
      plan_summary: 'Open network port for debugging',
      reason_summary: 'Need port 4444 open to connect debugger to production process.',
      inputs_used: ['debug session request'],
      tool_calls: [
        { step: 1, toolName: 'wooblay_exec', args: 'sudo iptables -A INPUT ...', status: 'failed', output: 'DENIED by policy' },
      ],
    },
    idempotencyKey: 'idem-5a2b8e-iptables',
    rollbackAvailable: false,
    ttlSeconds: 300,
    createdAt: ago(1440),
    resolvedAt: ago(1440),
    receiptHash: 'd4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5',
  },
  {
    id: 'apr-006',
    taskId: 'task-8f4c2d',
    sessionId: 'sess-006',
    agentId: 'agent-002',
    agentName: 'Sentinel',
    agentPubkey: MOCK_AGENTS[1].pubkey,
    toolName: 'wooblay_http',
    adapter: 'mcp-toolhost',
    riskTier: 'WRITE',
    status: 'pending',
    title: 'Update DNS records for blue/green deployment',
    summary: 'Switch Route53 weighted records from blue (current) to green (new) environment.',
    targetDomain: 'route53.amazonaws.com',
    steps: [
      'Verify green environment health checks pass',
      'Update Route53 weighted record: green=100, blue=0',
      'Verify DNS propagation (TTL: 60s)',
      'Monitor error rates for 5 minutes',
    ],
    evidenceCount: 3,
    requiredApprovals: 1,
    currentApprovals: 0,
    policyMatches: [
      { policyId: 'pol-003', priority: 3, matchTool: 'wooblay_http', riskTier: 'WRITE', decision: 'APPROVE', reason: 'Cloud API mutations require approval' },
    ],
    citations: [
      { type: 'tool_output', ref: 'health-check green env', hash: 'a1b2c3...', timestamp: ago(3), preview: 'All 4 endpoints healthy' },
      { type: 'tool_output', ref: 'aws route53 list-resource-record-sets', hash: 'b2c3d4...', timestamp: ago(2), preview: 'Current: blue=100, green=0' },
      { type: 'url', ref: 'https://runbooks.internal/blue-green-deploy', timestamp: ago(120) },
    ],
    decisionTrail: {
      plan_summary: 'Execute blue-green DNS cutover after verifying green environment health',
      reason_summary: 'Green environment has passed all smoke tests. Ready for DNS switch.',
      inputs_used: ['health check results', 'current DNS state', 'deployment runbook'],
      tool_calls: [
        { step: 1, toolName: 'wooblay_http', args: 'GET /health (green)', status: 'success', duration: 340, output: 'All healthy' },
        { step: 2, toolName: 'wooblay_http', args: 'GET route53/records', status: 'success', duration: 520, output: 'blue=100, green=0' },
        { step: 3, toolName: 'wooblay_http', args: 'PUT route53/records (pending)', status: 'pending' },
      ],
    },
    idempotencyKey: 'idem-8f4c2d-dns-switch',
    rollbackAvailable: true,
    ttlSeconds: 600,
    createdAt: ago(2),
  },
  {
    id: 'apr-007',
    taskId: 'task-1a7b9c',
    sessionId: 'sess-007',
    agentId: 'agent-003',
    agentName: 'Forge',
    agentPubkey: MOCK_AGENTS[2].pubkey,
    toolName: 'wooblay_exec',
    adapter: 'openclaw-plugin',
    riskTier: 'WRITE',
    status: 'rolled_back',
    title: 'Apply Terraform changes to production VPC',
    summary: 'Terraform apply modified security group rules, but caused connectivity issues. Rolled back via checkpoint.',
    command: 'terraform apply -auto-approve -var-file=prod.tfvars',
    affectedPaths: ['infra/prod/security-groups.tf', 'infra/prod/terraform.tfstate'],
    evidenceCount: 5,
    requiredApprovals: 1,
    currentApprovals: 1,
    policyMatches: [
      { policyId: 'pol-002', priority: 2, matchTool: 'wooblay_exec', riskTier: 'WRITE', decision: 'APPROVE', reason: 'Infrastructure changes require approval' },
    ],
    citations: [
      { type: 'tool_output', ref: 'terraform plan', hash: 'e5f6a7...', timestamp: ago(180), preview: '3 to change, 0 to destroy' },
      { type: 'file', ref: 'infra/prod/security-groups.tf', hash: 'f6a7b8...', timestamp: ago(175) },
    ],
    decisionTrail: {
      plan_summary: 'Apply security group changes for new microservice connectivity',
      reason_summary: 'New service requires ingress rules on port 8443.',
      inputs_used: ['terraform plan output', 'security group config'],
      tool_calls: [
        { step: 1, toolName: 'wooblay_exec', args: 'terraform plan', status: 'success', duration: 15000, output: '3 changes' },
        { step: 2, toolName: 'wooblay_exec', args: 'terraform apply', status: 'success', duration: 45000, output: 'Apply complete: 3 changed' },
        { step: 3, toolName: 'wooblay_http', args: 'GET /health (service)', status: 'failed', duration: 30000, output: 'Connection refused' },
      ],
    },
    idempotencyKey: 'idem-1a7b9c-tf-apply',
    rollbackAvailable: true,
    ttlSeconds: 300,
    createdAt: ago(180),
    resolvedAt: ago(170),
    receiptHash: 'e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6',
  },
];

// ---------------------------------------------------------------------------
// Mock Checkpoints
// ---------------------------------------------------------------------------

export const MOCK_CHECKPOINTS: MockCheckpoint[] = [
  {
    id: 'ckpt-001',
    taskId: 'task-2f8a9c',
    toolName: 'wooblay_exec',
    scope: 'staging-db',
    label: 'Pre-migration backup',
    createdAt: ago(10),
    actionCount: 3,
    agentName: 'Atlas',
  },
  {
    id: 'ckpt-002',
    taskId: 'task-7b3d1e',
    toolName: 'wooblay_http',
    scope: 'ecs-service',
    label: 'Pre-canary deploy state',
    createdAt: ago(25),
    actionCount: 2,
    agentName: 'Sentinel',
  },
  {
    id: 'ckpt-003',
    taskId: 'task-1a7b9c',
    toolName: 'wooblay_exec',
    scope: 'terraform-state',
    label: 'Pre-terraform apply',
    createdAt: ago(185),
    metadata: { resources: 47, state_version: 14 },
    actionCount: 1,
    agentName: 'Forge',
  },
  {
    id: 'ckpt-004',
    taskId: 'task-4e9f2a',
    toolName: 'wooblay_exec',
    scope: 'git-repo',
    label: 'Pre-branch creation',
    createdAt: ago(50),
    actionCount: 0,
    agentName: 'Forge',
  },
  {
    id: 'ckpt-005',
    taskId: 'task-8f4c2d',
    toolName: 'wooblay_http',
    scope: 'dns-records',
    label: 'Pre-DNS switch',
    createdAt: ago(5),
    actionCount: 2,
    agentName: 'Sentinel',
  },
];

// ---------------------------------------------------------------------------
// Mock Receipts
// ---------------------------------------------------------------------------

export const MOCK_RECEIPTS: MockReceipt[] = [
  {
    id: 'rcpt-001',
    hash: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2',
    signature: '304502210089a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8022012e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3',
    chainPrev: null,
    toolName: 'wooblay_http',
    agentPubkey: MOCK_AGENTS[1].pubkey,
    riskTier: 'WRITE',
    policyDecision: 'APPROVE',
    approvalDecision: 'APPROVED',
    approver: 'jack@wooblay.com',
    timestamp: ago(18),
    decisionTrail: {
      plan_summary: 'Canary deploy v2.4.1',
      reason_summary: 'Approved - critical fix with canary safety net',
      inputs_used: ['release notes', 'service state'],
      citations: MOCK_ACTION_PRS[1].citations,
    },
    executionSummary: {
      status: 'success',
      exitCode: 0,
      stdoutPreview: 'ECS service updated. Task definition: app:v2.4.1. Canary weight: 10%.',
      durationMs: 3200,
    },
    verified: true,
  },
  {
    id: 'rcpt-002',
    hash: 'b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3',
    signature: '3045022100c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8022012f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4',
    chainPrev: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2',
    toolName: 'wooblay_exec',
    agentPubkey: MOCK_AGENTS[2].pubkey,
    riskTier: 'WRITE',
    policyDecision: 'APPROVE',
    approvalDecision: 'APPROVED',
    approver: 'dashboard',
    timestamp: ago(42),
    decisionTrail: {
      plan_summary: 'Scaffold user preferences feature',
      reason_summary: 'Standard scaffold operation following established patterns',
      inputs_used: ['jira ticket', 'scaffold templates'],
      citations: MOCK_ACTION_PRS[2].citations,
    },
    executionSummary: {
      status: 'success',
      exitCode: 0,
      stdoutPreview: 'Branch feat/user-preferences pushed to origin. 5 files created.',
      durationMs: 6400,
    },
    verified: true,
  },
  {
    id: 'rcpt-003',
    hash: 'd4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5',
    signature: '3045022100d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8022013a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5',
    chainPrev: 'b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3',
    toolName: 'wooblay_exec',
    agentPubkey: MOCK_AGENTS[3].pubkey,
    riskTier: 'DESTRUCTIVE',
    policyDecision: 'DENY',
    timestamp: ago(1440),
    decisionTrail: {
      plan_summary: 'Open network port for debugging',
      reason_summary: 'DENIED - firewall modifications explicitly blocked by policy',
      inputs_used: ['debug session request'],
      citations: [],
    },
    verified: true,
  },
];

// ---------------------------------------------------------------------------
// Helper to get agent by id
// ---------------------------------------------------------------------------

export function getMockAgent(id: string): MockAgent | undefined {
  return MOCK_AGENTS.find(a => a.id === id);
}

export function getMockActionPR(id: string): MockActionPR | undefined {
  return MOCK_ACTION_PRS.find(a => a.id === id);
}

export function getPendingActionPRs(): MockActionPR[] {
  return MOCK_ACTION_PRS.filter(a => a.status === 'pending');
}

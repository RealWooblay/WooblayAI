#!/usr/bin/env npx tsx
/**
 * Integration test: OpenClaw Adapter → Wooblay Gate
 *
 * Tests the Wooblay integration using the Exec Approval Bridge pattern
 * (aligned with OpenClaw's actual Exec Approvals system).
 *
 * Flow:
 *   1. Generate agent signing keys
 *   2. Register agent with Gate
 *   3. Simulate exec approval requests (as OpenClaw would send them)
 *   4. Route them through the ExecApprovalBridge → Wooblay Gate
 *   5. Verify Gate policy evaluation, approvals, receipts
 *   6. Test the hook handler for audit logging
 *
 * Prerequisites:
 *   - Gate running at http://localhost:4800
 *   - Database migrated
 *
 * Usage:
 *   pnpm exec tsx scripts/test-openclaw-adapter.ts [--gate-url http://localhost:4800]
 */

import { generateKeyPair, sign, storeKeyPair } from '@wooblay/crypto';
import { GateClient } from '@wooblay/gate-client';
import { PluginGateClient } from '../packages/adapters/openclaw/src/gate-client.js';
import { ExecApprovalBridge, type ExecApprovalRequest } from '../packages/adapters/openclaw/src/bridge/exec-approval-bridge.js';
import { resolveConfig } from '../packages/adapters/openclaw/src/config.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ── Configuration ────────────────────────────────────────────────────────
const GATE_URL = process.argv.includes('--gate-url')
  ? process.argv[process.argv.indexOf('--gate-url') + 1]
  : 'http://localhost:4800';

// ── Helpers ──────────────────────────────────────────────────────────────
function banner(text: string): void {
  const line = '─'.repeat(60);
  console.log(`\n${line}`);
  console.log(`  ${text}`);
  console.log(line);
}

function ok(msg: string): void {
  console.log(`  ✅ ${msg}`);
}

function fail(msg: string): void {
  console.log(`  ❌ ${msg}`);
}

function info(msg: string): void {
  console.log(`  ℹ️  ${msg}`);
}

/**
 * Background auto-approver: polls pending approvals and auto-approves them.
 */
function startAutoApprover(): () => void {
  let running = true;
  const poll = async () => {
    while (running) {
      try {
        const res = await fetch(`${GATE_URL}/api/approvals/pending`);
        if (res.ok) {
          const approvals = (await res.json()) as Array<{ id: string }>;
          for (const approval of approvals) {
            try {
              await fetch(`${GATE_URL}/api/approvals/${approval.id}/approve`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  approver: 'auto-test',
                  reason: 'Auto-approved by integration test',
                }),
              });
              info(`Auto-approved: ${approval.id}`);
            } catch { /* ignore */ }
          }
        }
      } catch { /* ignore */ }
      await new Promise((r) => setTimeout(r, 500));
    }
  };
  poll();
  return () => { running = false; };
}

// ── Main Test ────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  banner('OpenClaw Adapter Integration Test (Exec Approvals Bridge)');
  console.log(`  Gate URL: ${GATE_URL}`);
  console.log(`  Integration: Exec Approval Bridge + Hook (per OpenClaw API)`);

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, msg: string): void {
    if (condition) {
      ok(msg);
      passed++;
    } else {
      fail(msg);
      failed++;
    }
  }

  // ── Step 1: Generate agent keys ──────────────────────────────────────
  banner('Step 1: Generate Agent Signing Keys');
  const keys = generateKeyPair();
  const keyDir = join(tmpdir(), `wooblay-test-${Date.now()}`);
  storeKeyPair(keyDir, 'test-agent', keys);
  ok(`Keys generated in ${keyDir}`);
  info(`Public key: ${keys.publicKey.slice(0, 24)}...`);

  // ── Step 2: Check Gate health ────────────────────────────────────────
  banner('Step 2: Verify Gate Health');
  const pluginClient = new PluginGateClient(GATE_URL);
  const healthy = await pluginClient.healthCheck();
  assert(healthy, 'Gate is reachable and healthy');

  if (!healthy) {
    console.error('\n  Gate is not running. Start it with:');
    console.error('    pnpm --filter @wooblay/gate dev\n');
    process.exit(1);
  }

  // ── Step 3: Register agent ───────────────────────────────────────────
  banner('Step 3: Register Agent with Gate');
  const gate = new GateClient({
    baseUrl: GATE_URL,
    agentPubkey: keys.publicKey,
    agentPrivateKey: keys.privateKey,
  });

  const agentName = `openclaw-bridge-test-${Date.now()}`;
  const agent = await gate.createAgent({
    pubkey: keys.publicKey,
    name: agentName,
    allowlisted: true,
  });
  assert(agent.name === agentName, `Agent registered: ${agent.name}`);
  assert(agent.allowlisted === true, 'Agent is allowlisted');

  // ── Step 4: Initialize the Exec Approval Bridge ─────────────────────
  banner('Step 4: Initialize Exec Approval Bridge');
  const config = resolveConfig({
    gateUrl: GATE_URL,
    toolFilter: 'all',
  });

  const bridge = new ExecApprovalBridge({
    gateClient: pluginClient,
    config,
    agentPubkey: keys.publicKey,
    agentPrivateKey: keys.privateKey,
  });

  ok('Exec Approval Bridge initialized');

  // Start auto-approver for WRITE/DESTRUCTIVE tests
  const stopAutoApprover = startAutoApprover();

  // ── Step 5: Simulate READ exec approval (ls command) ────────────────
  banner('Step 5: READ Tool via Exec Approval Bridge (ls)');
  try {
    const request: ExecApprovalRequest = {
      id: `approval-read-${Date.now()}`,
      command: 'ls -la /tmp',
      args: ['-la', '/tmp'],
      cwd: '/home/user',
      agentId: 'main',
      toolName: 'exec',
      toolParams: { command: 'ls -la /tmp' },
      sessionKey: 'test-session',
    };

    const action = await bridge.handleApprovalRequest(request);
    assert(
      action === 'allow-once',
      `READ exec approved: action="${action}"`,
    );
  } catch (err) {
    fail(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }

  // ── Step 6: Simulate WRITE exec approval (mkdir) ────────────────────
  banner('Step 6: WRITE Tool via Exec Approval Bridge (mkdir)');
  try {
    const request: ExecApprovalRequest = {
      id: `approval-write-${Date.now()}`,
      command: 'mkdir /tmp/wooblay-test',
      args: ['/tmp/wooblay-test'],
      cwd: '/home/user',
      agentId: 'main',
      toolName: 'exec',
      toolParams: { command: 'mkdir /tmp/wooblay-test' },
      sessionKey: 'test-session',
    };

    const action = await bridge.handleApprovalRequest(request);
    assert(
      action === 'allow-once',
      `WRITE exec routed through Gate and approved: action="${action}"`,
    );
  } catch (err) {
    fail(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }

  // ── Step 7: Simulate DESTRUCTIVE exec approval (rm -rf) ─────────────
  banner('Step 7: DESTRUCTIVE Tool via Exec Approval Bridge (rm -rf)');
  try {
    const request: ExecApprovalRequest = {
      id: `approval-destructive-${Date.now()}`,
      command: 'rm -rf /tmp/wooblay-test',
      args: ['-rf', '/tmp/wooblay-test'],
      cwd: '/home/user',
      agentId: 'main',
      toolName: 'exec',
      toolParams: { command: 'rm -rf /tmp/wooblay-test' },
      sessionKey: 'test-session',
    };

    const action = await bridge.handleApprovalRequest(request);
    assert(
      action === 'allow-once',
      `DESTRUCTIVE exec routed through Gate and approved: action="${action}"`,
    );
  } catch (err) {
    fail(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }

  // ── Step 8: Simulate safe tool (read — should bypass gating) ────────
  banner('Step 8: Safe Tool Bypass (read — not gated)');
  try {
    const request: ExecApprovalRequest = {
      id: `approval-read-tool-${Date.now()}`,
      command: 'read',
      agentId: 'main',
      toolName: 'read',
      toolParams: { path: '/etc/hostname' },
      sessionKey: 'test-session',
    };

    const action = await bridge.handleApprovalRequest(request);
    assert(
      action === 'allow-once',
      `Safe tool "read" auto-allowed (not sent to Gate): action="${action}"`,
    );
  } catch (err) {
    fail(`Safe tool should not fail: ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }

  // ── Step 9: Simulate browser tool (risky) ───────────────────────────
  banner('Step 9: Browser Tool via Exec Approval Bridge');
  try {
    const request: ExecApprovalRequest = {
      id: `approval-browser-${Date.now()}`,
      command: 'browser-navigate',
      agentId: 'main',
      toolName: 'browser',
      toolParams: { action: 'navigate', url: 'https://example.com' },
      sessionKey: 'test-session',
    };

    const action = await bridge.handleApprovalRequest(request);
    assert(
      action === 'allow-once',
      `Browser tool routed through Gate and approved: action="${action}"`,
    );
  } catch (err) {
    fail(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }

  // Stop auto-approver
  stopAutoApprover();

  // ── Step 10: Verify stats and receipts ──────────────────────────────
  banner('Step 10: Verify Stats and Receipts');
  try {
    const stats = await gate.getStats();
    assert(stats.totalToolCalls > 0, `Gate has ${stats.totalToolCalls} tool calls recorded`);
    assert(stats.totalReceipts > 0, `Gate has ${stats.totalReceipts} receipts`);
    info(`Approval rate: ${stats.approvalRate ?? 'N/A'}`);
  } catch (err) {
    fail(`Could not fetch stats: ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }

  // ── Step 11: Verify adapters endpoint ───────────────────────────────
  banner('Step 11: Verify GET /api/adapters');
  try {
    const res = await fetch(`${GATE_URL}/api/adapters`);
    assert(res.ok, 'GET /api/adapters returns 200');
    const adapters = (await res.json()) as Array<{ id: string }>;
    assert(adapters.length >= 3, `Got ${adapters.length} adapters`);
  } catch (err) {
    fail(`Adapters endpoint failed: ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }

  // ── Step 12: Verify audit log ───────────────────────────────────────
  banner('Step 12: Verify Audit Log');
  try {
    const res = await fetch(`${GATE_URL}/api/audit/log`);
    assert(res.ok, 'GET /api/audit/log returns 200');
    const data = (await res.json()) as { data: unknown[] };
    assert(Array.isArray(data.data), `Audit log has ${data.data.length} entries`);
  } catch (err) {
    fail(`Audit endpoint failed: ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }

  // ── Summary ──────────────────────────────────────────────────────────
  banner('Test Results');
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Total:  ${passed + failed}`);

  if (failed > 0) {
    console.log(`\n  ❌ ${failed} test(s) failed.`);
    process.exit(1);
  } else {
    console.log(`\n  ✅ All tests passed!`);
    console.log('  The Exec Approval Bridge correctly routes OpenClaw approval');
    console.log('  requests through Wooblay Gate for policy evaluation.\n');
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

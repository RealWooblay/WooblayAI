#!/usr/bin/env npx tsx
/**
 * Wooblay Agent Simulator
 *
 * Demonstrates the full decision flow:
 *   1. Generate an ephemeral ed25519 keypair for this agent
 *   2. Register the agent with Gate
 *   3. Send a series of tool calls with different risk tiers
 *   4. Print results, receipt IDs, and the decision flow
 *
 * Usage:
 *   npx tsx scripts/simulate-agent.ts [--gate-url http://localhost:4800]
 */

import { generateKeyPair, sign } from '@wooblay/crypto';
import { GateClient } from '@wooblay/gate-client';
import type { ToolExecuteResponse } from '@wooblay/types';

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

function printDecision(label: string, res: ToolExecuteResponse): void {
  const icon =
    res.decision === 'EXECUTE' ? '✅' :
    res.decision === 'DENY' ? '🚫' :
    '⏳';

  console.log(`\n  ${icon} ${label}`);
  console.log(`     Decision:   ${res.decision}`);
  console.log(`     Tool Call:  ${res.toolCallId}`);
  if (res.receiptId) {
    console.log(`     Receipt:    ${res.receiptId}`);
  }
  if (res.approvalId) {
    console.log(`     Approval:   ${res.approvalId}`);
  }
  if (res.reason) {
    console.log(`     Reason:     ${res.reason}`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  banner('Wooblay Agent Simulator');
  console.log(`  Gate URL: ${GATE_URL}`);

  // ── Step 1: Generate ephemeral agent keypair ─────────────────────────
  banner('Step 1: Generate Ephemeral Agent Keypair');
  const agentKeys = generateKeyPair();
  console.log(`  Public Key:  ${agentKeys.publicKey.slice(0, 40)}...`);
  console.log(`  Private Key: [hidden]`);

  // ── Create Gate client with agent credentials ────────────────────────
  const gate = new GateClient({
    baseUrl: GATE_URL,
    agentPubkey: agentKeys.publicKey,
    agentPrivateKey: agentKeys.privateKey,
  });

  // ── Step 2: Check Gate health ────────────────────────────────────────
  banner('Step 2: Check Gate Health');
  try {
    const health = await gate.health();
    console.log(`  Status:    ${health.status}`);
    console.log(`  Version:   ${health.version}`);
    console.log(`  Timestamp: ${health.timestamp}`);
  } catch (err) {
    console.error(`  ✗ Gate is not reachable at ${GATE_URL}`);
    console.error(`    Make sure Gate is running: pnpm --filter @wooblay/gate dev`);
    process.exit(1);
  }

  // ── Step 3: Register the agent ───────────────────────────────────────
  banner('Step 3: Register Agent');
  try {
    const agent = await gate.createAgent({
      pubkey: agentKeys.publicKey,
      name: `simulator-${Date.now()}`,
      allowlisted: true,
    });
    console.log(`  Agent registered: ${agent.name}`);
    console.log(`  Allowlisted:     ${agent.allowlisted}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ✗ Failed to register agent: ${msg}`);
    process.exit(1);
  }

  // ── Step 4: Send tool calls ──────────────────────────────────────────
  banner('Step 4: Tool Call Sequence');

  const toolCalls = [
    {
      label: 'READ – List directory (ls -la)',
      toolName: 'wooblay_exec',
      args: { command: 'ls -la /tmp' },
    },
    {
      label: 'WRITE – Create directory (mkdir /tmp/wooblay-test)',
      toolName: 'wooblay_exec',
      args: { command: 'mkdir /tmp/wooblay-test' },
    },
    {
      label: 'DESTRUCTIVE – Remove directory (rm -rf /tmp/wooblay-test)',
      toolName: 'wooblay_exec',
      args: { command: 'rm -rf /tmp/wooblay-test' },
    },
  ];

  const results: ToolExecuteResponse[] = [];

  for (const tc of toolCalls) {
    try {
      const payload = {
        toolName: tc.toolName,
        args: tc.args,
        agentPubkey: agentKeys.publicKey,
        requestSignature: sign(
          { toolName: tc.toolName, args: tc.args },
          agentKeys.privateKey,
        ),
        adapter: 'simulator',
      };

      const res = await gate.toolExecute(payload);
      results.push(res);
      printDecision(tc.label, res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`\n  ✗ ${tc.label}`);
      console.log(`     Error: ${msg}`);
    }
  }

  // ── Step 5: Summary ──────────────────────────────────────────────────
  banner('Decision Flow Summary');

  const byDecision = results.reduce<Record<string, number>>((acc, r) => {
    acc[r.decision] = (acc[r.decision] || 0) + 1;
    return acc;
  }, {});

  console.log('  Results:');
  for (const [decision, count] of Object.entries(byDecision)) {
    console.log(`    ${decision}: ${count}`);
  }

  const receipts = results.filter((r) => r.receiptId);
  if (receipts.length > 0) {
    console.log('\n  Receipts:');
    for (const r of receipts) {
      console.log(`    ${r.receiptId}`);
    }
  }

  console.log('\n  Flow: Agent → Gate → Policy Engine → Decision → Receipt');
  console.log('  Each tool call is evaluated, logged, and a receipt is issued.');

  // ── Step 6: Verify a receipt (if any were issued) ────────────────────
  if (receipts.length > 0) {
    banner('Step 5: Verify Receipt');
    const receiptId = receipts[0].receiptId!;
    try {
      const verification = await gate.verifyReceipt(receiptId);
      console.log(`  Receipt: ${receiptId}`);
      console.log(`  Valid:   ${verification.valid}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  ✗ Could not verify receipt: ${msg}`);
    }
  }

  banner('Simulation Complete');
  console.log('  All tool calls have been processed through Wooblay Gate.');
  console.log('  Open the UI at http://localhost:5173 to view the dashboard.\n');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

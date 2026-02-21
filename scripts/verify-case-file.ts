#!/usr/bin/env npx tsx
/**
 * Wooblay Case File Verifier
 *
 * Standalone script that verifies the integrity of an exported case file.
 * Given a JSON case file, it checks:
 * 1. Content hash matches the case file data
 * 2. Receipt chain is intact (each receipt links to previous via chainPrev)
 * 3. Evidence hashes are present and consistent
 *
 * Usage:
 *   npx tsx scripts/verify-case-file.ts <path-to-case-file.json>
 *   cat case-file.json | npx tsx scripts/verify-case-file.ts -
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

// ── Types ───────────────────────────────────────────────────────────────

interface CaseFileExport {
  caseFile: {
    version: string;
    exportedAt: string;
    run: { id: string; status: string; priority: string };
    incident: { id: string; title: string; source: string };
    proposals: Array<{
      id: string;
      actionClass: string;
      status: string;
      policySnapshot: unknown | null;
      evidence: { inputsHash: string | null; outputsHash: string | null } | null;
    }>;
    evidenceBundles: Array<{
      id: string;
      environmentHash: string | null;
      inputsHash: string | null;
      outputsHash: string | null;
      reproducible: boolean;
    }>;
    receipts: Array<{
      id: string;
      hash: string;
      signature: string;
      chainPrev: string | null;
      timestamp: string;
    }>;
    timeline: Array<{ type: string; timestamp: string; sequenceNum: number }>;
    verifications?: Array<{
      id: string;
      proposalId: string;
      status: string;
      observedHash: string | null;
    }>;
    artifacts?: Array<{
      id: string;
      type: string;
      path: string;
      contentHash: string;
      sizeBytes: number;
    }>;
    evidenceEnvironments?: Array<{
      bundleId: string;
      baseImageDigest: string | null;
      dependencyHash: string | null;
    }>;
  };
  integrity: {
    contentHash: string;
    receiptChainValid: boolean;
    receiptCount: number;
    evidenceCount: number;
    proposalCount: number;
    verificationCount?: number;
    artifactCount?: number;
    artifactManifestHash?: string;
  };
}

// ── Verification ────────────────────────────────────────────────────────

function verify(exported: CaseFileExport): {
  valid: boolean;
  checks: { name: string; passed: boolean; detail?: string }[];
} {
  const checks: { name: string; passed: boolean; detail?: string }[] = [];

  // 1. Verify content hash
  const recomputedHash = createHash('sha256')
    .update(JSON.stringify(exported.caseFile))
    .digest('hex');

  const contentHashValid = recomputedHash === exported.integrity.contentHash;
  checks.push({
    name: 'Content hash integrity',
    passed: contentHashValid,
    detail: contentHashValid
      ? `Hash matches: ${recomputedHash.slice(0, 16)}...`
      : `MISMATCH: expected ${exported.integrity.contentHash.slice(0, 16)}..., got ${recomputedHash.slice(0, 16)}...`,
  });

  // 2. Verify receipt chain
  const receipts = exported.caseFile.receipts;
  let chainValid = true;
  let brokenAt = -1;

  for (let i = 1; i < receipts.length; i++) {
    if (receipts[i]!.chainPrev !== receipts[i - 1]!.hash) {
      chainValid = false;
      brokenAt = i;
      break;
    }
  }

  checks.push({
    name: 'Receipt chain integrity',
    passed: chainValid,
    detail: chainValid
      ? `${receipts.length} receipts, chain intact`
      : `Chain broken at receipt index ${brokenAt}`,
  });

  // 3. Verify receipt count matches
  const countMatch = receipts.length === exported.integrity.receiptCount;
  checks.push({
    name: 'Receipt count consistency',
    passed: countMatch,
    detail: `${receipts.length} receipts in file, ${exported.integrity.receiptCount} declared`,
  });

  // 4. Verify evidence bundles have hashes
  const evidenceBundles = exported.caseFile.evidenceBundles;
  const evidenceIntegrity = evidenceBundles.every(
    (eb) => eb.inputsHash || eb.environmentHash || eb.outputsHash,
  );
  checks.push({
    name: 'Evidence bundles have integrity hashes',
    passed: evidenceIntegrity || evidenceBundles.length === 0,
    detail: `${evidenceBundles.length} bundles, ${evidenceBundles.filter((eb) => eb.reproducible).length} reproducible`,
  });

  // 5. Verify timeline ordering
  const timeline = exported.caseFile.timeline;
  let timelineOrdered = true;
  for (let i = 1; i < timeline.length; i++) {
    if (timeline[i]!.sequenceNum <= timeline[i - 1]!.sequenceNum) {
      timelineOrdered = false;
      break;
    }
  }
  checks.push({
    name: 'Timeline sequence ordering',
    passed: timelineOrdered,
    detail: `${timeline.length} events`,
  });

  // 6. Verify artifact manifest hash (if present)
  const artifacts = exported.caseFile.artifacts ?? [];
  if (artifacts.length > 0 && exported.integrity.artifactManifestHash) {
    const recomputedManifest = artifacts.map((a) => `${a.id}:${a.contentHash}`).join('\n');
    const recomputedManifestHash = createHash('sha256').update(recomputedManifest).digest('hex');
    const manifestMatch = recomputedManifestHash === exported.integrity.artifactManifestHash;
    checks.push({
      name: 'Artifact manifest integrity',
      passed: manifestMatch,
      detail: manifestMatch
        ? `${artifacts.length} artifacts, manifest hash matches`
        : `Manifest hash MISMATCH: expected ${exported.integrity.artifactManifestHash.slice(0, 16)}, got ${recomputedManifestHash.slice(0, 16)}`,
    });

    // Check that all artifacts have content hashes
    const allHaveHashes = artifacts.every((a) => a.contentHash && a.contentHash.length === 64);
    checks.push({
      name: 'Artifact content hashes present',
      passed: allHaveHashes,
      detail: `${artifacts.filter((a) => a.contentHash).length}/${artifacts.length} have SHA-256 hashes`,
    });
  }

  // 7. Verify all verifications match proposals
  const verifications = exported.caseFile.verifications ?? [];
  if (verifications.length > 0) {
    const proposalIds = new Set(exported.caseFile.proposals.map((p) => p.id));
    const allLinked = verifications.every((v) => proposalIds.has(v.proposalId));
    checks.push({
      name: 'Verification-proposal linkage',
      passed: allLinked,
      detail: `${verifications.length} verifications, all linked to proposals: ${allLinked}`,
    });

    // Check that observed outcomes have hashes
    const withHashes = verifications.filter((v) => v.observedHash);
    checks.push({
      name: 'Verification observed outcome hashes',
      passed: withHashes.length === verifications.filter((v) => v.status !== 'skipped').length,
      detail: `${withHashes.length}/${verifications.length} have observed outcome hashes`,
    });
  }

  // 8. Evidence environment pinning (if present)
  const envs = exported.caseFile.evidenceEnvironments ?? [];
  if (envs.length > 0) {
    const bundleIds = new Set(exported.caseFile.evidenceBundles.map((eb) => eb.id));
    const allLinked = envs.every((e) => bundleIds.has(e.bundleId));
    checks.push({
      name: 'Evidence environment manifests linked',
      passed: allLinked,
      detail: `${envs.length} environment manifests for ${exported.caseFile.evidenceBundles.length} bundles`,
    });
  }

  // 9. Policy snapshot audit trail
  const proposalsWithPolicy = exported.caseFile.proposals.filter((p) => p.policySnapshot);
  if (exported.caseFile.proposals.length > 0) {
    checks.push({
      name: 'Policy snapshots captured',
      passed: proposalsWithPolicy.length > 0,
      detail: `${proposalsWithPolicy.length}/${exported.caseFile.proposals.length} proposals have frozen policy snapshots`,
    });
  }

  // 10. Version check
  checks.push({
    name: 'Case file version',
    passed: exported.caseFile.version === '1.0.0',
    detail: `Version: ${exported.caseFile.version}`,
  });

  const allPassed = checks.every((c) => c.passed);

  return { valid: allPassed, checks };
}

// ── Main ────────────────────────────────────────────────────────────────

function main() {
  const inputPath = process.argv[2];

  if (!inputPath) {
    console.error('Usage: npx tsx scripts/verify-case-file.ts <path-to-case-file.json>');
    console.error('       cat case-file.json | npx tsx scripts/verify-case-file.ts -');
    process.exit(1);
  }

  let rawJson: string;
  if (inputPath === '-') {
    rawJson = readFileSync('/dev/stdin', 'utf-8');
  } else {
    rawJson = readFileSync(inputPath, 'utf-8');
  }

  let exported: CaseFileExport;
  try {
    exported = JSON.parse(rawJson);
  } catch {
    console.error('Error: Invalid JSON in case file');
    process.exit(1);
  }

  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║         Wooblay Case File Verifier              ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log();
  console.log(`Run:      ${exported.caseFile.run.id}`);
  console.log(`Status:   ${exported.caseFile.run.status}`);
  console.log(`Incident: ${exported.caseFile.incident.title}`);
  console.log(`Exported: ${exported.caseFile.exportedAt}`);
  console.log();

  const result = verify(exported);

  for (const check of result.checks) {
    const icon = check.passed ? '✓' : '✗';
    const color = check.passed ? '\x1b[32m' : '\x1b[31m';
    console.log(`${color}  ${icon} ${check.name}\x1b[0m`);
    if (check.detail) {
      console.log(`    ${check.detail}`);
    }
  }

  console.log();
  if (result.valid) {
    console.log('\x1b[32m  VERIFIED: Case file integrity confirmed.\x1b[0m');
  } else {
    console.log('\x1b[31m  FAILED: Case file integrity check failed.\x1b[0m');
  }

  process.exit(result.valid ? 0 : 1);
}

main();

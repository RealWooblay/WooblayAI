/**
 * Migration script: AuditFlag → Analysis
 *
 * Converts existing AuditFlag records to Analysis records.
 * Run once after deploying the new schema.
 *
 * Usage: npx tsx scripts/migrate-audit-flags.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const CATEGORY_TO_FINDING_CODE: Record<string, string> = {
  velocity_anomaly: 'RETRY_LOOP',
  evasion_pattern: 'APPROVAL_BYPASS',
  sensitive_access: 'DESTRUCTIVE_CMD',
  privilege_escalation: 'DESTRUCTIVE_CMD',
  unusual_pattern: 'COST_TIME_BASELINE',
};

async function migrate() {
  const flags = await prisma.auditFlag.findMany({
    orderBy: { createdAt: 'asc' },
  });

  console.log(`Found ${flags.length} AuditFlag records to migrate.`);

  let migrated = 0;
  let skipped = 0;

  for (const flag of flags) {
    // Skip dismissed flags
    if (flag.dismissed) {
      skipped++;
      continue;
    }

    const findingCode = CATEGORY_TO_FINDING_CODE[flag.category] ?? 'COST_TIME_BASELINE';

    const finding = {
      code: findingCode,
      message: `[Migrated from AuditFlag] ${flag.title}: ${flag.description}`,
      evidenceRefs: flag.toolCallId ? [flag.toolCallId] : [],
      confidence: flag.severity === 'CRITICAL' ? 0.95 : flag.severity === 'HIGH' ? 0.8 : 0.5,
      suggestedAction: 'info-only' as const,
      detectedAt: flag.createdAt.toISOString(),
    };

    await prisma.analysis.create({
      data: {
        agentPubkey: flag.agentPubkey ?? 'unknown',
        severity: flag.severity,
        tags: JSON.stringify([flag.category]),
        summary: `${flag.title}: ${flag.description}`,
        findings: JSON.stringify([finding]),
        createdAt: flag.createdAt,
      },
    });

    migrated++;
  }

  console.log(`Migration complete: ${migrated} migrated, ${skipped} skipped (dismissed).`);
}

migrate()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

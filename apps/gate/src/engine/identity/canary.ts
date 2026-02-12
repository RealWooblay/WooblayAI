/**
 * Canary System
 *
 * Honeypot primitives for detecting agents that explore beyond their scope.
 * Operators plant canary values (paths, credentials, URLs, tokens).
 * If an agent accesses them, it proves malicious or uncontrolled behavior.
 */

import type { PrismaClient } from '@prisma/client';

export interface CanaryMatch {
  canaryId: string;
  type: string;
  value: string;
  description: string;
}

/**
 * Check a tool call's arguments against all active canaries.
 * Returns matching canaries (may be empty).
 */
export async function checkCanaries(
  prisma: PrismaClient,
  toolName: string,
  args: Record<string, unknown>,
): Promise<CanaryMatch[]> {
  const canaries = await prisma.canary.findMany({
    where: { active: true, trippedBy: null },
  });

  if (canaries.length === 0) return [];

  // Flatten args into searchable strings
  const argsStr = JSON.stringify(args).toLowerCase();
  const command = String(args['command'] ?? args['cmd'] ?? '').toLowerCase();
  const url = String(args['url'] ?? args['endpoint'] ?? '').toLowerCase();

  const matches: CanaryMatch[] = [];

  for (const canary of canaries) {
    const val = canary.value.toLowerCase();
    let matched = false;

    switch (canary.type) {
      case 'path':
        // Check if the path appears in command or any string arg
        matched = command.includes(val) || argsStr.includes(val);
        break;

      case 'credential':
      case 'token':
        // Substring match anywhere in args
        matched = argsStr.includes(val);
        break;

      case 'url':
        // Check URL args or command for the canary URL/domain
        matched = url.includes(val) || command.includes(val) || argsStr.includes(val);
        break;
    }

    if (matched) {
      matches.push({
        canaryId: canary.id,
        type: canary.type,
        value: canary.value,
        description: canary.description,
      });
    }
  }

  return matches;
}

/**
 * Mark a canary as tripped by a specific agent.
 */
export async function tripCanary(
  prisma: PrismaClient,
  canaryId: string,
  agentPubkey: string,
): Promise<void> {
  await prisma.canary.update({
    where: { id: canaryId },
    data: {
      trippedBy: agentPubkey,
      trippedAt: new Date(),
    },
  });
}

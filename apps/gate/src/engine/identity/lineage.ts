/**
 * Agent Lineage Tree
 *
 * Manages parent/child relationships when agents spawn sub-agents.
 * Trust inherits with decay through the spawn tree.
 */

import type { PrismaClient } from '@prisma/client';
import type { SpawnScope, LineageNode, TrustLevel } from '@wooblay/types';
import { TRUST_THRESHOLDS } from '@wooblay/types';

/** Trust inheritance discount per spawn depth level. */
export const TRUST_INHERITANCE_FACTOR = 0.7;

/** Maximum allowed spawn depth (deeper = automatically suspicious). */
export const MAX_SPAWN_DEPTH = 5;

/**
 * Compute the trust level from a numeric trust score.
 */
export function trustLevelFromScore(score: number): TrustLevel {
  if (score >= TRUST_THRESHOLDS['autonomous']) return 'autonomous';
  if (score >= TRUST_THRESHOLDS['write-with-approvals']) return 'write-with-approvals';
  return 'read-only';
}

/**
 * Compute inherited trust score for a child agent.
 *
 * childTrustScore = parentTrustScore * TRUST_INHERITANCE_FACTOR^spawnDepth
 */
export function computeInheritedTrust(parentScore: number, childSpawnDepth: number): number {
  return Math.max(0, Math.min(100, parentScore * Math.pow(TRUST_INHERITANCE_FACTOR, childSpawnDepth)));
}

/**
 * Cap a trust level by a risk ceiling from a spawn attestation.
 */
export function capTrustByRiskCeiling(level: TrustLevel, riskCeiling: string | undefined): TrustLevel {
  if (!riskCeiling) return level;

  const ceilingMap: Record<string, TrustLevel> = {
    READ: 'read-only',
    WRITE: 'write-with-approvals',
    DESTRUCTIVE: 'autonomous',
  };

  const maxLevel = ceilingMap[riskCeiling] ?? 'read-only';
  const order: TrustLevel[] = ['read-only', 'write-with-approvals', 'autonomous'];
  const levelIdx = order.indexOf(level);
  const maxIdx = order.indexOf(maxLevel);

  return order[Math.min(levelIdx, maxIdx)];
}

/**
 * Register a child agent spawn. Creates the child Agent record + SpawnAttestation.
 * Returns the newly created agent and attestation IDs.
 */
export async function registerSpawn(
  prisma: PrismaClient,
  data: {
    spawnerPubkey: string;
    spawnedPubkey: string;
    spawnedName: string;
    purpose: string;
    scope?: SpawnScope;
    signature: string;
  },
): Promise<{ agentId: string; attestationId: string; trustScore: number; trustLevel: TrustLevel }> {
  // Look up the parent
  const parent = await prisma.agent.findUnique({
    where: { pubkey: data.spawnerPubkey },
  });

  if (!parent) {
    throw new Error(`Spawner agent not found: ${data.spawnerPubkey}`);
  }

  if (parent.status !== 'active') {
    throw new Error(`Spawner agent is not active: ${parent.status}`);
  }

  const childSpawnDepth = parent.spawnDepth + 1;
  const inheritedScore = computeInheritedTrust(parent.trustScore, childSpawnDepth);
  let childTrustLevel = trustLevelFromScore(inheritedScore);

  // Cap by risk ceiling if specified
  if (data.scope?.riskCeiling) {
    childTrustLevel = capTrustByRiskCeiling(childTrustLevel, data.scope.riskCeiling);
  }

  // Create child agent + attestation in transaction
  const result = await prisma.$transaction(async (tx) => {
    // Upsert agent (might already exist from a previous spawn)
    const agent = await tx.agent.upsert({
      where: { pubkey: data.spawnedPubkey },
      update: {
        name: data.spawnedName,
        parentPubkey: data.spawnerPubkey,
        spawnDepth: childSpawnDepth,
        trustScore: inheritedScore,
        trustLevel: childTrustLevel,
        status: 'active',
      },
      create: {
        pubkey: data.spawnedPubkey,
        name: data.spawnedName,
        status: 'active',
        allowlisted: parent.allowlisted, // inherit parent's allowlist status
        trustLevel: childTrustLevel,
        trustScore: inheritedScore,
        parentPubkey: data.spawnerPubkey,
        spawnDepth: childSpawnDepth,
      },
    });

    const attestation = await tx.spawnAttestation.create({
      data: {
        spawnerPubkey: data.spawnerPubkey,
        spawnedPubkey: data.spawnedPubkey,
        purpose: data.purpose,
        scopeJson: data.scope ? JSON.stringify(data.scope) : null,
        signature: data.signature,
      },
    });

    return { agentId: agent.id, attestationId: attestation.id };
  });

  return {
    ...result,
    trustScore: inheritedScore,
    trustLevel: childTrustLevel,
  };
}

/**
 * Build a lineage tree starting from a given agent pubkey.
 * Returns the full tree downward (all descendants).
 */
export async function buildLineageTree(
  prisma: PrismaClient,
  rootPubkey: string,
): Promise<LineageNode | null> {
  const agent = await prisma.agent.findUnique({
    where: { pubkey: rootPubkey },
    include: { children: true },
  });

  if (!agent) return null;

  const node: LineageNode = {
    pubkey: agent.pubkey,
    name: agent.name,
    status: agent.status,
    trustLevel: agent.trustLevel as TrustLevel,
    trustScore: agent.trustScore,
    spawnDepth: agent.spawnDepth,
    children: [],
  };

  // Recursively build children
  for (const child of agent.children) {
    const childNode = await buildLineageTree(prisma, child.pubkey);
    if (childNode) {
      node.children.push(childNode);
    }
  }

  return node;
}

/**
 * Get the full lineage path from root to the given agent.
 */
export async function getAncestorChain(
  prisma: PrismaClient,
  agentPubkey: string,
): Promise<Array<{ pubkey: string; name: string; trustScore: number }>> {
  const chain: Array<{ pubkey: string; name: string; trustScore: number }> = [];
  let currentPubkey: string | null = agentPubkey;

  while (currentPubkey) {
    const agent: any = await prisma.agent.findUnique({
      where: { pubkey: currentPubkey },
      select: { pubkey: true, name: true, trustScore: true, parentPubkey: true },
    });

    if (!agent) break;
    chain.unshift({ pubkey: agent.pubkey, name: agent.name, trustScore: agent.trustScore });
    currentPubkey = agent.parentPubkey;
  }

  return chain;
}

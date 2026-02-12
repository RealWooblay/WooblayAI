/**
 * Seed default beta coupon on first startup.
 * Only runs in platform mode and only if no coupons exist.
 */

import type { PrismaClient } from '@prisma/client';

export async function seedDefaultCoupon(prisma: PrismaClient): Promise<boolean> {
  const count = await prisma.coupon.count();
  if (count > 0) return false;

  await prisma.coupon.create({
    data: {
      code: 'WOOBLAY-BETA-2026',
      maxUses: 500,
      currentUses: 0,
      metadata: JSON.stringify({ type: 'beta', note: 'Default beta access code' }),
    },
  });

  return true;
}

/**
 * User management routes (platform mode only).
 *
 * POST /api/webhooks/clerk     — Clerk webhook: user.created / user.updated / user.deleted
 * GET  /api/users/me           — Get current user profile + activation status
 * POST /api/coupons/redeem     — Redeem access code to activate account
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db/client.js';
import { config } from '../config.js';

export async function userRoutes(app: FastifyInstance): Promise<void> {
  // These routes only exist in platform mode
  if (!config.PLATFORM_MODE) return;

  /**
   * POST /api/webhooks/clerk — Clerk webhook receiver.
   *
   * Syncs user data from Clerk to our database.
   * In production, verify the webhook signature. For MVP, trust the payload.
   */
  app.post('/api/webhooks/clerk', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as {
      type: string;
      data: {
        id: string;
        email_addresses?: Array<{ email_address: string; id: string }>;
        first_name?: string;
        last_name?: string;
        image_url?: string;
      };
    };

    const { type, data } = body;
    const clerkId = data.id;
    const email = data.email_addresses?.[0]?.email_address ?? '';
    const name = [data.first_name, data.last_name].filter(Boolean).join(' ') || null;
    const avatarUrl = data.image_url ?? null;

    try {
      if (type === 'user.created') {
        await prisma.user.upsert({
          where: { clerkId },
          create: { clerkId, email, name, avatarUrl, activated: false },
          update: { email, name, avatarUrl },
        });
      } else if (type === 'user.updated') {
        await prisma.user.upsert({
          where: { clerkId },
          create: { clerkId, email, name, avatarUrl },
          update: { email, name, avatarUrl },
        });
      } else if (type === 'user.deleted') {
        await prisma.user.deleteMany({ where: { clerkId } });
      }

      return reply.send({ received: true });
    } catch (err) {
      request.log.error(err, 'Clerk webhook processing failed');
      return reply.code(500).send({ error: 'Webhook processing failed' });
    }
  });

  /**
   * GET /api/users/me — Current user profile.
   *
   * Returns the user record for the authenticated Clerk user.
   * If the user doesn't exist in our DB yet (webhook race condition), create them.
   */
  app.get('/api/users/me', async (request: FastifyRequest, reply: FastifyReply) => {
    const clerkUserId = request.clerkUserId;
    if (!clerkUserId) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    try {
      let user = await prisma.user.findUnique({ where: { clerkId: clerkUserId } });

      // Auto-create if webhook hasn't fired yet
      if (!user) {
        user = await prisma.user.create({
          data: {
            clerkId: clerkUserId,
            email: `pending-${clerkUserId}@wooblay.com`,
            activated: false,
          },
        });
      }

      return reply.send({
        id: user.id,
        clerkId: user.clerkId,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
        activated: user.activated,
        createdAt: user.createdAt,
      });
    } catch (err) {
      request.log.error(err, 'Failed to get user profile');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * POST /api/coupons/redeem — Redeem an access code.
   *
   * Body: { code: string }
   * Activates the user's account if the code is valid.
   */
  app.post('/api/coupons/redeem', async (request: FastifyRequest, reply: FastifyReply) => {
    const clerkUserId = request.clerkUserId;
    if (!clerkUserId) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const { code } = request.body as { code?: string };
    if (!code || typeof code !== 'string') {
      return reply.code(400).send({ error: 'Missing "code" field' });
    }

    try {
      // Find or create user
      let user = await prisma.user.findUnique({ where: { clerkId: clerkUserId } });
      if (!user) {
        user = await prisma.user.create({
          data: { clerkId: clerkUserId, email: `pending-${clerkUserId}@wooblay.com`, activated: false },
        });
      }

      if (user.activated) {
        return reply.send({ ok: true, message: 'Account already activated' });
      }

      // Find coupon
      const coupon = await prisma.coupon.findUnique({ where: { code: code.trim().toUpperCase() } });
      if (!coupon) {
        return reply.code(400).send({ error: 'Invalid access code' });
      }

      // Check limits
      if (coupon.maxUses > 0 && coupon.currentUses >= coupon.maxUses) {
        return reply.code(400).send({ error: 'This access code has reached its maximum uses' });
      }
      if (coupon.expiresAt && new Date() > coupon.expiresAt) {
        return reply.code(400).send({ error: 'This access code has expired' });
      }

      // Check if already redeemed by this user
      const existing = await prisma.userCoupon.findUnique({
        where: { userId_couponId: { userId: user.id, couponId: coupon.id } },
      });
      if (existing) {
        return reply.send({ ok: true, message: 'Code already redeemed' });
      }

      // Redeem
      await prisma.$transaction([
        prisma.userCoupon.create({
          data: { userId: user.id, couponId: coupon.id },
        }),
        prisma.coupon.update({
          where: { id: coupon.id },
          data: { currentUses: { increment: 1 } },
        }),
        prisma.user.update({
          where: { id: user.id },
          data: { activated: true },
        }),
      ]);

      return reply.send({ ok: true, message: 'Account activated!' });
    } catch (err) {
      request.log.error(err, 'Coupon redemption failed');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });
}

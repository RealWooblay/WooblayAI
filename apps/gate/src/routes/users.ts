/**
 * User management routes (platform mode only).
 *
 * POST /api/webhooks/clerk     — Clerk webhook: user / organization / membership events
 * GET  /api/users/me           — Get current user profile + activation status
 * POST /api/coupons/redeem     — Redeem access code to activate account
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { prisma } from '../db/client.js';
import { config } from '../config.js';

export async function userRoutes(app: FastifyInstance): Promise<void> {
  // These routes only exist in platform mode
  if (!config.PLATFORM_MODE) return;

  /**
   * POST /api/webhooks/clerk — Clerk webhook receiver.
   *
   * Syncs user, organization, and membership data from Clerk to our database.
   * If CLERK_WEBHOOK_SECRET is set, verifies the Svix webhook signature.
   */
  app.post('/api/webhooks/clerk', async (request: FastifyRequest, reply: FastifyReply) => {
    // ── Signature verification ──────────────────────────────────────────
    if (config.CLERK_WEBHOOK_SECRET) {
      const svixId = request.headers['svix-id'] as string | undefined;
      const svixTimestamp = request.headers['svix-timestamp'] as string | undefined;
      const svixSignature = request.headers['svix-signature'] as string | undefined;

      if (!svixId || !svixTimestamp || !svixSignature) {
        return reply.code(400).send({ error: 'Missing Svix signature headers' });
      }

      const rawBody = typeof request.body === 'string'
        ? request.body
        : JSON.stringify(request.body);

      const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;
      const secret = config.CLERK_WEBHOOK_SECRET.startsWith('whsec_')
        ? config.CLERK_WEBHOOK_SECRET.slice(6)
        : config.CLERK_WEBHOOK_SECRET;
      const secretBytes = Buffer.from(secret, 'base64');
      const expected = createHmac('sha256', secretBytes)
        .update(signedContent, 'utf8')
        .digest('base64');

      const signatures = svixSignature.split(' ');
      const verified = signatures.some((sig) => {
        const sigValue = sig.startsWith('v1,') ? sig.slice(3) : sig;
        try {
          const sigBuf = Buffer.from(sigValue, 'utf8');
          const expBuf = Buffer.from(expected, 'utf8');
          return sigBuf.length === expBuf.length && timingSafeEqual(sigBuf, expBuf);
        } catch {
          return false;
        }
      });

      if (!verified) {
        request.log.warn('Clerk webhook signature verification failed');
        return reply.code(401).send({ error: 'Invalid webhook signature' });
      }
    } else if (config.NODE_ENV === 'production') {
      request.log.error('CLERK_WEBHOOK_SECRET not set in production — rejecting webhook');
      return reply.code(500).send({ error: 'Webhook secret not configured' });
    }

    // ── Process events ──────────────────────────────────────────────────
    const body = request.body as {
      type: string;
      data: Record<string, any>;
    };

    const { type, data } = body;

    try {
      // ── User events ─────────────────────────────────────────────────
      if (type === 'user.created' || type === 'user.updated') {
        const clerkId = data.id as string;
        const email = data.email_addresses?.[0]?.email_address ?? '';
        const name = [data.first_name, data.last_name].filter(Boolean).join(' ') || null;
        const avatarUrl = data.image_url ?? null;

        await prisma.user.upsert({
          where: { clerkId },
          create: { clerkId, email, name, avatarUrl, activated: type === 'user.updated' },
          update: { email, name, avatarUrl },
        });
      } else if (type === 'user.deleted') {
        const clerkId = data.id as string;
        await prisma.user.deleteMany({ where: { clerkId } });
      }

      // ── Organization events ─────────────────────────────────────────
      else if (type === 'organization.created' || type === 'organization.updated') {
        const orgId = data.id as string;
        const orgName = (data.name as string) ?? 'Unnamed';
        const slug = (data.slug as string) ?? null;
        const imageUrl = (data.image_url as string) ?? null;

        await prisma.organization.upsert({
          where: { id: orgId },
          create: { id: orgId, name: orgName, slug, imageUrl },
          update: { name: orgName, slug, imageUrl },
        });
      } else if (type === 'organization.deleted') {
        const orgId = data.id as string;
        // Unlink users before deleting the org
        await prisma.user.updateMany({
          where: { orgId },
          data: { orgId: null, role: 'member' },
        });
        await prisma.organization.deleteMany({ where: { id: orgId } });
      }

      // ── Membership events ──────────────────────────────────────────
      else if (type === 'organizationMembership.created' || type === 'organizationMembership.updated') {
        const orgId = data.organization?.id as string | undefined;
        const clerkUserId = data.public_user_data?.user_id as string | undefined;
        const orgRole = (data.role as string) ?? 'org:member';

        if (orgId && clerkUserId) {
          await prisma.user.updateMany({
            where: { clerkId: clerkUserId },
            data: { orgId, role: orgRole },
          });
        }
      } else if (type === 'organizationMembership.deleted') {
        const clerkUserId = data.public_user_data?.user_id as string | undefined;
        if (clerkUserId) {
          await prisma.user.updateMany({
            where: { clerkId: clerkUserId },
            data: { orgId: null, role: 'member' },
          });
        }
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
        orgId: user.orgId,
        role: user.role,
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

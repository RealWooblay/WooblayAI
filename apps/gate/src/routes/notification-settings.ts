/**
 * User notification settings routes.
 *
 * GET  /api/notification-settings           — fetch current user's settings
 * PATCH /api/notification-settings          — update channels, phone, telegramChatId, slackWebhookUrl
 * POST  /api/notification-settings/test     — send a test notification
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db/client.js';
import { sendNotification } from '../services/notifications.js';

export async function notificationSettingsRoutes(app: FastifyInstance) {
  app.get(
    '/api/notification-settings',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const clerkId = request.user?.clerkId;
      if (!clerkId) return reply.code(401).send({ error: 'Unauthorized' });

      const user = await prisma.user.findFirst({
        where: { clerkId },
        select: {
          email: true,
          phone: true,
          telegramChatId: true,
          slackWebhookUrl: true,
          notifyChannels: true,
        },
      });

      if (!user) return reply.code(404).send({ error: 'User not found' });

      return reply.send({
        email: user.email,
        phone: user.phone,
        telegramChatId: user.telegramChatId,
        slackWebhookUrl: user.slackWebhookUrl,
        channels: user.notifyChannels.split(',').map((c) => c.trim()).filter(Boolean),
        availableChannels: {
          telegram: !!process.env.TELEGRAM_BOT_TOKEN,
          slack: true,
          whatsapp: !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID),
          email: !!process.env.SMTP_HOST,
        },
      });
    },
  );

  app.patch(
    '/api/notification-settings',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const clerkId = request.user?.clerkId;
      if (!clerkId) return reply.code(401).send({ error: 'Unauthorized' });

      const body = request.body as {
        phone?: string | null;
        telegramChatId?: string | null;
        slackWebhookUrl?: string | null;
        channels?: string[];
      };

      const user = await prisma.user.findFirst({ where: { clerkId } });
      if (!user) return reply.code(404).send({ error: 'User not found' });

      const validChannels = ['telegram', 'slack', 'whatsapp', 'email'];
      const updateData: Record<string, unknown> = {};

      if (body.phone !== undefined) {
        if (body.phone && !/^\+[1-9]\d{6,14}$/.test(body.phone)) {
          return reply.code(400).send({ error: 'Phone must be E.164 format (e.g. +14155551234)' });
        }
        updateData.phone = body.phone;
      }

      if (body.telegramChatId !== undefined) {
        updateData.telegramChatId = body.telegramChatId;
      }

      if (body.slackWebhookUrl !== undefined) {
        if (body.slackWebhookUrl && !body.slackWebhookUrl.startsWith('https://hooks.slack.com/')) {
          return reply.code(400).send({ error: 'Slack webhook URL must start with https://hooks.slack.com/' });
        }
        updateData.slackWebhookUrl = body.slackWebhookUrl;
      }

      if (body.channels) {
        const filtered = body.channels.filter((c) => validChannels.includes(c));
        if (filtered.length === 0) {
          return reply.code(400).send({ error: 'At least one valid channel required (telegram, slack, whatsapp, email)' });
        }
        updateData.notifyChannels = filtered.join(',');
      }

      const updated = await prisma.user.update({
        where: { id: user.id },
        data: updateData,
        select: {
          phone: true,
          telegramChatId: true,
          slackWebhookUrl: true,
          notifyChannels: true,
        },
      });

      return reply.send({
        phone: updated.phone,
        telegramChatId: updated.telegramChatId,
        slackWebhookUrl: updated.slackWebhookUrl,
        channels: updated.notifyChannels.split(',').map((c) => c.trim()).filter(Boolean),
      });
    },
  );

  app.post(
    '/api/notification-settings/test',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const clerkId = request.user?.clerkId;
      if (!clerkId) return reply.code(401).send({ error: 'Unauthorized' });

      const user = await prisma.user.findFirst({
        where: { clerkId },
        select: { orgId: true },
      });
      if (!user?.orgId) return reply.code(400).send({ error: 'No org found' });

      await sendNotification(prisma, {
        type: 'anomaly_alert',
        orgId: user.orgId,
        title: 'Test notification from Wooblay',
        body: 'If you see this, your notification channels are working.',
      });

      return reply.send({ sent: true });
    },
  );
}

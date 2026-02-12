/**
 * Prisma client singleton.
 *
 * Re-uses a single PrismaClient instance across the application to avoid
 * exhausting database connections during development hot-reloads.
 */

import pkg from '@prisma/client';
const { PrismaClient } = pkg;

type PrismaClientType = InstanceType<typeof PrismaClient>;
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClientType };

export const prisma: PrismaClientType =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env['NODE_ENV'] === 'development'
        ? ['query', 'warn', 'error']
        : ['warn', 'error'],
  });

if (process.env['NODE_ENV'] !== 'production') {
  globalForPrisma.prisma = prisma;
}

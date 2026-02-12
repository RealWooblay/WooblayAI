# ── Stage 1: Build everything ─────────────────────────────────────────
FROM node:22-alpine AS build

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy the full monorepo (use .dockerignore to exclude node_modules, dist, etc.)
COPY . .

# Install all dependencies
RUN pnpm install --frozen-lockfile || pnpm install

# Generate Prisma client
RUN pnpm --filter @wooblay/gate exec prisma generate

# Build shared packages first, then apps
RUN pnpm --filter @wooblay/types build || true
RUN pnpm --filter @wooblay/schemas build || true
RUN pnpm --filter @wooblay/crypto build || true
RUN pnpm --filter @wooblay/gate build
RUN pnpm --filter @wooblay/ui build


# ── Stage 2: Production ──────────────────────────────────────────────
FROM node:22-alpine AS production

RUN corepack enable && corepack prepare pnpm@latest --activate
# wget for healthcheck, docker-cli + docker-compose for instance management
RUN apk add --no-cache wget docker-cli docker-cli-compose

WORKDIR /app

# Copy everything from build stage (keeps node_modules, dist, prisma client)
COPY --from=build /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/gate ./apps/gate
COPY --from=build /app/packages ./packages

# Copy built UI into Gate's public directory for serving
COPY --from=build /app/apps/ui/dist ./apps/gate/public

ENV NODE_ENV=production
ENV PORT=4800

EXPOSE 4800

# Push schema on startup (idempotent), then start the Gate server
CMD ["sh", "-c", "cd apps/gate && npx prisma db push --skip-generate 2>/dev/null; cd /app && node apps/gate/dist/server.js"]

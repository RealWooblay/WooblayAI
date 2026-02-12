/**
 * Gate server configuration — loaded from environment variables with sensible defaults.
 *
 * The Gate can run in two modes:
 *   - **platform** (PLATFORM_MODE=true): Central SaaS API — user accounts, billing, instance orchestration.
 *   - **instance** (default): Per-tenant runtime — policy eval, tool gating, receipts. Agents run here.
 */

export const config = {
  /** PostgreSQL connection string. */
  DATABASE_URL:
    process.env['DATABASE_URL'] ??
    'postgresql://wooblay:wooblay_dev@localhost:5432/wooblay_dev',

  /** Port to listen on. */
  PORT: Number(process.env['PORT'] ?? 4800),

  /** Ed25519 server private key (hex-encoded DER). Used to sign receipts. */
  WOOBLAY_SERVER_PRIVATE_KEY: process.env['WOOBLAY_SERVER_PRIVATE_KEY'] ?? '',

  /** Ed25519 server public key (hex-encoded DER). Used to verify receipts. */
  WOOBLAY_SERVER_PUBLIC_KEY: process.env['WOOBLAY_SERVER_PUBLIC_KEY'] ?? '',

  /** Current environment. */
  NODE_ENV: process.env['NODE_ENV'] ?? 'development',

  // ── Platform mode ───────────────────────────────────────────────────────
  /** Whether this Gate runs as the central platform (true) or a per-instance runtime (false). */
  PLATFORM_MODE: process.env['PLATFORM_MODE'] === 'true',

  /** Clerk publishable key (frontend sends this). */
  CLERK_PUBLISHABLE_KEY: process.env['CLERK_PUBLISHABLE_KEY'] ?? '',

  /** Clerk secret key (backend verifies JWTs). */
  CLERK_SECRET_KEY: process.env['CLERK_SECRET_KEY'] ?? '',

  /** Dashboard URL (Vercel frontend). */
  WOOBLAY_DASHBOARD_URL: process.env['WOOBLAY_DASHBOARD_URL'] ?? 'http://localhost:5173',
} as const;

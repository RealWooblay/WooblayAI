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

  /** Ed25519 server private key (hex-encoded DER). Used to sign receipts + capabilities. */
  WOOBLAY_SERVER_PRIVATE_KEY: process.env['WOOBLAY_SERVER_PRIVATE_KEY'] ?? '',

  /** Ed25519 server public key (hex-encoded DER). Used to verify receipts + capabilities. */
  WOOBLAY_SERVER_PUBLIC_KEY: process.env['WOOBLAY_SERVER_PUBLIC_KEY'] ?? '',

  /**
   * Key ID for the current signing key. Changes on rotation.
   * Old keys stay in WOOBLAY_SERVER_PUBLIC_KEYS_PREV for verification.
   */
  WOOBLAY_SERVER_KEY_ID: process.env['WOOBLAY_SERVER_KEY_ID'] ?? 'key-1',

  /**
   * Previous public keys for rotation. JSON array: [{"kid":"key-0","pub":"hex..."}]
   * Enables verification of tokens signed by rotated-out keys.
   */
  WOOBLAY_SERVER_PUBLIC_KEYS_PREV: process.env['WOOBLAY_SERVER_PUBLIC_KEYS_PREV'] ?? '[]',

  /** Current environment. */
  NODE_ENV: process.env['NODE_ENV'] ?? 'development',

  // ── Platform mode ───────────────────────────────────────────────────────
  /** Whether this Gate runs as the central platform (true) or a per-instance runtime (false). */
  PLATFORM_MODE: process.env['PLATFORM_MODE'] === 'true',

  /** Clerk publishable key (frontend sends this). */
  CLERK_PUBLISHABLE_KEY: process.env['CLERK_PUBLISHABLE_KEY'] ?? '',

  /** Clerk secret key (backend verifies JWTs). */
  CLERK_SECRET_KEY: process.env['CLERK_SECRET_KEY'] ?? '',

  /** Clerk webhook signing secret (Svix). Used to verify webhook payloads from Clerk. */
  CLERK_WEBHOOK_SECRET: process.env['CLERK_WEBHOOK_SECRET'] ?? '',

  /** Dashboard URL (Vercel frontend). */
  WOOBLAY_DASHBOARD_URL: process.env['WOOBLAY_DASHBOARD_URL'] ?? 'http://localhost:5173',

  // ── AI Analysis ────────────────────────────────────────────────────────
  /** OpenAI API key for AI-powered agent supervision. */
  OPENAI_API_KEY: process.env['OPENAI_API_KEY'] ?? '',

  /** OpenAI model for analysis. */
  OPENAI_MODEL: process.env['OPENAI_MODEL'] ?? 'gpt-4.1-mini',

  // ── Workspace Runner ──────────────────────────────────────────────────
  /** Gateway host for workspace egress rules. */
  GATEWAY_HOST: process.env['GATEWAY_HOST'] ?? '127.0.0.1',

  // ── Webhook Security ──────────────────────────────────────────────────
  /** GitHub webhook secret for HMAC-SHA256 signature verification. */
  GITHUB_WEBHOOK_SECRET: process.env['GITHUB_WEBHOOK_SECRET'] ?? '',

  // ── Encryption ────────────────────────────────────────────────────────
  /** KMS key ID or ARN for envelope encryption. MVP uses AES-256-GCM locally. */
  KMS_KEY_ID: process.env['KMS_KEY_ID'] ?? '',

  /** Master encryption key (hex-encoded, 32 bytes). Used in dev when KMS_KEY_ID is not set. */
  VAULT_MASTER_KEY: process.env['VAULT_MASTER_KEY'] ?? '',

  /**
   * Full Platform unlock password. Wooblay controls this and gives it to select customers.
   * User enters it in Settings to unlock Full Platform mode (hosted agents, sensors, etc.).
   * Default "WOBBLE" in development only; production must set env (e.g. FULL_PLATFORM_UNLOCK_PASSWORD=WOBBLE).
   */
  FULL_PLATFORM_UNLOCK_PASSWORD:
    process.env['FULL_PLATFORM_UNLOCK_PASSWORD'] ??
    (process.env['NODE_ENV'] === 'production' ? '' : 'WOBBLE'),
} as const;

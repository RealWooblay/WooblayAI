/**
 * Gate server configuration — loaded from environment variables with sensible defaults.
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

  // ── GitHub App ──────────────────────────────────────────────────────────
  /** GitHub App ID. */
  GITHUB_APP_ID: process.env['GITHUB_APP_ID'] ?? '',
  /** GitHub App private key (PEM-encoded, base64 or multi-line). */
  GITHUB_APP_PRIVATE_KEY: process.env['GITHUB_APP_PRIVATE_KEY'] ?? '',
  /** GitHub webhook secret for HMAC-SHA256 verification. */
  GITHUB_WEBHOOK_SECRET: process.env['GITHUB_WEBHOOK_SECRET'] ?? '',
  /** Dashboard URL for links in Check Runs. */
  WOOBLAY_DASHBOARD_URL: process.env['WOOBLAY_DASHBOARD_URL'] ?? 'http://localhost:5173',
} as const;

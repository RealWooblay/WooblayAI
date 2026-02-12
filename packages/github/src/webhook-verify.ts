/**
 * GitHub webhook signature verification.
 *
 * Verifies the HMAC-SHA256 signature sent in the `x-hub-signature-256` header
 * using constant-time comparison to prevent timing attacks.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verify a GitHub webhook payload signature.
 *
 * @param payload  Raw request body (string or Buffer)
 * @param signature  Value of the `x-hub-signature-256` header (e.g. "sha256=abc123...")
 * @param secret  The webhook secret configured in the GitHub App
 * @returns true if the signature is valid
 */
export function verifyWebhookSignature(
  payload: string | Buffer,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!signature) return false;

  const prefix = 'sha256=';
  if (!signature.startsWith(prefix)) return false;

  const expected = createHmac('sha256', secret)
    .update(payload)
    .digest('hex');

  const expectedFull = `${prefix}${expected}`;

  // Constant-time comparison to prevent timing attacks
  if (signature.length !== expectedFull.length) return false;

  return timingSafeEqual(
    Buffer.from(signature, 'utf8'),
    Buffer.from(expectedFull, 'utf8'),
  );
}

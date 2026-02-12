import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifyWebhookSignature } from '../webhook-verify.js';

const SECRET = 'test-webhook-secret-abc123';

function sign(payload: string, secret: string): string {
  const hmac = createHmac('sha256', secret).update(payload).digest('hex');
  return `sha256=${hmac}`;
}

describe('verifyWebhookSignature', () => {
  it('returns true for a valid signature', () => {
    const payload = JSON.stringify({ action: 'opened', number: 42 });
    const signature = sign(payload, SECRET);
    expect(verifyWebhookSignature(payload, signature, SECRET)).toBe(true);
  });

  it('returns false for an invalid signature', () => {
    const payload = JSON.stringify({ action: 'opened', number: 42 });
    expect(
      verifyWebhookSignature(payload, 'sha256=deadbeef', SECRET),
    ).toBe(false);
  });

  it('returns false for undefined signature', () => {
    const payload = JSON.stringify({ action: 'opened' });
    expect(verifyWebhookSignature(payload, undefined, SECRET)).toBe(false);
  });

  it('returns false for signature without sha256= prefix', () => {
    const payload = JSON.stringify({ action: 'opened' });
    const hmac = createHmac('sha256', SECRET).update(payload).digest('hex');
    expect(verifyWebhookSignature(payload, hmac, SECRET)).toBe(false);
  });

  it('returns false for wrong secret', () => {
    const payload = JSON.stringify({ action: 'opened' });
    const signature = sign(payload, SECRET);
    expect(verifyWebhookSignature(payload, signature, 'wrong-secret')).toBe(false);
  });

  it('handles Buffer payload', () => {
    const payload = Buffer.from(JSON.stringify({ test: true }));
    const signature = sign(payload.toString(), SECRET);
    expect(verifyWebhookSignature(payload, signature, SECRET)).toBe(true);
  });

  it('is sensitive to payload changes (tamper detection)', () => {
    const original = JSON.stringify({ action: 'opened', number: 42 });
    const signature = sign(original, SECRET);
    const tampered = JSON.stringify({ action: 'opened', number: 43 });
    expect(verifyWebhookSignature(tampered, signature, SECRET)).toBe(false);
  });

  it('returns false for signature with wrong length', () => {
    const payload = JSON.stringify({ action: 'opened' });
    expect(verifyWebhookSignature(payload, 'sha256=short', SECRET)).toBe(false);
  });
});

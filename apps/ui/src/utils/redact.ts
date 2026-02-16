/**
 * UI-layer redaction for sensitive data in event payloads, timelines,
 * and webhook payloads shown in the browser.
 *
 * More aggressive than server-side redaction:
 * - Scrubs tokens, API keys, PATs
 * - Redacts email addresses
 * - Redacts potential passwords/secrets in JSON keys
 * - Sanitizes GitHub webhook payloads (commit author emails, tokens in messages)
 */

const TOKEN_PATTERNS = [
  /ghp_[a-zA-Z0-9]{36}/g,          // GitHub PAT (classic)
  /github_pat_[a-zA-Z0-9_]{82}/g,  // GitHub PAT (fine-grained)
  /ghs_[a-zA-Z0-9]{36}/g,          // GitHub installation token
  /sk-[a-zA-Z0-9]{48}/g,           // OpenAI API key
  /Bearer\s+[a-zA-Z0-9._-]{20,}/gi, // Bearer tokens
  /AKIA[0-9A-Z]{16}/g,             // AWS access key
  /wbl_cap_v1\.[a-zA-Z0-9_-]+\.[a-f0-9]+/g, // Wooblay capability tokens
  /[a-f0-9]{64}/g,                 // 64-char hex strings (likely hashes/keys) — redact display
];

const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

const SECRET_JSON_KEYS = [
  'password', 'secret', 'token', 'api_key', 'apiKey',
  'private_key', 'privateKey', 'credential', 'credentialRef',
  'access_token', 'accessToken', 'refresh_token', 'refreshToken',
  'authorization', 'githubAppPrivateKey',
];

/**
 * Redact sensitive strings from display text.
 */
export function redactString(input: string): string {
  let output = input;
  for (const pattern of TOKEN_PATTERNS) {
    output = output.replace(pattern, '[REDACTED]');
  }
  output = output.replace(EMAIL_PATTERN, '[EMAIL]');
  return output;
}

/**
 * Deep-redact an object for UI display.
 * Handles nested objects, arrays, and sensitive keys.
 */
export function redactPayload(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === 'string') {
    return redactString(obj);
  }

  if (Array.isArray(obj)) {
    return obj.map(redactPayload);
  }

  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      // Redact values of known sensitive keys entirely
      if (SECRET_JSON_KEYS.includes(key)) {
        result[key] = '[REDACTED]';
        continue;
      }

      // Recursively redact nested objects
      result[key] = redactPayload(value);
    }
    return result;
  }

  return obj;
}

/**
 * Redact a webhook payload for display in the UI.
 * Extra aggressive: strips author.email, committer.email,
 * and any nested token/key fields.
 */
export function redactWebhookPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') return redactPayload(payload);

  const cleaned = redactPayload(payload) as Record<string, unknown>;

  // Strip specific GitHub webhook sensitive paths
  const sensitiveNestedPaths = [
    'sender.email',
    'pusher.email',
    'head_commit.author.email',
    'head_commit.committer.email',
  ];

  for (const path of sensitiveNestedPaths) {
    const parts = path.split('.');
    let current: any = cleaned;
    for (let i = 0; i < parts.length - 1; i++) {
      if (current && typeof current === 'object') {
        current = current[parts[i]!];
      }
    }
    if (current && typeof current === 'object') {
      const lastKey = parts[parts.length - 1]!;
      if (lastKey in current) {
        current[lastKey] = '[EMAIL]';
      }
    }
  }

  return cleaned;
}

/**
 * Format an event's data payload for safe UI display.
 * This is the main entry point for timeline events.
 */
export function safeDisplayPayload(data: unknown): string {
  const redacted = redactPayload(data);
  try {
    return JSON.stringify(redacted, null, 2);
  } catch {
    return String(redacted);
  }
}

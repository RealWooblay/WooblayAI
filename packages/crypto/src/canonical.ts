import serialize from 'canonicalize';

/**
 * RFC 8785 JSON Canonicalization Scheme.
 * Produces deterministic JSON output regardless of key ordering.
 */
export function canonicalJson(obj: unknown): string {
  const result = (serialize as unknown as (input: unknown) => string | undefined)(obj);
  if (result === undefined) {
    throw new Error('Cannot canonicalize value: ' + typeof obj);
  }
  return result;
}

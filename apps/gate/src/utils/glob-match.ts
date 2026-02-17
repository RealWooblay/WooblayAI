/**
 * Simple glob matching utility.
 *
 * Supports:
 *   - "*" — matches everything
 *   - "prefix*" — prefix match (e.g., "github:*" matches "github:pr:create")
 *   - "*suffix" — suffix match (e.g., "*.ts" matches "index.ts")
 *   - Exact match otherwise
 */
export function globMatch(pattern: string, value: string): boolean {
  if (pattern === value) return true;
  if (pattern === '*') return true;

  if (pattern.endsWith('*') && !pattern.startsWith('*')) {
    return value.startsWith(pattern.slice(0, -1));
  }

  if (pattern.startsWith('*') && !pattern.endsWith('*')) {
    return value.endsWith(pattern.slice(1));
  }

  return false;
}

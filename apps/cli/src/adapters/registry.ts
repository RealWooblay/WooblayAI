import type { IntegrationAdapter } from './types.js';
import { OpenClawAdapter } from './openclaw.js';

const adapters: Record<string, () => IntegrationAdapter> = {
  openclaw: () => new OpenClawAdapter(),
};

/**
 * Get an integration adapter by name.
 * Throws if the adapter is not registered.
 */
export function getAdapter(name: string): IntegrationAdapter {
  const factory = adapters[name];
  if (!factory) {
    const available = Object.keys(adapters).join(', ');
    throw new Error(`Unknown adapter "${name}". Available: ${available}`);
  }
  return factory();
}

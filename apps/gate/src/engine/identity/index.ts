/**
 * Agent Identity System
 *
 * Re-exports all identity modules:
 * - Lineage: spawn tree management
 * - Fingerprint: behavioral profiling
 * - Trust: dynamic trust scoring
 * - Canary: honeypot management
 */

export * from './lineage.js';
export * from './fingerprint.js';
export * from './trust.js';
export * from './canary.js';

/**
 * IntegrationAdapter – interface for plugging agent frameworks into Wooblay.
 *
 * Each adapter knows how to detect, configure, and manage
 * a specific agent runtime (e.g. OpenClaw).
 */
export interface IntegrationAdapter {
  /** Human-readable name of the adapter (e.g. "openclaw") */
  readonly name: string;

  /** Path to the framework's config file */
  readonly configPath: string;

  /** Detect whether the framework is installed and configured */
  detect(): Promise<{ installed: boolean; configExists: boolean; version?: string }>;

  /** Back up the current config; returns the backup file path */
  backup(): Promise<string>;

  /** Patch the framework config to route through Wooblay Gate */
  enable(opts: { gateUrl: string }): Promise<{ success: boolean; message: string }>;

  /** Restore the framework config from a backup */
  disable(backupPath: string): Promise<void>;

  /** Restart the framework process */
  restart(): Promise<{ success: boolean; message: string }>;

  /** Check if the framework is running and healthy */
  status(): Promise<{ healthy: boolean; message: string }>;
}

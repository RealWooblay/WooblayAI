import { join } from 'node:path';
import { homedir } from 'node:os';

/** Root Wooblay config directory: ~/.wooblay */
export const WOOBLAY_HOME = join(homedir(), '.wooblay');

/** Directory for signing keys: ~/.wooblay/keys */
export const KEYS_DIR = join(WOOBLAY_HOME, 'keys');

/** Directory for config backups: ~/.wooblay/backups */
export const BACKUPS_DIR = join(WOOBLAY_HOME, 'backups');

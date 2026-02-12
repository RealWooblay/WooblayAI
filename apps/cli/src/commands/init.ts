import chalk from 'chalk';
import { mkdirSync } from 'node:fs';
import { generateKeyPair, storeKeyPair } from '@wooblay/crypto';
import { KEYS_DIR } from '../config/paths.js';

export async function init(): Promise<void> {
  console.log(chalk.bold.cyan('\n⚡ Wooblay – Local Dev Init\n'));

  // ── Step 1: Create directories ─────────────────────────────────────
  mkdirSync(KEYS_DIR, { recursive: true });
  console.log(chalk.green(`  ✓ Created ${KEYS_DIR}`));

  // ── Step 2: Generate server keypair ────────────────────────────────
  console.log(chalk.yellow('\n→ Generating server signing keypair...'));
  const serverKeys = generateKeyPair();
  storeKeyPair(KEYS_DIR, 'server', serverKeys);
  console.log(chalk.green('  ✓ Server keypair stored'));
  console.log(chalk.gray(`    Public:  ${KEYS_DIR}/server.pub`));
  console.log(chalk.gray(`    Private: ${KEYS_DIR}/server.key`));

  // ── Step 3: Generate toolhost keypair ──────────────────────────────
  console.log(chalk.yellow('\n→ Generating toolhost signing keypair...'));
  const toolhostKeys = generateKeyPair();
  storeKeyPair(KEYS_DIR, 'toolhost', toolhostKeys);
  console.log(chalk.green('  ✓ Toolhost keypair stored'));
  console.log(chalk.gray(`    Public:  ${KEYS_DIR}/toolhost.pub`));
  console.log(chalk.gray(`    Private: ${KEYS_DIR}/toolhost.key`));

  // ── Step 4: Environment variable instructions ──────────────────────
  console.log(chalk.yellow('\n→ Set the following environment variables:\n'));
  console.log(chalk.white(`  export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/wooblay_dev"`));
  console.log(chalk.white(`  export SERVER_SIGNING_PUBLIC_KEY="${serverKeys.publicKey}"`));
  console.log(chalk.white(`  export SERVER_SIGNING_PRIVATE_KEY="${serverKeys.privateKey}"`));
  console.log(chalk.white(`  export TOOLHOST_SIGNING_PUBLIC_KEY="${toolhostKeys.publicKey}"`));
  console.log(chalk.white(`  export TOOLHOST_SIGNING_PRIVATE_KEY="${toolhostKeys.privateKey}"`));

  // ── Step 5: Database setup ─────────────────────────────────────────
  console.log(chalk.yellow('\n→ Initialize the database:\n'));
  console.log(chalk.white('  pnpm --filter @wooblay/gate db:push'));

  console.log(chalk.bold.green('\n✓ Local dev environment initialized.\n'));
}

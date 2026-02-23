#!/usr/bin/env node
/**
 * Minimal validation for Cursor marketplace submission.
 * Checks .cursor-plugin/plugin.json and required folders.
 * For full validation, use Cursor's template: node scripts/validate-template.mjs
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let ok = true;

function check(condition, msg) {
  if (!condition) {
    console.error('❌', msg);
    ok = false;
  } else {
    console.log('✓', msg);
  }
}

const pluginJsonPath = join(root, '.cursor-plugin', 'plugin.json');
check(existsSync(pluginJsonPath), '.cursor-plugin/plugin.json exists');

if (existsSync(pluginJsonPath)) {
  try {
    const plugin = JSON.parse(readFileSync(pluginJsonPath, 'utf8'));
    check(plugin.name && /^[a-z0-9-]+$/.test(plugin.name), 'plugin.json: name (lowercase kebab-case)');
    check(!!plugin.displayName, 'plugin.json: displayName');
    check(!!plugin.description, 'plugin.json: description');
    check(!!plugin.author, 'plugin.json: author');
    check(!!plugin.license, 'plugin.json: license');
  } catch (e) {
    check(false, 'plugin.json: valid JSON - ' + e.message);
  }
}

check(existsSync(join(root, 'rules')), 'rules/ exists');
check(existsSync(join(root, 'skills')), 'skills/ exists');
check(existsSync(join(root, 'README.md')), 'README.md exists');
check(existsSync(join(root, 'mcp.example.json')), 'mcp.example.json exists');

if (!ok) process.exit(1);
console.log('\nValidation passed. See PUBLISHING.md for submission steps.');

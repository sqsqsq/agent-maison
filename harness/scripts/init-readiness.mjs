#!/usr/bin/env node
// init-readiness.mjs — Tier_1 harness 依赖就绪探测（Node-only，不写盘）
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_HARNESS_ROOT = path.resolve(__dirname, '..');
const RECOMMENDED_COMMAND = 'cd framework/harness && npm install';

/**
 * @param {string} harnessRoot absolute path to framework/harness
 * @param {string} [cwd] process cwd to validate (default harnessRoot)
 */
export function checkInitReadiness(harnessRoot, cwd = harnessRoot) {
  const checks = [
    {
      label: 'framework/harness/package.json',
      file: path.join(harnessRoot, 'package.json'),
    },
    {
      label: 'framework/harness/node_modules/ts-node/package.json',
      file: path.join(harnessRoot, 'node_modules', 'ts-node', 'package.json'),
    },
    {
      label: 'framework/harness/node_modules/@types/node/package.json',
      file: path.join(harnessRoot, 'node_modules', '@types', 'node', 'package.json'),
    },
  ];

  /** @type {string[]} */
  const missing = [];
  for (const check of checks) {
    if (!fs.existsSync(check.file)) {
      missing.push(check.label);
    }
  }
  const normalizedCwd = path.resolve(cwd);
  const normalizedHarness = path.resolve(harnessRoot);
  if (normalizedCwd !== normalizedHarness) {
    missing.push(`cwd must be framework/harness (current: ${cwd})`);
  }
  return {
    ok: missing.length === 0,
    missing,
    recommended_command: RECOMMENDED_COMMAND,
    harness_root: harnessRoot,
  };
}

/** CLI 默认：脚本所在 harness 根 + process.cwd() */
export function runReadiness() {
  return checkInitReadiness(DEFAULT_HARNESS_ROOT, process.cwd());
}

export { DEFAULT_HARNESS_ROOT as HARNESS_ROOT, RECOMMENDED_COMMAND };

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const result = runReadiness();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(result.ok ? 0 : 1);
}

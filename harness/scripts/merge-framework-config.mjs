#!/usr/bin/env node
// ============================================================================
// merge-framework-config.mjs — 薄 shim：fork 到 ts-node 执行 merge-framework-config.ts
// ============================================================================
// 与 render-agents-md.mjs 同构；调用路径稳定为：
//   `node framework/harness/scripts/merge-framework-config.mjs [--dry-run] [--apply] [--config <path>]`
// ============================================================================

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const harnessRoot = path.resolve(__dirname, '..');
const tsScript = path.join(__dirname, 'merge-framework-config.ts');
const extra = process.argv.slice(2);

const requireHarness = createRequire(import.meta.url);
let tsNodeBin;
try {
  tsNodeBin = requireHarness.resolve('ts-node/dist/bin.js');
} catch {
  process.stderr.write('[merge-framework-config] 未找到 ts-node，请在 framework/harness 执行 npm install\n');
  process.exit(1);
}

// cwd 仍设为 harnessRoot 以保持与其它 shim 一致（ts-node 依赖解析稳定）；
// 通过环境变量把"用户原始 cwd"透传给 ts 主体，用于解析 --config 的相对路径。
const r = spawnSync(process.execPath, [tsNodeBin, '--transpile-only', tsScript, ...extra], {
  cwd: harnessRoot,
  env: { ...process.env, MERGE_FW_CONFIG_USER_CWD: process.cwd() },
  stdio: 'inherit',
});

process.exit(r.status === null ? 1 : r.status);

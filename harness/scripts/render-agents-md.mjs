#!/usr/bin/env node
// ============================================================================
// render-agents-md.mjs — 薄 shim：fork 到 ts-node 执行 render-agents-md.ts
// ============================================================================
// 保持 framework-init / 文档中的调用路径不变：`node framework/harness/scripts/render-agents-md.mjs ...`
// ============================================================================

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertHarnessCliCwd } from './utils/assert-harness-cli-cwd.mjs';

assertHarnessCliCwd('render-agents-md.mjs');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const harnessRoot = path.resolve(__dirname, '..');
const tsScript = path.join(__dirname, 'render-agents-md.ts');
const extra = process.argv.slice(2);

// 直接拉起本地 ts-node：避免 Windows 上 npx.cmd + shell:true 截断含空格的 --summary，也避免 shell:false 无法执行 .cmd。
const requireHarness = createRequire(import.meta.url);
let tsNodeBin;
try {
  tsNodeBin = requireHarness.resolve('ts-node/dist/bin.js');
} catch {
  process.stderr.write('[render-agents-md] 未找到 ts-node，请在 framework/harness 执行 npm install\n');
  process.exit(1);
}

const r = spawnSync(process.execPath, [tsNodeBin, '--transpile-only', tsScript, ...extra], {
  cwd: harnessRoot,
  stdio: 'inherit',
});

process.exit(r.status === null ? 1 : r.status);

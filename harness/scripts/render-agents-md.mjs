#!/usr/bin/env node
// ============================================================================
// render-agents-md.mjs — 薄 shim：fork 到 ts-node 执行 render-agents-md.ts
// ============================================================================
// 保持 Skill 00 / 文档中的调用路径不变：`node framework/harness/scripts/render-agents-md.mjs ...`
// ============================================================================

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const harnessRoot = path.resolve(__dirname, '..');
const tsScript = path.join(__dirname, 'render-agents-md.ts');
const extra = process.argv.slice(2);

const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const r = spawnSync(cmd, ['ts-node', '--transpile-only', tsScript, ...extra], {
  cwd: harnessRoot,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

process.exit(r.status === null ? 1 : r.status);

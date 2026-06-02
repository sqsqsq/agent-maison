#!/usr/bin/env node
// bootstrap-plan-versions.mjs — 一次性：生成 allowlist；在研 plan 须人工处理（不批量改历史 plan）
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  hasOpenTodos,
  loadAllPlans,
  readCurrentVersion,
} from './plan-version-lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const current = readCurrentVersion(REPO_ROOT);
const plans = loadAllPlans(REPO_ROOT);
/** @type {string[]} */
const openPlans = [];

for (const { basename, parsed } of plans) {
  if (hasOpenTodos(parsed.todos)) openPlans.push(basename);
}

console.log(`[bootstrap-plan-versions] current window=${current}`);
console.log(`  含未完成 todo 的 plan: ${openPlans.length}`);
if (openPlans.length) {
  console.log('  请逐个人工处理（勿批量顺延历史搁置项）：');
  for (const b of openPlans) console.log(`    - ${b}`);
  console.log('    → 纳入当前窗口: version: ' + current);
  console.log('    → 顺延未来窗口: version + deferred_to = <目标版本>（二者相等）');
  console.log('    → 搁置归档: 将未完成 todo 标 cancelled，重跑 gen-plan-version-allowlist');
}
console.log('Run: node scripts/gen-plan-version-allowlist.mjs');

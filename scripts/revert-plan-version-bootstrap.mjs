#!/usr/bin/env node
// revert-plan-version-bootstrap.mjs — 撤销 bootstrap 对历史搁置 plan 的 2.2.0 误标
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const PLANS_DIR = path.join(REPO_ROOT, '.cursor', 'plans');

/** bootstrap 写入 2.2.0 的搁置 plan（不含当前在研的 version_evolution） */
const BOOTSTRAP_DEFERRED = new Set([
  'code-graph-ut-evolution_f8fa08ee.plan.md',
  'framework-generalization-plan_30295ca0.plan.md',
  'framework_拆分与演进_7f2f9b30.plan.md',
  'hylyre步骤错误根因分析_dfae989c.plan.md',
  'prd_图片精度无损化_271528e1.plan.md',
  'skill5_融合characterization路径.plan.md',
  'skill6_hylyre_integration_313e3b0b.plan.md',
  'skill6_即席真机优化_66bc068a.plan.md',
  'spec-harness验证体系_27975623.plan.md',
  'stop_hook_跨会话隔离_b5e771a3.plan.md',
  'ut_v2_修正_usecase去代码化.plan.md',
  'ut_能力深度提升_096a8c3a.plan.md',
  '交互层架构大重构_4e365c34.plan.md',
  '弱模型吞字防护_framework-init.plan.md',
  '鸿蒙应用开发环境搭建_9a8b0620.plan.md',
]);

const OPEN_TODO = new Set(['pending', 'in_progress']);

function stripFmKeys(fm, keys) {
  return fm
    .split('\n')
    .filter((line) => !keys.some((k) => new RegExp(`^${k}:\\s`).test(line)))
    .join('\n');
}

function cancelOpenTodos(fm) {
  return fm.replace(/^(\s*status:\s*)(pending|in_progress)\s*$/gm, '$1cancelled');
}

let reverted = 0;
for (const basename of BOOTSTRAP_DEFERRED) {
  const abs = path.join(PLANS_DIR, basename);
  if (!fs.existsSync(abs)) {
    console.warn(`[revert] skip missing ${basename}`);
    continue;
  }
  let content = fs.readFileSync(abs, 'utf8');
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (!m) continue;
  let fm = stripFmKeys(m[1], ['version', 'deferred_to', 'deferred_from']);
  fm = cancelOpenTodos(fm);
  content = content.replace(/^---\r?\n[\s\S]*?\r?\n---/, `---\n${fm}\n---`);
  fs.writeFileSync(abs, content, 'utf8');
  reverted += 1;
  console.log(`[revert] ${basename}: removed version/deferred_to, open todos → cancelled`);
}

console.log(`[revert] done (${reverted} files). Run: node scripts/gen-plan-version-allowlist.mjs`);

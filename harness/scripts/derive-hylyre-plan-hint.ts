#!/usr/bin/env npx ts-node
/**
 * 从 doc/features/<feature>/test-plan.md 抽取用例行，输出 JSON（stdout），
 * 供 Agent 或本地脚本生成 test-plan.hylyre.md。
 *
 * 用法（在实例仓库根目录）：
 *   cd framework/harness && npx ts-node scripts/derive-hylyre-plan-hint.ts --feature home-page
 *   cd framework/harness && npx ts-node scripts/derive-hylyre-plan-hint.ts --feature home-page --out ../../doc/features/home-page/testing/reports/hint.json
 */
import * as fs from 'fs';
import * as path from 'path';
import minimist from 'minimist';
import { attachNavigationHints, extractTopPlanTestCasesForDeriveHint } from './utils/test-plan-derive-hint';

const argv = minimist(process.argv.slice(2), {
  string: ['feature', 'f', 'project-root', 'p', 'out', 'o'],
});

function defaultProjectRoot(): string {
  const cwd = process.cwd();
  if (path.basename(cwd) === 'harness' && path.basename(path.dirname(cwd)) === 'framework') {
    return path.resolve(cwd, '..', '..');
  }
  return cwd;
}

const projectRoot = path.resolve(argv['project-root'] || argv.p || defaultProjectRoot());
const feature = (argv.feature || argv.f || '').trim();
const outPath = (argv.out || argv.o || '').trim();

if (!feature) {
  console.error('用法: npx ts-node scripts/derive-hylyre-plan-hint.ts --feature <name> [--project-root <dir>] [--out <file.json>]');
  process.exit(2);
}

const planPath = path.join(projectRoot, 'doc', 'features', feature, 'test-plan.md');
if (!fs.existsSync(planPath)) {
  console.error(JSON.stringify({ error: 'test_plan_not_found', path: planPath }, null, 2));
  process.exit(1);
}

const planMd = fs.readFileSync(planPath, 'utf-8');
const test_cases = attachNavigationHints(extractTopPlanTestCasesForDeriveHint(planMd));
const payload = {
  schema: 3,
  feature,
  generated_at: new Date().toISOString(),
  source: path.relative(projectRoot, planPath).replace(/\\/g, '/'),
  navigation_discipline:
    'Nav 子页回 Tab 须用 {"back":{}}；禁止无 area/at 的 swipe RIGHT/LEFT 代替返回。',
  test_cases,
};

const text = `${JSON.stringify(payload, null, 2)}\n`;
if (outPath) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, text, 'utf-8');
  console.error(`已写入 ${path.resolve(outPath)}`);
} else {
  process.stdout.write(text);
}

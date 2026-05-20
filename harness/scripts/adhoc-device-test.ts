#!/usr/bin/env npx ts-node
/**
 * Ad-hoc device test orchestration (Skill 6 Step 4.B preferred entry).
 *
 *   cd framework/harness && npm run adhoc-device-test -- \
 *     --bundle com.huawei.hmos.wallet \
 *     --steps "打开应用->点击添加管理卡片"
 */
import * as fs from 'fs';
import * as path from 'path';
import minimist from 'minimist';
import { resolveHylyreToolConfig } from '../config';
import {
  ensureHylyreReady,
  parseHylyreTrace,
  runHylyreDeviceTest,
} from '../../profiles/hmos-app/harness/providers/device-test-run';
import { resolveMainAbilityForBundle } from '../../profiles/hmos-app/harness/resolve-main-ability';
import {
  ensureAppSnapshotWarmup,
  resolveAppSnapshotCacheAbs,
} from '../../profiles/hmos-app/harness/app-snapshot-warmup';
import { ensureHypiumWorkDir } from '../../profiles/hmos-app/harness/device-test-hypium-workdir';
import { featurePhaseReportsDir } from '../config';
import {
  lintHylyrePlanMarkdown,
  normalizePlannedStepsCell,
  extractDerivedPlanCases,
} from './utils/derived-hylyre-plan';
import {
  splitNaturalLanguageSteps,
  translateNaturalStepsToPlanned,
  plannedStepsToCellJson,
} from './utils/adhoc-step-translate';

const ADHOC_FEATURE = '_adhoc';
const HARNESS_ROOT = path.resolve(__dirname, '..');

const argv = minimist(process.argv.slice(2), {
  string: ['bundle', 'b', 'steps', 's', 'ability', 'a', 'plan', 'project-root', 'p'],
  boolean: ['skip-explore', 'skip-explore-warmup'],
});

function defaultProjectRoot(): string {
  const cwd = process.cwd();
  if (path.basename(cwd) === 'harness' && path.basename(path.dirname(cwd)) === 'framework') {
    return path.resolve(cwd, '..', '..');
  }
  return cwd;
}

function timestampSlug(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function buildHylyrePlanMd(stepsCell: string): string {
  return [
    '# 测试计划（派生执行格式） — _adhoc',
    '',
    '> 由 adhoc-device-test CLI 生成；步骤列为裸 JSON（无 Markdown 反引号）。',
    '',
    '## 测试用例清单',
    '',
    '| 用例编号 | 用例名称 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 关联 AC |',
    '|----------|---------|---------|---------|---------|--------|---------|',
    `| TC-001 | 即席探索流 | 已启动 app（harness aa start 预启） | ${stepsCell} | 按 trace 判定 | P0 | ad-hoc |`,
    '',
  ].join('\n');
}

const projectRoot = path.resolve(argv['project-root'] || argv.p || defaultProjectRoot());
const bundle = (argv.bundle || argv.b || '').trim();
const stepsRaw = (argv.steps || argv.s || '').trim();
const abilityOverride = (argv.ability || argv.a || '').trim();
const planPathArg = (argv.plan || '').trim();
const skipExplore = argv['skip-explore'] || argv['skip-explore-warmup'];

if (!bundle) {
  console.error('用法: npm run adhoc-device-test -- --bundle <id> (--steps "…" | --plan path/to/test-plan.hylyre.md)');
  process.exit(2);
}
if (!planPathArg && !stepsRaw) {
  console.error('必须提供 --steps 或 --plan');
  process.exit(2);
}

const ts = timestampSlug();
const hylyreDir = path.join(
  projectRoot,
  'doc',
  'features',
  ADHOC_FEATURE,
  'testing',
  'reports',
  ts,
  'hylyre',
);
fs.mkdirSync(hylyreDir, { recursive: true });

const derivedPlanPath = planPathArg
  ? path.resolve(projectRoot, planPathArg)
  : path.join(hylyreDir, 'test-plan.hylyre.md');
const stepsFilePath = path.join(hylyreDir, 'test-steps.json');
const reportOutPath = path.join(hylyreDir, 'test-report.md');
const traceOutPath = path.join(hylyreDir, 'trace.json');
const lintReportPath = path.join(hylyreDir, 'plan-lint.json');

const reportsBase = featurePhaseReportsDir(projectRoot, ADHOC_FEATURE, 'testing');
const logPath = path.join(reportsBase, 'device-test-run.log');

if (!planPathArg) {
  const natural = splitNaturalLanguageSteps(stepsRaw);
  const planned = translateNaturalStepsToPlanned(natural);
  if (planned.length === 0) {
    console.error('无法从 --steps 解析出任何 Hylyre JSON 步骤');
    process.exit(2);
  }
  fs.writeFileSync(stepsFilePath, `${JSON.stringify(planned, null, 2)}\n`, 'utf-8');
  const cell = normalizePlannedStepsCell(plannedStepsToCellJson(planned));
  fs.writeFileSync(derivedPlanPath, buildHylyrePlanMd(cell), 'utf-8');
}

let planMd = fs.readFileSync(derivedPlanPath, 'utf-8');
let lint = lintHylyrePlanMarkdown(planMd, undefined, { forbidStartApp: true, canonicalTouch: true });
if (!lint.ok) {
  const onlyBacktick = lint.violations.every(
    v => v.rule_id === 'STEP-005' || v.severity === 'WARN',
  );
  if (onlyBacktick) {
    const cases = extractDerivedPlanCases(planMd);
    if (cases[0]) {
      const norm = normalizePlannedStepsCell(cases[0].steps_raw);
      planMd = planMd.replace(cases[0].steps_raw, norm);
      fs.writeFileSync(derivedPlanPath, planMd, 'utf-8');
      lint = lintHylyrePlanMarkdown(planMd, undefined, { forbidStartApp: true, canonicalTouch: true });
    }
  }
}

fs.writeFileSync(
  lintReportPath,
  `${JSON.stringify({ ok: lint.ok, violations: lint.violations, nav: lint.nav.violations }, null, 2)}\n`,
  'utf-8',
);

const blockers = lint.violations.filter(v => v.severity === 'BLOCKER');
if (blockers.length > 0 && !fs.existsSync(stepsFilePath)) {
  console.error('plan-lint BLOCKER:', lintReportPath);
  for (const v of blockers) {
    console.error(`  [${v.rule_id}] ${v.tc_id}: ${v.message}`);
  }
  process.exit(2);
}

const ready = ensureHylyreReady({
  projectRoot,
  harnessRoot: HARNESS_ROOT,
  feature: ADHOC_FEATURE,
  phase: 'testing',
});
if (!ready.ok) {
  console.error('ensureHylyreReady 失败');
  for (const e of ready.errors) console.error(`  - ${e.message}`);
  process.exit(1);
}

const deviceSn = process.env.HARNESS_HDC_TARGET;
const ability = resolveMainAbilityForBundle({
  projectRoot,
  bundleName: bundle,
  override: abilityOverride || null,
  deviceSn,
  writeCache: true,
});
if (!ability.mainAbility) {
  console.error('无法解析 main ability；请传 --ability MainAbility 或配置 tools.hylyre.bundle_abilities');
  if (ability.bmDumpExcerpt) console.error(ability.bmDumpExcerpt.slice(0, 800));
  process.exit(1);
}

const appSnapshotCacheAbs = resolveAppSnapshotCacheAbs(projectRoot);
const hypiumWorkDir = ensureHypiumWorkDir(reportsBase);

if (!skipExplore) {
  const warm = ensureAppSnapshotWarmup({
    projectRoot,
    bundleName: bundle,
    mainAbility: ability.mainAbility,
    pythonPath: ready.pythonPath,
    appSnapshotCacheAbs,
    hypiumWorkDir,
    deviceSn,
    logPath,
  });
  if (!warm.ok && !warm.skipped) {
    console.error('snapshot warmup 失败:', warm.reason);
    console.error(warm.log);
    process.exit(1);
  }
}

const useStepsFallback =
  blockers.length > 0 && fs.existsSync(stepsFilePath);

const run = runHylyreDeviceTest({
  projectRoot,
  harnessRoot: HARNESS_ROOT,
  feature: ADHOC_FEATURE,
  phase: 'testing',
  pythonPath: ready.pythonPath,
  derivedPlanPath,
  stepsFilePath: useStepsFallback ? stepsFilePath : undefined,
  reportOutPath,
  traceOutPath,
  bundleName: bundle,
  hypiumPageName: ability.mainAbility,
  deviceSn,
  skipAssertExpected: true,
  appSnapshotCacheAbs,
});

const trace = run.trace ?? parseHylyreTrace(traceOutPath);
console.log(
  JSON.stringify(
    {
      ok: run.ok,
      bundle,
      main_ability: ability.mainAbility,
      main_ability_source: ability.source,
      plan: derivedPlanPath,
      steps_file: useStepsFallback ? stepsFilePath : null,
      report: reportOutPath,
      trace: traceOutPath,
      lint: lintReportPath,
      cases: trace?.cases ?? [],
    },
    null,
    2,
  ),
);

process.exit(run.ok ? 0 : 1);

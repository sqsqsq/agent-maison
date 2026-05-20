#!/usr/bin/env npx ts-node
/**
 * Ad-hoc device test orchestration (Skill 6 Step 4.B).
 *
 * Derive (no device run):
 *   npm run adhoc-device-test -- --bundle <id> --steps "打开->点击…"
 *
 * Execute (agent-authored Hylyre JSON):
 *   npm run adhoc-device-test -- --bundle <id> --plan path/to/test-plan.hylyre.md
 *   npm run adhoc-device-test -- --bundle <id> --steps-file path/to/test-steps.json
 */
import * as fs from 'fs';
import * as path from 'path';
import minimist from 'minimist';
import {
  ensureHylyreReady,
  parseHylyreTrace,
  runHylyreDeviceTest,
} from '../../profiles/hmos-app/harness/providers/device-test-run';
import { resolveMainAbilityForBundle } from '../../profiles/hmos-app/harness/resolve-main-ability';
import {
  ensureAppSnapshotWarmup,
  isAppSnapshotCacheEmpty,
  resolveAppSnapshotCacheAbs,
  type SnapshotWarmupResult,
} from '../../profiles/hmos-app/harness/app-snapshot-warmup';
import { listSnapshotPages } from './utils/app-snapshot-cache-hint';
import { ensureHypiumWorkDir } from '../../profiles/hmos-app/harness/device-test-hypium-workdir';
import { featurePhaseReportsDir } from '../config';
import {
  lintHylyrePlanMarkdown,
  normalizePlannedStepsCell,
  extractDerivedPlanCases,
  type LintHylyrePlanResult,
} from './utils/derived-hylyre-plan';
import { buildAdhocDerivePayload } from './utils/adhoc-derive-payload';
import { validatePlannedStepsArray } from './utils/hylyre-planned-step-lint';
import {
  printAdhocAnchors,
  writeAdhocTracePlaceholder,
  type AdhocAnchors,
} from './utils/adhoc-trace-placeholder';
import { resolveAdhocInputPath } from './utils/adhoc-input-path';

const ADHOC_FEATURE = '_adhoc';
const HARNESS_ROOT = path.resolve(__dirname, '..');

const argv = minimist(process.argv.slice(2), {
  string: ['bundle', 'b', 'steps', 's', 'ability', 'a', 'plan', 'steps-file', 'project-root', 'p'],
  boolean: ['skip-explore', 'skip-explore-warmup', 'accept-cold-start'],
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

function deriveLastJsonPath(projectRoot: string): string {
  return path.join(
    projectRoot,
    'doc',
    'features',
    ADHOC_FEATURE,
    'testing',
    'reports',
    'derive-adhoc-last.json',
  );
}

function listCachePageFiles(cacheAbs: string, bundle: string): string[] {
  const pagesDir = path.join(cacheAbs, bundle, 'pages');
  if (!fs.existsSync(pagesDir)) return [];
  try {
    return fs
      .readdirSync(pagesDir)
      .filter(f => f.endsWith('.json'))
      .map(f => path.join(pagesDir, f));
  } catch {
    return [];
  }
}

const projectRoot = path.resolve(argv['project-root'] || argv.p || defaultProjectRoot());
const bundle = (argv.bundle || argv.b || '').trim();
const stepsRaw = (argv.steps || argv.s || '').trim();
const abilityOverride = (argv.ability || argv.a || '').trim();
const planPathArg = (argv.plan || '').trim();
const stepsFileArg = (argv['steps-file'] || '').trim();
let skipExplore = argv['skip-explore'] || argv['skip-explore-warmup'];
const acceptColdStart = argv['accept-cold-start'] === true;

if (!bundle) {
  console.error(
    '用法: npm run adhoc-device-test -- --bundle <id> (--steps "…" | --plan <path> | --steps-file <path>)',
  );
  process.exit(2);
}

const isDeriveOnly = Boolean(stepsRaw) && !planPathArg && !stepsFileArg;
const isExecute = Boolean(planPathArg || stepsFileArg);

if (!isDeriveOnly && !isExecute) {
  console.error('必须提供以下之一：');
  console.error('  --steps "NL…"  （仅 derive hint，不跑机）');
  console.error('  --plan path/to/test-plan.hylyre.md  （agent 已写派生计划）');
  console.error('  --steps-file path/to/test-steps.json  （agent 已写 Hylyre JSON 数组）');
  process.exit(2);
}

if (isDeriveOnly) {
  const payload = buildAdhocDerivePayload(projectRoot, bundle, stepsRaw);
  const derivePath = deriveLastJsonPath(projectRoot);
  fs.mkdirSync(path.dirname(derivePath), { recursive: true });
  fs.writeFileSync(derivePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
  console.error(`ADHOC_DERIVE_FILE=${path.resolve(derivePath)}`);
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exit(0);
}

if (acceptColdStart) {
  skipExplore = true;
}

const appSnapshotCacheAbs = resolveAppSnapshotCacheAbs(projectRoot);
const cachePagesBefore = listCachePageFiles(appSnapshotCacheAbs, bundle);
console.error(`ADHOC_CACHE_DIR=${appSnapshotCacheAbs}`);
console.error(`ADHOC_AVAILABLE_PAGES=${listSnapshotPages(appSnapshotCacheAbs, bundle).join(',')}`);
if (isAppSnapshotCacheEmpty(appSnapshotCacheAbs, bundle)) {
  console.error('[info] snapshot_cache_empty=true — 执行模式将尝试 warmup（可加 --accept-cold-start 跳过）');
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
  ? resolveAdhocInputPath(projectRoot, planPathArg)
  : path.join(hylyreDir, 'test-plan.hylyre.md');
const stepsFilePath = stepsFileArg
  ? resolveAdhocInputPath(projectRoot, stepsFileArg)
  : path.join(hylyreDir, 'test-steps.json');
const reportOutPath = path.join(hylyreDir, 'test-report.md');
const traceOutPath = path.join(hylyreDir, 'trace.json');
const lintReportPath = path.join(hylyreDir, 'plan-lint.json');

const reportsBase = featurePhaseReportsDir(projectRoot, ADHOC_FEATURE, 'testing');
const logPath = path.join(reportsBase, 'device-test-run.log');

const anchors: AdhocAnchors = {
  trace: traceOutPath,
  report: reportOutPath,
  warmupMeta: path.join(reportsBase, 'snapshot-warmup.meta.json'),
  ensureMeta: path.join(reportsBase, 'hylyre-ready.meta.json'),
  runMeta: path.join(reportsBase, 'device-test-run.meta.json'),
};

let useStepsFile = false;

if (stepsFileArg) {
  if (!fs.existsSync(stepsFilePath)) {
    console.error(`steps-file 不存在: ${stepsFilePath}`);
    if (stepsFileArg && !path.isAbsolute(stepsFileArg)) {
      console.error(
        `  提示: 相对路径先试 cwd(${process.cwd()})，再试 projectRoot(${projectRoot})；推荐 doc/features/_adhoc/... 或绝对路径`,
      );
    }
    process.exit(2);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(stepsFilePath, 'utf-8'));
  } catch (e) {
    console.error(`steps-file JSON 解析失败: ${(e as Error).message}`);
    process.exit(2);
  }
  const v = validatePlannedStepsArray(parsed);
  if (!v.ok) {
    fs.writeFileSync(
      lintReportPath,
      `${JSON.stringify({ ok: false, violations: v.violations, source: 'steps-file' }, null, 2)}\n`,
      'utf-8',
    );
    writeAdhocTracePlaceholder(traceOutPath, {
      feature: ADHOC_FEATURE,
      phase: 'testing',
      outcome: 'aborted',
      error_kind: 'plan_lint_blocker',
      error_message: v.violations.map(x => `[${x.rule_id}] #${x.index}: ${x.message}`).join(' | '),
      bundle,
      artifacts: { derived_plan: stepsFilePath },
    });
    printAdhocAnchors(anchors);
    console.error('steps-file lint BLOCKER:', lintReportPath);
    for (const x of v.violations) {
      console.error(`  [${x.rule_id}] #${x.index}: ${x.message}`);
    }
    process.exit(2);
  }
  useStepsFile = true;
}

let lint: LintHylyrePlanResult = {
  ok: true,
  violations: [],
  nav: { ok: true, violations: [] },
};

if (planPathArg) {
  if (!fs.existsSync(derivedPlanPath)) {
    console.error(`plan 不存在: ${derivedPlanPath}`);
    process.exit(2);
  }
  let planMd = fs.readFileSync(derivedPlanPath, 'utf-8');
  lint = lintHylyrePlanMarkdown(planMd, undefined, { forbidStartApp: true, canonicalTouch: true });
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
  if (blockers.length > 0 && !useStepsFile) {
    writeAdhocTracePlaceholder(traceOutPath, {
      feature: ADHOC_FEATURE,
      phase: 'testing',
      outcome: 'aborted',
      error_kind: 'plan_lint_blocker',
      error_message: blockers.map(v => `[${v.rule_id}] ${v.tc_id}: ${v.message}`).join(' | '),
      bundle,
      artifacts: { derived_plan: derivedPlanPath },
    });
    printAdhocAnchors(anchors);
    console.error('plan-lint BLOCKER:', lintReportPath);
    for (const v of blockers) {
      console.error(`  [${v.rule_id}] ${v.tc_id}: ${v.message}`);
    }
    process.exit(2);
  }
  if (blockers.length > 0 && useStepsFile) {
    console.error('[warn] plan-lint BLOCKER — 将 fallback 到 --steps-file');
  }
} else if (useStepsFile) {
  fs.writeFileSync(
    lintReportPath,
    `${JSON.stringify({ ok: true, source: 'steps-file', violations: [] }, null, 2)}\n`,
    'utf-8',
  );
}

const ready = ensureHylyreReady({
  projectRoot,
  harnessRoot: HARNESS_ROOT,
  feature: ADHOC_FEATURE,
  phase: 'testing',
});
if (!ready.ok) {
  const doctorLog = path.join(reportsBase, 'hylyre-doctor.log');
  writeAdhocTracePlaceholder(traceOutPath, {
    feature: ADHOC_FEATURE,
    phase: 'testing',
    outcome: 'aborted',
    error_kind: 'ensure_failed',
    error_message: ready.errors.map(e => `[${e.kind ?? 'error'}] ${e.message}`).join(' | '),
    bundle,
    artifacts: { ensure_meta: anchors.ensureMeta },
  });
  printAdhocAnchors(anchors);
  console.error('ensureHylyreReady 失败（agent 应在本对话内排查宿主环境后重跑本 CLI，勿让用户 pip install）');
  for (const e of ready.errors) console.error(`  - [${e.kind ?? 'error'}] ${e.message}`);
  console.error(`  hylyre-doctor.log: ${doctorLog}`);
  console.error(`  hylyre-ready.meta.json: ${anchors.ensureMeta}`);
  if (process.env.HYLYRE_PYTHON) {
    console.error(
      `  HYLYRE_PYTHON=${process.env.HYLYRE_PYTHON}（该环境不会自动 pip 对齐 vendor；可取消后重试）`,
    );
  }
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
  writeAdhocTracePlaceholder(traceOutPath, {
    feature: ADHOC_FEATURE,
    phase: 'testing',
    outcome: 'aborted',
    error_kind: 'main_ability_unresolved',
    error_message:
      '无法解析 main ability（override / config map / app-meta / bm dump 均未命中）',
    bundle,
    artifacts: { warmup_meta: anchors.warmupMeta },
  });
  printAdhocAnchors(anchors);
  console.error('无法解析 main ability；请传 --ability MainAbility 或配置 tools.hylyre.bundle_abilities');
  if (ability.bmDumpExcerpt) console.error(ability.bmDumpExcerpt.slice(0, 800));
  process.exit(1);
}

const hypiumWorkDir = ensureHypiumWorkDir(reportsBase);

let warmupResult: SnapshotWarmupResult | null = null;
let warmupDegraded = false;
if (!skipExplore) {
  warmupResult = ensureAppSnapshotWarmup({
    projectRoot,
    bundleName: bundle,
    mainAbility: ability.mainAbility,
    pythonPath: ready.pythonPath,
    appSnapshotCacheAbs,
    hypiumWorkDir,
    deviceSn,
    logPath,
  });
  if (!warmupResult.ok && !warmupResult.skipped) {
    warmupDegraded = true;
    console.error(
      '[WARN] snapshot warmup 失败:',
      warmupResult.reason,
      warmupResult.reasonKind ? `(reason_kind=${warmupResult.reasonKind})` : '',
      '— 仍尝试运行 plan',
    );
    if (warmupResult.log) console.error(warmupResult.log);
  }
}

const run = runHylyreDeviceTest({
  projectRoot,
  harnessRoot: HARNESS_ROOT,
  feature: ADHOC_FEATURE,
  phase: 'testing',
  pythonPath: ready.pythonPath,
  derivedPlanPath,
  stepsFilePath: useStepsFile ? stepsFilePath : undefined,
  reportOutPath,
  traceOutPath,
  bundleName: bundle,
  hypiumPageName: ability.mainAbility,
  deviceSn,
  skipAssertExpected: true,
  appSnapshotCacheAbs,
});

let trace = run.trace ?? parseHylyreTrace(traceOutPath);
if (!trace) {
  writeAdhocTracePlaceholder(traceOutPath, {
    feature: ADHOC_FEATURE,
    phase: 'testing',
    outcome: 'aborted',
    error_kind: 'run_crashed',
    error_message: run.errors.map(e => e.message).join(' | ') || 'hylyre run 未产出有效 trace.json',
    bundle,
    artifacts: {
      run_meta: anchors.runMeta,
      warmup_meta: anchors.warmupMeta,
      ensure_meta: anchors.ensureMeta,
    },
  });
  trace = parseHylyreTrace(traceOutPath);
}

const cachePagesAfter = listCachePageFiles(appSnapshotCacheAbs, bundle);
let cacheUpdated = false;
let pageSaveExit: number | null = null;
try {
  const runMeta = JSON.parse(fs.readFileSync(anchors.runMeta, 'utf-8')) as {
    hylyre_page_save?: { exit_code?: number | null };
  };
  pageSaveExit = runMeta.hylyre_page_save?.exit_code ?? null;
  if (pageSaveExit === 0) {
    cacheUpdated = true;
  }
} catch {
  /* run_meta 缺失时回退 mtime 启发 */
}
if (!cacheUpdated) {
  if (cachePagesAfter.length > cachePagesBefore.length) {
    cacheUpdated = true;
  } else if (cachePagesAfter.length > 0 && cachePagesBefore.length > 0) {
    const beforeMax = Math.max(...cachePagesBefore.map(p => fs.statSync(p).mtimeMs));
    const afterMax = Math.max(...cachePagesAfter.map(p => fs.statSync(p).mtimeMs));
    cacheUpdated = afterMax > beforeMax;
  } else if (cachePagesAfter.length > 0 && cachePagesBefore.length === 0) {
    cacheUpdated = true;
  }
}
if (pageSaveExit === 0 && !cacheUpdated) {
  console.error(
    '[warn] hylyre_page_save exit=0 但 pages/ mtime 未变（可能末屏非 home slug）；见 device-test-run.meta.json',
  );
}
console.error(`ADHOC_PAGE_SAVE_EXIT=${pageSaveExit ?? 'null'}`);
console.error(`ADHOC_CACHE_UPDATED=${cacheUpdated}`);
console.error(`ADHOC_CACHE_PAGES=${listSnapshotPages(appSnapshotCacheAbs, bundle).join(',')}`);

console.log(
  JSON.stringify(
    {
      ok: run.ok && !warmupDegraded,
      warmup_degraded: warmupDegraded,
      warmup: warmupResult
        ? {
            ok: warmupResult.ok,
            skipped: warmupResult.skipped,
            reason: warmupResult.reason ?? null,
            reason_kind: warmupResult.reasonKind ?? null,
            meta: warmupResult.metaPath ?? anchors.warmupMeta,
          }
        : null,
      bundle,
      main_ability: ability.mainAbility,
      main_ability_source: ability.source,
      plan: planPathArg ? derivedPlanPath : null,
      steps_file: useStepsFile ? stepsFilePath : null,
      report: reportOutPath,
      trace: traceOutPath,
      lint: lintReportPath,
      cache_updated: cacheUpdated,
      cases: trace?.cases ?? [],
    },
    null,
    2,
  ),
);

printAdhocAnchors(anchors);
process.exit(run.ok ? 0 : 1);

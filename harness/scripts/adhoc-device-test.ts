#!/usr/bin/env npx ts-node
/**
 * Ad-hoc device test orchestration (device-testing Step 4.B).
 *
 * Derive:     --bundle <id> --steps "打开->点击…"
 * Execute:    --bundle <id> --plan <path> | --steps-file <path>  (default cold-restart; --continue-session keeps Nav)
 * Dump only:  --bundle <id> --dump-ui-only [--dump-ui-out <path>]
 * Observe:    --bundle <id> --steps "…" --observe-ui  (touch-only NL auto-run + dump + summarize)
 */
import * as fs from 'fs';
import { defaultProjectRoot } from './utils/cli-project-root';
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
import { listSnapshotPages, isCacheLayoutMismatch, listSnapshotPageJsonPaths } from './utils/app-snapshot-cache-hint';
import { ensureHypiumWorkDir } from '../../profiles/hmos-app/harness/device-test-hypium-workdir';
import { featurePhaseReportsDir } from '../config';
import { detectRepoLayout } from '../repo-layout';
import {
  lintHylyrePlanMarkdown,
  normalizePlannedStepsCell,
  extractDerivedPlanCases,
  type LintHylyrePlanResult,
} from './utils/derived-hylyre-plan';
import { buildAdhocDerivePayload } from './utils/adhoc-derive-payload';
import { validatePlannedStepsArray } from './utils/hylyre-planned-step-lint';
import { normalizePlannedStepsInput } from './utils/hylyre-steps-normalize';
import {
  printAdhocAnchors,
  writeAdhocTracePlaceholder,
  type AdhocAnchors,
} from './utils/adhoc-trace-placeholder';
import { resolveAdhocInputPath } from './utils/adhoc-input-path';
import { logAdhocPhase, logAdhocRunDone } from './utils/adhoc-phase-log';
import { runAdhocDumpUi } from './utils/adhoc-dump-ui';
import { summarizeAdhocDumpFile } from './utils/adhoc-summarize-dump';
import {
  readPreviousRunOutcome,
  shouldEmitUiResetRecommended,
} from './utils/adhoc-ui-reset-meta';
import {
  adhocHylyreRunDir,
  isUnderAdhocFeatureDir,
} from './utils/adhoc-canonical-paths';

const ADHOC_FEATURE = '_adhoc';
const HARNESS_ROOT = path.resolve(__dirname, '..');
const ADHOC_FRAMEWORK_ROOT = detectRepoLayout(HARNESS_ROOT).frameworkRoot;

const argv = minimist(process.argv.slice(2), {
  string: [
    'bundle',
    'b',
    'steps',
    's',
    'ability',
    'a',
    'plan',
    'steps-file',
    'project-root',
    'p',
    'dump-ui-out',
  ],
  boolean: [
    'skip-explore',
    'skip-explore-warmup',
    'accept-cold-start',
    'dump-ui-only',
    'skip-page-save',
    'observe-ui',
    'no-normalize',
    'continue-session',
  ],
});

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

function emitCacheLayoutStderr(cacheAbs: string, bundleId: string): void {
  if (isCacheLayoutMismatch(cacheAbs, bundleId)) {
    console.error('ADHOC_CACHE_LAYOUT_MISMATCH=1');
    console.error(
      '[warn] bundle 根目录有 page-like JSON 但 pages/ 为空；官方 layout 为 pages/<slug>.json；勿 agent Write 根目录替代 page save',
    );
  }
}

function hylyreDirForRun(projectRoot: string): string {
  const ts = timestampSlug();
  const dir = adhocHylyreRunDir(projectRoot, ts);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function parseStepsFileWithNormalize(
  filePath: string,
  lintReportPath: string,
  useNormalize: boolean,
): { ok: true; steps: Record<string, unknown>[] } | { ok: false } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (e) {
    console.error(`steps-file JSON 解析失败: ${(e as Error).message}`);
    return { ok: false };
  }
  let toLint: unknown = parsed;
  if (useNormalize) {
    const norm = normalizePlannedStepsInput(parsed);
    for (const w of norm.warnings) console.error(`[normalize] ${w}`);
    if (norm.changed) {
      const normPath = path.join(path.dirname(filePath), 'test-steps.normalized.json');
      fs.writeFileSync(normPath, `${JSON.stringify(norm.steps, null, 2)}\n`, 'utf-8');
      console.error(`ADHOC_NORMALIZED_FILE=${path.resolve(normPath)}`);
      toLint = norm.steps;
    }
  }
  const v = validatePlannedStepsArray(toLint);
  if (!v.ok) {
    fs.writeFileSync(
      lintReportPath,
      `${JSON.stringify({ ok: false, violations: v.violations, source: 'steps-file' }, null, 2)}\n`,
      'utf-8',
    );
    console.error('steps-file lint BLOCKER:', lintReportPath);
    for (const x of v.violations) {
      console.error(`  [${x.rule_id}] #${x.index}: ${x.message}`);
    }
    return { ok: false };
  }
  return v;
}

function runSummarizeDump(dumpPath: string): string | null {
  try {
    const summary = summarizeAdhocDumpFile(dumpPath);
    return JSON.stringify(summary);
  } catch (e) {
    console.error(`[warn] summarize 失败: ${(e as Error).message}`);
    return null;
  }
}

const projectRoot = path.resolve(argv['project-root'] || argv.p || defaultProjectRoot());
const bundle = (argv.bundle || argv.b || '').trim();
const stepsRaw = (argv.steps || argv.s || '').trim();
const abilityOverride = (argv.ability || argv.a || '').trim();
const planPathArg = (argv.plan || '').trim();
let stepsFileArg = (argv['steps-file'] || '').trim();
/** Set when --observe-ui auto-materializes steps under a fresh hylyre run dir. */
let reservedHylyreRunDir: string | null = null;
let skipExplore = argv['skip-explore'] || argv['skip-explore-warmup'];
const acceptColdStart = argv['accept-cold-start'] === true;
const dumpUiOnly = argv['dump-ui-only'] === true;
const skipPageSaveFlag = argv['skip-page-save'] === true;
const observeUi = argv['observe-ui'] === true;
const useNormalize = argv['no-normalize'] !== true;
const dumpUiOutArg = (argv['dump-ui-out'] || '').trim();
const deviceSn = process.env.HARNESS_HDC_TARGET;
const continueSession = argv['continue-session'] === true;
/** Default cold restart on execute; opt out with --continue-session or --no-cold-restart. */
const coldRestart = !continueSession && !process.argv.includes('--no-cold-restart');

if (!bundle) {
  console.error(
    '用法: npm run adhoc-device-test -- --bundle <id> (--steps "…" | --plan <path> | --steps-file <path> | --dump-ui-only | --observe-ui)',
  );
  process.exit(2);
}

const appSnapshotCacheAbs = resolveAppSnapshotCacheAbs(projectRoot);
const reportsBase = featurePhaseReportsDir(projectRoot, ADHOC_FEATURE, 'testing', ADHOC_FRAMEWORK_ROOT);
const logPath = path.join(reportsBase, 'device-test-run.log');

// --- dump-ui-only mode ---
if (dumpUiOnly) {
  logAdhocPhase('dump_ui_only');
  const ready = ensureHylyreReady({
    projectRoot,
    harnessRoot: HARNESS_ROOT,
    frameworkRoot: ADHOC_FRAMEWORK_ROOT,
    feature: ADHOC_FEATURE,
    phase: 'testing',
  });
  if (!ready.ok) {
    console.error('ensureHylyreReady 失败');
    for (const e of ready.errors) console.error(`  - ${e.message}`);
    process.exit(1);
  }
  const dump = runAdhocDumpUi({
    projectRoot,
    frameworkRoot: ADHOC_FRAMEWORK_ROOT,
    bundle,
    pythonPath: ready.pythonPath,
    appSnapshotCacheAbs,
    deviceSn,
    outPath: dumpUiOutArg || undefined,
    logPath,
  });
  console.error(`ADHOC_DUMP_UI_PATH=${dump.outPath}`);
  if (!dump.ok) {
    console.error('dump-ui 失败', dump.stderr.slice(0, 1500));
    process.exit(1);
  }
  const summary = runSummarizeDump(dump.outPath);
  if (summary) console.log(summary);
  process.exit(0);
}

// --- observe-ui: prepare steps-file when NL is touch-only ---
if (observeUi) {
  if (!stepsRaw && !stepsFileArg) {
    console.error('--observe-ui 需要 --steps "NL…" 或 --steps-file <path>');
    process.exit(2);
  }
  logAdhocPhase('observe_ui_derive');
  skipExplore = true;
  if (stepsRaw && !stepsFileArg) {
    const payload = buildAdhocDerivePayload(projectRoot, bundle, stepsRaw);
    const derivePath = deriveLastJsonPath(projectRoot);
    fs.mkdirSync(path.dirname(derivePath), { recursive: true });
    fs.writeFileSync(derivePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
    console.error(`ADHOC_DERIVE_FILE=${path.resolve(derivePath)}`);
    emitCacheLayoutStderr(appSnapshotCacheAbs, bundle);
    const minimal = payload.steps_file_minimal_example as
      | { steps: Record<string, unknown>[] }
      | null
      | undefined;
    if (!minimal?.steps?.length) {
      console.error(
        'ADHOC_NEED_AGENT_STEPS=1 — 复杂 NL 无法机械生成 touch 步骤；请读 derive contract 手写 steps-file',
      );
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
      process.exit(2);
    }
    reservedHylyreRunDir = hylyreDirForRun(projectRoot);
    const autoPath = path.join(reservedHylyreRunDir, 'test-steps.json');
    fs.writeFileSync(autoPath, `${JSON.stringify(minimal.steps, null, 2)}\n`, 'utf-8');
    stepsFileArg = autoPath;
    console.error(`ADHOC_AUTO_STEPS_FILE=${autoPath}`);
  }
}

const effectiveSkipPageSave = skipPageSaveFlag || observeUi;

const isDeriveOnly =
  Boolean(stepsRaw) && !planPathArg && !stepsFileArg && !observeUi && !dumpUiOnly;
const isExecute = Boolean(planPathArg || stepsFileArg);

if (isDeriveOnly) {
  const payload = buildAdhocDerivePayload(projectRoot, bundle, stepsRaw);
  const derivePath = deriveLastJsonPath(projectRoot);
  fs.mkdirSync(path.dirname(derivePath), { recursive: true });
  fs.writeFileSync(derivePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
  console.error(`ADHOC_DERIVE_FILE=${path.resolve(derivePath)}`);
  emitCacheLayoutStderr(appSnapshotCacheAbs, bundle);
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exit(0);
}

if (!isExecute && !observeUi) {
  console.error('必须提供以下之一：');
  console.error('  --steps "NL…"  （仅 derive hint）');
  console.error('  --plan / --steps-file  （执行）');
  console.error('  --dump-ui-only  （当前屏 dump-ui）');
  console.error('  --observe-ui --steps "…"  （touch-only 一站式）');
  process.exit(2);
}

if (acceptColdStart) skipExplore = true;

const cachePagesBefore = listSnapshotPageJsonPaths(appSnapshotCacheAbs, bundle);
console.error(`ADHOC_CACHE_DIR=${appSnapshotCacheAbs}`);
console.error(`ADHOC_AVAILABLE_PAGES=${listSnapshotPages(appSnapshotCacheAbs, bundle).join(',')}`);
emitCacheLayoutStderr(appSnapshotCacheAbs, bundle);
if (isAppSnapshotCacheEmpty(appSnapshotCacheAbs, bundle)) {
  console.error('[info] snapshot_cache_empty=true — 可加 --accept-cold-start 跳过 warmup');
}

const hylyreDir = reservedHylyreRunDir ?? hylyreDirForRun(projectRoot);

const derivedPlanPath = planPathArg
  ? resolveAdhocInputPath(projectRoot, planPathArg)
  : path.join(hylyreDir, 'test-plan.hylyre.md');
const stepsFilePath = stepsFileArg
  ? resolveAdhocInputPath(projectRoot, stepsFileArg)
  : path.join(hylyreDir, 'test-steps.json');
const reportOutPath = path.join(hylyreDir, 'test-report.md');
const traceOutPath = path.join(hylyreDir, 'trace.json');
const lintReportPath = path.join(hylyreDir, 'plan-lint.json');

if (stepsFileArg && !isUnderAdhocFeatureDir(projectRoot, stepsFilePath)) {
  console.error('ADHOC_STEPS_OUTSIDE_CANONICAL=1');
  console.error(
    `[warn] steps-file 不在 doc/features/_adhoc/ 下（${stepsFilePath}）；执行报告仍写入 ${hylyreDir}`,
  );
}

const archivedStepsPath = path.join(hylyreDir, 'test-steps.json');
if (stepsFileArg && path.resolve(stepsFilePath) !== path.resolve(archivedStepsPath)) {
  fs.copyFileSync(stepsFilePath, archivedStepsPath);
  console.error(`ADHOC_ARCHIVED_STEPS_FILE=${path.resolve(archivedStepsPath)}`);
}

const anchors: AdhocAnchors = {
  trace: traceOutPath,
  report: reportOutPath,
  hylyreRunDir: hylyreDir,
  warmupMeta: path.join(reportsBase, 'snapshot-warmup.meta.json'),
  ensureMeta: path.join(reportsBase, 'hylyre-ready.meta.json'),
  runMeta: path.join(reportsBase, 'device-test-run.meta.json'),
};

let useStepsFile = false;

if (stepsFileArg || observeUi) {
  if (!fs.existsSync(stepsFilePath)) {
    console.error(`steps-file 不存在: ${stepsFilePath}`);
    process.exit(2);
  }
  logAdhocPhase('lint_steps_file');
  const v = parseStepsFileWithNormalize(stepsFilePath, lintReportPath, useNormalize);
  if (!v.ok) {
    writeAdhocTracePlaceholder(traceOutPath, {
      feature: ADHOC_FEATURE,
      phase: 'testing',
      outcome: 'aborted',
      error_kind: 'plan_lint_blocker',
      error_message: 'steps-file lint failed',
      bundle,
      artifacts: { derived_plan: stepsFilePath },
    });
    printAdhocAnchors(anchors);
    process.exit(2);
  }
  fs.writeFileSync(
    lintReportPath,
    `${JSON.stringify({ ok: true, source: 'steps-file', violations: [] }, null, 2)}\n`,
    'utf-8',
  );
  useStepsFile = true;
}

let lint: LintHylyrePlanResult = {
  ok: true,
  violations: [],
  nav: { ok: true, violations: [] },
};

if (planPathArg && !observeUi) {
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
  const navViolations = lint.nav.violations;
  if ((blockers.length > 0 || navViolations.length > 0) && !useStepsFile) {
    writeAdhocTracePlaceholder(traceOutPath, {
      feature: ADHOC_FEATURE,
      phase: 'testing',
      outcome: 'aborted',
      error_kind: 'plan_lint_blocker',
      error_message: [
        ...blockers.map(v => `[${v.rule_id}] ${v.tc_id}: ${v.message}`),
        ...navViolations.map(v => `[${v.rule_id}] ${v.tc_id}: ${v.message}`),
      ].join(' | '),
      bundle,
      artifacts: { derived_plan: derivedPlanPath },
    });
    printAdhocAnchors(anchors);
    process.exit(2);
  }
}

logAdhocPhase('ensure');
const ready = ensureHylyreReady({
  projectRoot,
  harnessRoot: HARNESS_ROOT,
  frameworkRoot: ADHOC_FRAMEWORK_ROOT,
  feature: ADHOC_FEATURE,
  phase: 'testing',
});
if (!ready.ok) {
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
  console.error('ensureHylyreReady 失败');
  process.exit(1);
}

logAdhocPhase('resolve_ability');
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
    error_message: '无法解析 main ability',
    bundle,
    artifacts: { warmup_meta: anchors.warmupMeta },
  });
  printAdhocAnchors(anchors);
  process.exit(1);
}

let warmupResult: SnapshotWarmupResult | null = null;
let warmupDegraded = false;
if (!skipExplore) {
  logAdhocPhase('warmup');
  warmupResult = ensureAppSnapshotWarmup({
    projectRoot,
    bundleName: bundle,
    mainAbility: ability.mainAbility,
    pythonPath: ready.pythonPath,
    appSnapshotCacheAbs,
    hypiumWorkDir: ensureHypiumWorkDir(reportsBase),
    deviceSn,
    logPath,
  });
  if (!warmupResult.ok && !warmupResult.skipped) {
    warmupDegraded = true;
    console.error('[WARN] snapshot warmup 失败 — 仍尝试 run');
  }
}

const effectiveSkipPageSaveFinal = effectiveSkipPageSave;

const previousOutcome = readPreviousRunOutcome(anchors.runMeta);
if (shouldEmitUiResetRecommended(previousOutcome, continueSession)) {
  console.error('ADHOC_UI_RESET_RECOMMENDED=1');
}
console.error(`ADHOC_COLD_RESTART=${coldRestart ? '1' : '0'}`);

logAdhocPhase('run');
const runT0 = Date.now();
const run = runHylyreDeviceTest({
  projectRoot,
  harnessRoot: HARNESS_ROOT,
  frameworkRoot: ADHOC_FRAMEWORK_ROOT,
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
  skipPageSave: effectiveSkipPageSaveFinal,
  coldRestart,
  appSnapshotCacheAbs,
});

let trace = run.trace ?? parseHylyreTrace(traceOutPath);
logAdhocRunDone(Date.now() - runT0, trace?.cases?.length ?? 0);

if (observeUi && run.ok) {
  logAdhocPhase('dump_ui');
  const dump = runAdhocDumpUi({
    projectRoot,
    frameworkRoot: ADHOC_FRAMEWORK_ROOT,
    bundle,
    pythonPath: ready.pythonPath,
    appSnapshotCacheAbs,
    deviceSn,
    logPath,
  });
  console.error(`ADHOC_DUMP_UI_PATH=${dump.outPath}`);
  if (dump.ok) {
    logAdhocPhase('summarize');
    const summary = runSummarizeDump(dump.outPath);
    if (summary) {
      console.log(summary);
      console.error(`ADHOC_SUMMARY_JSON=${summary}`);
    }
  }
}

if (!trace) {
  writeAdhocTracePlaceholder(traceOutPath, {
    feature: ADHOC_FEATURE,
    phase: 'testing',
    outcome: 'aborted',
    error_kind: 'run_crashed',
    error_message: run.errors.map(e => e.message).join(' | ') || 'hylyre run 未产出 trace',
    bundle,
    artifacts: { run_meta: anchors.runMeta },
  });
  trace = parseHylyreTrace(traceOutPath);
}

if (!effectiveSkipPageSave) {
  logAdhocPhase('page_save');
}

const cachePagesAfter = listSnapshotPageJsonPaths(appSnapshotCacheAbs, bundle);
let cacheUpdated = false;
let pageSaveExit: number | null = null;
try {
  const runMeta = JSON.parse(fs.readFileSync(anchors.runMeta, 'utf-8')) as {
    hylyre_page_save?: { exit_code?: number | null; attempted?: boolean };
  };
  pageSaveExit = runMeta.hylyre_page_save?.exit_code ?? null;
  if (pageSaveExit === 0) cacheUpdated = true;
} catch {
  /* ignore */
}
if (!cacheUpdated && cachePagesAfter.length > cachePagesBefore.length) cacheUpdated = true;

console.error(`ADHOC_PAGE_SAVE_EXIT=${effectiveSkipPageSaveFinal ? 'skipped' : String(pageSaveExit ?? 'null')}`);
console.error(`ADHOC_CACHE_UPDATED=${cacheUpdated}`);

console.log(
  JSON.stringify(
    {
      ok: run.ok && !warmupDegraded,
      observe_ui: observeUi,
      skip_page_save: effectiveSkipPageSaveFinal,
      bundle,
      main_ability: ability.mainAbility,
      steps_file: useStepsFile ? stepsFilePath : null,
      trace: traceOutPath,
      cases: trace?.cases ?? [],
    },
    null,
    2,
  ),
);

printAdhocAnchors(anchors);
process.exit(run.ok ? 0 : 1);

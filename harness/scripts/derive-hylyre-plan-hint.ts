#!/usr/bin/env npx ts-node
/**
 * 从 doc/features/<feature>/testing/test-plan.md（兼容旧扁平路径）抽取用例行，输出 JSON（stdout），
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
import {
  appSnapshotCacheAbsFor,
  isSnapshotCacheEmpty,
  listSnapshotPages,
  resolveDefaultSnapshotBundle,
} from './utils/app-snapshot-cache-hint';
import { resolveFeatureArtifact, relFeatureArtifact } from '../config';
import { buildStandardHylyreDerivePayloadBase } from './utils/hylyre-standard-derive-knowledge';
import { loadUiSpecFile, uiSpecAbsPath } from './utils/ui-spec-shared';
import { buildSelectorContractQuery } from '../../profiles/hmos-app/harness/selector-contract';
import { EXECUTION_CHANNEL_DOMAIN } from './utils/execution-channel';

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

const planResolved = resolveFeatureArtifact(projectRoot, feature, 'test-plan.md');
if (!planResolved.exists) {
  console.error(
    JSON.stringify(
      { error: 'test_plan_not_found', path: planResolved.canonicalPath, legacy: planResolved.legacyPath },
      null,
      2,
    ),
  );
  process.exit(1);
}

const planMd = fs.readFileSync(planResolved.actualPath, 'utf-8');
const test_cases = attachNavigationHints(extractTopPlanTestCasesForDeriveHint(planMd));
const snapshotBundle = resolveDefaultSnapshotBundle(projectRoot);
const cacheAbs = appSnapshotCacheAbsFor(projectRoot);
const snapshot_cache_empty = snapshotBundle
  ? isSnapshotCacheEmpty(cacheAbs, snapshotBundle)
  : true;
const available_pages = snapshotBundle ? listSnapshotPages(cacheAbs, snapshotBundle) : [];
const uiSpec = loadUiSpecFile(uiSpecAbsPath(projectRoot, feature));
const selector_contract = uiSpec ? buildSelectorContractQuery(uiSpec, feature) : [];
const payload = {
  // t7a（plan e6a3c9f4）：统一基座（与 check-testing 自动 hint 同源，schema/知识块永不分叉）
  ...buildStandardHylyreDerivePayloadBase(),
  feature,
  source: relFeatureArtifact(projectRoot, feature, 'test-plan.md'),
  snapshot_bundle: snapshotBundle || null,
  snapshot_cache_empty,
  available_pages,
  selector_contract: {
    rule_id: 'SELECTOR-SPEC-001',
    policy:
      'snapshot-cache/device dump only discover candidates; the feature ui-spec is an OPEN WORLD static hint (pre-existing entry screens are legitimately absent) and a miss is a provenance WARN, not proof of an illegal selector — the run\'s own native StepResult selector evidence is the final truth; formal by_text MUST explicitly declare match exact|contains chosen by acceptance intent; runtime MUST NOT fallback',
    static_blockers:
      'only determinable errors block: illegal selector/match, missing explicit by_text match, a ui-spec-proven same-screen multi-mapping without index/scope/within/all, a contains hit that only matches an aggregate Text/Row with children, and a structured acceptance conflict (same checkpoint action target_element_id != the plan action by_id)',
    match_modes: ['exact', 'contains'],
    match_selection:
      'Maison/agent chooses exact or contains from acceptance intent; never infer contains from digits/date or other text shape',
    disambiguation_fields: ['index', 'scope', 'within', 'all'],
    entries: selector_contract,
  },
  navigation_discipline:
    'Nav 子页回 Tab 须用 {"back":{}}；禁止无 area/at 的 swipe RIGHT/LEFT 代替返回。',
  execution_channel_policy: {
    domain: EXECUTION_CHANNEL_DOMAIN,
    source: 'top-level test-plan.md 「执行通道」column (compile-time dispatch, part of plan identity)',
    derive_authority:
      'compile EXACTLY the channel=hylyre set; never add, remove, or rewrite a channel; never emit explicit_skip_tc_ids',
    all_or_nothing:
      'if any channel=hylyre case cannot be compiled (step lint, selector BLOCKER, unparseable steps, or no same-case setup/navigation action before its first assertion), do NOT produce a runnable plan — report that case root cause and the next responsible phase instead',
    setup_before_assertion:
      'every channel=hylyre case MUST contain at least one action step before its first assertion step in the same case (STEP-SETUP); do not rely on screen state left by another case',
    manual_note:
      'a manual TC has no machine quality-PASS carrier: it stays FAIL/UNVERIFIED in the denominator and keeps the feature testing from passing — this is frozen design, not an executor defect',
  },
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

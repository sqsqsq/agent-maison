import { testCliArgs } from '../utils/test-cli-args';
import { beginUnitCase } from '../utils/unit-cases';
// ============================================================================
// check-disposition-consumers.unit.test.ts — 消费矩阵、披露、聚合去重与共享结论（plan f7045213 §4、§5、§10）
// ----------------------------------------------------------------------------
//   A4 改用谓词的消费者对同一组检查给出一致的"挡不挡"；保留原生语义的消费者在去向表为空与非空时判据不变；
//   A5 被披露的失败进 summary 清单、计入完成缺口、完成标签为带缺口的完成、不阻塞完成（经 harness-runner 写入器）；
//   A6 聚合去重两个方向；只由阻断跳过引起时运行时归因不是代码回归、签名非空、无进展守卫照常生效；
//   A7 review 统计汇总失败（报告合法性、MAJOR）：退出码、控制台、summary、goal 运行时四处一致（真实 CLI）；
//   A8 adhoc correction（真实 git 工程）、入口失败的结论与退出码不变；request 入口由 request-entry 套件承担；
//   A1 补样本：adhoc 包装 id。
// ============================================================================

import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import * as YAML from 'yaml';

import { collectDisclosedFailures, isBlockingCheck, resolveCheckDisposition, withDispositionTableForTest, type DispositionEntry } from '../../scripts/utils/check-disposition';
import {
  failScriptReportWithFatalError,
  generateMergedReport,
  generateRequestScriptReport,
  generateScriptReport,
  printReportToConsole,
  resolveEffectiveSuggestion,
  resolveVerdictFromChecks,
} from '../../scripts/utils/report-generator';
import { deriveQualityAxes, deriveReportValidity, extractCompletionGaps } from '../../scripts/utils/quality-axes';
import { buildSummaryBlockers } from '../../scripts/utils/summary-blockers';
import { canProduceVerifierRequest } from '../../scripts/utils/verifier-plan';
import { applyCompatDowngrade } from '../../compat-loader';
import { resolvePhaseVerdict, writeRunSummaryBase } from '../../harness-runner';
import { classifyFailureKind, shouldHaltNoProgress } from '../../scripts/utils/goal-failure-classifier';
import { buildCurrentAttemptFailureProjection } from '../../scripts/goal-phase-runtime';
import { buildGoalManifestFromInput } from '../../scripts/utils/goal-manifest';
import { createGoalRun } from '../../scripts/utils/goal-run-creation';
import { __testing_buildTestingRunStatusResult } from '../../scripts/check-testing';
import { validateLiteSchema } from '../../scripts/utils/lite-json-schema';
import { featureFilePath, featurePhaseReportsDir, clearFrameworkConfigCache } from '../../config';
import { ensureFeatureExecutionScopeFrozen, featureEffectiveScope } from '../../scripts/utils/feature-execution-scope';
import { executionScopeFingerprint } from '../../scripts/utils/execution-scope';
import { buildCorrectionState, writeCorrectionState } from '../../scripts/utils/correction-state';
import { runAdhocCorrection } from '../../scripts/utils/correction-commands';
import { makeVerifierProject, rmDir } from '../utils/verifier-project-fixture';
import { setupRunlessProject } from './execution-scope.unit.test';
import type { CheckResult, HarnessRunSummary, RequestCheckContext, ScriptReport } from '../../scripts/utils/types';
import type { UnitCaseResult } from '../run-unit';

const FRAMEWORK_ROOT = path.resolve(__dirname, '..', '..', '..');
const HARNESS_ROOT = path.join(FRAMEWORK_ROOT, 'harness');
const SUMMARY_SCHEMA = JSON.parse(fs.readFileSync(path.join(HARNESS_ROOT, 'schemas', 'summary.schema.json'), 'utf-8')) as Record<string, unknown>;

function check(id: string, severity: CheckResult['severity'], status: CheckResult['status'], extra: Partial<CheckResult> = {}): CheckResult {
  return { id, category: 'structure', description: id, severity, status, details: `${id} details`, ...extra };
}

// ---------------------------------------------------------------------------
// A4：四种保护对象、MAJOR 失败、阻断跳过的检查组
// ---------------------------------------------------------------------------

const GROUP: CheckResult[] = [
  check('p4_product_gate', 'BLOCKER', 'FAIL'),
  check('p4_basis_gate', 'BLOCKER', 'FAIL'),
  check('p4_ledger_gate', 'BLOCKER', 'FAIL'),
  check('p4_capability_gate', 'BLOCKER', 'FAIL'),
  check('p4_major_gate', 'MAJOR', 'FAIL'),
  check('p4_skip_gate', 'BLOCKER', 'SKIP'),
  check('p4_ok_gate', 'BLOCKER', 'PASS'),
];

const GROUP_TABLE: DispositionEntry[] = [
  { match: { id: 'p4_product_gate' }, protects: 'product_truth', basis: 'test', consequence: '坏产品' },
  { match: { id: 'p4_basis_gate' }, protects: 'result_basis', owner: 'current_phase', basis: 'test', consequence: '结论无依据' },
  { match: { id: 'p4_ledger_gate' }, protects: 'ledger_shape', basis: 'test', consequence: '记录不好看' },
  { match: { id: 'p4_capability_gate' }, protects: 'capability_gap', basis: 'test', consequence: '本机做不到' },
];

/** 每个改用谓词的消费者各自给出"挡"的 id 集合。 */
function predicateConsumerViews(checks: CheckResult[]): Record<string, string[]> {
  const ids = (xs: CheckResult[]) => xs.map(c => c.id).sort();
  return {
    legacy_verdict: ids(checks.filter(c => resolveVerdictFromChecks([c]) !== 'PASS')),
    quality_axes: ids(checks.filter(c => deriveQualityAxes([c], { phase: 'coding', visualApplicable: false, assetApplicable: false }).functional.verdict === 'FAIL')),
    summary_blockers: buildSummaryBlockers(checks, t => t, () => undefined).map(b => b.id).sort(),
    suggestion_fallback: ids(checks.filter(c => resolveEffectiveSuggestion({ ...c, suggestion: undefined }, 'coding') !== undefined)),
  };
}

// ---------------------------------------------------------------------------
// 真实 CLI（runless 夹具，由生产 prepareFeatureScopeCandidate 与首次 harness 冻结）
// ---------------------------------------------------------------------------

function seedGit(root: string): void {
  execFileSync('git', ['init', '-q'], { cwd: root });
  fs.writeFileSync(path.join(root, '.gitignore'), 'framework\n');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['-c', 'user.name=F', '-c', 'user.email=f@e.test', 'commit', '-qm', 'base'], { cwd: root });
}

function runCli(root: string, args: string[], extraEnv: Record<string, string> = {}): ReturnType<typeof spawnSync> & { out: string } {
  const r = spawnSync(process.execPath, [...testCliArgs(path.join(HARNESS_ROOT, 'harness-runner.ts'), [require.resolve('ts-node/dist/bin.js')]), ...args], {
    cwd: root, encoding: 'utf8', timeout: 300000,
    env: { ...process.env, TS_NODE_TRANSPILE_ONLY: '1', TS_NODE_PROJECT: path.join(HARNESS_ROOT, 'tsconfig.json'), MAISON_GOAL_RUN_ID: '', ...extraEnv },
  });
  return Object.assign(r, { out: `${r.stdout ?? ''}${r.stderr ?? ''}` });
}

/** 结论只差 review 统计汇总（MAJOR、报告合法性）的审查报告。 */
const REVIEW_REPORT_STATS_BROKEN = [
  '# Code Review 报告 — runless', '',
  '> **模块标识**: `runless`', '> **审查日期**: 2026-09-29', '> **审查版本**: v1.0', '> **审查人**: AI Code Reviewer', '> **保证等级**: `full`', '',
  '---', '', '## 一、审查范围', '',
  '| 模块名 | 所属层 | 格式 | 审查文件数 |', '|--------|--------|------|-----------|', '| demo | src | ts | 3 |', '',
  '- src/demo/value.ts', '- framework.config.json', '- AGENTS.md', '',
  '## 二、审查方法', '', '按维度审查。', '',
  '## 三、问题清单', '', '| 编号 | 严重程度 | 分类 | 问题描述 | 涉及文件 | 修复建议 |', '|------|---------|------|---------|---------|---------|', '',
  '## 四、问题统计', '', '| 严重程度 | 数量 |', '|---------|------|', '| **合计** | **0** |', '',
  '## 五、修复建议摘要', '', '无。', '',
  '## 六、结论', '', '**审查结论**: 通过', '', '无问题。', '', '**判定依据**:', '- BLOCKER 数量: 0', '- MAJOR 数量: 0', '',
].join('\n');

/** 统计表完整、结论干净的审查报告（第二批：让结论只取决于探索账本的去向）。 */
const REVIEW_REPORT_CLEAN = REVIEW_REPORT_STATS_BROKEN.replace(
  '| **合计** | **0** |',
  '| BLOCKER | 0 |\n| MAJOR | 0 |\n| MINOR | 0 |\n| INFO | 0 |\n| **合计** | **0** |',
);

/**
 * 先由生产冻结入口取得 facts 指纹，再走真实 Review CLI 验证披露与正式退出码。
 * 默认 facts 满足全部可核实的探索门。
 */
function runReviewCli(report: string, facts: Record<string, unknown> = {}): {
  cli: ReturnType<typeof runCli>; summary: HarnessRunSummary | null; script: ScriptReport | null; cleanup: () => void;
} {
  const { root, frameworkRoot, feature } = setupRunlessProject({ chain: ['review'], completionTarget: 'feature' });
  const reportPath = featureFilePath(root, feature, path.join('review', 'review-report.md'));
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, report);
  seedGit(root);
  const args = ['--phase', 'review', '--feature', feature, '--project-root', root, '--framework-root', frameworkRoot];
  const frozen = ensureFeatureExecutionScopeFrozen({ projectRoot: root, frameworkRoot, feature });
  assert(frozen.record && frozen.status === 'frozen', JSON.stringify(frozen.checks));
  const record = frozen.record;
  const factsPath = featureFilePath(root, feature, path.join('context', 'facts.md'));
  fs.mkdirSync(path.dirname(factsPath), { recursive: true });
  const sources = ['src/demo/value.ts', 'framework.config.json', 'AGENTS.md'];
  fs.writeFileSync(factsPath, '---\n' + YAML.stringify({
    schema_version: '1.1', feature, frozen_scope_fingerprint: executionScopeFingerprint(featureEffectiveScope(record)), established_by: 'review',
    ready_to_produce: true, has_blocker_coverage_risk: false, source_code_paths: sources, key_inputs_read: sources, files_inspected_count: 5,
    searches_performed_estimate: 4, decisions_unlocked: ['review value'], exploration_mode: 'sequential', ...facts,
  }) + '---\n## Code Facts\n| 路径 | 事实 | 影响 |\n|---|---|---|\n' + sources.map(s => `| ${s} | readable | review target |`).join('\n') + '\n\n## phase_delta: review\nreviewed\n');
  const cli = runCli(root, args);
  const dir = featurePhaseReportsDir(root, feature, 'review', frameworkRoot);
  const read = <T>(name: string): T | null => (fs.existsSync(path.join(dir, name)) ? JSON.parse(fs.readFileSync(path.join(dir, name), 'utf-8')) as T : null);
  return { cli, summary: read<HarnessRunSummary>('summary.json'), script: read<ScriptReport>('script-report.json'), cleanup: () => { rmDir(root); clearFrameworkConfigCache(); } };
}

// ---------------------------------------------------------------------------
// cases
// ---------------------------------------------------------------------------

const cases: Array<{ name: string; run: () => void | Promise<void> }> = [
  { name: '38e5a7c2 four real process checks disclose through report, axes, summary and verifier eligibility', run() {
    const { root } = makeVerifierProject();
    try {
      const ids = ['context_exploration_inputs_coverage', 'context_exploration_mode_allowed', 'context_exploration_mode_required', 'context_exploration_subagent_required'];
      const checks = ids.map(id => check(id, 'BLOCKER', 'FAIL'));
      const report = generateScriptReport('', 'plan', 'demo', root, checks, FRAMEWORK_ROOT);
      assert.equal(report.summary.verdict, 'PASS');
      assert.equal(report.summary.fail, 4, 'raw failures remain visible');
      const summary = writeRunSummaryBase(root, report, FRAMEWORK_ROOT);
      assert.equal(summary.verdict, 'PASS');
      assert.equal(summary.blocker_count, 0);
      assert.deepStrictEqual(summary.blockers, []);
      assert.deepStrictEqual(summary.disclosed_failures?.map(c => c.id), ids);
      assert(canProduceVerifierRequest({ planMode: 'enabled', phase: 'plan', scriptVerdict: summary.verdict,
        checks, reportValidity: 'PASS', hasBlockedCapability: false }).allowed,
      'disclosed process failures do not become product blockers or prevent the normal independent review');
      for (const blocked of Object.values(predicateConsumerViews(checks))) assert.deepStrictEqual(blocked, []);
      for (const id of ['context_exploration_facts_baseline_stale', 'context_exploration_facts_scope_coverage', 'context_exploration_facts_run_match', 'ut_hvigor_build']) {
        assert.equal(resolveVerdictFromChecks([...checks, check(id, 'BLOCKER', 'FAIL')]), 'FAIL', id);
      }
    } finally { rmDir(root); }
  } },
  {
    name: 'A4 改用谓词的消费者对同一组检查给出一致的"挡不挡"（去向表为空与非空）',
    run: () => {
      const expectations: Array<{ label: string; table: DispositionEntry[]; blocking: string[] }> = [
        { label: '空表', table: [], blocking: ['p4_basis_gate', 'p4_capability_gate', 'p4_ledger_gate', 'p4_product_gate'] },
        { label: '四类登记', table: GROUP_TABLE, blocking: ['p4_basis_gate', 'p4_capability_gate', 'p4_product_gate'] },
      ];
      for (const e of expectations) {
        assert.deepStrictEqual(GROUP.filter(c => isBlockingCheck(c, e.table)).map(c => c.id).sort(), e.blocking, `${e.label}: 谓词`);
        const views = withDispositionTableForTest(e.table, () => predicateConsumerViews(GROUP));
        for (const [consumer, blocking] of Object.entries(views)) {
          assert.deepStrictEqual(blocking, e.blocking, `${e.label}: ${consumer} 与谓词不一致`);
        }
        const gaps = withDispositionTableForTest(e.table, () => extractCompletionGaps(GROUP));
        assert.strictEqual(gaps.total, e.table.length ? 1 : 0, `${e.label}: 被披露条数计入完成缺口`);
        assert(!withDispositionTableForTest(e.table, () => canProduceVerifierRequest({ planMode: 'enabled', phase: 'review',
          scriptVerdict: 'FAIL', checks: GROUP, reportValidity: 'PASS', hasBlockedCapability: false })).allowed,
        'blocking and independent eligibility are distinct: missing actual reviewable objects cannot buy a verifier');
      }
    },
  },
  {
    name: 'A4 报告合法性/compat 保留语义，request 仅放行统一处置已披露项',
    run: () => {
      // 把报告合法性检查与 compat 豁免检查都登记为账本与形状：谓词不挡，但原生判据照旧。
      const ledger: DispositionEntry[] = [
        { match: { id: 'issue_table_format' }, protects: 'ledger_shape', basis: 'test', consequence: 'c' },
        { match: { id: 'ctx_gate' }, protects: 'ledger_shape', basis: 'test', consequence: 'c' },
        { match: { id: 'p4_ledger_gate' }, protects: 'ledger_shape', basis: 'test', consequence: 'c' },
      ];
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p4-native-'));
      try {
        fs.mkdirSync(path.join(root, 'doc', 'features', 'f'), { recursive: true });
        fs.writeFileSync(path.join(root, 'doc', 'features', 'f', 'compat.yaml'), [
          'schema_version: "1.0"', 'feature: f', 'exempt_checks: ["ctx_*"]', 'reason: "legacy"', 'scheduled_backfill_by: "2099-06-01"', '',
        ].join('\n'));
        for (const table of [[], ledger]) {
          withDispositionTableForTest(table, () => {
            // 报告合法性：只看失败不看级别，也不看去向表
            assert.strictEqual(deriveReportValidity([check('issue_table_format', 'BLOCKER', 'FAIL')]), 'FAIL');
            assert.strictEqual(deriveReportValidity([check('statistics_summary', 'MAJOR', 'FAIL')]), 'FAIL');
            // compat：命中豁免的 FAIL+BLOCKER 照常改写
            const { results, stats } = applyCompatDowngrade([check('ctx_gate', 'BLOCKER', 'FAIL')], { feature: 'f', phase: 'spec', projectRoot: root }, Date.UTC(2098, 0, 1));
            assert.deepStrictEqual(stats.appliedIds, ['ctx_gate'], `compat 判据变了（表 ${table.length}）`);
            assert.strictEqual(results[0].status, 'WARN');
            // Request shares disclosures; other failures retain its stricter policy.
            const reportDir = path.join(root, 'req', String(table.length));
            const ctx = {
              phase: 'coding', projectRoot: root, reportDir,
              request: { request_sha256: 'a'.repeat(64), requested_result: 'r', baseline: null, bindings: [] },
              resolvedInputs: { values: {} },
            } as unknown as RequestCheckContext;
            assert.strictEqual(generateRequestScriptReport(ctx, [check('p4_ledger_gate', 'BLOCKER', 'FAIL')]).verdict, table.length ? 'PASS' : 'FAIL');
            const requestSummary = JSON.parse(fs.readFileSync(path.join(reportDir, 'summary.json'), 'utf8'));
            assert.strictEqual(requestSummary.disclosed_failures.length, table.length ? 1 : 0);
            assert.strictEqual(generateRequestScriptReport(ctx, [check('p4_major_gate', 'MAJOR', 'FAIL')]).verdict, 'FAIL');
          });
        }
      } finally { rmDir(root); }
    },
  },
  {
    name: 'A5 被披露的失败进 summary 清单并计入完成缺口：带缺口的完成、不阻塞完成（经 harness-runner 写入器）',
    run: () => {
      const { root } = makeVerifierProject();
      try {
        const table: DispositionEntry[] = [{ match: { id: 'p4_ledger_gate' }, protects: 'ledger_shape', basis: 'test', consequence: '记录不好看' }];
        const checks = [check('p4_ledger_gate', 'BLOCKER', 'FAIL', { details: '账本缺一行\n第二行' }), check('p4_ok_gate', 'BLOCKER', 'PASS')];
        const summary = withDispositionTableForTest(table, () => {
          const report = generateScriptReport('', 'coding', 'demo', root, checks, FRAMEWORK_ROOT);
          assert.strictEqual(report.summary.verdict, 'PASS', '脚本报告结论');
          return writeRunSummaryBase(root, report, FRAMEWORK_ROOT);
        });
        assert.strictEqual(summary.verdict, 'PASS', '被披露的失败不阻塞');
        assert.deepStrictEqual(summary.blockers, []);
        assert.strictEqual(summary.blocker_count, 0);
        assert.strictEqual(summary.completion_status, 'COMPLETE_WITH_GAPS', `完成标签：${summary.completion_status}`);
        assert.deepStrictEqual(summary.disclosed_failures, [{ id: 'p4_ledger_gate', protects: 'ledger_shape', severity: 'BLOCKER', details_excerpt: '账本缺一行\n第二行' }]);
        const onDisk = JSON.parse(fs.readFileSync(path.join(featurePhaseReportsDir(root, 'demo', 'coding', FRAMEWORK_ROOT), 'summary.json'), 'utf-8')) as HarnessRunSummary;
        assert.deepStrictEqual(onDisk.disclosed_failures, summary.disclosed_failures);
        assert.deepStrictEqual(validateLiteSchema(onDisk, SUMMARY_SCHEMA), [], '新 summary 过 schema');
        const legacy = { ...onDisk } as Record<string, unknown>; delete legacy.disclosed_failures;
        assert.deepStrictEqual(validateLiteSchema(legacy, SUMMARY_SCHEMA), [], '没有这一项的旧 summary 照常过 schema');
        // 去向表为空：同一检查按声明阻断，清单为空
        const report = generateScriptReport('', 'coding', 'demo', root, checks, FRAMEWORK_ROOT);
        const plain = writeRunSummaryBase(root, report, FRAMEWORK_ROOT);
        assert.strictEqual(plain.verdict, 'FAIL');
        assert.deepStrictEqual(plain.disclosed_failures, []);
        assert.deepStrictEqual(collectDisclosedFailures(checks), []);
      } finally { rmDir(root); }
    },
  },
  {
    name: 'A6 聚合去重两个方向：归因与签名保真，未知完成评估不触发无进展',
    run: () => {
      // 方向一：源失败已表达 → 聚合项不进清单、计数与签名，但照常参与结论
      const src = check('p4_src_gate', 'BLOCKER', 'FAIL');
      const aggWithSource = __testing_buildTestingRunStatusResult('plan', 'report', [src]);
      assert.strictEqual(aggWithSource.status, 'FAIL');
      const dedup = [src, aggWithSource];
      assert.deepStrictEqual(buildSummaryBlockers(dedup, t => t, () => undefined).map(b => b.id), ['p4_src_gate']);
      assert.strictEqual(resolveVerdictFromChecks([aggWithSource]), 'FAIL', '聚合项照常参与结论');
      // 方向二：只由关键的阻断跳过引起 → 聚合项保留
      const skip = check('p4_gate_not_run', 'BLOCKER', 'SKIP');
      const aggAlone = __testing_buildTestingRunStatusResult('plan', 'report', [skip]);
      assert.strictEqual(aggAlone.status, 'FAIL', JSON.stringify(aggAlone));
      const { root } = makeVerifierProject();
      try {
        const report = generateScriptReport('', 'testing', 'demo', root, [skip, aggAlone], FRAMEWORK_ROOT);
        const summary = writeRunSummaryBase(root, report, FRAMEWORK_ROOT);
        assert.strictEqual(summary.verdict, 'FAIL');
        assert.deepStrictEqual(summary.blockers.map(check => check.id), ['testing_run_status']);
        assert.strictEqual(summary.blocker_count, 1);
        assert.deepStrictEqual(summary.blocking_skips.map(check => check.id), ['p4_gate_not_run']);
        const failureKind = classifyFailureKind(summary);
        assert.strictEqual(failureKind, 'deterministic_gate_or_artifact_missing', `归因=${failureKind}`);
        const projection = buildCurrentAttemptFailureProjection({ decisionSummary: summary as never, failureKind, phase: 'testing', hasRuntimeFailureEvidence: false });
        assert.strictEqual(projection.blockerSignature, 'testing_run_status');
        assert(!shouldHaltNoProgress({
          failureKind, priorBlockerSignature: projection.blockerSignature, currentBlockerSignature: projection.blockerSignature,
          priorArtifactSnapshot: {}, currentArtifactSnapshot: {},
        }), '旧签名/空快照不能冒充已完成的验收评估');
        // 方向一经真实写入器：计数与清单一致
        const withSource = writeRunSummaryBase(root, generateScriptReport('', 'testing', 'demo', root, dedup, FRAMEWORK_ROOT), FRAMEWORK_ROOT);
        assert.deepStrictEqual(withSource.blockers.map(b => b.id), ['p4_src_gate']);
        assert.strictEqual(withSource.blocker_count, 1);
        assert.strictEqual(classifyFailureKind(withSource), 'code_regression', '源 blocker 在场时归因不受聚合项影响');
      } finally { rmDir(root); }
    },
  },
  {
    name: 'R1 执行者超时且 summary 新鲜：去重掉的聚合项仍算非框架阻断，超时决策表的原结果不变',
    run: () => {
      const { root } = makeVerifierProject();
      try {
        // 唯一的源失败 framework_bug（真实致命失败写入器产出），加真实聚合项
        const blank: ScriptReport = {
          phase: 'testing', feature: 'demo', timestamp: '', project_root: root, assurance: 'not_applicable',
          capability_resolutions: [], capability_resolution_contract_fingerprint: null, checks: [],
          summary: { total: 0, pass: 0, fail: 0, warn: 0, skip: 0, blockers: 0, verdict: 'PASS' },
        };
        const fatal = failScriptReportWithFatalError(blank, 'assemble_ai_prompt', new Error('checker crashed'), FRAMEWORK_ROOT).checks.at(-1)!;
        assert.strictEqual(fatal.failure_kind, 'framework_bug');
        const aggregate = __testing_buildTestingRunStatusResult('plan', 'report', [fatal]);
        const summaryOf = (checks: CheckResult[]) => writeRunSummaryBase(root, generateScriptReport('', 'testing', 'demo', root, checks, FRAMEWORK_ROOT), FRAMEWORK_ROOT);
        const timedOut = (summary: HarnessRunSummary, stale: boolean | undefined) =>
          classifyFailureKind(summary as never, undefined, { agentTimedOut: true, staleSummary: stale });
        const withAggregate = summaryOf([fatal, aggregate]);
        assert.deepStrictEqual(withAggregate.blockers.map(b => b.id), [fatal.id], '前提：聚合项已去重');
        assert.strictEqual(timedOut(withAggregate, false), 'agent_timeout', '去重掉的聚合项在超时分支仍算一条非框架阻断');
        assert.strictEqual(timedOut(summaryOf([fatal]), false), 'framework_bug', '没有聚合项的纯 framework_bug 超时轮');
        assert.strictEqual(timedOut(summaryOf([fatal, check('p4_content_gate', 'BLOCKER', 'FAIL')]), false), 'agent_timeout', '框架与内容混装');
        assert.strictEqual(timedOut(withAggregate, true), 'agent_timeout', 'summary 不新鲜');
        // 非超时路径判据不动：存在框架阻断即按框架处理
        assert.strictEqual(classifyFailureKind(withAggregate as never), classifyFailureKind(summaryOf([fatal]) as never));
      } finally { rmDir(root); }
    },
  },
  {
    name: 'R3 合并报告：顶部裁定与"最终裁定"同按传入结论；设备阻塞 INCOMPLETE 不再写 PASS',
    run: () => {
      const { root } = makeVerifierProject();
      try {
        const finalSection = (md: string) => md.slice(md.indexOf('## 三、最终裁定'));
        const merged = (phase: 'ut' | 'plan', checks: CheckResult[], capabilities: unknown[] = []) => {
          const report = generateScriptReport('', phase, 'demo', root, checks, FRAMEWORK_ROOT);
          report.capability_resolutions = capabilities as never;
          // 结论只在报告带能力契约指纹时读能力解析（与 runner 同一判据）
          if (capabilities.length) report.capability_resolution_contract_fingerprint = 'p4-capability-contract';
          const verdict = resolvePhaseVerdict(root, report).verdict;
          return { verdict, md: generateMergedReport(HARNESS_ROOT, root, phase, 'demo', report, undefined, FRAMEWORK_ROOT, verdict) };
        };
        // 设备阻塞、没有能力输入缺口
        const device = merged('ut', [
          check('ut_hvigor_build', 'BLOCKER', 'PASS'),
          check('ut_hvigor_test', 'BLOCKER', 'FAIL', { blocking_class: 'externalBlocked', failure_kind: 'device_blocked' }),
        ]);
        assert.strictEqual(device.verdict, 'INCOMPLETE');
        assert(device.md.includes('| **裁定** | **INCOMPLETE** |'), '顶部');
        assert(finalSection(device.md).includes('**INCOMPLETE**') && !finalSection(device.md).includes('**PASS**'), finalSection(device.md));
        // PASS / FAIL / 能力输入缺口保持正确
        const pass = merged('plan', [check('p4_ok_gate', 'BLOCKER', 'PASS')]);
        assert(pass.verdict === 'PASS' && finalSection(pass.md).includes('**PASS**'), finalSection(pass.md));
        const fail = merged('plan', [check('p4_product_gate', 'BLOCKER', 'FAIL')]);
        assert(fail.verdict === 'FAIL' && finalSection(fail.md).includes('**FAIL**') && fail.md.includes('| **裁定** | **FAIL** |'), finalSection(fail.md));
        const capability = merged('plan', [check('p4_ok_gate', 'BLOCKER', 'PASS')], [{
          id: 'capability_p4_blocked', axis: 'functional', active: true, state: 'blocked', on_missing: 'fail',
          applicability_provider_id: 'applicability.ui', applicability_dependencies: [], inputs: [],
        }]);
        assert(capability.verdict === 'INCOMPLETE' && capability.md.includes('| **裁定** | **INCOMPLETE** |'), capability.md);
        assert(finalSection(capability.md).includes('blocked capability'), finalSection(capability.md));
      } finally { rmDir(root); }
    },
  },
  {
    name: 'R4 公开的阻断计数取同一个有效集合：脚本报告、Step 3 控制台、合并报告、summary 一致',
    run: () => {
      const { root } = makeVerifierProject();
      try {
        const src = check('p4_src_gate', 'BLOCKER', 'FAIL');
        const counts = (checks: CheckResult[]) => {
          const report = generateScriptReport('', 'testing', 'demo', root, checks, FRAMEWORK_ROOT);
          const lines: string[] = [];
          const original = console.log;
          console.log = (...xs: unknown[]) => { lines.push(xs.join(' ')); };
          try { printReportToConsole(report, { failuresOnly: true }); } finally { console.log = original; }
          const consoleBlockers = Number(/Blockers: (\d+)/.exec(lines.join('\n'))?.[1]);
          const md = generateMergedReport(HARNESS_ROOT, root, 'testing', 'demo', report, undefined, FRAMEWORK_ROOT);
          const mergedBlockers = Number(/\| BLOCKER 数 \| (\d+) \|/.exec(md)?.[1]);
          const summary = writeRunSummaryBase(root, report, FRAMEWORK_ROOT);
          return { script: report.summary.blockers, console: consoleBlockers, merged: mergedBlockers, summary: summary.blocker_count, list: summary.blockers.length, verdict: summary.verdict, fail: report.summary.fail, total: report.summary.total };
        };
        const withSource = counts([src, __testing_buildTestingRunStatusResult('plan', 'report', [src])]);
        assert.deepStrictEqual(withSource, { script: 1, console: 1, merged: 1, summary: 1, list: 1, verdict: 'FAIL', fail: 2, total: 2 }, '源失败 + 聚合项');
        const alone = counts([check('p4_gate_not_run', 'BLOCKER', 'SKIP'), __testing_buildTestingRunStatusResult('plan', 'report', [check('p4_gate_not_run', 'BLOCKER', 'SKIP')])]);
        assert.deepStrictEqual(alone, { script: 1, console: 1, merged: 1, summary: 1, list: 1, verdict: 'FAIL', fail: 1, total: 2 }, '只有聚合项：计数 1 且照常参与结论');
      } finally { rmDir(root); }
    },
  },
  {
    name: 'A8 入口失败：非法阶段仍以原退出码结束、不写 summary',
    run: () => {
      const { root, frameworkRoot, feature } = setupRunlessProject({ chain: ['coding'] });
      try {
        seedGit(root);
        const cli = runCli(root, ['--phase', 'no-such-phase', '--feature', feature, '--project-root', root, '--framework-root', frameworkRoot]);
        assert.strictEqual(cli.status, 1, cli.out);
        assert(!fs.existsSync(path.join(featurePhaseReportsDir(root, feature, 'no-such-phase', frameworkRoot), 'summary.json')));
      } finally { rmDir(root); clearFrameworkConfigCache(); }
    },
  },
  {
    name: 'A8 adhoc correction：结论与退出码不变（真实 git 工程）；A1 adhoc 包装 id 按声明处置',
    run: async () => {
      for (const variant of ['fail', 'pass'] as const) {
        const { root, frameworkRoot } = setupRunlessProject({ chain: ['coding'] });
        const harnessRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'p4-adhoc-h-'));
        try {
          if (variant === 'fail') {
            const configPath = path.join(root, 'framework.config.json');
            const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            config.project_profile = { name: 'hmos-app', sub_variant: 'app' };
            fs.writeFileSync(configPath, JSON.stringify(config));
            clearFrameworkConfigCache();
          }
          seedGit(root);
          const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
          writeCorrectionState(root, buildCorrectionState({
            feature: null, root_layer: 'src', touched_layers: ['src'], revalidate: [], base_commit: head, request_text: 'fix', enforcement_tier: 'soft' as never,
          }));
          if (variant === 'fail') fs.writeFileSync(path.join(root, 'src/demo/value.ts'), 'export const value: number = 42;\n');
          const exit = await runAdhocCorrection(root, harnessRoot, frameworkRoot);
          const reportsDir = path.join(root, 'doc', 'reports', '_adhoc');
          const report = JSON.parse(fs.readFileSync(path.join(reportsDir, fs.readdirSync(reportsDir)[0], 'correction-report.json'), 'utf-8')) as { verdict: string; results: CheckResult[] };
          const declaredBlocking = report.results.filter(r => r.status === 'FAIL' && r.severity === 'BLOCKER');
          assert.strictEqual(report.verdict, declaredBlocking.length ? 'FAIL' : 'PASS', `${variant}: 结论须等于声明计数`);
          assert.strictEqual(exit, declaredBlocking.length ? 1 : 0, `${variant}: 退出码`);
          assert.strictEqual(report.verdict, variant === 'fail' ? 'FAIL' : 'PASS', `${variant}: ${JSON.stringify(report.results.map(r => [r.id, r.status, r.severity]))}`);
          if (variant === 'fail') {
            const wrapped = report.results.find(r => r.id === 'adhoc_coding_compile');
            assert(wrapped && wrapped.status === 'FAIL', JSON.stringify(report.results.map(r => r.id)));
            assert.deepStrictEqual(resolveCheckDisposition(wrapped!), { action: 'block', entry: null }, 'A1：包装 id 按声明阻断');
          }
          for (const r of report.results) assert.strictEqual(isBlockingCheck(r), r.status === 'FAIL' && r.severity === 'BLOCKER', `A1：${r.id}`);
        } finally { rmDir(root); rmDir(harnessRoot); clearFrameworkConfigCache(); }
      }
    },
  },
  // ---- 第二批（t4、t5）：披露登记的公开入口、归因与恢复出口 ----
  {
    name: '第二批 披露：schema_version_present 经真实 CLI（catalog、glossary）——结论与退出码由 FAIL/1 变为 PASS/0，失败进披露清单',
    run: () => {
      for (const phase of ['catalog', 'glossary'] as const) {
        const { root, frameworkRoot } = setupRunlessProject({ chain: ['coding'] });
        try {
          fs.mkdirSync(path.join(root, 'doc'), { recursive: true });
          fs.writeFileSync(path.join(root, 'doc/module-catalog.yaml'), `schema_version: "${phase === 'catalog' ? '' : '1.0'}"\nmodules: []\n`);
          if (phase === 'glossary') fs.writeFileSync(path.join(root, 'doc/glossary.yaml'), 'schema_version: ""\nterms: []\n');
          seedGit(root);
          const runId = 'global-context-other-feature';
          const manifest = buildGoalManifestFromInput({ feature: 'runless', adapter: 'generic', requirement: 'value is 42', unattended: false,
            start_phase: 'coding', end_phase: 'coding' }, { projectRoot: root, runId });
          createGoalRun({ projectRoot: root, manifest, chain: ['coding'] });
          const goalEnv = { MAISON_GOAL_RUN_ID: runId, MAISON_GOAL_ATTEMPT: 'i1', MAISON_GOAL_ATTEMPT_PHASE: 'coding', MAISON_GOAL_HEADLESS: '1' };
          let baseline: HarnessRunSummary | undefined;
          const contexts: Array<{ name: string; feature: string; env: Record<string, string> }> = [{ name: 'plain', feature: '_global', env: {} },
            { name: 'other-feature-goal', feature: '_global', env: goalEnv },
            { name: 'global-staging-alias', feature: 'catalog-staging', env: {} }];
          for (const context of contexts) {
            const args = ['--phase', phase, '--project-root', root, '--framework-root', frameworkRoot,
              ...(context.feature === '_global' ? [] : ['--feature', context.feature])];
            const summaryPath = path.join(featurePhaseReportsDir(root, context.feature, phase, frameworkRoot), 'summary.json');
            fs.rmSync(summaryPath, { force: true });
            const cli = runCli(root, args, context.env);
            const out = cli.out;
            assert(/FAIL \[BLOCKER\] schema_version_present/.test(out), `前提：检查照常产出原始 FAIL（${phase}/${context.name}）：${out}`);
            assert.strictEqual(cli.status, 0, `${phase}/${context.name}：global 不得借他 Feature 的 Goal 身份读取 Feature 材料\n${out}`);
            assert(out.includes('Verdict: PASS'), `${phase}：控制台结论\n${out}`);
            const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8')) as HarnessRunSummary;
            assert.strictEqual(summary.verdict, 'PASS');
            assert.deepStrictEqual(summary.disclosed_failures?.map(d => d.id), ['schema_version_present'], `${phase}: ${JSON.stringify(summary.disclosed_failures)}`);
            if (baseline) assert.deepStrictEqual({ next: summary.next_action, closure: summary.closure_status, blockers: summary.blockers },
              { next: baseline.next_action, closure: baseline.closure_status, blockers: baseline.blockers }, `${phase}/${context.name}: 原 global 动作与异常语义不变`);
            else baseline = summary;
          }
          const wrongFeature = runCli(root, ['--phase', 'coding', '--feature', 'not-the-run-feature', '--project-root', root, '--framework-root', frameworkRoot], goalEnv);
          assert.notEqual(wrongFeature.status, 0, 'ordinary Feature cannot borrow a different Feature run identity');
          assert(wrongFeature.out.includes('[goal-manifest]'), wrongFeature.out);
        } finally { rmDir(root); clearFrameworkConfigCache(); }
      }
    },
  },
  {
    name: '第二批 披露：探索账本两条经真实 CLI review 脚本通过并保留独立核验义务；旧facts schema须真实重建',
    run: () => {
      const ledger = runReviewCli(REVIEW_REPORT_CLEAN, {
        searches_performed_estimate: 1, touches_layers: ['src', 'data', 'domain'], exploration_mode: 'subagent', subagents_used: 'not_available',
      });
      try {
        const raw = (ledger.script?.checks ?? []).filter(c => c.status === 'FAIL').map(c => `${c.id}/${c.severity}`).sort();
        assert.deepStrictEqual(raw, ['context_exploration_searches_min/BLOCKER', 'context_exploration_subagents_used/BLOCKER'], `前提：只有两条探索账本原始 FAIL\n${ledger.cli.out}`);
        assert.strictEqual(ledger.cli.status, 1, ledger.cli.out);
        assert.strictEqual(ledger.summary?.closure_status, 'open');
        assert.strictEqual(ledger.summary?.next_action, 'run_verifier_then_receipt');
        assert.strictEqual(ledger.summary?.verdict, 'PASS');
        assert.deepStrictEqual(ledger.summary?.disclosed_failures?.map(d => d.id).sort(), ['context_exploration_searches_min', 'context_exploration_subagents_used']);
        assert.strictEqual(ledger.summary?.completion_status, 'COMPLETE_WITH_GAPS');
      } finally { ledger.cleanup(); }
      const version = runReviewCli(REVIEW_REPORT_CLEAN, { schema_version: '1.0' });
      try {
        assert.notStrictEqual(version.cli.status, 0, '链首建立阶段仍被拦住');
        assert(version.cli.out.includes('context_exploration_facts_input_context'), `按事实调用契约拒收，不能误导为修改capability contract：\n${version.cli.out}`);
      } finally { version.cleanup(); }
    },
  },
  {
    // plan 3abca824 t4（A7）：review 是首个实际建立阶段、无 baseline；每次只触发一条候选原始 FAIL。
    // delta 缺节、空节的公开入口证据在 real-chain-seams RC-8c / RC-8d（goal 真实链路，plan 为非建立阶段）。
    name: 'P5 第二批 披露：自报文件数、未列解锁决策经真实 CLI review 进披露清单并保留独立核验义务',
    run: () => {
      for (const [label, overrides, id] of [
        ['文件数', { files_inspected_count: 1 }, 'context_exploration_files_inspected_min'],
        ['decisions', { decisions_unlocked: [] }, 'context_exploration_decisions_unlocked'],
      ] as const) {
        const r = runReviewCli(REVIEW_REPORT_CLEAN, overrides);
        try {
          const raw = (r.script?.checks ?? []).filter(c => c.status === 'FAIL').map(c => `${c.id}/${c.severity}`).sort();
          assert.deepStrictEqual(raw, [`${id}/BLOCKER`], `${label} 前提：完整检查结果里只有这一条原始 FAIL\n${r.cli.out}`);
          assert.strictEqual(r.cli.status, 1, `${label}：独立核验待补\n${r.cli.out}`);
          assert(r.cli.out.includes('Verdict: PASS'), `${label}：控制台结论\n${r.cli.out}`);
          assert.strictEqual(r.summary?.verdict, 'PASS', label);
          assert.strictEqual(r.summary?.closure_status, 'open', label);
          assert.strictEqual(r.summary?.next_action, 'run_verifier_then_receipt', label);
          assert.deepStrictEqual(r.summary?.disclosed_failures?.map(d => d.id), [id], label);
          assert.strictEqual(r.summary?.completion_status, 'COMPLETE_WITH_GAPS', label);
        } finally { r.cleanup(); }
      }
    },
  },
  {
    name: '第二批 披露：facts 版本（旧路径）、ut_mock_plan_typed、it_name_has_ac_or_branch_tag 经真实检查产出与 harness-runner 写入器——summary 结论由 FAIL 变 PASS',
    run: () => {
      const { root } = makeVerifierProject();
      try {
        // ① facts 版本：无调用上下文的旧路径（要求 "1.0"）
        const factsPath = featureFilePath(root, 'demo', path.join('context', 'facts.md'));
        fs.mkdirSync(path.dirname(factsPath), { recursive: true });
        fs.writeFileSync(factsPath, '---\n' + YAML.stringify({ schema_version: '1.1', feature: 'demo', established_by: 'coding' }) + '---\n');
        const { checkFactsArtifact } = require('../../scripts/utils/context-facts') as typeof import('../../scripts/utils/context-facts');
        const facts = checkFactsArtifact(root, 'demo', 'coding').filter(c => c.id === 'context_exploration_facts_schema_version');
        // ② mock-plan 缺类型标注
        const { checkUtMockPlanRequirements, checkItNameHasAcOrBranchTag } = require('../../scripts/check-ut') as typeof import('../../scripts/check-ut');
        const utCtx = { phase: 'ut', feature: 'demo', projectRoot: root, phaseRule: {}, featureSpec: { feature: 'demo' }, frameworkRoot: FRAMEWORK_ROOT,
          resolvedProfile: { name: 'generic', profileDir: path.join(FRAMEWORK_ROOT, 'profiles', 'generic'), capabilities: {}, phasesDisabled: new Set<string>() } } as never;
        const plan = { spies: [{ target_class: 'Repo', methods: [{ name: 'load', presets: [{ id: 'p1', returns: { ts_expr: '{ a: 1 }' } }] }] }] };
        const mock = checkUtMockPlanRequirements(utCtx, { status: 'loaded', value: [], relPath: 'ut/testability-audit.md', absPath: '', warnings: [] } as never, { status: 'loaded', value: plan, relPath: 'ut/mock-plan.yaml', absPath: '', warnings: [] } as never)
          .filter(c => c.id === 'ut_mock_plan_typed');
        // ③ it 名不以追溯标签开头，且需求模式下的 [REG-*]
        const itName = checkItNameHasAcOrBranchTag(utCtx, [{ path: 'test/A.test.ets', content: "describe('s', () => { it('plain name', 0, () => {}); it('[REG-1] reg', 0, () => {}); });" }]);
        for (const [label, checks] of [['facts 版本', facts], ['ut_mock_plan_typed', mock], ['it_name_has_ac_or_branch_tag', itName]] as const) {
          assert(checks.length === 1 && checks[0].status === 'FAIL' && checks[0].severity === 'BLOCKER', `${label} 前提：真实检查产出原始 FAIL：${JSON.stringify(checks)}`);
          const summary = writeRunSummaryBase(root, generateScriptReport('', 'ut', 'demo', root, [...checks], FRAMEWORK_ROOT), FRAMEWORK_ROOT);
          assert.strictEqual(summary.verdict, 'PASS', `${label}：披露后不阻断`);
          assert.deepStrictEqual(summary.disclosed_failures?.map(d => d.id), [checks[0].id], label);
          assert.deepStrictEqual(summary.blockers, [], label);
        }
      } finally { rmDir(root); }
    },
  },
];

export async function runAll() {
  const out: UnitCaseResult[] = [];
  for (const c of cases) {
    const endUnitCase = beginUnitCase(c.name);
    if (!endUnitCase) continue;
    try {
      await c.run();
      out.push({ name: c.name, ok: true });
    } catch (err) {
      out.push({ name: c.name, ok: false, error: (err as Error).stack ?? (err as Error).message });
    } finally {  endUnitCase(); }
  }
  return out;
}

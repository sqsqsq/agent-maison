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

import {
  collectDisclosedFailures,
  isBlockingCheck,
  resolveCheckDisposition,
  withDispositionTableForTest,
  type DispositionEntry,
} from '../../scripts/utils/check-disposition';
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
import { resolvePhaseHarnessVerdict } from '../../scripts/utils/goal-runner-phase';
import { __testing_buildTestingRunStatusResult } from '../../scripts/check-testing';
import { validateLiteSchema } from '../../scripts/utils/lite-json-schema';
import { featureFilePath, featurePhaseReportsDir, clearFrameworkConfigCache } from '../../config';
import { readFeatureFrozenScope, featureEffectiveScope } from '../../scripts/utils/feature-execution-scope';
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
  const negative = check('negative_verdict_closure', 'BLOCKER', 'FAIL');
  return {
    legacy_verdict: ids(checks.filter(c => resolveVerdictFromChecks([c]) !== 'PASS')),
    quality_axes: ids(checks.filter(c => deriveQualityAxes([c], { phase: 'coding', visualApplicable: false, assetApplicable: false }).functional.verdict === 'FAIL')),
    summary_blockers: buildSummaryBlockers(checks, t => t, () => undefined).map(b => b.id).sort(),
    suggestion_fallback: ids(checks.filter(c => resolveEffectiveSuggestion({ ...c, suggestion: undefined }, 'coding') !== undefined)),
    verifier_eligibility: ids(checks.filter(c => c.status !== 'SKIP' && !canProduceVerifierRequest({
      planMode: 'enabled', phase: 'review', scriptVerdict: 'FAIL', checks: [negative, c], reportValidity: 'PASS', hasBlockedCapability: false,
    }).allowed)),
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

function runCli(root: string, args: string[]): ReturnType<typeof spawnSync> & { out: string } {
  const r = spawnSync(process.execPath, [require.resolve('ts-node/dist/bin.js'), path.join(HARNESS_ROOT, 'harness-runner.ts'), ...args], {
    cwd: root, encoding: 'utf8', timeout: 300000,
    env: { ...process.env, TS_NODE_TRANSPILE_ONLY: '1', TS_NODE_PROJECT: path.join(HARNESS_ROOT, 'tsconfig.json'), MAISON_GOAL_RUN_ID: '' },
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

/** 违规钩子探针：把每次 on_violation 的 ruleId/severity 追加到工程根的 violations.log。 */
function installViolationProbe(root: string): string {
  const extRoot = path.join(root, 'doc', 'extensions');
  fs.mkdirSync(path.join(extRoot, 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(extRoot, 'manifest.yaml'), YAML.stringify({
    schema_version: '1.0', name: 'p4-violation-probe', provides: { hooks: { review: { on_violation: ['hooks/on-violation.mjs'] } } },
  }));
  fs.writeFileSync(path.join(extRoot, 'hooks', 'on-violation.mjs'), [
    "import { appendFileSync } from 'fs';",
    "import { join } from 'path';",
    'export default (ctx) => {',
    "  appendFileSync(join(ctx.projectRoot, 'violations.log'), `${ctx.violation.ruleId} ${ctx.violation.severity}\\n`);",
    '  return {};',
    '};',
    '',
  ].join('\n'));
  return path.join(root, 'violations.log');
}

/** 统计表完整、结论干净的审查报告（第二批：让结论只取决于探索账本的去向）。 */
const REVIEW_REPORT_CLEAN = REVIEW_REPORT_STATS_BROKEN.replace(
  '| **合计** | **0** |',
  '| BLOCKER | 0 |\n| MAJOR | 0 |\n| MINOR | 0 |\n| INFO | 0 |\n| **合计** | **0** |',
);

/**
 * runless review 链的真实 CLI：首次调用冻结范围，再按冻结指纹写 facts（`facts` 覆盖默认 frontmatter），第二次调用出结论。
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
  runCli(root, args);
  const record = readFeatureFrozenScope(root, feature);
  assert(record, '首次调用未冻结');
  const factsPath = featureFilePath(root, feature, path.join('context', 'facts.md'));
  fs.mkdirSync(path.dirname(factsPath), { recursive: true });
  const sources = ['src/demo/value.ts', 'framework.config.json', 'AGENTS.md'];
  fs.writeFileSync(factsPath, '---\n' + YAML.stringify({
    schema_version: '1.1', feature, frozen_scope_fingerprint: executionScopeFingerprint(featureEffectiveScope(record!)), established_by: 'review',
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
      }
    },
  },
  {
    name: 'A4 保留原生语义的消费者：报告合法性、compat 降级、request 入口在去向表为空与非空时判据不变',
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
            // request 入口：任意失败即失败
            const reportDir = path.join(root, 'req', String(table.length));
            const ctx = {
              phase: 'coding', projectRoot: root, reportDir,
              request: { request_sha256: 'a'.repeat(64), requested_result: 'r', baseline: null, bindings: [] },
              resolvedInputs: { values: {} },
            } as unknown as RequestCheckContext;
            assert.strictEqual(generateRequestScriptReport(ctx, [check('p4_ledger_gate', 'BLOCKER', 'FAIL')]).verdict, 'FAIL', `request 入口判据变了（表 ${table.length}）`);
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
    name: 'A6 聚合去重两个方向；只由阻断跳过引起时：归因不是代码回归、签名非空、无进展守卫生效',
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
        assert.deepStrictEqual(summary.blockers.map(b => b.id), ['testing_run_status']);
        assert.strictEqual(summary.blocker_count, 1);
        const failureKind = classifyFailureKind(summary);
        assert.strictEqual(failureKind, 'deterministic_gate_or_artifact_missing', `归因=${failureKind}`);
        const projection = buildCurrentAttemptFailureProjection({ decisionSummary: summary as never, failureKind, phase: 'testing', hasRuntimeFailureEvidence: false });
        assert.strictEqual(projection.blockerSignature, 'testing_run_status');
        assert(shouldHaltNoProgress({
          failureKind, priorBlockerSignature: projection.blockerSignature, currentBlockerSignature: projection.blockerSignature,
          priorArtifactSnapshot: {}, currentArtifactSnapshot: {},
        }), '同签名零进展须熔断');
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
    name: 'A7 review 统计汇总失败：退出码、控制台、summary、goal 运行时四处一致；违规钩子仍处理 MAJOR 失败（真实 CLI）',
    run: () => {
      const { root, frameworkRoot, feature } = setupRunlessProject({ chain: ['review'], completionTarget: 'feature' });
      try {
        const reportPath = featureFilePath(root, feature, path.join('review', 'review-report.md'));
        fs.mkdirSync(path.dirname(reportPath), { recursive: true });
        fs.writeFileSync(reportPath, REVIEW_REPORT_STATS_BROKEN);
        const violationsLog = installViolationProbe(root);
        seedGit(root);
        const args = ['--phase', 'review', '--feature', feature, '--project-root', root, '--framework-root', frameworkRoot];
        runCli(root, args); // 首次调用冻结范围
        const record = readFeatureFrozenScope(root, feature);
        assert(record, '首次调用未冻结');
        const factsPath = featureFilePath(root, feature, path.join('context', 'facts.md'));
        fs.mkdirSync(path.dirname(factsPath), { recursive: true });
        const sources = ['src/demo/value.ts', 'framework.config.json', 'AGENTS.md'];
        fs.writeFileSync(factsPath, '---\n' + YAML.stringify({
          schema_version: '1.1', feature, frozen_scope_fingerprint: executionScopeFingerprint(featureEffectiveScope(record!)), established_by: 'review',
          ready_to_produce: true, has_blocker_coverage_risk: false, source_code_paths: sources, key_inputs_read: sources, files_inspected_count: 5,
          searches_performed_estimate: 4, decisions_unlocked: ['review value'], exploration_mode: 'sequential',
        }) + '---\n## Code Facts\n| 路径 | 事实 | 影响 |\n|---|---|---|\n' + sources.map(s => `| ${s} | readable | review target |`).join('\n') + '\n\n## phase_delta: review\nreviewed\n');
        fs.rmSync(violationsLog, { force: true });
        const beforeMtime = Date.now() - 1;
        const cli = runCli(root, args);
        const dir = featurePhaseReportsDir(root, feature, 'review', frameworkRoot);
        const script = JSON.parse(fs.readFileSync(path.join(dir, 'script-report.json'), 'utf-8')) as ScriptReport;
        const stats = script.checks.find(c => c.id === 'statistics_summary')!;
        assert(stats.status === 'FAIL' && stats.severity === 'MAJOR', JSON.stringify(stats));
        assert.deepStrictEqual(script.checks.filter(c => c.status === 'FAIL' && c.severity === 'BLOCKER').map(c => c.id), [], '前提：没有阻断失败');
        assert.strictEqual(script.summary.verdict, 'PASS', '前提：脚本报告的 legacy 结论是 PASS（分裂实例）');
        // ① summary
        const summary = JSON.parse(fs.readFileSync(path.join(dir, 'summary.json'), 'utf-8')) as HarnessRunSummary;
        assert.strictEqual(summary.report_validity, 'FAIL');
        assert.strictEqual(summary.verdict, 'FAIL');
        // ② 退出码
        assert.strictEqual(cli.status, 1, cli.out);
        // ③ 控制台结论（Step 3 与最终两处）与合并报告
        assert(cli.out.includes('Verdict: FAIL') && !cli.out.includes('Verdict: PASS'), cli.out);
        assert(cli.out.includes('脚本 Harness 检查未通过') && !cli.out.includes('脚本 Harness 检查通过'), cli.out);
        assert(fs.readFileSync(path.join(dir, 'merged-report.md'), 'utf-8').includes('| **裁定** | **FAIL** |'), '合并报告裁定行');
        // ④ goal 运行时读同一份 summary
        const goal = resolvePhaseHarnessVerdict({
          summaryBeforeMtime: beforeMtime, summaryAfterMtime: fs.statSync(path.join(dir, 'summary.json')).mtimeMs,
          summaryVerdict: summary.verdict as never, harnessExitCode: cli.status ?? 1, agentExitCode: 0, agentSkipped: true, dryRun: false,
          receiptRequired: true, closureStatus: summary.closure_status, receiptStatus: summary.receipt_status,
        } as never);
        assert.strictEqual(goal.verdict, 'FAIL', JSON.stringify(goal));
        // 违规钩子保留原生语义：MAJOR 失败同样触发
        const violations = fs.existsSync(violationsLog) ? fs.readFileSync(violationsLog, 'utf-8') : '';
        assert(violations.includes('statistics_summary MAJOR'), `违规钩子没有处理 MAJOR 失败：${violations}\n${cli.out}`);
      } finally { rmDir(root); clearFrameworkConfigCache(); }
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
          const reportsDir = path.join(harnessRoot, 'reports', '_adhoc');
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
          const cli = runCli(root, ['--phase', phase, '--project-root', root, '--framework-root', frameworkRoot]);
          const out = cli.out;
          assert(/FAIL \[BLOCKER\] schema_version_present/.test(out), `前提：检查照常产出原始 FAIL（${phase}）：${out}`);
          assert.strictEqual(cli.status, 0, `${phase}：披露后退出码 0\n${out}`);
          assert(out.includes('Verdict: PASS'), `${phase}：控制台结论\n${out}`);
          const summaryPath = path.join(featurePhaseReportsDir(root, '_global', phase, frameworkRoot), 'summary.json');
          const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8')) as HarnessRunSummary;
          assert.strictEqual(summary.verdict, 'PASS');
          assert.deepStrictEqual(summary.disclosed_failures?.map(d => d.id), ['schema_version_present'], `${phase}: ${JSON.stringify(summary.disclosed_failures)}`);
        } finally { rmDir(root); clearFrameworkConfigCache(); }
      }
    },
  },
  {
    name: '第二批 披露：探索账本两条经真实 CLI review——结论与退出码改变；facts_schema_version 在链首被 capability_resolution_contract 拦住',
    run: () => {
      const ledger = runReviewCli(REVIEW_REPORT_CLEAN, {
        searches_performed_estimate: 1, touches_layers: ['src', 'data', 'domain'], exploration_mode: 'subagent', subagents_used: 'not_available',
      });
      try {
        const raw = (ledger.script?.checks ?? []).filter(c => c.status === 'FAIL').map(c => `${c.id}/${c.severity}`).sort();
        assert.deepStrictEqual(raw, ['context_exploration_searches_min/BLOCKER', 'context_exploration_subagents_used/BLOCKER'], `前提：只有两条探索账本原始 FAIL\n${ledger.cli.out}`);
        assert.strictEqual(ledger.cli.status, 0, ledger.cli.out);
        assert.strictEqual(ledger.summary?.verdict, 'PASS');
        assert.deepStrictEqual(ledger.summary?.disclosed_failures?.map(d => d.id).sort(), ['context_exploration_searches_min', 'context_exploration_subagents_used']);
        assert.strictEqual(ledger.summary?.completion_status, 'COMPLETE_WITH_GAPS');
      } finally { ledger.cleanup(); }
      const version = runReviewCli(REVIEW_REPORT_CLEAN, { schema_version: '1.0' });
      try {
        assert.notStrictEqual(version.cli.status, 0, '链首建立阶段仍被拦住');
        assert(version.cli.out.includes('capability_resolution_contract'), `拦住它的是链首预检：\n${version.cli.out}`);
      } finally { version.cleanup(); }
    },
  },
  {
    // plan 3abca824 t4（A7）：review 是首个实际建立阶段、无 baseline；每次只触发一条候选原始 FAIL。
    // delta 缺节、空节的公开入口证据在 real-chain-seams RC-8c / RC-8d（goal 真实链路，plan 为非建立阶段）。
    name: 'P5 第二批 披露：自报文件数、未列解锁决策经真实 CLI review——原始 FAIL 仍在，退出码 0、结论 PASS、进披露清单',
    run: () => {
      for (const [label, overrides, id] of [
        ['文件数', { files_inspected_count: 1 }, 'context_exploration_files_inspected_min'],
        ['decisions', { decisions_unlocked: [] }, 'context_exploration_decisions_unlocked'],
      ] as const) {
        const r = runReviewCli(REVIEW_REPORT_CLEAN, overrides);
        try {
          const raw = (r.script?.checks ?? []).filter(c => c.status === 'FAIL').map(c => `${c.id}/${c.severity}`).sort();
          assert.deepStrictEqual(raw, [`${id}/BLOCKER`], `${label} 前提：完整检查结果里只有这一条原始 FAIL\n${r.cli.out}`);
          assert.strictEqual(r.cli.status, 0, `${label}：退出码\n${r.cli.out}`);
          assert(r.cli.out.includes('Verdict: PASS'), `${label}：控制台结论\n${r.cli.out}`);
          assert.strictEqual(r.summary?.verdict, 'PASS', label);
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
  {
    name: 'A9 authoritative_content_aligned 与 ref_elements_excluded（当前阶段）：归因不落代码回归、不产回退候选、assess 走当前阶段重跑、重试提示词不含回退指引；上游责任反例产生候选并回退',
    run: () => {
      const { assessObservation } = require('../../scripts/utils/assess') as typeof import('../../scripts/utils/assess');
      const { selectRunnerActionFromAssess } = require('../../scripts/utils/goal-assess-driver') as typeof import('../../scripts/utils/goal-assess-driver');
      const { buildPhasePrompt } = require('../../scripts/goal-phase-runtime') as typeof import('../../scripts/goal-phase-runtime');
      const { extractDeterministicAffectedFiles } = require('../../scripts/utils/goal-failure-classifier') as typeof import('../../scripts/utils/goal-failure-classifier');
      const FULL = ['spec', 'plan', 'coding', 'review', 'ut', 'testing'];
      const observe = (current: string, summary: HarnessRunSummary) => ({
        schema_version: '1.0' as const, feature: 'demo', workflow: 'wf', track: 'full' as const, goal_end: 'testing',
        phases: FULL.map(p => ({
          phase: p, summary_state: 'current' as const, schema_version: '1.3', verdict: p === current ? summary.verdict : 'PASS',
          closure: p === current ? 'open' as const : 'closed' as const, assurance: 'full', required_assurance: null, assurance_satisfied: true,
          deferred: false, summary_fingerprint: 'x', evidence_fingerprint: 'x',
          ...(p === current && summary.repair_candidates?.length ? { repair_candidates: summary.repair_candidates } : {}),
        })),
        fingerprints: { workflow: 'w', track: 't', goal: 'g', run_attempt: 'r', summaries: 's', evidence: 'e', reconcile: 'rc', observed: 'o' },
        reconcile: {
          schema_version: '1.0' as const, state: 'active' as const, residual_fingerprints: [],
          phase_outcome: { phase: current, verdict: summary.verdict, legacy_action: 'retry' },
          invalidatable_phases: FULL, budgets: { retries_used: 0, backtracks_used: 0 },
        },
      });
      const { root } = makeVerifierProject();
      try {
        const cases: Array<[string, CheckResult]> = [
          ['spec', check('authoritative_content_aligned', 'BLOCKER', 'FAIL', { affected_files: ['doc/features/demo/acceptance.yaml'], suggestion: '按设计权威改写 acceptance.yaml，保留不冲突的补充。' })],
          ['plan', check('authoritative_content_aligned', 'BLOCKER', 'FAIL', { affected_files: ['doc/features/demo/contracts.yaml'], suggestion: '按设计权威改写 contracts.yaml，保留不冲突的补充。' })],
          ['spec', check('ref_elements_excluded', 'BLOCKER', 'FAIL', { details: 'result_nfc_card：requirement_quote「x」未逐字出现在需求原文' })],
        ];
        for (const [phase, failing] of cases) {
          const label = `${phase}/${failing.id}`;
          const summary = writeRunSummaryBase(root, generateScriptReport('', phase as never, 'demo', root, [failing], FRAMEWORK_ROOT), FRAMEWORK_ROOT);
          assert.strictEqual(summary.verdict, 'FAIL', `${label}：保持阻断`);
          const kind = classifyFailureKind(summary as never);
          assert.strictEqual(kind, 'deterministic_gate_or_artifact_missing', `${label}：归因=${kind}`);
          assert.deepStrictEqual(extractDeterministicAffectedFiles(summary as never), failing.affected_files ?? [], `${label}：受影响文件走同一份映射`);
          assert.strictEqual(summary.repair_candidates, undefined, `${label}：当前阶段责任不产生回退候选`);
          const observation = observe(phase, summary);
          const assessment = assessObservation(observation as never, { mode: 'goal_mode' });
          assert(assessment.recommendation.action === 'rerun_phase' && assessment.recommendation.phase === phase, `${label}：${JSON.stringify(assessment.recommendation)}`);
          assert.notStrictEqual(assessment.recommendation.runner_action, 'backtrack_to_phase', label);
          const action = selectRunnerActionFromAssess({ assessment, observation: observation.reconcile as never, currentPhase: phase, chain: FULL, driverGuardAction: 'none' });
          assert.notStrictEqual(action, 'backtrack_to_phase', `${label}：runner 动作=${action}`);
          const prompt = buildPhasePrompt({ feature: 'demo', requirement: 'r' } as never, root, phase as never, FRAMEWORK_ROOT, [], 'Verdict: FAIL\n- ' + failing.id, kind);
          assert(!prompt.includes('revert that change first') && prompt.includes('not a broken codebase'), `${label}：重试提示词不得含回退指引`);
        }
        // 上游责任反例：结果依据类登记责任在 spec，在 plan 失败 → 产生 spec 候选，assess 回退 spec
        const upstream: DispositionEntry[] = [{ match: { id: 'p4_upstream_basis' }, protects: 'result_basis', owner: 'spec', basis: 'test', consequence: '结论无依据' }];
        withDispositionTableForTest(upstream, () => {
          const summary = writeRunSummaryBase(root, generateScriptReport('', 'plan', 'demo', root, [check('p4_upstream_basis', 'BLOCKER', 'FAIL', { affected_files: ['doc/features/demo/acceptance.yaml'] })], FRAMEWORK_ROOT), FRAMEWORK_ROOT);
          assert.deepStrictEqual(summary.repair_candidates?.map(c => [c.id, c.category]), [['p4_upstream_basis', 'spec']], JSON.stringify(summary.repair_candidates));
          assert.strictEqual(classifyFailureKind(summary as never), 'deterministic_gate_or_artifact_missing');
          const observation = observe('plan', summary);
          const assessment = assessObservation(observation as never, { mode: 'goal_mode' });
          assert(assessment.recommendation.phase === 'spec' && assessment.recommendation.runner_action === 'backtrack_to_phase', JSON.stringify(assessment.recommendation));
          assert.strictEqual(selectRunnerActionFromAssess({ assessment, observation: observation.reconcile as never, currentPhase: 'plan', chain: FULL, driverGuardAction: 'none' }), 'backtrack_to_phase');
        });
      } finally { rmDir(root); }
    },
  },
  {
    name: '最终评审返修一：authoritative_content_aligned 的真实 affected_files（绝对路径）经 summary → 快照，修掉一处差异即判有进展；一字节不改仍判无进展',
    run: () => {
      const { loadHostSnapshot, SNAPSHOT_CU_FEATURE } = require('../fixtures/host-snapshot-3.1.0/generate') as typeof import('../fixtures/host-snapshot-3.1.0/generate');
      const { handWriteProjections } = require('./component-design-handoff.unit.test') as typeof import('./component-design-handoff.unit.test');
      const { checkAuthoritativeContentAligned } = require('../../scripts/utils/blueprint-skill-projection') as typeof import('../../scripts/utils/blueprint-skill-projection');
      const { SpecLoader } = require('../../scripts/utils/spec-loader') as typeof import('../../scripts/utils/spec-loader');
      const gc = require('../../scripts/utils/goal-failure-classifier') as typeof import('../../scripts/utils/goal-failure-classifier');
      const snap = loadHostSnapshot();
      const { root, frameworkRoot: fw } = snap;
      const feature = SNAPSHOT_CU_FEATURE;
      const acceptanceFile = featureFilePath(root, feature, 'acceptance.yaml');
      const editAc1 = (edit: (ac: Record<string, unknown>) => void): void => {
        const doc = YAML.parse(fs.readFileSync(acceptanceFile, 'utf8'));
        edit(doc.criteria[0]);
        fs.writeFileSync(acceptanceFile, YAML.stringify(doc));
        clearFrameworkConfigCache();
      };
      // 真实生产链：检查产出 → harness-runner 的 summary 写入器 → 归因 / 受影响文件 / 签名 / 快照
      const round = () => {
        clearFrameworkConfigCache();
        const ctx = { projectRoot: root, frameworkRoot: fw, feature, phaseRule: {}, featureSpec: new SpecLoader(root, undefined, undefined, fw).loadFeatureSpec(feature) } as unknown as import('../../scripts/utils/types').CheckContext;
        const gate = checkAuthoritativeContentAligned(ctx, 'acceptance').find(c => c.id === 'authoritative_content_aligned');
        assert(gate && gate.status === 'FAIL', `前提：检查产出 FAIL：${JSON.stringify(gate)}`);
        const summary = writeRunSummaryBase(root, generateScriptReport('', 'spec', feature, root, [gate!], fw), fw);
        const kind = gc.classifyFailureKind(summary as never);
        const files = gc.extractDeterministicAffectedFiles(summary as never);
        return { gate: gate!, kind, files, signature: gc.buildEffectiveBlockerSignature(summary as never, kind, 'spec'), snapshot: gc.snapshotArtifacts(root, files) };
      };
      try {
        clearFrameworkConfigCache();
        handWriteProjections(root);
        editAc1(ac => { ac.expected_result = 'hand drift one'; ac.description = 'hand drift two'; });
        const first = round();
        assert(/AC-1\.expected_result/.test(first.gate.details) && /AC-1\.description/.test(first.gate.details), `前提：两处差异：${first.gate.details}`);
        assert.strictEqual(first.kind, 'deterministic_gate_or_artifact_missing');
        assert(first.files.length === 1 && path.isAbsolute(first.files[0]), `前提：生产者给的是绝对路径：${JSON.stringify(first.files)}`);
        const [entry] = Object.values(first.snapshot);
        assert(entry?.exists === true && entry.contentHash.length === 64, `快照必须读到真实文件：${JSON.stringify(first.snapshot)}`);

        // 反向：一字节不改 → 同签名、快照不变 → 无进展守卫照常要求停机
        const same = round();
        assert.strictEqual(same.signature, first.signature);
        assert.strictEqual(gc.shouldHaltNoProgress({ failureKind: same.kind, priorBlockerSignature: first.signature, currentBlockerSignature: same.signature, priorArtifactSnapshot: first.snapshot, currentArtifactSnapshot: same.snapshot }), true, '未修改时仍须判无进展');

        // 正例：只修一处差异、保留另一处 → 仍 FAIL、同签名，但检测到修改，守卫不停机
        editAc1(ac => { ac.description = 'refresh and recover'; });
        const second = round();
        assert(/AC-1\.expected_result/.test(second.gate.details) && !/AC-1\.description/.test(second.gate.details), `前提：只剩一处差异：${second.gate.details}`);
        assert.strictEqual(second.signature, first.signature, '前提：签名相同（只看快照判进展）');
        assert.strictEqual(gc.artifactsProgressed(first.snapshot, second.snapshot), true, '修掉一处差异必须检测到修改');
        assert.strictEqual(gc.shouldHaltNoProgress({ failureKind: second.kind, priorBlockerSignature: first.signature, currentBlockerSignature: second.signature, priorArtifactSnapshot: first.snapshot, currentArtifactSnapshot: second.snapshot }), false, '真实修复不得被判无进展');

        // 同一文件以相对 / 绝对两种写法传入，快照键一致
        const rel = path.relative(root, acceptanceFile);
        assert.deepStrictEqual(Object.keys(gc.snapshotArtifacts(root, [rel])), Object.keys(gc.snapshotArtifacts(root, [acceptanceFile])), '两种写法键须一致');
      } finally {
        clearFrameworkConfigCache();
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: '最终评审返修二（无效）：蓝图投影自身坏 → 真实 authoritative_content_aligned 无效分支（repair_owner=external）经公开入口 --supersede：spec 只调用一次，首次即停 execution_scope_unresolved，说明指向设计 owner',
    run: () => withDesignOwnerHost(async (h) => {
      h.bump(bp => { h.ledgerDomain(bp).acceptance = '验收写成了一段文本'; });
      const { events, gates } = await h.runSuccessor();
      assert(gates.length === 1 && gates[0].status === 'FAIL' && gates[0].repair_owner === 'external' && /authority_projection_invalid/.test(gates[0].details),
        `前提：真实检查产出无效分支：${JSON.stringify(gates)}`);
      assert.strictEqual(events.filter(e => e.type === 'agent_invoke_start' && e.phase === 'spec').length, 1, 'spec 不得在当前阶段重试');
      const halt = events.filter(e => e.type === 'phase_halt').at(-1);
      assert(halt && halt.halt_reason === 'execution_scope_unresolved' && halt.phase === 'spec', `停机原因：${JSON.stringify(halt)}`);
      const guidance = String(halt!.halt_guidance ?? '');
      assert(/设计 owner/.test(guidance) && /authority_projection_invalid/.test(guidance) && /\/component-design/.test(guidance) && /重新发起同一请求/.test(guidance), `说明须写清原因、责任方与下一步：${guidance}`);
      assert(/设计 owner/.test(String(halt!.reason ?? '')), `reason 写明实情：${halt!.reason}`);
      const end = events.filter(e => e.type === 'run_end').at(-1);
      assert(end && end.halt_reason === 'execution_scope_unresolved', `run_end：${JSON.stringify(end)}`);
      assert(!events.some(e => e.type === 'phase_halt' && e.halt_reason === 'no_progress_guard'), '不得等到无进展熔断');
    }),
  },
  {
    name: '最终评审返修二（漂移）：手写验收未对齐当前设计权威 → 真实检查漂移分支不标 repair_owner，经同一公开入口仍由 spec 重试，同签名零进展才 no_progress_guard 停机（行为不变）',
    run: () => withDesignOwnerHost(async (h) => {
      const { changeProjectedAcceptance } = require('./successor-exit.unit.test') as typeof import('./successor-exit.unit.test');
      h.bump(changeProjectedAcceptance);
      const { events, gates } = await h.runSuccessor();
      assert(gates.length >= 2 && gates.every(g => g.status === 'FAIL' && g.repair_owner === undefined && /AC-1\.expected_result/.test(g.details)), `前提：真实检查产出漂移分支：${JSON.stringify(gates)}`);
      assert(events.filter(e => e.type === 'agent_invoke_start' && e.phase === 'spec').length >= 2, '漂移仍由当前阶段重试');
      const halt = events.filter(e => e.type === 'phase_halt').at(-1);
      assert(halt && halt.halt_reason === 'no_progress_guard', `漂移停机原因不变：${JSON.stringify(halt)}`);
      assert(!events.some(e => e.halt_reason === 'execution_scope_unresolved'), '漂移不得走设计 owner 出口');
    }),
  },
  {
    name: '最终评审返修二（CU 同类）：contracts.modules 越出蓝图可修改模块 → 真实 cu_scope_matches_blueprint（route=reconcile_blueprint）标 repair_owner=external，经真实 summary 写入器进入设计 owner 出口判据；repair_change_unit 路线不标',
    run: () => withDesignOwnerHost(async (h) => {
      const { checkChangeUnitFeatureProjection } = require('../../scripts/utils/change-unit-feature-projection') as typeof import('../../scripts/utils/change-unit-feature-projection');
      const { SpecLoader } = require('../../scripts/utils/spec-loader') as typeof import('../../scripts/utils/spec-loader');
      const { designOwnerBlockers, buildDesignOwnerGuidance } = require('../../scripts/goal-phase-runtime') as typeof import('../../scripts/goal-phase-runtime');
      const contractsFile = featureFilePath(h.root, h.feature, 'contracts.yaml');
      const doc = YAML.parse(fs.readFileSync(contractsFile, 'utf8'));
      doc.modules.push({ name: 'OutsideModule', layer: '02-Feature', format: 'HAR', change_type: 'modify', package_path: 'src/outside' });
      fs.writeFileSync(contractsFile, YAML.stringify(doc));
      clearFrameworkConfigCache();
      const ctx = { projectRoot: h.root, frameworkRoot: h.fw, feature: h.feature, phaseRule: {}, featureSpec: new SpecLoader(h.root, undefined, undefined, h.fw).loadFeatureSpec(h.feature) } as unknown as import('../../scripts/utils/types').CheckContext;
      const checks = checkChangeUnitFeatureProjection(ctx, 'plan');
      const scope = checks.find(c => c.id === 'cu_scope_matches_blueprint');
      assert(scope && scope.status === 'FAIL' && scope.repair_owner === 'external' && /OutsideModule/.test(scope.details), `前提：真实检查产出：${JSON.stringify(scope ?? checks.map(c => [c.id, c.status, c.details.slice(0, 160)]))}`);
      assert(checks.filter(c => c.status === 'FAIL' && c.repair_owner === 'external').every(c => /P1 调和/.test(c.suggestion ?? '')), '只有 reconcile_blueprint 路线标 external');
      const summary = writeRunSummaryBase(h.root, generateScriptReport('', 'plan', h.feature, h.root, [scope!], h.fw), h.fw);
      const owners = designOwnerBlockers(summary.blockers as never);
      assert.deepStrictEqual(owners.map(b => b.id), ['cu_scope_matches_blueprint'], JSON.stringify(summary.blockers));
      const guidance = buildDesignOwnerGuidance({ feature: h.feature, runId: 'r', phase: 'plan', blockers: owners });
      assert(/OutsideModule/.test(guidance) && /设计 owner/.test(guidance), guidance);
    }),
  },
];

/** 快照宿主 + 手写派生文件；runSuccessor 经公开入口 --supersede 起后继，spec 的门由真实检查产出（假 agent 不改文件）。 */
async function withDesignOwnerHost(run: (h: {
  root: string; fw: string; feature: string;
  bump: (mutate: (bp: Record<string, any>) => void) => void;
  ledgerDomain: (bp: Record<string, any>) => Record<string, any>;
  runSuccessor: () => Promise<{ events: Array<Record<string, any>>; gates: CheckResult[] }>;
}) => Promise<void>): Promise<void> {
  const { loadHostSnapshot, SNAPSHOT_CU_FEATURE } = require('../fixtures/host-snapshot-3.1.0/generate') as typeof import('../fixtures/host-snapshot-3.1.0/generate');
  const { handWriteProjections } = require('./component-design-handoff.unit.test') as typeof import('./component-design-handoff.unit.test');
  const se = require('./successor-exit.unit.test') as typeof import('./successor-exit.unit.test');
  const { goalRunEvents } = require('./goal-runner-testing-integrity.unit.test') as typeof import('./goal-runner-testing-integrity.unit.test');
  const { checkAuthoritativeContentAligned } = require('../../scripts/utils/blueprint-skill-projection') as typeof import('../../scripts/utils/blueprint-skill-projection');
  const { SpecLoader } = require('../../scripts/utils/spec-loader') as typeof import('../../scripts/utils/spec-loader');
  const { componentBlueprintPath } = require('../../scripts/utils/component-blueprint-path') as typeof import('../../scripts/utils/component-blueprint-path');
  const { reconcileChangeUnitBlueprintRefs } = require('../../scripts/utils/change-unit-design-preparation') as typeof import('../../scripts/utils/change-unit-design-preparation');
  const { resolveSuccessorExecutionScope } = require('../../scripts/utils/feature-execution-scope') as typeof import('../../scripts/utils/feature-execution-scope');
  const { resolveWorkflowSpec } = require('../../workflow-loader') as typeof import('../../workflow-loader');
  const { assessFeature } = require('../../scripts/utils/feature-assessment') as typeof import('../../scripts/utils/feature-assessment');
  const { resolveChangeUnitExpectedExecution } = require('../../scripts/utils/change-unit-completion') as typeof import('../../scripts/utils/change-unit-completion');
  const snap = loadHostSnapshot();
  const { root, frameworkRoot: fw } = snap;
  const feature = SNAPSHOT_CU_FEATURE;
  const ledgerDomain = (bp: Record<string, any>): Record<string, any> => {
    let hit: Record<string, any> | undefined;
    const visit = (v: unknown): void => {
      if (hit || !v || typeof v !== 'object') return;
      if (Array.isArray(v)) { v.forEach(visit); return; }
      if ((v as { node_id?: string }).node_id === 'ledger-domain') { hit = v as Record<string, any>; return; }
      Object.values(v).forEach(visit);
    };
    visit(bp);
    assert(hit, '快照蓝图缺 ledger-domain');
    return hit!;
  };
  const bump = (mutate: (bp: Record<string, any>) => void): void => {
    const file = componentBlueprintPath(root, 'ledger-app-blueprint');
    const bp = YAML.parse(fs.readFileSync(file, 'utf8'));
    bp.revision = Number(bp.revision) + 1;
    for (const r of bp.derived_results ?? []) r.input_revision = bp.revision;
    mutate(bp);
    fs.writeFileSync(file, YAML.stringify(bp));
    const r = reconcileChangeUnitBlueprintRefs(root, 'ledger-app-blueprint');
    assert(r.bumped.some(b => b.change_unit_id === 'ledger-refresh') && !r.skipped.length, JSON.stringify(r));
    clearFrameworkConfigCache();
  };
  const runSuccessor = async () => {
    const [source] = se.runIds(root, feature);
    const requirement = se.readJson<{ requirement: string }>(se.runFile(root, feature, source, 'manifest.json')).requirement;
    clearFrameworkConfigCache();
    const born = resolveSuccessorExecutionScope(root, feature, resolveWorkflowSpec(root, { frameworkRoot: fw }), fw, requirement, source)!;
    const chain = se.uncoveredOwnerPhases(assessFeature(root, feature, { ...resolveChangeUnitExpectedExecution(root, feature), frameworkRoot: fw, scope: born }));
    assert(chain[0] === 'spec', `前提：出生链从 spec 开始：${JSON.stringify(chain)}`);
    const gates: CheckResult[] = [];
    const { successor } = await se.supersede(snap, feature, source, chain, {
      failExecutorFor: () => false,
      onHarnessSummary: ({ phase }) => {
        if (phase !== 'spec') return null;
        clearFrameworkConfigCache();
        const ctx = { projectRoot: root, frameworkRoot: fw, feature, phaseRule: {}, featureSpec: new SpecLoader(root, undefined, undefined, fw).loadFeatureSpec(feature) } as unknown as import('../../scripts/utils/types').CheckContext;
        const gate = checkAuthoritativeContentAligned(ctx, 'acceptance').find(c => c.id === 'authoritative_content_aligned');
        if (!gate) return null;
        gates.push(gate);
        return { checks: [gate] };
      },
    });
    assert(successor, '后继须出生');
    return { events: goalRunEvents(root, successor!, feature) as Array<Record<string, any>>, gates };
  };
  try {
    clearFrameworkConfigCache();
    handWriteProjections(root);
    await run({ root, fw, feature, bump, ledgerDomain, runSuccessor });
  } finally {
    clearFrameworkConfigCache();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

export async function runAll(): Promise<UnitCaseResult[]> {
  const out: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      await c.run();
      out.push({ name: c.name, ok: true });
    } catch (err) {
      out.push({ name: c.name, ok: false, error: (err as Error).stack ?? (err as Error).message });
    }
  }
  return out;
}

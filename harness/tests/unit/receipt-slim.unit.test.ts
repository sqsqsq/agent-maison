import { runUnitCases } from '../utils/unit-cases';
import { testCliArgs } from '../utils/test-cli-args';
// ============================================================================
// receipt-slim.unit.test.ts — 瘦身回执（receipt_schema 2.0）端到端回归
// （plan e6a3c9f4 t2 / openspec receipt-slim）
// ----------------------------------------------------------------------------
// 真实 CLI 路径（tryValidateReceipt spawn check-receipt.ts 子进程）：
//   - slim PASS：base summary（PASS+0 blocker+指纹新鲜）+ 瘦身回执完整 → passed
//   - checkbox 未勾仍按真实检查/独立核验决定，回执不构成推进条件
//   - 本次 FAIL 的 base summary → failed（slim_summary_not_pass——"读旧 PASS 件"环已拆）
//   - 伪造/过期 gate_fingerprint → failed（gate_fingerprint_stale）
//   - 他 feature 的 summary → failed（identity mismatch，防串目录）
//   - summary 缺失 → failed（不静默豁免）
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { tryValidateReceipt } from '../../scripts/utils/phase-state';
import { writeReceiptScaffold } from '../../scripts/utils/receipt-scaffold';
import { computeGateFingerprint } from '../../scripts/utils/gate-fingerprint';
import { publishFixtureVerifierEvidence } from '../utils/verifier-evidence-fixture';
import { assembleAIPrompt, generateScriptReport, loadVerifierPromptTemplate } from '../../scripts/utils/report-generator';
import { writeRunSummaryBase } from '../../harness-runner';
import { buildVerifierMaterialView } from '../../scripts/utils/verifier-material';
import { resolveVerifierPlan, workflowVerifierPrompt } from '../../scripts/utils/verifier-plan';
import { loadWorkflowSpec } from '../../workflow-loader';
import { SpecLoader } from '../../scripts/utils/spec-loader';
import { buildGoalManifestFromInput } from '../../scripts/utils/goal-manifest';
import { createGoalRun } from '../../scripts/utils/goal-run-creation';
import { phaseEvidenceManifestPath, resolvePhaseEvidenceManifest, writePhaseEvidenceManifest } from '../../scripts/utils/phase-evidence-manifest';
import { computeRunRequirementSha } from '../../scripts/utils/fidelity-shared';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const HARNESS_ROOT = path.resolve(__dirname, '..', '..');
const FRAMEWORK_ROOT = path.resolve(HARNESS_ROOT, '..');
const PHASE = 'review'; // generic profile 未禁用、非 balanced 保留集——策略干净样本

function initGit(root: string): string {
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: root, shell: false });
  fs.appendFileSync(path.join(root, '.git', 'config'), '\n[user]\n\tname = Test\n\temail = test@example.com\n[commit]\n\tgpgsign = false\n');
  spawnSync('git', ['add', '-A'], { cwd: root, shell: false });
  spawnSync('git', ['commit', '-q', '-m', 'baseline'], { cwd: root, shell: false });
  return spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf-8', shell: false }).stdout.trim();
}

interface SlimOpts {
  summaryVerdict?: 'PASS' | 'FAIL';
  summaryFeature?: string;
  staleFingerprint?: boolean;
  omitSummary?: boolean;
  uncheckedBoxes?: boolean;
  /** t2 v2 负例：故意缺 schema 必填字段（手搓片段冒充） */
  dropRequiredKey?: string;
  /** Change a path actually used by this review. */
  dirtyUntrackedAfter?: boolean;
  /** Same edit is unrelated unless the review explicitly consumes the Unicode path. */
  dirtyUnicodeAfter?: boolean;
  reviewUnicode?: boolean;
  commitUnrelatedAfter?: boolean;
  tamperSummaryAfter?: boolean;
  legacyReceipt?: boolean;
  dirtyRootConfigAfter?: boolean;
  /** t2 v4 负例（codex 第三轮高优）：goal 环境 summary 带/不带 run_id */
  summaryRunId?: string;
  /** f9c2e6b4 t1：回执自报的 attempt 身份（省略 = 旧格式回执） */
  claimedAttemptId?: string;
  /** runner-owned-machine-facts 正例：写一条**旧 run** 的账本行（且不覆盖 registry gate）——
   *  账本是跨 run 累积留痕，不再拥有 closure 否决权 */
  staleLedgerFromPriorRun?: boolean;
  /** plan 3abca824 A4：blocking_warnings 已停写——omit=当代 writer 形状；legacy=旧 summary 带非空清单 */
  blockingWarnings?: 'omit' | 'legacy';
}

function buildSlimProject(opts: SlimOpts, currentRunId?: string): { root: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'receipt-slim-'));
  const featureDir = path.join(root, 'doc', 'features', 'demo', PHASE);
  const reportsDir = path.join(featureDir, 'reports');
  fs.mkdirSync(reportsDir, { recursive: true });
  fs.mkdirSync(path.join(root, 'framework', 'harness', 'state'), { recursive: true });
  fs.mkdirSync(path.join(root, 'framework', 'workflows'), { recursive: true });
  fs.copyFileSync(
    path.join(FRAMEWORK_ROOT, 'workflows', 'spec-driven.workflow.yaml'),
    path.join(root, 'framework', 'workflows', 'spec-driven.workflow.yaml'),
  );
  fs.writeFileSync(
    path.join(root, 'framework.config.json'),
    JSON.stringify(
      {
        schema_version: '1.1',
        project_name: 'receipt-slim-test', active_workflow: 'spec-driven',
        project_profile: { name: 'generic' },
        // plan a9d4e7c2：full×interactive 的 verifier=required 需要一个**已登记
        // verifier 能力**的 adapter（generic 没有 SubagentStop 发布链路，恒 blocked）。
        // 本套用例测的是回执/slim 机制，不是 provider 可用性——用 claude 保持变量单一。
        agent_adapter: 'claude',
        architecture: {
          outer_layers: [{ id: 'app', can_depend_on: [], intra_layer_deps: 'forbid' }],
          module_inner_layers: ['content'],
          inner_dependency_direction: 'upward',
          cross_module_exports_file: 'index.ts',
        },
        paths: {
          features_dir: 'doc/features',
          module_catalog: 'doc/module-catalog.yaml',
          glossary: 'doc/glossary.yaml',
          glossary_seed: 'doc/glossary-seed.txt',
          architecture_md: 'doc/architecture.md',
          docs_committed: false,
          receipt_dir_pattern: 'doc/features/<feature>/<phase>',
          reports_dir_pattern: 'doc/features/<feature>/<phase>/reports',
        },
      },
      null,
      2,
    ),
  );

  fs.writeFileSync(
    path.join(reportsDir, 'trace.json'),
    JSON.stringify({ schema_version: '1.0.0', feature: 'demo', phase: PHASE }),
    'utf-8',
  );
  if (opts.staleLedgerFromPriorRun) {
    fs.writeFileSync(
      path.join(featureDir, 'headless-assumptions.jsonl'),
      `${JSON.stringify({
        decision_id: 'stale-1',
        run_id: 'r-prior',
        phase: PHASE,
        gate_id: `${PHASE}.freeze`,
        class: 'artifact_checkbox',
        decision: 'n/a: 旧 run 留痕',
        must_review: false,
        source: 'agent',
        ts: '2026-07-08T10:00:00.000Z',
      })}\n`,
      'utf-8',
    );
  }
  const buildInput = 'build-profile.json5';
  fs.writeFileSync(path.join(root, buildInput), '{ "app": { "sdk": "6.0" } }\n', 'utf-8');

  const sha = initGit(root);

  // Both sources are untracked. The report explicitly selects the files it read.
  const source = 'app/untracked-src.ets', unicode = 'app/中文 组件.ets';
  fs.mkdirSync(path.join(root, 'app'), { recursive: true });
  fs.writeFileSync(path.join(root, source), 'const V = 1;\n', 'utf-8');
  fs.writeFileSync(path.join(root, unicode), 'const CN = 1;\n', 'utf-8');

  for (const runId of new Set([opts.summaryRunId, currentRunId].filter((id): id is string => !!id))) {
    const manifest = buildGoalManifestFromInput({ feature: 'demo', adapter: 'claude', start_phase: PHASE, end_phase: PHASE,
      requirement: '核验当前 app 源码读取结果', unattended: false }, { projectRoot: root, runId });
    createGoalRun({ projectRoot: root, manifest, chain: [PHASE] });
  }
  if (!opts.omitSummary) {
    const producerRunId = opts.summaryRunId ?? currentRunId, previousRunId = process.env.MAISON_GOAL_RUN_ID;
    if (producerRunId) process.env.MAISON_GOAL_RUN_ID = producerRunId; else delete process.env.MAISON_GOAL_RUN_ID;
    let summary: Record<string, unknown>;
    const inputs = [source, buildInput, ...(opts.reviewUnicode ? [unicode] : [])];
    try {
      const contextFiles = inputs.map(label => ({ label, kind: 'path' as const, content: fs.readFileSync(path.join(root, label), 'utf8') }));
      const report = generateScriptReport(HARNESS_ROOT, PHASE, 'demo', root, [{ id: 'fixture_current_source', category: 'structure',
        description: 'current receipt source and build inputs', severity: 'BLOCKER',
        status: opts.summaryVerdict === 'FAIL' || contextFiles.some(file => !file.content.trim()) ? 'FAIL' : 'PASS',
        details: `Read actual current inputs: ${inputs.join(', ')}`, affected_files: inputs }], FRAMEWORK_ROOT);
      const plan = resolveVerifierPlan({ phase: PHASE, track: 'full', runtimeMode: 'interactive', policy: { verifier: 'required' },
        workflowVerifierPrompt: workflowVerifierPrompt(loadWorkflowSpec(FRAMEWORK_ROOT, 'spec-driven'), PHASE) });
      const phaseRuleText = JSON.stringify(new SpecLoader(root, undefined, undefined, FRAMEWORK_ROOT).loadPhaseRule(PHASE));
      assembleAIPrompt(HARNESS_ROOT, root, PHASE, 'demo', contextFiles, JSON.stringify(report), phaseRuleText, undefined, undefined,
        FRAMEWORK_ROOT, { verifierPromptRel: plan.verifier_prompt! });
      const material = buildVerifierMaterialView({ projectRoot: root, feature: 'demo', phase: PHASE, frameworkRoot: FRAMEWORK_ROOT,
        gateFingerprint: computeGateFingerprint(FRAMEWORK_ROOT, PHASE), phaseRuleText,
        templateText: loadVerifierPromptTemplate(HARNESS_ROOT, PHASE, undefined, plan.verifier_prompt!), checks: report.checks, contextFiles });
      const produced = writeRunSummaryBase(root, report, FRAMEWORK_ROOT, { verifierPlan: plan, verifierMaterial: material });
      assert(opts.summaryVerdict === 'FAIL' || !!produced.verifier_subject_id, 'the successful producer must issue its current verification request');
      if (produced.verifier_subject_id) publishFixtureVerifierEvidence({ projectRoot: root, reportsDir, feature: 'demo', phase: PHASE,
        subjectId: produced.verifier_subject_id, skipSummaryPatch: true });
      summary = { ...produced };
    } finally {
      if (previousRunId === undefined) delete process.env.MAISON_GOAL_RUN_ID; else process.env.MAISON_GOAL_RUN_ID = previousRunId;
    }
    // Faults are applied after the real writer, without replacing its raw checks or quality projection.
    if (opts.summaryFeature) summary.feature = opts.summaryFeature;
    if (opts.staleFingerprint) summary.gate_fingerprint = 'v9.9.9:deadbeef0000';
    if (currentRunId && !opts.summaryRunId) delete summary.run_id;
    if (opts.dropRequiredKey) delete summary[opts.dropRequiredKey];
    if (opts.blockingWarnings === 'omit') delete summary.blocking_warnings;
    if (opts.blockingWarnings === 'legacy') {
      summary.blocking_warnings = [{ id: 'scope_declaration', blocking_class: 'prd_scope', details_excerpt: 'rationale 为空', suggestion: '补齐 rationale' }];
    }
    fs.writeFileSync(path.join(reportsDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf-8');
    writePhaseEvidenceManifest(root, resolvePhaseEvidenceManifest({
      projectRoot: root, feature: 'demo', phase: PHASE, frameworkRoot: FRAMEWORK_ROOT, extraInputs: inputs,
      requirementSha: producerRunId ? computeRunRequirementSha(root, 'demo', producerRunId) : null,
    }));
  }
  const box = opts.uncheckedBoxes ? '[ ]' : '[x]';
  const receipt = [
    '---',
    ...(opts.legacyReceipt ? [] : ['receipt_schema: "2.0"']),
    'feature: "demo"',
    `phase: "${PHASE}"`,
    'agent_model: "test-model"',
    'agent_runtime: "test-runtime"',
    'claimed_completion_at: "2026-07-16T10:00:00+08:00"',
    `claimed_completion_commit_sha: "${sha}"`,
    ...(opts.claimedAttemptId ? [`claimed_attempt_id: "${opts.claimedAttemptId}"`] : []),
    'verifier_subagent:',
    '  invoked_via: "Task(subagent_type=verifier)"',
    `  report_path: "doc/features/demo/${PHASE}/reports/verifier.report.md"`,
    '  verdict: "PASS"',
    '---',
    '',
    '## 反假设条款回顾',
    '',
    `- ${box} a`,
    `- ${box} b`,
    `- ${box} c`,
    '',
  ].join('\n');
  fs.writeFileSync(path.join(featureDir, 'phase-completion-receipt.md'), receipt, 'utf-8');
  return { root };
}

function runCase(opts: SlimOpts, env?: Record<string, string | undefined>): ReturnType<typeof tryValidateReceipt> {
  const { root } = buildSlimProject(opts, env?.MAISON_GOAL_RUN_ID);
  // Only post-publication mutations exercise freshness against the original bytes.
  if (opts.dirtyUntrackedAfter) {
    fs.writeFileSync(path.join(root, 'app', 'untracked-src.ets'), 'const V = 2;\n', 'utf-8');
  }
  if (opts.dirtyUnicodeAfter) {
    fs.writeFileSync(path.join(root, 'app', '中文 组件.ets'), 'const CN = 2;\n', 'utf-8');
  }
  if (opts.dirtyRootConfigAfter) {
    fs.writeFileSync(path.join(root, 'build-profile.json5'), '{ "app": { "sdk": "6.1" } }\n', 'utf-8');
  }
  if (opts.commitUnrelatedAfter) {
    fs.writeFileSync(path.join(root, 'parallel-change.txt'), 'independent work\n', 'utf8');
    const args = ['commit', '-qm', 'parallel request', '--', 'parallel-change.txt'];
    assert(spawnSync('git', ['add', '--', 'parallel-change.txt'], { cwd: root }).status === 0, 'stage independent change');
    assert(spawnSync('git', args, { cwd: root }).status === 0, 'commit independent change');
  }
  if (opts.tamperSummaryAfter) {
    const file = path.join(root, 'doc/features/demo', PHASE, 'reports/summary.json');
    const summary = JSON.parse(fs.readFileSync(file, 'utf8'));
    fs.writeFileSync(file, JSON.stringify({ ...summary, source_commit_sha: '0'.repeat(40) }, null, 2));
  }
  const savedEnv: Record<string, string | undefined> = {};
  if (env) {
    for (const [k, v] of Object.entries(env)) {
      savedEnv[k] = process.env[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
  try {
    return tryValidateReceipt(HARNESS_ROOT, root, PHASE, 'demo');
  } finally {
    if (env) {
      for (const [k, v] of Object.entries(savedEnv)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'slim PASS：base summary（PASS+0+指纹新鲜）+ 完整瘦身回执 → passed',
    run: () => {
      const v = runCase({});
      assert(v.status === 'passed', `expected passed, got ${v.status}: ${v.message ?? ''}`);
    },
  },
  {
    name: 'plan 07a41ec6 T4：反假设 checkbox 不再是判据（回执为机器投影）→ 未勾也 passed',
    run: () => {
      const v = runCase({ uncheckedBoxes: true });
      assert(v.status === 'passed', `expected passed, got ${v.status}: ${v.message ?? ''}`);
    },
  },
  {
    name: '本次 FAIL 的 base summary → failed（时序拆环：不再读旧 PASS 件）',
    run: () => {
      const v = runCase({ summaryVerdict: 'FAIL' });
      assert(v.status === 'failed', `expected failed, got ${v.status}`);
    },
  },
  {
    name: '伪造/过期 gate_fingerprint → failed（stale 治理照拦 slim）',
    run: () => {
      const v = runCase({ staleFingerprint: true });
      assert(v.status === 'failed', `expected failed, got ${v.status}`);
    },
  },
  {
    name: '他 feature 的 summary → failed（identity mismatch，防串目录）',
    run: () => {
      const v = runCase({ summaryFeature: 'other-feature' });
      assert(v.status === 'failed', `expected failed, got ${v.status}`);
    },
  },
  {
    name: 'summary 缺失 → failed（机器事实源缺失不静默豁免）',
    run: () => {
      const v = runCase({ omitSummary: true });
      assert(v.status === 'failed', `expected failed, got ${v.status}`);
    },
  },
  {
    name: 't2 v2：缺 schema 必填字段的手搓 summary → failed（slim_summary_schema_invalid）',
    run: () => {
      const v = runCase({ dropRequiredKey: 'run_statuses' });
      assert(v.status === 'failed', `expected failed, got ${v.status}`);
    },
  },
  {
    name: 'plan 3abca824 A4：不带 blocking_warnings 的当代 summary 过回执入口 schema 校验 → passed',
    run: () => {
      const v = runCase({ blockingWarnings: 'omit' });
      assert(v.status === 'passed', `expected passed, got ${v.status}: ${v.message ?? ''}`);
    },
  },
  {
    name: 'plan 3abca824 A4：带非空 blocking_warnings 的旧 summary 仍过回执入口 schema 校验 → passed',
    run: () => {
      const v = runCase({ blockingWarnings: 'legacy' });
      assert(v.status === 'passed', `expected passed, got ${v.status}: ${v.message ?? ''}`);
    },
  },
  {
    name: '实际输入回执：另一请求提交及未纳入本次 review 的工作区变动不使结论失效',
    run: () => {
      const result = runCase({ commitUnrelatedAfter: true, dirtyUnicodeAfter: true });
      assert(result.status === 'passed', `当前绑定仍有效：${result.message}`);
    },
  },
  {
    name: '实际输入回执：已签 summary 事后改写被原证据拒绝',
    run: () => {
      const result = runCase({ tamperSummaryAfter: true });
      assert(result.status === 'failed' && (result.message ?? '').includes('summary.json'), String(result.message));
    },
  },
  {
    name: '实际输入回执：相关源码、中文含空格路径和已引用的构建输入变化分别拒收',
    run: () => {
      const result = runCase({ dirtyUntrackedAfter: true, dirtyUnicodeAfter: true, reviewUnicode: true, dirtyRootConfigAfter: true });
      for (const input of ['app/untracked-src.ets', 'app/中文 组件.ets', 'build-profile.json5']) {
        assert(result.status === 'failed' && (result.message ?? '').includes(input), `${input}：${result.status} ${result.message}`);
      }
    },
  },
  {
    name: '实际输入回执：历史无 Git 摘要与当前无 Git 不妨碍核原报告',
    run: () => {
      const { root } = buildSlimProject({});
      try {
        const summaryPath = path.join(root, 'doc/features/demo', PHASE, 'reports/summary.json');
        const manifestPath = phaseEvidenceManifestPath(root, 'demo', PHASE);
        const summaryBytes = fs.readFileSync(summaryPath, 'utf8');
        const manifestBytes = fs.readFileSync(manifestPath);
        fs.writeFileSync(summaryPath, JSON.stringify({ ...JSON.parse(summaryBytes), worktree_digest: 'no-git' }));
        writePhaseEvidenceManifest(root, resolvePhaseEvidenceManifest({ projectRoot: root, feature: 'demo', phase: PHASE,
          frameworkRoot: FRAMEWORK_ROOT, extraInputs: ['app/untracked-src.ets', 'build-profile.json5'] }));
        const cli = spawnSync(process.execPath, [...testCliArgs(path.join(HARNESS_ROOT, 'scripts/check-receipt.ts')),
          '--feature', 'demo', '--phase', PHASE, '--project-root', root, '--skip-state-sync'], { cwd: HARNESS_ROOT, encoding: 'utf8', windowsHide: true });
        assert(cli.status === 0, `历史无 Git 摘要仍可核原报告：${cli.stderr || cli.error?.message}`);

        fs.writeFileSync(summaryPath, summaryBytes);
        fs.writeFileSync(manifestPath, manifestBytes);
        fs.renameSync(path.join(root, '.git'), path.join(root, '.git-off'));
        const result = tryValidateReceipt(HARNESS_ROOT, root, PHASE, 'demo');
        assert(result.status === 'passed', `当前无 Git 时原件绑定仍有效：${result.message}`);
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    },
  },
  // ==========================================================================
  // f9c2e6b4 t1 —— attempt 身份门禁必须在**Cursor 丢 env 的真实形态**下也生效。
  // 仓内实锤（phase-state.ts:107）：adapter 工具子进程会丢 MAISON_GOAL_HEADLESS/RUNNER，
  // 只留 RUN_ID/ATTEMPT。若门禁只认 isGoalOrchestrationEnv()，agent 侧跑 check-receipt
  // 时校验完全不执行，而 observer 又严格要求该字段 → 一路跑到 hard timeout。
  // 三例均只设 RUN_ID+ATTEMPT（不设 RUNNER/HEADLESS），复现该形态。
  // ==========================================================================
  {
    name: 'plan 07a41ec6 T4：仅 RUN_ID+ATTEMPT 且 receipt 缺失 → 新闭环仍按 summary/verifier/policy passed',
    run: () => {
      const v = runCase(
        { summaryRunId: 'r-123' },
        {
          MAISON_GOAL_RUNNER: undefined, MAISON_GOAL_HEADLESS: undefined,
          MAISON_GOAL_GATE_HARNESS: undefined,
          MAISON_GOAL_RUN_ID: 'r-123', MAISON_GOAL_ATTEMPT: 'i5',
          MAISON_GOAL_ATTEMPT_PHASE: PHASE,
        },
      );
      assert(v.status === 'passed', `expected passed（receipt 非输入），got ${v.status}: ${v.message ?? ''}`);
    },
  },
  {
    name: 'plan 07a41ec6 T4：当前 receipt 的旧 claimed_attempt_id 不参与新闭环 → passed',
    run: () => {
      const v = runCase(
        { summaryRunId: 'r-123', claimedAttemptId: 'i3' },
        {
          MAISON_GOAL_RUNNER: undefined, MAISON_GOAL_HEADLESS: undefined,
          MAISON_GOAL_GATE_HARNESS: undefined,
          MAISON_GOAL_RUN_ID: 'r-123', MAISON_GOAL_ATTEMPT: 'i5',
          MAISON_GOAL_ATTEMPT_PHASE: PHASE,
        },
      );
      assert(v.status === 'passed', `expected passed, got ${v.status}: ${v.message ?? ''}`);
    },
  },
  {
    // 二轮复核：上面三例只证明 attempt 门禁没被绕过，未证明**整个 check-receipt** 在该
    // 环境下仍保持 goal 语义。本例打 slim 凭证的 run 绑定分支（与 attempt 门禁无关的另一处
    // goal 分支）：cursor 形态下 summary 缺 run_id 必须照样 BLOCKER，否则说明该分支仍被
    // 误判成 interactive 而静默跳过。
    name: 'f9c2e6b4 t1：cursor 丢 env 形态下**非 attempt 分支**同样保持 goal 语义（summary 缺 run_id → failed）',
    run: () => {
      const v = runCase(
        { claimedAttemptId: 'i5' }, // 不设 summaryRunId
        {
          MAISON_GOAL_RUNNER: undefined, MAISON_GOAL_HEADLESS: undefined,
          MAISON_GOAL_GATE_HARNESS: undefined,
          MAISON_GOAL_RUN_ID: 'r-123', MAISON_GOAL_ATTEMPT: 'i5',
          MAISON_GOAL_ATTEMPT_PHASE: PHASE,
        },
      );
      assert(v.status === 'failed', `expected failed, got ${v.status}`);
      assert(
        (v.message ?? '').includes('slim_summary_run_id_missing'),
        `goal 语义须覆盖 slim 凭证 run 绑定分支：${v.message}`,
      );
    },
  },
  {
    name: 'f9c2e6b4 t1：仅 RUN_ID+ATTEMPT 且 claimed_attempt_id 精确匹配 → 不因本门禁失败',
    run: () => {
      const v = runCase(
        { summaryRunId: 'r-123', claimedAttemptId: 'i5' },
        {
          MAISON_GOAL_RUNNER: undefined, MAISON_GOAL_HEADLESS: undefined,
          MAISON_GOAL_GATE_HARNESS: undefined,
          MAISON_GOAL_RUN_ID: 'r-123', MAISON_GOAL_ATTEMPT: 'i5',
          MAISON_GOAL_ATTEMPT_PHASE: PHASE,
        },
      );
      assert(
        !(v.message ?? '').includes('claimed_attempt_id'),
        `匹配时不得再报 attempt 身份问题：${v.message}`,
      );
    },
  },
  // ==========================================================================
  // b3e8d4c7 t1 —— attempt 等值**只在同 phase 内成立**。
  // 宿主实锤 run 20260804T033834Z-99c0a1：coding attempt(i5) 里按门禁指引回上游重跑
  // plan harness，plan 回执写的是 plan 自己的 attempt(i3)——跨阶段复验结构上不可能通过
  // （填 i3≠i5，改 i5=伪造），把框架自己指的修复路堵死，最终死锁。
  // ==========================================================================
  {
    name: 'b3e8d4c7 t1 事故回归：跨阶段复验（attempt 属别的 phase）不得因 attempt 不等而 BLOCKER',
    run: () => {
      const v = runCase(
        { summaryRunId: 'r-123', claimedAttemptId: 'i3' }, // 回执带本 phase 自己的 attempt
        {
          MAISON_GOAL_RUNNER: undefined, MAISON_GOAL_HEADLESS: undefined,
          MAISON_GOAL_GATE_HARNESS: undefined,
          MAISON_GOAL_RUN_ID: 'r-123',
          MAISON_GOAL_ATTEMPT: 'i5', MAISON_GOAL_ATTEMPT_PHASE: 'coding', // 当前在 coding attempt 里
        },
      );
      assert(
        !(v.message ?? '').includes('claimed_attempt_id'),
        `跨阶段复验不得报 attempt 身份问题（本次事故形态）：${v.message}`,
      );
    },
  },
  {
    name: 'plan 07a41ec6 T4：goal attempt phase 缺失不再由 receipt 门阻止新闭环',
    run: () => {
      const v = runCase(
        { summaryRunId: 'r-123', claimedAttemptId: 'i5' },
        {
          MAISON_GOAL_RUNNER: undefined, MAISON_GOAL_HEADLESS: undefined,
          MAISON_GOAL_GATE_HARNESS: undefined,
          MAISON_GOAL_RUN_ID: 'r-123', MAISON_GOAL_ATTEMPT: 'i5',
          MAISON_GOAL_ATTEMPT_PHASE: undefined,
        },
      );
      assert(v.status === 'passed', `expected passed, got ${v.status}: ${v.message ?? ''}`);
    },
  },
  {
    name: 'b3e8d4c7 t1：仅 ATTEMPT_PHASE 在场也算 goal 信号（并集扩充，不得当 manual 放行）',
    run: () => {
      const v = runCase(
        { claimedAttemptId: 'i5' }, // 不设 summaryRunId
        {
          MAISON_GOAL_RUNNER: undefined, MAISON_GOAL_HEADLESS: undefined,
          MAISON_GOAL_GATE_HARNESS: undefined, MAISON_GOAL_ATTEMPT: undefined,
          MAISON_GOAL_RUN_ID: undefined, MAISON_GOAL_ATTEMPT_PHASE: PHASE,
        },
      );
      assert(v.status === 'failed', `expected failed, got ${v.status}`);
      assert(
        (v.message ?? '').includes('MAISON_GOAL_RUN_ID'),
        `goal 语义须生效（run identity 必填）：${v.message}`,
      );
    },
  },
  {
    name: 't2 v4 fail-closed：goal 环境缺 MAISON_GOAL_RUN_ID → failed（传播异常不得静默跳过绑定校验）',
    run: () => {
      const v = runCase(
        { summaryRunId: 'r-123' },
        { MAISON_GOAL_RUNNER: '1', MAISON_GOAL_HEADLESS: undefined, MAISON_GOAL_RUN_ID: undefined },
      );
      assert(v.status === 'failed', `expected failed, got ${v.status}`);
      assert(
        (v.message ?? '').includes('slim_summary_run_identity_unavailable'),
        `应命中 run identity 缺失 BLOCKER：${v.message}`,
      );
    },
  },
  {
    name: 't2 v4 fail-closed：goal 环境 summary 缺 run_id → failed（旧版产物不得闭环）',
    run: () => {
      const v = runCase(
        {},
        { MAISON_GOAL_RUNNER: '1', MAISON_GOAL_HEADLESS: undefined, MAISON_GOAL_RUN_ID: 'r-123' },
      );
      assert(v.status === 'failed', `expected failed, got ${v.status}`);
      assert(
        (v.message ?? '').includes('slim_summary_run_id_missing'),
        `应命中 summary 缺 run_id BLOCKER：${v.message}`,
      );
    },
  },
  {
    name: 't2 v4：goal 环境 run_id 不匹配 → failed（跨 run 复用被拒，语义保持）',
    run: () => {
      const v = runCase(
        { summaryRunId: 'r-old' },
        { MAISON_GOAL_RUNNER: '1', MAISON_GOAL_HEADLESS: undefined, MAISON_GOAL_RUN_ID: 'r-new' },
      );
      assert(v.status === 'failed', `expected failed, got ${v.status}`);
      assert(
        (v.message ?? '').includes('slim_summary_run_id_mismatch'),
        `应命中 run_id 失配 BLOCKER：${v.message}`,
      );
    },
  },
  {
    name: '实际输入回执：旧格式同阶段回执声明了他 attempt 时仍拒绝',
    run: () => {
      const result = runCase({ omitSummary: true, legacyReceipt: true, claimedAttemptId: 'i3' },
        { MAISON_GOAL_RUN_ID: 'r-123', MAISON_GOAL_ATTEMPT: 'i5', MAISON_GOAL_ATTEMPT_PHASE: PHASE });
      assert(result.status === 'failed' && (result.message ?? '').includes('receipt_attempt_identity'), String(result.message));
    },
  },
  {
    name: 'runner-owned-machine-facts：旧 run 账本行在场+registry gate 未覆盖 → 不再否决闭环（goal 态 passed）',
    run: () => {
      // 宿主实锤 run 20260815T083127Z-edfe38：账本 58 条旧 run 行 + 2 条初 run 已物化决议
      // 曾把完整且身份等值的回执恒判 failed。账本仅留痕，closure 否决权已退役。
      const v = runCase(
        { summaryRunId: 'r-new', claimedAttemptId: 'i2', staleLedgerFromPriorRun: true },
        {
          MAISON_GOAL_RUNNER: '1',
          MAISON_GOAL_HEADLESS: undefined,
          MAISON_GOAL_RUN_ID: 'r-new',
          MAISON_GOAL_ATTEMPT: 'i2',
          MAISON_GOAL_ATTEMPT_PHASE: PHASE,
        },
      );
      assert(v.status === 'passed', `账本留痕不得否决完整且身份等值的回执：${v.status} ${v.message ?? ''}`);
    },
  },
  {
    name: 'runner-owned-machine-facts：骨架身份预填（attemptId）/幂等不覆盖/force 重建作废旧回执/非 goal 留空',
    run: () => {
      // goal 态预填：claimed_attempt_id 由 runner 写入骨架
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'receipt-scaffold-'));
      const r1 = writeReceiptScaffold(root, 'demo', PHASE, { attemptId: 'i3' });
      assert(r1.wrote && r1.receiptPath !== null, '首次生成应写盘');
      const text1 = fs.readFileSync(r1.receiptPath!, 'utf-8');
      assert(text1.includes('claimed_attempt_id: "i3"'), `身份应预填 i3：${text1.slice(0, 300)}`);
      assert(text1.includes('feature: "demo"') && text1.includes(`phase: "${PHASE}"`), 'feature/phase 应预填');
      // 幂等：已存在 + 非 force → 不覆盖（harness PASS 语义，agent 已填内容不丢）
      fs.appendFileSync(r1.receiptPath!, '\n<!-- agent-filled -->\n', 'utf-8');
      const r2 = writeReceiptScaffold(root, 'demo', PHASE, { attemptId: 'i4' });
      assert(!r2.wrote, '已存在时非 force 不得覆盖');
      assert(fs.readFileSync(r1.receiptPath!, 'utf-8').includes('agent-filled'), '既有内容应保留');
      // force：closure attempt 前重建——旧回执作废、身份换新、骨架回到未完成态
      const r3 = writeReceiptScaffold(root, 'demo', PHASE, { attemptId: 'i4', force: true });
      assert(r3.wrote, 'force 应重建');
      const text3 = fs.readFileSync(r3.receiptPath!, 'utf-8');
      assert(text3.includes('claimed_attempt_id: "i4"'), '身份应更新为 i4');
      assert(!text3.includes('agent-filled'), '上一 attempt 的旧回执内容应被作废（防旧声明误命中完成观测）');
      assert(/receipt_schema: "2\.1"/.test(text3), '重建后的回执是 2.1 机器投影（无反假设 checkbox）');
      // 非 goal（人工态）：attemptId 省略 → 字段留空
      const root2 = fs.mkdtempSync(path.join(os.tmpdir(), 'receipt-scaffold-'));
      const r4 = writeReceiptScaffold(root2, 'demo', PHASE, {});
      assert(r4.wrote && r4.receiptPath !== null, '非 goal 也应能生成骨架');
      assert(
        fs.readFileSync(r4.receiptPath!, 'utf-8').includes('claimed_attempt_id: ""'),
        '非 goal 态身份字段保持留空',
      );
    },
  },
  {
    name: 'legacy 投影 helper 写失败仍携带真实原因（闭环调用方只作 WARN）',
    run: () => {
      // 让回执路径落在一个"以文件占位"的目录下：mkdirSync 必然 EEXIST/ENOTDIR
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'receipt-scaffold-fail-'));
      const featuresDir = path.join(root, 'doc', 'features');
      fs.mkdirSync(path.dirname(featuresDir), { recursive: true });
      fs.writeFileSync(featuresDir, 'not-a-directory', 'utf-8');
      const r = writeReceiptScaffold(root, 'demo', PHASE, { attemptId: 'i2', force: true });
      assert(!r.wrote, '写失败不得报 wrote');
      assert(
        typeof r.failure === 'string' && r.failure.length > 0,
        `失败必须携带真实原因（路径+I/O 错误），实得：${JSON.stringify(r)}`,
      );
    },
  },
  {
    name: '生产接线：runner/invoke 前不写 receipt，finalizer 在 closed 后 best-effort 投影',
    run: () => {
      const harness = fs.readFileSync(path.resolve(__dirname, '../../harness-runner.ts'), 'utf8');
      const finalizer = fs.readFileSync(path.resolve(__dirname, '../../scripts/utils/phase-closure-finalizer.ts'), 'utf8');
      assert(!/writeReceiptSkeletonIfMissing|writeReceiptProjection/.test(harness), 'harness runner 不得在 closure 前写 receipt');
      assert(/fs\.renameSync\(stagedSummaryPath, summaryPath\)[\s\S]{0,500}projectReceiptAfterClosure/.test(finalizer), 'receipt 只能在 summary commit 后 best-effort 投影');
    },
  },
];

export function runAll(): UnitCaseResult[] {
  return runUnitCases(cases);
}

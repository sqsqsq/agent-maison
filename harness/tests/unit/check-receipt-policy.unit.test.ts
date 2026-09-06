// ============================================================================
// check-receipt-policy.unit.test.ts — C2 verification-matrix 端到端回归
// （plan d4a7c1e8）
// ============================================================================
// 覆盖真实 CLI 路径（tryValidateReceipt 真 spawn check-receipt.ts 子进程）：
//   - lite track：not_applicable，零 spawn（架构性短路）
//   - full×strict（缺省）：verifier 缺失仍 FAIL——零回归
//   - full×balanced×非保留 phase：verifier 缺失也 PASS（off 跳过整块）
//   - full×balanced：trace 缺失仅 WARN 不 FAIL（optional 豁免"不提供"）
// 每个真实 spawn 用例都构造完整合法回执骨架，只消融被测字段，隔离变量。

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { runSyncClosureDetailed, tryValidateReceipt } from '../../scripts/utils/phase-state';
// B05（plan 7b3e9a15）V8：sob 的闭环负例必须经**真实 writer** 再验 check-receipt——
// 手写 summary 只能证明 check-receipt 一侧，恰好绕过 writer 的候选/next_action/字段三处。
import { writeRunSummaryBase } from '../../harness-runner';
import { resolveEvidencePolicy, type RuntimeContext } from '../../scripts/utils/runtime-policy';
import { resolveVerifierPlan, workflowVerifierPrompt } from '../../scripts/utils/verifier-plan';
import { buildVerifierMaterialView } from '../../scripts/utils/verifier-material';
import { checkDataModelTyped } from '../../scripts/check-plan';
import { loadWorkflowSpec } from '../../workflow-loader';
import type { CheckContext, CheckResult, ContextFileEntry, Phase, ScriptReport } from '../../scripts/utils/types';
import { clearFrameworkConfigCache, featurePhaseReportsDir, resolveFeatureArtifact, statefilePath } from '../../config';
import { publishFixtureVerifierEvidence } from '../utils/verifier-evidence-fixture';
import { SUMMARY_SCHEMA_VERSION_CURRENT } from '../../scripts/utils/quality-axes';
import { computeGateFingerprint } from '../../scripts/utils/gate-fingerprint';
import { computeProductWorktreeDigest } from '../../scripts/utils/worktree-digest';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const HARNESS_ROOT = path.resolve(__dirname, '..', '..');

function initGit(root: string): string {
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: root, shell: false });
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root, shell: false });
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: root, shell: false });
  spawnSync('git', ['add', '-A'], { cwd: root, shell: false });
  spawnSync('git', ['commit', '-q', '-m', 'baseline'], { cwd: root, shell: false });
  const sha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf-8', shell: false });
  return sha.stdout.trim();
}

interface ReceiptOpts {
  evidenceProfile?: 'balanced';
  omitVerifier?: boolean;
  omitTrace?: boolean;
  /**
   * B05 V3（plan 7b3e9a15 D1）：canonical 路径上留一份**损坏**的 trace.json，同时回执写
   * `trace_json: {}`（声明"未提供"）。改前 check-receipt 只按回执自报决定要不要读磁盘，
   * optional 档下会把损坏证据降成 missing WARN。
   */
  corruptTrace?: boolean;
  /** 环 C（plan f3a8c6d2 t2）：goal 下的 attempt 身份自证字段；省略=非 goal 夹具（现状） */
  claimedAttemptId?: string;
  /**
   * `reports_dir_pattern` 指向 phase 目录**本身**（宿主可配形态，codex 三轮 medium）。
   * 此时 review-report.md 等阶段产物落在 reports 面内 → 材料视图构建侧把它们当运行期产出
   * 排除，只能经 contextFiles 进视图；候选集必须用**同一条**规则判归属，否则沿用判据恒失配。
   */
  reportsInPhaseDir?: boolean;
  /**
   * 环 C：goal 身份在场时 check-receipt 另行强制 headless-assumptions 账本
   * （registry 中该 phase 的每个 gate 都须有记录）。账本 closure 否决已退役
   * （runner-owned-machine-facts）——本选项保留仅为可写旧 run 账本行，钉住
   * 「账本内容不参与闭环裁决」。
   */
  goalLedgerRunId?: string;
  extensionManifest?: string;
}

/** 构造一个「除被消融字段外全部合法」的 full track 工程；返回 { root, sha, phase }。 */
function buildProject(phase: string, opts: ReceiptOpts): { root: string; sha: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'receipt-policy-'));
  const featureDir = path.join(root, 'doc', 'features', 'demo', phase);
  const reportsRelDir = `doc/features/demo/${phase}${opts.reportsInPhaseDir ? '' : '/reports'}`;
  const reportsDir = path.resolve(root, reportsRelDir);
  fs.mkdirSync(reportsDir, { recursive: true });

  // submodule layout：resolveWorkflowSpec（check-receipt.ts 子进程内、无显式 frameworkRoot）
  // 依赖 <projectRoot>/framework/workflows/ 探测到 workflow tree。
  fs.mkdirSync(path.join(root, 'framework', 'harness', 'state'), { recursive: true });
  fs.mkdirSync(path.join(root, 'framework', 'workflows'), { recursive: true });
  fs.copyFileSync(
    path.join(HARNESS_ROOT, '..', 'workflows', 'spec-driven.workflow.yaml'),
    path.join(root, 'framework', 'workflows', 'spec-driven.workflow.yaml'),
  );

  fs.writeFileSync(
    path.join(root, 'framework.config.json'),
    JSON.stringify(
      {
        schema_version: '1.1',
        project_name: 'receipt-policy-test',
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
          reports_dir_pattern: `doc/features/<feature>/<phase>${opts.reportsInPhaseDir ? '' : '/reports'}`,
        },
        ...(opts.evidenceProfile ? { evidence_profile: opts.evidenceProfile } : {}),
      },
      null,
      2,
    ),
  );

  const tracePath = path.join(reportsDir, 'trace.json');
  fs.writeFileSync(tracePath, JSON.stringify({ schema_version: '1.0.0', feature: 'demo', phase }), 'utf-8');
  const ceAbs = path.join(featureDir, 'context-exploration.md');
  fs.writeFileSync(ceAbs, '# context exploration\n', 'utf-8');
  // plan e5b8c3f7：verifier 证据 = summary.verifier_subject_id + 身份验真过的
  // verifier.report.<subject>.md（与生产同形，经共享 fixture 工具写入）。
  // omitVerifier 时**两者都不写**——这正是"verifier 缺失"的新形态（旧形态是不写 MD）。
  if (!opts.omitVerifier) {
    fs.writeFileSync(
      path.join(reportsDir, 'summary.json'),
      JSON.stringify(
        {
          // plan a9d4e7c2 T3: dispatch is keyed on schema_version now, so the fixture
          // must carry the current generation or it is (correctly) treated as legacy.
          schema_version: SUMMARY_SCHEMA_VERSION_CURRENT,
          phase,
          feature: 'demo',
          verdict: 'PASS',
          blocker_count: 0,
          fail_count: 0,
          warn_count: 0,
          // assurance 刻意缺席：本夹具用于身份/证据面断言，闭环提交阶段必然失败
          // （见「环C：重签后放行」用例——它靠 finalizer 抛错区分"身份放行"与"身份拦截"）。
          closure_status: 'open',
        },
        null,
        2,
      ),
      'utf-8',
    );
    publishFixtureVerifierEvidence({ projectRoot: root, reportsDir, feature: 'demo', phase });
  }

  if (opts.extensionManifest) {
    fs.mkdirSync(path.join(root, 'doc', 'extensions'), { recursive: true });
    fs.writeFileSync(path.join(root, 'doc', 'extensions', 'manifest.yaml'), opts.extensionManifest, 'utf-8');
  }
  fs.mkdirSync(path.join(root, 'app/demo/src/main/ets'), { recursive: true });
  fs.writeFileSync(path.join(root, 'app/demo/src/main/ets/Main.ets'), 'export const value = 1;\n', 'utf8');
  const sha = initGit(root);
  const summaryPath = path.join(reportsDir, 'summary.json');
  if (fs.existsSync(summaryPath)) {
    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
    const rel = (name: string) => `${reportsRelDir}/${name}`;
    Object.assign(summary, {
      script_report: rel('script-report.json'), merged_report: rel('merged-report.md'), summary_json: rel('summary.json'),
      run_statuses: [], readiness_signals: [], blocking_warnings: [], blocking_skips: [], blockers: [],
      next_action: 'run_verifier_then_receipt',
      assurance: 'not_applicable', capability_resolutions: [], capability_resolution_contract_fingerprint: null,
      gate_fingerprint: computeGateFingerprint(path.dirname(HARNESS_ROOT), phase),
      source_commit_sha: sha, worktree_digest: computeProductWorktreeDigest(root, ['app']),
      ...(opts.goalLedgerRunId ? { run_id: opts.goalLedgerRunId } : {}),
    });
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf8');
  }
  if (opts.omitTrace) fs.unlinkSync(tracePath);
  if (opts.corruptTrace) fs.writeFileSync(tracePath, '{ this is not json', 'utf-8');

  const verifierBlock = opts.omitVerifier
    ? 'verifier_subagent: {}\n'
    : [
        'verifier_subagent:',
        '  invoked_via: "Task(subagent_type=verifier)"',
        '  report_path: "' + reportsRelDir + '/verifier.report.md"',
        '  verdict: "PASS"',
        '',
      ].join('\n');

  const traceBlock = opts.omitTrace || opts.corruptTrace
    ? 'trace_json: {}\n'
    : [
        'trace_json:',
        '  path: "' + reportsRelDir + '/trace.json"',
        '  exists: true',
        '  schema_valid: true',
        '',
      ].join('\n');

  const receipt = [
    '---',
    'feature: "demo"',
    `phase: "${phase}"`,
    'agent_model: "test-model"',
    'agent_runtime: "test-runtime"',
    'claimed_completion_at: "2026-07-08T10:00:00+08:00"',
    `claimed_completion_commit_sha: "${sha}"`,
    ...(opts.claimedAttemptId ? [`claimed_attempt_id: "${opts.claimedAttemptId}"`] : []),
    'script_harness:',
    '  exit_code: 0',
    '  blocker_count: 0',
    verifierBlock,
    traceBlock,
    'context_exploration:',
    '  summary_path: "doc/features/demo/' + phase + '/context-exploration.md"',
    '  exists: true',
    '  ready_to_produce: true',
    '  has_blocker_coverage_risk: false',
    'self_check:',
    '  q1_trace_json_abs_path: "' + tracePath.replace(/\\/g, '\\\\') + '"',
    '  q2_verifier_verdict_quoted: "PASS"',
    '  q3_last_diff_file: "doc/features/demo/' + phase + '/context-exploration.md"',
    '  q4_no_hallucinated_rule_used: true',
    '  q4_evidence: "n/a"',
    '---',
    '',
    '## 反假设条款回顾',
    '',
    '- [x] a',
    '- [x] b',
    '- [x] c',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(featureDir, 'phase-completion-receipt.md'), receipt, 'utf-8');

  // runner-owned-machine-facts：账本 closure 否决已退役——这里刻意写一条**旧 run** 的
  // 账本行（run_id 与当前 goal run 不同），钉住「账本内容（含旧 run 行/未覆盖 registry
  // gate）不再参与闭环裁决」；attempt 等值仍是唯一被消融变量。
  if (opts.goalLedgerRunId) {
    const ledger = JSON.stringify({
      decision_id: `${phase}-fixture-stale`,
      run_id: 'stale-prior-run',
      phase,
      gate_id: `${phase}.freeze`,
      class: 'artifact_checkbox',
      decision: 'n/a: unit fixture（旧 run 留痕）',
      must_review: false,
      source: 'agent',
      ts: '2026-07-08T10:00:00.000Z',
    });
    fs.writeFileSync(path.join(featureDir, 'headless-assumptions.jsonl'), `${ledger}\n`, 'utf-8');
  }

  return { root, sha };
}

/**
 * 直接 spawn check-receipt 并保留 stdout（tryValidateReceipt 在 PASS 时丢弃 stdout、
 * FAIL 时只带 stderr——断言具体 issue id 必须自己 spawn）。goal 身份走与
 * phase-state.ts:383–385 **同三个 env key**，不另造通道。
 */
function spawnCheckReceipt(
  root: string,
  phase: string,
  goal?: { runId: string; attemptId: string; attemptPhase: string },
): { status: number | null; stdout: string; stderr: string } {
  const checker = path.join(HARNESS_ROOT, 'scripts', 'check-receipt.ts');
  const r = spawnSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['ts-node', checker, '--feature', 'demo', '--phase', phase, '--project-root', root, '--skip-state-sync'],
    {
      cwd: HARNESS_ROOT,
      encoding: 'utf-8',
      shell: process.platform === 'win32',
      env: goal
        ? {
            ...process.env,
            MAISON_GOAL_RUN_ID: goal.runId,
            MAISON_GOAL_ATTEMPT: goal.attemptId,
            MAISON_GOAL_ATTEMPT_PHASE: goal.attemptPhase,
          }
        : process.env,
    },
  );
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** goal 态 RuntimeContext（与生产 harness-runner.ts:786 的取值同形）。 */
function goalCtx(phase: string): RuntimeContext {
  return {
    mode: 'goal',
    adapter: 'claude',
    phase,
    workflow: 'spec-driven',
    can_prompt_user: false,
    can_collect_usage: true,
  };
}

/** 真实 policy → 真实 resolveVerifierPlan（不手搓 policy/plan 字面量，§6 生产接线要求）。 */
function goalBalancedPlan(phase: string) {
  const spec = loadWorkflowSpec(path.dirname(HARNESS_ROOT), 'spec-driven');
  const policy = resolveEvidencePolicy('full', goalCtx(phase), { evidence_profile: 'balanced' });
  return resolveVerifierPlan({
    phase,
    track: 'full',
    runtimeMode: 'goal',
    policy,
    workflowVerifierPrompt: workflowVerifierPrompt(spec, phase),
    phaseDisabledByProfile: false,
    adapterHasVerifierSubagent: true,
    adapterName: 'claude',
  });
}

/**
 * 在 goal run 身份下跑 writer（生产里 harness 由 goal-runner 以这三个 env 拉起）。
 * summary.run_id 只在 `MAISON_GOAL_RUN_ID` 在场时落盘，check-receipt 的 goal 门禁要它。
 */
function withGoalRunEnv<T>(runId: string, fn: () => T): T {
  const prev = process.env.MAISON_GOAL_RUN_ID;
  process.env.MAISON_GOAL_RUN_ID = runId;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.MAISON_GOAL_RUN_ID;
    else process.env.MAISON_GOAL_RUN_ID = prev;
  }
}

/** 脚本全 PASS 的最小 ScriptReport（V8：脚本侧无缺陷，唯一的负面结论来自 verifier）。 */
function passScriptReport(phase: string, projectRoot: string, extraChecks: CheckResult[] = []): ScriptReport {
  const checks: CheckResult[] = [
    { id: 'demo_ok', category: 'structure', description: 'demo', severity: 'BLOCKER', status: 'PASS', details: 'ok' },
    ...extraChecks,
  ];
  return {
    phase: phase as Phase,
    feature: 'demo',
    timestamp: new Date().toISOString(),
    project_root: projectRoot,
    assurance: 'full',
    capability_resolutions: [],
    capability_resolution_contract_fingerprint: null,
    checks,
    summary: {
      total: checks.length,
      pass: checks.filter(c => c.status === 'PASS').length,
      fail: 0,
      warn: 0,
      skip: checks.filter(c => c.status === 'SKIP').length,
      blockers: 0,
      verdict: 'PASS',
    },
  };
}

/**
 * 真 n/a 的 BLOCKER SKIP —— 经**真实 check-plan 出口**（`checkDataModelTyped` → 共享的
 * `resolveSectionApplicability`）产出，不手搓 `structured` 标注，也不复刻判定。
 */
function notApplicableSkipCheck(): CheckResult {
  const ctx = {
    phase: 'plan',
    feature: 'demo',
    projectRoot: '.',
    featureSpec: { contracts: { data_models: [] }, shape_issues: [] },
    phaseRule: { phase: 'plan', structure_checks: {} },
  } as unknown as CheckContext;
  const r = checkDataModelTyped(ctx, ['## 数据模型定义', '', '不适用：本 feature 是纯路由改造。', ''].join('\n'))[0];
  assert(
    r.status === 'SKIP' && r.severity === 'BLOCKER',
    `构造性前提：真 n/a 出口必须给 BLOCKER SKIP，实得 ${r.status}/${r.severity}`,
  );
  return r;
}

/** 改工程 config 的 `evidence_profile`（本批 codex 一轮 high 的唯一变量）。 */
function setEvidenceProfile(root: string, profile: string): void {
  const abs = path.join(root, 'framework.config.json');
  const cfg = JSON.parse(fs.readFileSync(abs, 'utf8')) as Record<string, unknown>;
  cfg.evidence_profile = profile;
  fs.writeFileSync(abs, JSON.stringify(cfg, null, 2), 'utf8');
  clearFrameworkConfigCache();
}

/**
 * strict 轮：真实 policy（无 `evidence_profile`）→ 真实 `resolveVerifierPlan` → 真实材料视图
 * → 真实 `writeRunSummaryBase` 签发 subject 并落盘 `verifier.material.<subject>.json`。
 *
 * `ai-prompt.md` 的正文是夹具字节：`prompt_sha256` 只是 request 的审计字段，**不参与** subject
 * 派生（verifier-request.ts `canonicalRequestInput`）；subject 由这里传进去的真实材料视图定。
 */
function issueStrictSubject(
  root: string,
  phase: string,
  report: ScriptReport,
  contextFiles: ContextFileEntry[] = [],
): string {
  const frameworkRoot = path.dirname(HARNESS_ROOT);
  const spec = loadWorkflowSpec(frameworkRoot, 'spec-driven');
  const plan = resolveVerifierPlan({
    phase,
    track: 'full',
    runtimeMode: 'goal',
    policy: resolveEvidencePolicy('full', goalCtx(phase), {}),
    workflowVerifierPrompt: workflowVerifierPrompt(spec, phase),
    phaseDisabledByProfile: false,
    adapterHasVerifierSubagent: true,
    adapterName: 'claude',
  });
  assert(
    plan.mode === 'enabled' && plan.reason === 'policy_required',
    `构造性前提：未声明 evidence_profile 时 goal 仍 strict，实得 ${plan.mode}/${plan.reason}`,
  );
  // reports 目录走生产 SSOT：`reports_dir_pattern` 指向 phase 目录本身时也算得对。
  const reportsDir = featurePhaseReportsDir(root, 'demo', phase, frameworkRoot);
  fs.writeFileSync(path.join(reportsDir, 'ai-prompt.md'), '# verifier prompt (fixture)\n', 'utf-8');
  const material = buildVerifierMaterialView({
    projectRoot: root,
    feature: 'demo',
    phase,
    frameworkRoot,
    gateFingerprint: computeGateFingerprint(frameworkRoot, phase),
    phaseRuleText: `phase: ${phase}\n`,
    templateText: '# verify template\n',
    checks: report.checks,
    contextFiles,
  });
  const summary = withGoalRunEnv('run-X', () =>
    writeRunSummaryBase(root, report, frameworkRoot, { verifierPlan: plan, verifierMaterial: material }),
  );
  assert(Boolean(summary.verifier_subject_id), 'strict 轮必须签发 subject，否则本用例前提不成立');
  return summary.verifier_subject_id as string;
}

/** 材料视图的文件面（仓根相对路径）——钉住"某文件经哪条路进视图"的构造性前提。 */
function materialFileRels(root: string, phase: string, contextFiles: ContextFileEntry[] = []): string[] {
  return buildVerifierMaterialView({
    projectRoot: root,
    feature: 'demo',
    phase,
    frameworkRoot: path.dirname(HARNESS_ROOT),
    gateFingerprint: null,
    phaseRuleText: '',
    templateText: '',
    checks: [],
    contextFiles,
  }).files.map(f => f.path);
}

/** 材料视图里 phase 产物文件的仓根相对路径（用于"材料真变"对照例）。 */
function phaseOutputRelPath(root: string, phase: string, basename: string): string {
  const view = buildVerifierMaterialView({
    projectRoot: root,
    feature: 'demo',
    phase,
    frameworkRoot: path.dirname(HARNESS_ROOT),
    gateFingerprint: null,
    phaseRuleText: '',
    templateText: '',
    checks: [],
    contextFiles: [],
  });
  const hit = view.files.find(f => f.path.endsWith(`/${basename}`) || f.path === basename);
  assert(Boolean(hit), `构造性前提：${basename} 必须在 phase 材料面内，实得 ${JSON.stringify(view.files)}`);
  return (hit as { path: string }).path;
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'tryValidateReceipt：lite track → not_applicable，架构性短路（无 subprocess）',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'receipt-lite-'));
      try {
        fs.mkdirSync(path.join(root, 'doc', 'features', 'demo'), { recursive: true });
        fs.writeFileSync(
          path.join(root, 'doc', 'features', 'demo', 'feature.yaml'),
          'schema_version: "1.0"\ntrack: lite\n',
          'utf-8',
        );
        const v = tryValidateReceipt(HARNESS_ROOT, root, 'exit', 'demo');
        assert(v.status === 'not_applicable', `expected not_applicable, got ${v.status}`);
        assert(!!v.message && v.message.includes('lite'), 'message 应说明 lite 语义');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    // review 不在 generic profile 的 phases_disabled 内、也不在默认保留集 {spec,coding}——
    // 干净的"非保留 phase"样本（ut/coding 会被 generic 直接禁用整阶段，测不到本矩阵逻辑）。
    name: 'full×strict（缺省，无 evidence_profile）：verifier 缺失仍 FAIL——零回归基线',
    run: () => {
      const { root } = buildProject('review', { omitVerifier: true });
      try {
        const v = tryValidateReceipt(HARNESS_ROOT, root, 'review', 'demo');
        assert(v.status === 'failed', `expected failed under strict, got ${v.status}`);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'full×balanced×非保留 phase（review）：verifier 缺失仍 PASS（off 跳过整块）',
    run: () => {
      const { root } = buildProject('review', { evidenceProfile: 'balanced', omitVerifier: true });
      try {
        const v = tryValidateReceipt(HARNESS_ROOT, root, 'review', 'demo');
        assert(v.status === 'passed', `expected passed under balanced+review(off), got ${v.status}: ${v.message ?? ''}`);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'full×balanced×保留 phase（spec）：verifier 缺失仍 FAIL（保留集内不豁免）',
    run: () => {
      const { root } = buildProject('spec', { evidenceProfile: 'balanced', omitVerifier: true });
      try {
        const v = tryValidateReceipt(HARNESS_ROOT, root, 'spec', 'demo');
        assert(v.status === 'failed', `expected failed（spec 在保留集内）, got ${v.status}`);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'full×balanced：trace 缺失仅 WARN 不 FAIL（optional 豁免"不提供"）',
    run: () => {
      const { root } = buildProject('review', { evidenceProfile: 'balanced', omitTrace: true });
      try {
        const v = tryValidateReceipt(HARNESS_ROOT, root, 'review', 'demo');
        assert(v.status === 'passed', `expected passed（trace optional 缺失不阻塞）, got ${v.status}: ${v.message ?? ''}`);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'full×strict：trace 缺失仍 FAIL（strict 下 trace required，零回归）',
    run: () => {
      const { root } = buildProject('review', { omitTrace: true });
      try {
        const v = tryValidateReceipt(HARNESS_ROOT, root, 'review', 'demo');
        assert(v.status === 'failed', `expected failed under strict, got ${v.status}`);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'extension 1.1 after_phase_verify_before_close required produces 缺失 → 真 spawn receipt FAIL',
    run: () => {
      const extensionManifest = [
        'schema_version: "1.1"', 'name: receipt-extension', 'provides:', '  skills: []',
        '  mcp_actions:', '    close-action:', '      tool: host.close', '      required: true',
        '      severity: BLOCKER', '      produces: [doc/missing-close.json]', '      usage: close',
        'phase_bindings:', '  review:', '    after_phase_verify_before_close:',
        '      - { kind: mcp, ref: close-action }', '',
      ].join('\n');
      const { root } = buildProject('review', {
        evidenceProfile: 'balanced', omitVerifier: true, extensionManifest,
      });
      try {
        const result = tryValidateReceipt(HARNESS_ROOT, root, 'review', 'demo');
        assert(result.status === 'failed', `expected failed, got ${result.status}`);
        assert((result.message ?? '').includes('extension_produces_'), result.message ?? 'missing message');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: '非法 extension manifest → 真 spawn receipt 复用 manifest BLOCKER，不静默关闭 gate',
    run: () => {
      const extensionManifest = [
        'schema_version: "1.1"', 'name: invalid-receipt-extension', 'unknown: true',
        'provides:', '  skills: []', '  mcp_actions:', '    close-action:',
        '      tool: host.close', '      required: true', '      produces: [doc/missing-close.json]',
        '      usage: close', 'phase_bindings:', '  review:', '    after_phase_verify_before_close:',
        '      - { kind: mcp, ref: close-action }', '',
      ].join('\n');
      const { root } = buildProject('review', {
        evidenceProfile: 'balanced', omitVerifier: true, extensionManifest,
      });
      try {
        const result = tryValidateReceipt(HARNESS_ROOT, root, 'review', 'demo');
        assert(result.status === 'failed', `expected failed, got ${result.status}`);
        assert((result.message ?? '').includes('extension_manifest_manifest_unknown_field'), result.message ?? 'missing message');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    // tryValidateReceipt 在 PASS 时不保留 stdout（只关心 status），直接 spawn
    // 才能验证"缺失仅 WARN"真的把提示打到了 stdout，而不只是"没让它 FAIL"。
    name: 'full×balanced：trace 缺失的 WARN 真实出现在 stdout（而非仅"没 FAIL"）',
    run: () => {
      const { root } = buildProject('review', { evidenceProfile: 'balanced', omitTrace: true });
      try {
        const checker = path.join(HARNESS_ROOT, 'scripts', 'check-receipt.ts');
        const r = spawnSync(
          process.platform === 'win32' ? 'npx.cmd' : 'npx',
          ['ts-node', checker, '--feature', 'demo', '--phase', 'review', '--project-root', root, '--skip-state-sync'],
          { cwd: HARNESS_ROOT, encoding: 'utf-8', shell: process.platform === 'win32' },
        );
        assert(r.status === 0, `expected exit 0, got ${r.status}\n${r.stderr}`);
        assert(
          (r.stdout ?? '').includes('trace_json_missing_optional'),
          `stdout 应包含 optional-missing 提示 id；实际 stdout:\n${r.stdout}`,
        );
        assert(
          (r.stdout ?? '').includes('profile_resolved=balanced'),
          `stdout 应含 HARNESS_EVIDENCE_POLICY 标记行；实际:\n${r.stdout}`,
        );
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  // ==========================================================================
  // B05（plan 7b3e9a15）：显式 balanced 在 goal 态生效 + policy off ≠ 忽略。
  // ==========================================================================
  {
    // V3：改前 goal 被 :408–410 早退成 strict → verifier 缺失 FAIL；改后与 interactive 同判。
    name: 'V3（B05 D1）：goal 态 × 显式 balanced × 非保留 phase —— verifier 缺失 PASS 且 profile_resolved=balanced',
    run: () => {
      const { root } = buildProject('review', {
        evidenceProfile: 'balanced',
        omitVerifier: true,
        omitTrace: true,
        claimedAttemptId: 'i8',
      });
      try {
        const v = tryValidateReceipt(HARNESS_ROOT, root, 'review', 'demo', {
          goalIdentity: { runId: 'run-X', attemptId: 'i8', attemptPhase: 'review' },
        });
        assert(v.status === 'passed', `goal×balanced×review 应 PASS，实得 ${v.status}: ${v.message ?? ''}`);
        const r = spawnCheckReceipt(root, 'review', { runId: 'run-X', attemptId: 'i8', attemptPhase: 'review' });
        assert(r.status === 0, `直接 spawn 也应 exit 0，实得 ${r.status}\n${r.stderr}`);
        assert(
          r.stdout.includes('profile_resolved=balanced'),
          `goal 态 stdout 须记 balanced 档位；实际:\n${r.stdout}`,
        );
        assert(
          r.stdout.includes('trace_json_missing_optional'),
          `trace 缺失在 goal×balanced 下只 WARN；实际:\n${r.stdout}`,
        );
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    // V3 trace 负例（codex 二轮 medium）：canonical 路径有损坏 trace.json + 回执声明缺失。
    // 改前 legacy 分支只看 tj.exists/tj.path 就落 missing WARN（exit 0），损坏证据被藏。
    name: 'V3（B05 D1）：损坏 trace 在场 + 回执声明缺失 → goal×balanced 仍 BLOCKER（以盘上文件为准）',
    run: () => {
      const { root } = buildProject('review', {
        evidenceProfile: 'balanced',
        omitVerifier: true,
        corruptTrace: true,
        claimedAttemptId: 'i8',
      });
      try {
        const r = spawnCheckReceipt(root, 'review', { runId: 'run-X', attemptId: 'i8', attemptPhase: 'review' });
        assert(r.status !== 0, `损坏 trace 必须阻断，实得 exit ${r.status}\n${r.stdout}`);
        assert(
          `${r.stdout}${r.stderr}`.includes('trace_json_not_parseable'),
          `须报 trace_json_not_parseable（而不是 missing WARN）；stdout:\n${r.stdout}`,
        );
        assert(
          !r.stdout.includes('trace_json_missing_optional'),
          `盘上有文件时不得判"未提供"；stdout:\n${r.stdout}`,
        );
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    // V8（S0b）：policy off 只免除"要求提供"，不免除"已有的负面结论"。
    // codex 实施 review 一轮 high 返修：**真实的档位切换**才是被测场景——strict 轮跑出
    // 有效 FAIL 之后，唯一变量是把 framework.config.json 的 evidence_profile 改成 balanced。
    // 改前（沿用判据用 source_commit_sha / worktree_digest 三锚）这一步必失配：
    // worktree_digest 把 framework.config.json 算在内（worktree-digest.ts ROOT_CONFIG_PATHSPECS），
    // 改配置本身就让摘要漂移 → subject 被丢弃 → 脚本 PASS 直接放行（少否决）。
    name: 'V8（B05 S0b，codex 一轮 high 返修）：strict 轮有效 FAIL 后仅改 evidence_profile=balanced —— writer 仍沿用 subject，check-receipt 仍否决',
    run: () => {
      const { root } = buildProject('review', { omitVerifier: true, claimedAttemptId: 'i8' });
      try {
        const reportsDir = path.join(root, 'doc', 'features', 'demo', 'review', 'reports');
        const report = passScriptReport('review', root);
        // ① strict 轮：真实 writer 签发 subject + 落盘材料视图。
        const subjectId = issueStrictSubject(root, 'review', report);
        // ② 同一 subject 上发布一份有效 FAIL 报告（生产同形字节：终态块回显 subject + 自洽）。
        publishFixtureVerifierEvidence({
          projectRoot: root,
          reportsDir,
          feature: 'demo',
          phase: 'review',
          subjectId,
          verdict: 'FAIL',
          blockerCount: 2,
          skipSummaryPatch: true,
        });
        // ③ 唯一变量：档位。材料（phase 输入/产物、gate、脚本报告投影）一字未动。
        const strictSummary = JSON.parse(fs.readFileSync(path.join(reportsDir, 'summary.json'), 'utf8')) as {
          worktree_digest?: string;
        };
        setEvidenceProfile(root, 'balanced');
        // 反证（钉住旧三锚判据为什么必失配）：framework.config.json 在
        // worktree-digest.ts 的 ROOT_CONFIG_PATHSPECS 里——改档位本身就让摘要漂移。
        assert(
          strictSummary.worktree_digest !== computeProductWorktreeDigest(root, ['app']),
          '构造性前提：改 evidence_profile 必让 worktree_digest 漂移（旧判据正因此把有效 FAIL 丢掉）',
        );
        const plan = goalBalancedPlan('review');
        assert(
          plan.mode === 'disabled' && plan.reason === 'policy_off',
          `构造性前提：goal×balanced×review 必须 policy_off，实得 ${plan.mode}/${plan.reason}`,
        );
        const summary = withGoalRunEnv('run-X', () =>
          writeRunSummaryBase(root, report, path.dirname(HARNESS_ROOT), { verifierPlan: plan }),
        );
        assert(
          summary.verifier_subject_id === subjectId,
          `writer 必须沿用 strict 轮那个 subject（改档位不构成材料换代）；实得 ${JSON.stringify(summary.verifier_subject_id)}`,
        );
        assert(Boolean(summary.verifier_report), 'writer 须写出沿用报告的落点');
        assert(!summary.verifier_request, '本轮未签发新凭证，不得写 verifier_request');
        assert(
          summary.next_action === 'fix_verifier_findings_then_rerun_harness',
          `next_action 必须先于 disabled 早退处理 'fail'，实得 ${summary.next_action}`,
        );

        const r = spawnCheckReceipt(root, 'review', { runId: 'run-X', attemptId: 'i8', attemptPhase: 'review' });
        assert(r.status !== 0, `已有有效 FAIL 报告时不得放行，实得 exit ${r.status}\n${r.stdout}`);
        assert(
          `${r.stdout}${r.stderr}`.includes('verifier_not_pass'),
          `须保留 verifier_not_pass 否决；stdout:\n${r.stdout}`,
        );
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    // 沿用判据的另一半（codex 一轮 high）：材料**真变**时旧 FAIL 不得沿用——否则改配置沿用、
    // 改代码也沿用，就成了永久否决。这里动的是 phase 产物文件（review-report.md），
    // 它由 resolvePhaseEvidenceManifest 纳入材料面，与 policy 无关。
    name: 'V8 材料真变对照（B05 S0b）：改 phase 产物文件后 → 旧 FAIL 不再沿用，writer 零 verifier 字段',
    run: () => {
      const { root } = buildProject('review', { omitVerifier: true, claimedAttemptId: 'i8' });
      try {
        const reportsDir = path.join(root, 'doc', 'features', 'demo', 'review', 'reports');
        const report = passScriptReport('review', root);
        const subjectId = issueStrictSubject(root, 'review', report);
        publishFixtureVerifierEvidence({
          projectRoot: root,
          reportsDir,
          feature: 'demo',
          phase: 'review',
          subjectId,
          verdict: 'FAIL',
          blockerCount: 2,
          skipSummaryPatch: true,
        });
        setEvidenceProfile(root, 'balanced');
        // 材料真变：phase 产物文件从缺席变为在场（哈希 null → 实值）。
        const outRel = phaseOutputRelPath(root, 'review', 'review-report.md');
        fs.mkdirSync(path.dirname(path.join(root, outRel)), { recursive: true });
        fs.writeFileSync(path.join(root, outRel), '# review report（材料已变）\n', 'utf-8');
        const summary = withGoalRunEnv('run-X', () =>
          writeRunSummaryBase(root, report, path.dirname(HARNESS_ROOT), { verifierPlan: goalBalancedPlan('review') }),
        );
        assert(
          !summary.verifier_subject_id,
          `材料已变时不得沿用旧 subject（那份 FAIL 审的不是这批材料）；实得 ${JSON.stringify(summary.verifier_subject_id)}`,
        );
        assert(!summary.verifier_report, '不沿用时不得写 verifier_report');
        assert(
          summary.next_action === 'fill_receipt_then_sync_closure',
          `无沿用结论时落回 disabled 的闭环指令，实得 ${summary.next_action}`,
        );
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    // 沿用判据的删除面（codex 实施 review 二轮 medium）：单向比较只遍历"本轮材料面里的
    // 文件"，而 resolvePhaseEvidenceManifest 的可选条目**存在才纳入**——被删的可选输入
    // 整条从本轮 manifest 消失，正向遍历永远看不到它，于是"材料哈希已变"却判 still-current。
    // review 的 spec.md 正是这样一个可选输入（OPTIONAL_FEATURE_FILES_BY_PHASE.review）。
    name: 'V8 可选输入被删（B05 S0b，codex 二轮 medium 返修）：strict 签发后删除可选 manifest 输入 → 切 balanced 不沿用',
    run: () => {
      const { root } = buildProject('review', { omitVerifier: true, claimedAttemptId: 'i8' });
      try {
        const reportsDir = path.join(root, 'doc', 'features', 'demo', 'review', 'reports');
        // 可选输入在场 → 进材料面（phaseOutputRelPath 内含"必须在材料面内"的构造性断言）。
        const specAbs = resolveFeatureArtifact(root, 'demo', 'spec.md').canonicalPath;
        fs.mkdirSync(path.dirname(specAbs), { recursive: true });
        fs.writeFileSync(specAbs, '# spec（可选输入，签发时在场）\n', 'utf-8');
        phaseOutputRelPath(root, 'review', 'spec.md');
        const report = passScriptReport('review', root);
        const subjectId = issueStrictSubject(root, 'review', report);
        publishFixtureVerifierEvidence({
          projectRoot: root,
          reportsDir,
          feature: 'demo',
          phase: 'review',
          subjectId,
          verdict: 'FAIL',
          blockerCount: 2,
          skipSummaryPatch: true,
        });
        setEvidenceProfile(root, 'balanced');
        // 材料真变：可选输入被删。其余材料与脚本投影一字未动。
        fs.rmSync(specAbs);
        const summary = withGoalRunEnv('run-X', () =>
          writeRunSummaryBase(root, report, path.dirname(HARNESS_ROOT), { verifierPlan: goalBalancedPlan('review') }),
        );
        assert(
          !summary.verifier_subject_id,
          `可选 manifest 输入被删=材料换代，不得沿用旧 subject；实得 ${JSON.stringify(summary.verifier_subject_id)}`,
        );
        assert(!summary.verifier_report, '不沿用时不得写 verifier_report');
        assert(
          summary.next_action === 'fill_receipt_then_sync_closure',
          `无沿用结论时落回 disabled 的闭环指令，实得 ${summary.next_action}`,
        );
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    // 沿用判据的**归属面**（codex 实施 review 三轮 medium）：候选集与材料视图构建器必须套
    // 同一条 reports 排除规则。`reports_dir_pattern` 指向 phase 目录**本身**时，
    // review-report.md 落在 reports 面内——buildVerifierMaterialView 把它当运行期产出排除，
    // 只能经 contextFiles（生产 collectContextFiles 的 review 分支）进签发时视图。候选集若
    // 不排除，就把它当 manifest 面 → 反向比较永远找不到它 → 材料一字未动、仅切 balanced
    // 也丢弃 subject，strict 轮的 FAIL 否决随之落空（少否决）。
    name: 'V8 reports 落在 phase 目录（B05 S0b，codex 三轮 medium 返修）：材料未变仅切 balanced → 仍沿用 FAIL',
    run: () => {
      const { root } = buildProject('review', {
        omitVerifier: true,
        claimedAttemptId: 'i8',
        reportsInPhaseDir: true,
      });
      try {
        const frameworkRoot = path.dirname(HARNESS_ROOT);
        const reportsDir = featurePhaseReportsDir(root, 'demo', 'review', frameworkRoot);
        assert(
          reportsDir === path.join(root, 'doc', 'features', 'demo', 'review'),
          `构造性前提：reports 目录必须等于 phase 目录，实得 ${reportsDir}`,
        );
        const reviewReportRel = 'doc/features/demo/review/review-report.md';
        fs.writeFileSync(path.join(root, reviewReportRel), '# review report（签发时在场）\n', 'utf-8');
        const contextFiles: ContextFileEntry[] = [
          { label: reviewReportRel, content: '# review report（签发时在场）\n' },
        ];
        // 构造性前提：它**只**经 contextFiles 进视图——manifest 面（contextFiles 为空）里没有它。
        assert(
          materialFileRels(root, 'review', contextFiles).includes(reviewReportRel),
          'contextFiles 必须把 review-report.md 带进签发时视图',
        );
        assert(
          !materialFileRels(root, 'review').includes(reviewReportRel),
          'reports 面内的产物不得进 manifest 面（构建器排除规则）——否则本用例测不到归属分叉',
        );
        const report = passScriptReport('review', root);
        const subjectId = issueStrictSubject(root, 'review', report, contextFiles);
        publishFixtureVerifierEvidence({
          projectRoot: root,
          reportsDir,
          feature: 'demo',
          phase: 'review',
          subjectId,
          verdict: 'FAIL',
          blockerCount: 2,
          skipSummaryPatch: true,
        });
        // 唯一变量：档位。manifest 面、gate、脚本投影一字未动。
        setEvidenceProfile(root, 'balanced');
        const summary = withGoalRunEnv('run-X', () =>
          writeRunSummaryBase(root, report, frameworkRoot, { verifierPlan: goalBalancedPlan('review') }),
        );
        assert(
          summary.verifier_subject_id === subjectId,
          `材料未变必须沿用 strict 轮 subject（reports 面的条目不算 manifest 面）；实得 ${JSON.stringify(summary.verifier_subject_id)}`,
        );
        assert(Boolean(summary.verifier_report), 'writer 须写出沿用报告的落点');
        assert(
          summary.next_action === 'fix_verifier_findings_then_rerun_harness',
          `FAIL 否决必须保留，实得 ${summary.next_action}`,
        );
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    // 上一条的对照：reports 面内的文件**变化**同样不构成材料换代（它压根不在比较面里）。
    // 与"V8 材料真变对照"互为镜像——同一个 review-report.md，缺省布局下算 manifest 面（改了就
    // 不沿用），reports_dir_pattern 覆盖到 phase 目录时算排除面（改了仍沿用）。
    name: 'V8 reports 内文件变化（B05 S0b，codex 三轮 medium 返修）：reports 面内产物改动 → 仍沿用 FAIL',
    run: () => {
      const { root } = buildProject('review', {
        omitVerifier: true,
        claimedAttemptId: 'i8',
        reportsInPhaseDir: true,
      });
      try {
        const frameworkRoot = path.dirname(HARNESS_ROOT);
        const reportsDir = featurePhaseReportsDir(root, 'demo', 'review', frameworkRoot);
        const reviewReportRel = 'doc/features/demo/review/review-report.md';
        fs.writeFileSync(path.join(root, reviewReportRel), '# review report（签发时）\n', 'utf-8');
        const report = passScriptReport('review', root);
        const subjectId = issueStrictSubject(root, 'review', report, [
          { label: reviewReportRel, content: '# review report（签发时）\n' },
        ]);
        publishFixtureVerifierEvidence({
          projectRoot: root,
          reportsDir,
          feature: 'demo',
          phase: 'review',
          subjectId,
          verdict: 'FAIL',
          blockerCount: 2,
          skipSummaryPatch: true,
        });
        setEvidenceProfile(root, 'balanced');
        // reports 面内的文件改字节：不在比较面内 → 不构成材料换代。
        fs.writeFileSync(path.join(root, reviewReportRel), '# review report（改过，reports 面内）\n', 'utf-8');
        fs.writeFileSync(path.join(reportsDir, 'trace.json'), JSON.stringify({ schema_version: '1.0.0', changed: true }), 'utf-8');
        const summary = withGoalRunEnv('run-X', () =>
          writeRunSummaryBase(root, report, frameworkRoot, { verifierPlan: goalBalancedPlan('review') }),
        );
        assert(
          summary.verifier_subject_id === subjectId,
          `reports 面内的改动不构成材料换代，须继续沿用；实得 ${JSON.stringify(summary.verifier_subject_id)}`,
        );
        assert(
          summary.next_action === 'fix_verifier_findings_then_rerun_harness',
          `FAIL 否决必须保留，实得 ${summary.next_action}`,
        );
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    // V8 对照例：**没有**报告时才是零要求——这才是 balanced 买到的东西。
    name: 'V8 对照（B05 S0b）：goal×balanced 下无 verifier 报告 → writer 零 verifier 字段，check-receipt PASS',
    run: () => {
      const { root } = buildProject('review', {
        evidenceProfile: 'balanced',
        omitVerifier: true,
        claimedAttemptId: 'i8',
      });
      try {
        const plan = goalBalancedPlan('review');
        const summary = withGoalRunEnv('run-X', () =>
          writeRunSummaryBase(root, passScriptReport('review', root), path.dirname(HARNESS_ROOT), { verifierPlan: plan }),
        );
        assert(!summary.verifier_subject_id, '无报告时不得凭空沿用 subject');
        assert(!summary.verifier_report, '无报告时不得写 verifier_report');
        assert(
          summary.next_action === 'fill_receipt_then_sync_closure',
          `无负面结论时仍走 disabled 的闭环指令，实得 ${summary.next_action}`,
        );
        const r = spawnCheckReceipt(root, 'review', { runId: 'run-X', attemptId: 'i8', attemptPhase: 'review' });
        assert(r.status === 0, `无报告时应放行，实得 exit ${r.status}\n${r.stdout}\n${r.stderr}`);
        assert(!r.stdout.includes('verifier_not_pass'), '无报告时不得凭空否决');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    // D2 返修（codex 一轮 medium）：真 n/a 的 BLOCKER SKIP 曾进 blocking_skips，
    // decideNextAction 因此提前返回 review_blocking_skips_then_verifier——把已确认不适用的
    // 章节说成待办，还把调用方指向一个本轮**根本没签发**的 verifier，绕过 disabled 分支。
    name: 'B05 D2（codex 一轮 medium 返修）：真 n/a 的 BLOCKER SKIP 不进 blocking_skips —— goal×balanced 下不指向未签发的 verifier',
    run: () => {
      const { root } = buildProject('review', {
        evidenceProfile: 'balanced',
        omitVerifier: true,
        claimedAttemptId: 'i8',
      });
      try {
        const report = passScriptReport('review', root, [notApplicableSkipCheck()]);
        const summary = withGoalRunEnv('run-X', () =>
          writeRunSummaryBase(root, report, path.dirname(HARNESS_ROOT), { verifierPlan: goalBalancedPlan('review') }),
        );
        assert(
          summary.next_action === 'fill_receipt_then_sync_closure',
          `disabled 下不得把调用方指向本轮未签发的 verifier（其余全 PASS 时走闭环指令），实得 ${summary.next_action}`,
        );
        assert(
          summary.blocking_skips.length === 0,
          `已确认不适用的 SKIP 不得进 blocking_skips，实得 ${JSON.stringify(summary.blocking_skips)}`,
        );
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    // D2 返修的另一半：真 n/a 在场时，**已有的 verifier FAIL** 仍须给出正确下一步
    //（改前 blocking_skips 分支排在 verifier 分支之前，这条否决同样被绕过）。
    name: 'B05 D2（codex 一轮 medium 返修）：真 n/a SKIP + 已有 verifier FAIL → next_action 仍是 fix_verifier_findings_then_rerun_harness',
    run: () => {
      const { root } = buildProject('review', { omitVerifier: true, claimedAttemptId: 'i8' });
      try {
        const reportsDir = path.join(root, 'doc', 'features', 'demo', 'review', 'reports');
        // 两轮**同一份** ScriptReport：script_checks 投影是材料面的一部分，
        // n/a SKIP 必须在 strict 轮就在场，否则本轮材料确实变了（那时不沿用才是对的）。
        const report = passScriptReport('review', root, [notApplicableSkipCheck()]);
        const subjectId = issueStrictSubject(root, 'review', report);
        publishFixtureVerifierEvidence({
          projectRoot: root,
          reportsDir,
          feature: 'demo',
          phase: 'review',
          subjectId,
          verdict: 'FAIL',
          blockerCount: 1,
          skipSummaryPatch: true,
        });
        setEvidenceProfile(root, 'balanced');
        const summary = withGoalRunEnv('run-X', () =>
          writeRunSummaryBase(root, report, path.dirname(HARNESS_ROOT), { verifierPlan: goalBalancedPlan('review') }),
        );
        assert(summary.blocking_skips.length === 0, `n/a SKIP 不得进 blocking_skips，实得 ${JSON.stringify(summary.blocking_skips)}`);
        assert(summary.verifier_subject_id === subjectId, `须沿用 strict 轮 subject，实得 ${JSON.stringify(summary.verifier_subject_id)}`);
        assert(
          summary.next_action === 'fix_verifier_findings_then_rerun_harness',
          `已有 FAIL 时必须指向修缺陷，实得 ${summary.next_action}`,
        );
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  // ==========================================================================
  // 环 C（plan f3a8c6d2 t2）：closure **提交侧**的严格 attempt 等值校验。
  // 事故：receipt claimed_attempt_id=i7 与终局 attempt i8 失配；而 runSyncClosureDetailed
  // 此前调 tryValidateReceipt 不带 goalIdentity → goal 门禁在提交侧静默跳过（最松一环）。
  // 修法只加"透传身份"，不引入迁移/改绑协议、不新增控制流：失配即不闭环，
  // 只有 agent 把 receipt 重签为当前 attempt 才允许提交。
  // ==========================================================================
  {
    name: 'T4：current summary 不读取旧 receipt attempt；receipt 缺失仍可闭环',
    run: () => {
      const { root } = buildProject('review', { claimedAttemptId: 'i7', goalLedgerRunId: 'run-X' });
      try {
        const receiptPath = path.join(root, 'doc/features/demo/review/phase-completion-receipt.md');
        const probe = tryValidateReceipt(HARNESS_ROOT, root, 'review', 'demo', {
          goalIdentity: { runId: 'run-X', attemptId: 'i8', attemptPhase: 'review' },
        });
        assert(probe.status === 'passed', `current schema 不读旧 receipt：${probe.message}`);
        fs.unlinkSync(receiptPath);
        const res = runSyncClosureDetailed(HARNESS_ROOT, root, 'demo', 'review', path.dirname(HARNESS_ROOT), {
          goalIdentity: { runId: 'run-X', attemptId: 'i8', attemptPhase: 'review' },
        });
        assert(res.exitCode === 0, `缺 receipt 应 closed：${res.finalizationError}`);
        const summary = JSON.parse(fs.readFileSync(path.join(root, 'doc/features/demo/review/reports/summary.json'), 'utf8'));
        assert(summary.closure_status === 'closed', 'summary 必须 closed');
        assert(fs.existsSync(receiptPath), '闭环后应生成兼容投影');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'T4：receipt 路径不可写不影响 current schema 校验与 closed summary',
    run: () => {
      const { root } = buildProject('review', { claimedAttemptId: 'i8', goalLedgerRunId: 'run-X' });
      try {
        const receiptPath = path.join(root, 'doc/features/demo/review/phase-completion-receipt.md');
        fs.unlinkSync(receiptPath);
        fs.mkdirSync(receiptPath);
        const probe = tryValidateReceipt(HARNESS_ROOT, root, 'review', 'demo', {
          goalIdentity: { runId: 'run-X', attemptId: 'i8', attemptPhase: 'review' },
        });
        assert(
          probe.status === 'passed',
          `投影不可写不应影响校验，实得 ${probe.status}；msg=${probe.message}`,
        );
        const res = runSyncClosureDetailed(HARNESS_ROOT, root, 'demo', 'review', path.dirname(HARNESS_ROOT), {
          goalIdentity: { runId: 'run-X', attemptId: 'i8', attemptPhase: 'review' },
        });
        assert(
          res.exitCode === 0,
          `receipt 投影失败不得改变闭环：${res.finalizationError}`,
        );
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
];

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      c.run();
      results.push({ name: c.name, ok: true });
    } catch (err) {
      results.push({ name: c.name, ok: false, error: (err as Error).message });
    }
  }
  return results;
}

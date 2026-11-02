// ============================================================================
// verifier-plan.unit.test.ts — verifier 适用性解析矩阵（plan a9d4e7c2 T1 / d2f7a9c4）
// ============================================================================
// 冻结的是**行为矩阵**，不是实现：verifier 从「每阶段必跑的仪式」改为按
// workflow / track / policy / adapter 有无审查员动态启用的能力，二态 disabled|enabled
// 由 resolveVerifierPlan 一次解析、全员消费。
//
// 这一套穷举四个输入维度的组合，并把四条最容易回潮的边界钉死：
//   · lite（含 lite×goal）恒 disabled——policy 说 not_applicable 就是"这条轴不存在"；
//   · workflow 未声明 verifier_prompt = 不适用，**不得** fallback 模板擅自造一个；
//   · **三种运行模式解析结果必须逐字相同**——旧口径 adapter 门只作用于 interactive、
//     而 hook 在 goal/headless 不发布，交集为空让宿主两轮无人值守 run 熔断（本轮病根）；
//   · adapter 无审查员 → disabled/adapter_has_no_reviewer（如实披露），**不是** blocked。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';

import { canProduceVerifierRequest, resolveVerifierPlan, workflowVerifierPrompt } from '../../scripts/utils/verifier-plan';
// V1（plan 7b3e9a15）：生产接线——真实 policy → 真实 plan → 真实 Step 4 装配 → 真实 writer。
import { writeRunSummaryBase } from '../../harness-runner';
import { assembleAIPrompt } from '../../scripts/utils/report-generator';
import { makeVerifierProject, reportsDirOf, rmDir } from '../utils/verifier-project-fixture';
import { CHECK_NOT_APPLICABLE_MARKER, type CheckResult, type Phase, type ScriptReport } from '../../scripts/utils/types';
// D1 归因回退用**生产实现**（runner 唯一的"失败归因：xxx"解析器），不在测试里复刻正则。
import { extractFailureClassification as parseFailureClassificationFromDetails } from '../../harness-runner';
import { resolveVerifierSubagentDeclared } from '../../scripts/utils/adapter-catalog';
import { resolveEvidencePolicy, type RuntimeContext, type RuntimeMode } from '../../scripts/utils/runtime-policy';
import { loadWorkflowSpec } from '../../workflow-loader';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

const FRAMEWORK_SOURCE_ROOT = path.resolve(__dirname, '..', '..', '..');
const WORKFLOW_NAME = 'spec-driven';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function ctx(mode: RuntimeMode, phase: string): RuntimeContext {
  return {
    mode,
    adapter: 'claude',
    phase,
    workflow: 'spec-driven',
    can_prompt_user: mode === 'interactive',
    can_collect_usage: false,
  };
}

/** 与生产同源：policy 一律经 resolveEvidencePolicy 求解，测试里不手搓 policy。 */
function planFor(opts: {
  phase: string;
  track: 'full';
  mode: RuntimeMode;
  balanced?: boolean;
  hasReviewer?: boolean;
  workflowPrompt?: string | null;
  phaseDisabledByProfile?: boolean;
}) {
  const spec = loadWorkflowSpec(FRAMEWORK_SOURCE_ROOT, WORKFLOW_NAME);
  const policy = resolveEvidencePolicy(
    opts.track,
    ctx(opts.mode, opts.phase),
    opts.balanced ? { evidence_profile: 'balanced' } : null,
  );
  return resolveVerifierPlan({
    phase: opts.phase,
    track: opts.track,
    runtimeMode: opts.mode,
    policy,
    workflowVerifierPrompt:
      opts.workflowPrompt === undefined ? workflowVerifierPrompt(spec, opts.phase) : opts.workflowPrompt,
    phaseDisabledByProfile: opts.phaseDisabledByProfile ?? false,
    adapterHasVerifierSubagent: opts.hasReviewer ?? true,
    adapterName: 'claude',
  });
}

// --------------------------------------------------------------------------
// 1. lite 全链零 verifier —— 含 lite×goal（生产路由矛盾的收口点）
// --------------------------------------------------------------------------

// --------------------------------------------------------------------------
// 2. workflow 未声明 = 不适用（缺席即为零，不得 fallback 造模板）
// --------------------------------------------------------------------------
function case2_workflowSilenceMeansNotApplicable(): void {
  const spec = loadWorkflowSpec(FRAMEWORK_SOURCE_ROOT, WORKFLOW_NAME);
  // 真实数据：change / exit / 全部 global phase 都没有 verifier_prompt。
  for (const phase of ['change', 'exit', 'catalog', 'glossary', 'docs', 'init']) {
    assert(
      workflowVerifierPrompt(spec, phase) === null,
      `构造性前提：${phase} 在 workflow 里不应声明 verifier_prompt`,
    );
  }
  const plan = planFor({ phase: 'catalog', track: 'full', mode: 'interactive' });
  assert(plan.mode === 'disabled', `未声明的 phase 必须 disabled，实得 ${plan.mode}`);
  assert(plan.reason === 'workflow_capability_absent', `实得 reason=${plan.reason}`);
  assert(plan.verifier_prompt === null, '未声明时不得凭空给出一个模板路径');

  // 未知 phase / 空 spec 同样是"不适用"，不是崩栈也不是默认启用。
  assert(workflowVerifierPrompt(spec, 'no-such-phase') === null, '未知 phase 应为 null');
  assert(workflowVerifierPrompt(null, 'spec') === null, 'spec 不可用时应为 null');
}

// --------------------------------------------------------------------------
// 3. full + 已登记 adapter = enabled；balanced 档按保留集分流
// --------------------------------------------------------------------------
function case3_fullEnabledAndBalancedSplit(): void {
  for (const phase of ['spec', 'plan', 'coding', 'review', 'ut', 'testing']) {
    const plan = planFor({ phase, track: 'full', mode: 'interactive' });
    assert(plan.mode === 'enabled', `full×${phase} 应 enabled，实得 ${plan.mode}/${plan.reason}`);
    assert(plan.reason === 'policy_required', `实得 reason=${plan.reason}`);
    assert(Boolean(plan.verifier_prompt), 'enabled 必须带出 workflow 声明的模板路径');
  }
  // balanced：保留集内仍 required，集外 off（零产物，但不是"缺失"）。
  assert(planFor({ phase: 'spec', track: 'full', mode: 'interactive', balanced: true }).mode === 'enabled', 'balanced 保留 spec');
  assert(planFor({ phase: 'coding', track: 'full', mode: 'interactive', balanced: true }).mode === 'enabled', 'balanced 保留 coding');
  const off = planFor({ phase: 'review', track: 'full', mode: 'interactive', balanced: true });
  assert(off.mode === 'disabled' && off.reason === 'policy_off', `balanced×review 应 policy_off，实得 ${off.mode}/${off.reason}`);
}

// --------------------------------------------------------------------------
// 4. 三模式同判；adapter 无审查员 → disabled/adapter_has_no_reviewer（不是 blocked）
// --------------------------------------------------------------------------
function case4_modeAgnosticAndReviewerDisclosure(): void {
  // ① **本轮病根的回归**：同一输入在三种模式下必须解析出逐字相同的结果。
  //    旧口径 adapter 门只作用于 interactive，而 hook 在 goal/headless 一律不发布，
  //    两条规则交集为空 → 一次真跑通过的审查永远闭不了环 → closure_wall_repeated。
  for (const hasReviewer of [true, false]) {
    const seen = new Set<string>();
    for (const mode of ['interactive', 'goal', 'headless'] as RuntimeMode[]) {
      const plan = planFor({ phase: 'spec', track: 'full', mode, hasReviewer });
      seen.add(`${plan.mode}/${plan.reason}`);
    }
    assert(
      seen.size === 1,
      `hasReviewer=${hasReviewer} 时三种模式必须同判，实得 ${[...seen].join(' | ')}`,
    );
  }

  // ② 有审查员 → enabled（三模式皆然，上面已验同判）。
  const enabled = planFor({ phase: 'spec', track: 'full', mode: 'goal', hasReviewer: true });
  assert(enabled.mode === 'enabled', `有审查员应 enabled，实得 ${enabled.mode}/${enabled.reason}`);

  // ③ 无审查员 → disabled + adapter_has_no_reviewer。**不得**是 blocked：
  //    起不了子代理是环境事实，不是产物缺陷；阻断会让整条 full track 在该 adapter 上不可用。
  const noReviewer = planFor({ phase: 'spec', track: 'full', mode: 'interactive', hasReviewer: false });
  assert(noReviewer.mode === 'disabled', `无审查员应 disabled，实得 ${noReviewer.mode}`);
  assert(noReviewer.reason === 'adapter_has_no_reviewer', `实得 reason=${noReviewer.reason}`);

  // ④ policy=off 优先于 adapter 审查员：关掉的能力不问 adapter。
  const offNoReviewer = planFor({
    phase: 'review',
    track: 'full',
    mode: 'interactive',
    balanced: true,
    hasReviewer: false,
  });
  assert(
    offNoReviewer.mode === 'disabled' && offNoReviewer.reason === 'policy_off',
    `policy=off 应先于 adapter 判定，实得 ${offNoReviewer.mode}/${offNoReviewer.reason}`,
  );
}

// --------------------------------------------------------------------------
// 5. profile 禁用 phase 优先于一切
// --------------------------------------------------------------------------
function case5_profileDisabledWins(): void {
  const plan = planFor({
    phase: 'coding',
    track: 'full',
    mode: 'interactive',
    phaseDisabledByProfile: true,
    hasReviewer: false, // 即使 adapter 也没审查员，profile 禁用仍优先
  });
  assert(plan.mode === 'disabled', `profile 禁用时必须 disabled，实得 ${plan.mode}`);
  assert(plan.reason === 'phase_disabled_by_profile', `实得 reason=${plan.reason}`);
}

// --------------------------------------------------------------------------
// 6. adapter 声明：布尔真源，且**磁盘声明说了算**（不许按目录/家族推断）
// --------------------------------------------------------------------------
function case6_reviewerDeclarationIsTheOnlyTruth(): void {
  // 已登记：宿主实跑观测过能起 verifier 子代理。
  for (const adapter of ['claude', 'codeagent', 'codex']) {
    assert(
      resolveVerifierSubagentDeclared(FRAMEWORK_SOURCE_ROOT, adapter),
      `${adapter} 应登记 verifier_subagent: true（宿主实证）`,
    );
  }
  // 未登记：共享规则被物化 ≠ 运行时会读取（opencode 明写 rules 不自动加载、chrys 引用可达、
  // generic 是任意外部 CLI）。虚标会让每阶段走 report missing → 重跑 → 仍 missing。
  for (const adapter of ['cursor', 'opencode', 'chrys', 'generic']) {
    assert(
      !resolveVerifierSubagentDeclared(FRAMEWORK_SOURCE_ROOT, adapter),
      `${adapter} 未经实测，不得预填 verifier_subagent（入册纪律）`,
    );
  }
  assert(!resolveVerifierSubagentDeclared(FRAMEWORK_SOURCE_ROOT, ''), '空 adapter 名 → 无审查员');
  assert(
    !resolveVerifierSubagentDeclared(FRAMEWORK_SOURCE_ROOT, 'no-such-adapter'),
    '不存在的 adapter → 无审查员（不 throw）',
  );

  // 磁盘声明直连解析器：codex 在 full×goal 下必须与 claude 同判 enabled
  //（08-29 到 09-05 期间它被判 blocked、full track 事实不可用——这条是那次回归的看门狗）。
  for (const adapter of ['claude', 'codex']) {
    const plan = resolveVerifierPlan({
      phase: 'spec',
      track: 'full',
      runtimeMode: 'goal',
      policy: resolveEvidencePolicy('full', ctx('goal', 'spec'), null),
      workflowVerifierPrompt: workflowVerifierPrompt(loadWorkflowSpec(FRAMEWORK_SOURCE_ROOT, WORKFLOW_NAME), 'spec'),
      adapterHasVerifierSubagent: resolveVerifierSubagentDeclared(FRAMEWORK_SOURCE_ROOT, adapter),
      adapterName: adapter,
    });
    assert(plan.mode === 'enabled', `${adapter} × full × goal 应 enabled，实得 ${plan.mode}/${plan.reason}`);
  }
}

// ---------------------------------------------------------------------------
// ⑦ D1（plan 3a7f9c12）：request 生产资格——脚本非 PASS 时的窄放行
// ---------------------------------------------------------------------------

type EligibilityCheck = { id: string; status: string; severity?: string; failure_kind?: string; details?: string; affected_files?: string[]; structured?: unknown };

const BLOCKER_FAIL = (id: string, extra: Partial<EligibilityCheck> = {}): EligibilityCheck =>
  ({ id, status: 'FAIL', severity: 'BLOCKER', ...extra });
const BLOCKER_PASS = (id: string): EligibilityCheck => ({ id, status: 'PASS', severity: 'BLOCKER' });

function eligibility(over: Partial<Parameters<typeof canProduceVerifierRequest>[0]>) {
  return canProduceVerifierRequest({
    planMode: 'enabled',
    phase: 'review',
    scriptVerdict: 'FAIL',
    checks: [],
    reportValidity: 'PASS',
    hasBlockedCapability: false,
    // 归因回退用**生产实现**（runner 的 extractFailureClassification），不复刻正则。
    parseClassificationFromDetails: parseFailureClassificationFromDetails,
    ...over,
  });
}

function case7_d1RequestEligibility(): void {
  assert(!eligibility({ planMode: 'disabled', scriptVerdict: 'PASS' }).allowed, 'disabled cannot create another verification capability');
  assert(eligibility({ scriptVerdict: 'PASS', checks: [BLOCKER_PASS('demo')] }).kind === 'normal', 'actual PASS retains the enabled verification path');
  const product = BLOCKER_FAIL('actual_product_assertion', { details: 'src/app.ts:7 当前完成页缺少已开卡断言', affected_files: ['src/app.ts'], failure_kind: 'code_regression' });
  const framework = BLOCKER_FAIL('compile_provider', { details: '工具连接不可用', affected_files: ['src/app.ts'], failure_kind: 'framework_bug' });
  for (const phase of ['spec', 'plan', 'coding', 'review', 'ut', 'testing']) {
    const plain = eligibility({ phase, checks: [product] });
    assert(plain.allowed && plain.kind === 'repair_diagnosis' && plain.diagnosticCheckIds.includes(product.id), `${phase}: actual readable work cannot be hidden by a phase name`);
    const mixed = eligibility({ phase, checks: [product, framework], hasBlockedCapability: true, reportValidity: 'FAIL' });
    assert(mixed.allowed, `${phase}: an unrelated provider/report gap cannot hide the available product object`);
    assert(product.status === 'FAIL' && framework.status === 'FAIL', 'diagnosis never signs any raw FAIL or missing tool as passed');
  }
  assert(!eligibility({ checks: [{ ...product, affected_files: [] }] }).allowed, 'missing actual source/test objects cannot create a diagnostic request');
  assert(!eligibility({ checks: [BLOCKER_FAIL('actual_product_assertion')] }).allowed, 'a bare check ID is not readable evidence');
  assert(!eligibility({ checks: [framework], hasBlockedCapability: true }).allowed, 'a pure unavailable provider needs its own recovery, not objectless independent work');
  assert(!eligibility({ checks: [{ id: 'device_unavailable', status: 'SKIP', severity: 'BLOCKER' }] }).allowed, 'an unexecuted mandatory check cannot invent a current product fact');
  assert(!eligibility({ checks: [], scriptVerdict: 'INCOMPLETE', reportValidity: 'UNVERIFIED' }).allowed, 'unknown remains unknown');
  const unexecuted = { id: 'device_pending', status: 'SKIP', severity: 'BLOCKER' };
  assert(eligibility({ checks: [product, unexecuted] }).allowed, 'available work can be reviewed while an independent mandatory check remains unexecuted');
  assert(unexecuted.status === 'SKIP', 'issuing diagnosis cannot turn the unexecuted check into evidence');
  const marked = { ...unexecuted, structured: { applicability: CHECK_NOT_APPLICABLE_MARKER } };
  assert(eligibility({ checks: [product, marked] }).allowed, 'true nonapplicability still does not hide the actual defect');
}

// --------------------------------------------------------------------------
// 8. V1（plan 7b3e9a15 S0/D1）：goal×balanced 的 policy 一路走到落盘产物
// --------------------------------------------------------------------------
// 生产接线要求（§6）：真实 `resolveEvidencePolicy` → 真实 `resolveVerifierPlan` → **真实
// Step 4 门控**（`canProduceVerifierRequest`，与生产 harness-runner.ts 的
// `resolveVerifierRequestEligibility` 同一实现）→ 放行时以**真实 `assembleAIPrompt`** 落盘
// ai-prompt.md → 真实已导出的 `writeRunSummaryBase`。
//
// 为什么必须带上 Step 4：`issueVerifierRequest` 在读不到 ai-prompt.md 时直接 `return null`
// （writer 自身不生成 prompt）。空目录直调 writer 时 spec 侧也会零产物，review 侧的"全部
// 缺席"就只证明了目录是空的——与 policy 无关。故断言顺序固定为「先证 Step 4 被 policy
// 关闭，再证产物缺席」。
const HARNESS_ROOT = path.resolve(__dirname, '..', '..');

function v1ScriptReport(feature: string, phase: string, projectRoot: string): ScriptReport {
  const checks: CheckResult[] = [
    { id: 'demo_ok', category: 'structure', description: 'demo', severity: 'BLOCKER', status: 'PASS', details: 'ok' },
  ];
  return {
    phase: phase as Phase,
    feature,
    timestamp: new Date().toISOString(),
    project_root: projectRoot,
    assurance: 'full',
    capability_resolutions: [],
    capability_resolution_contract_fingerprint: null,
    checks,
    summary: { total: 1, pass: 1, fail: 0, warn: 0, skip: 0, blockers: 0, verdict: 'PASS' },
  };
}

function case8_goalBalancedProductionWiring(): void {
  const spec = loadWorkflowSpec(FRAMEWORK_SOURCE_ROOT, WORKFLOW_NAME);
  const balancedCfg = { evidence_profile: 'balanced' };

  for (const [phase, expectIssued] of [['review', false], ['spec', true]] as Array<[string, boolean]>) {
    const { root } = makeVerifierProject({ evidenceProfile: 'balanced' });
    try {
      const policy = resolveEvidencePolicy('full', ctx('goal', phase), balancedCfg);
      const plan = resolveVerifierPlan({
        phase,
        track: 'full',
        runtimeMode: 'goal',
        policy,
        workflowVerifierPrompt: workflowVerifierPrompt(spec, phase),
        phaseDisabledByProfile: false,
        adapterHasVerifierSubagent: true,
        adapterName: 'claude',
      });
      const report = v1ScriptReport('demo', phase, root);
      // 生产 Step 4 的同一门控（harness-runner.ts:1168 / :1878 都只是它的包装调用点）。
      const gate = canProduceVerifierRequest({
        planMode: plan.mode,
        phase,
        scriptVerdict: report.summary.verdict,
        checks: report.checks,
        reportValidity: 'PASS',
        hasBlockedCapability: false,
        parseClassificationFromDetails: parseFailureClassificationFromDetails,
      });

      if (expectIssued) {
        assert(policy.verifier === 'required', `spec 在保留集内应 required，实得 ${policy.verifier}`);
        assert(plan.mode === 'enabled', `spec×goal×balanced 应 enabled，实得 ${plan.mode}/${plan.reason}`);
        assert(plan.reason === 'policy_required', `实得 reason=${plan.reason}`);
        assert(gate.allowed, `Step 4 门控须放行，实得 ${JSON.stringify(gate)}`);
      } else {
        // **先证"Step 4 被 policy 关闭"**——不是"空目录里没有 prompt"。
        assert(policy.verifier === 'off', `goal×balanced×review 的 verifier 应 off，实得 ${policy.verifier}`);
        assert(plan.mode === 'disabled', `实得 ${plan.mode}/${plan.reason}`);
        assert(plan.reason === 'policy_off', `实得 reason=${plan.reason}`);
        assert(!gate.allowed, `Step 4 门控必须因 plan disabled 拒绝装配，实得 ${JSON.stringify(gate)}`);
      }

      const dir = reportsDirOf(root, 'demo', phase);
      fs.mkdirSync(dir, { recursive: true });
      // Step 4：门控放行才装配（与生产 harness-runner.ts:1169–1210 同形）。
      if (gate.allowed) {
        assembleAIPrompt(
          HARNESS_ROOT,
          root,
          phase as Phase,
          'demo',
          [],
          '{"checks":[]}',
          'rule: {}',
          undefined,
          undefined,
          FRAMEWORK_SOURCE_ROOT,
          { verifierPromptRel: plan.verifier_prompt ?? undefined },
        );
      }
      const promptOnDisk = fs.existsSync(path.join(dir, 'ai-prompt.md'));
      assert(promptOnDisk === expectIssued, `ai-prompt.md 在盘上=${promptOnDisk}，期望 ${expectIssued}`);

      const summary = writeRunSummaryBase(root, report, FRAMEWORK_SOURCE_ROOT, { verifierPlan: plan });
      for (const field of ['verifier_subject_id', 'verifier_request', 'verifier_report', 'ai_prompt'] as const) {
        const present = Boolean((summary as unknown as Record<string, unknown>)[field]);
        assert(
          present === expectIssued,
          `${phase}: summary.${field} 在场=${present}，期望 ${expectIssued}（next_action=${summary.next_action}）`,
        );
      }
    } finally {
      rmDir(root);
    }
  }
}

const CASES: Array<{ name: string; fn: () => void }> = [{ name: '② workflow 未声明 verifier_prompt = 不适用，不得 fallback 造模板', fn: case2_workflowSilenceMeansNotApplicable },
  { name: 'P2 C actual test-strength facts can reach independent verification without washing other FAIL or inventing a test object', fn: () => {
    const check = { id: 'coding_existing_test_preserved', severity: 'BLOCKER', status: 'FAIL', details: 'tests/value.test.ts：actual assertion change', affected_files: ['tests/value.test.ts'] };
    const base = { phase: 'coding', checks: [check, BLOCKER_FAIL('coding_compile')], hasBlockedCapability: true };
    const result = eligibility(base);
    assert(result.allowed && result.kind === 'repair_diagnosis' && result.diagnosticCheckIds.length === 1, 'independent readable test facts cannot be hidden by unrelated compile/environment gaps');
    assert(check.status === 'FAIL' && base.checks[1].status === 'FAIL', 'eligibility cannot rewrite original failure truth');
    assert(!eligibility({ ...base, checks: [{ ...check, affected_files: [] }] }).allowed, 'missing actual test objects cannot create a diagnostic request');
    assert(!eligibility({ ...base, checks: [BLOCKER_FAIL('coding_compile')] }).allowed, 'unrelated product failures are not a test-strength qualification');
    assert(!eligibility({ ...base, planMode: 'disabled' }).allowed, 'a disabled verifier cannot be silently invented');
    assert(eligibility({ ...base, scriptVerdict: 'INCOMPLETE' }).allowed, 'unexecuted independent tools stay incomplete while readable strength facts may be checked');
  } },
  { name: '③ full + 已登记 adapter = enabled；balanced 按保留集分流 off', fn: case3_fullEnabledAndBalancedSplit },
  { name: '④ 三模式同判；adapter 无审查员 → disabled/adapter_has_no_reviewer', fn: case4_modeAgnosticAndReviewerDisclosure },
  { name: '⑤ profile 禁用 phase 优先于 policy 与 adapter 能力', fn: case5_profileDisabledWins },
  { name: '⑥ verifier_subagent 布尔真源：磁盘声明说了算，codex 与 claude 同判', fn: case6_reviewerDeclarationIsTheOnlyTruth },
  { name: 'P3 当前真实对象与共同repair决定独核资格；纯环境/无对象/未执行仍不造证据', fn: case7_d1RequestEligibility },
  { name: '⑧ V1（B05）：goal×balanced 经真实 policy→plan→Step 4 装配→writer，review 零产物/spec 全在场', fn: case8_goalBalancedProductionWiring },
];

export async function runAll(): Promise<UnitCaseResult[]> {
  const results: UnitCaseResult[] = [];
  for (const c of CASES) {
    try {
      c.fn();
      results.push({ name: c.name, ok: true });
    } catch (err) {
      results.push({ name: c.name, ok: false, error: (err as Error).message });
    }
  }
  return results;
}

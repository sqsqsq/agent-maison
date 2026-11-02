// ============================================================================
// verifier-plan.ts — verifier「能力是否启用」的唯一解析 SSOT（plan a9d4e7c2 T1）
// ============================================================================
// 病根（宿主 bc-openCard-1 实锤）：verifier 被做成了**每阶段必跑的仪式**——policy 说
// off、runner 仍无条件装配 ai-prompt 与 subject、Skill 仍无条件要求四件套、
// 全流程，于是「不适用」与「该有却缺失」被混成同一种 missing。
//
// 收口：verifier 降为**按 workflow/track/policy/adapter 能力动态启用的能力**。
// 四个互不越权的问题只在这里解析一次，runner / check-receipt / Skill 指引 / hook
// 恢复话术全部消费同一结果：
//
//   这个阶段是否存在？          → workflow + feature track（调用方已裁掉轨外 phase）
//   这个阶段是否需要 verifier？ → workflow 的 verifier_prompt 声明 + evidence policy
//   当前 adapter 有没有审查员？ → adapter 的布尔 verifier_subagent（宿主实测登记）
//   本次报告属于哪个 run？      → verifier request 的 subject（见 verifier-request.ts）
//
// ─── 二态语义（plan d2f7a9c4：blocked 整体删除）─────────────────────────────
//   disabled：不生成 ai-prompt / request / subject，不调用，不校验——**缺席即为零**；
//   enabled ：生成 request 并执行 verifier。
//
// 曾经的第三态 blocked 表达的是「policy 要 verifier，但当前 adapter 发布不了」。报告改由
// **调用方**写出后，发布不再有 adapter 差异，该态没有指称对象。剩下的唯一缺口是「这个工具
// 起不了子代理」，按 disabled/adapter_has_no_reviewer 如实披露、不阻断闭环。
//
// **判定与运行模式无关**（本轮的病根）：旧口径下 adapter 能力门只作用于 interactive，而 hook
// 在 goal/headless 一律落 bedside 不发布——两条规则交集为空，一次真跑通过的审查永远闭不了环，
// 宿主两轮无人值守 run 因此熔断。此处不得再出现任何 runtimeMode 分支。
//
// ─── 两条不可让步的边界 ─────────────────────────────────────────────────────
// 1. **声明在场即真源**：workflow 声明 `verifier_prompt` = 该 phase 具备 verifier 能力，
//    声明缺席 = 不适用（不得 fallback 模板擅自造一个）。**磁盘上残留的旧
//    prompt/request/report 永远不能激活被本解析器判为 disabled 的能力**——
//    enabled→disabled 无需清理旧文件，也不会被旧文件重新激活。
// 2. **不落快照**：本模块是纯函数 + 薄 I/O 装配，结果**不写进 summary**。再造一个
//    `summary.verifier_plan` 就是把适用性从「随时可重算的判断」变成「会漂移的状态」。
// ============================================================================

import type { WorkflowSpec } from '../../workflow-loader';
import type { EvidenceLevel, EvidencePolicy, FeatureTrack, RuntimeMode } from './runtime-policy';
import { isCheckNotApplicable } from './types';
import { isBlockingCheck, isRequiredCheckGap, resolveCurrentDisposition, renderCurrentDisposition, type CurrentDispositionPhaseFact } from './check-disposition';

export type VerifierPlanMode = 'disabled' | 'enabled';

export type VerifierPlanReason =
  /** profile 禁用整个 phase */
  | 'phase_disabled_by_profile'
  /** workflow 未声明 verifier_prompt = 该 phase 无此能力（不是"缺失"） */
  | 'workflow_capability_absent'
  /** evidence policy 判 off（如 balanced 档的非保留 phase） */
  | 'policy_off'
  | 'policy_not_applicable'
  /** 当前 adapter 未登记 verifier_subagent = 没有审查员（如实披露，不阻断） */
  | 'adapter_has_no_reviewer'
  | 'policy_required'
  | 'policy_optional';

export interface VerifierPlan {
  mode: VerifierPlanMode;
  reason: VerifierPlanReason;
  /** workflow 声明的 prompt 模板相对路径；disabled(workflow_capability_absent) 时为 null。 */
  verifier_prompt: string | null;
  /** 人读一句话（控制台 / Skill 指引 / check-receipt 话术共用，避免各写一份）。 */
  message: string;
}

// ---------------------------------------------------------------------------
// 纯函数解析
// ---------------------------------------------------------------------------

export interface ResolveVerifierPlanInput {
  phase: string;
  track: FeatureTrack;
  runtimeMode: RuntimeMode;
  /** 已求解的 evidence policy（runtime-policy.resolveEvidencePolicy 唯一出处）。 */
  policy: Pick<EvidencePolicy, 'verifier'>;
  /** workflow artifact 的 `verifier_prompt`；缺席 = 该 phase 不具备 verifier 能力。 */
  workflowVerifierPrompt?: string | null;
  phaseDisabledByProfile?: boolean;
  /** adapter 的布尔 verifier_subagent；缺省 = 无审查员。 */
  adapterHasVerifierSubagent?: boolean;
  /** 仅用于话术。 */
  adapterName?: string;
}

/**
 * 四问一次解析。**顺序即优先级**，任何调用方都不得插队或另判：
 *   profile 禁用 > workflow 未声明 > policy 不适用/off > adapter 无审查员 > 启用。
 *
 * interactive / headless / goal 三种模式解析结果完全一致——**不得引入任何 mode 分支**。
 * runtimeMode 只进话术。
 */
export function resolveVerifierPlan(input: ResolveVerifierPlanInput): VerifierPlan {
  const prompt = typeof input.workflowVerifierPrompt === 'string' && input.workflowVerifierPrompt.trim()
    ? input.workflowVerifierPrompt.trim()
    : null;
  const where = `${input.phase}（track=${input.track}, mode=${input.runtimeMode}）`;

  if (input.phaseDisabledByProfile) {
    return {
      mode: 'disabled',
      reason: 'phase_disabled_by_profile',
      verifier_prompt: prompt,
      message: `阶段 ${where} 已被 project_profile 禁用：verifier 不适用，零产物、零要求。`,
    };
  }
  if (!prompt) {
    return {
      mode: 'disabled',
      reason: 'workflow_capability_absent',
      verifier_prompt: null,
      message:
        `阶段 ${where} 的 workflow 未声明 verifier_prompt：该阶段不具备 verifier 能力（不是"缺失"）。` +
        '不生成 ai-prompt/request/subject，也不得 fallback 模板擅自造一个。',
    };
  }

  const level: EvidenceLevel = input.policy.verifier;
  if (level === 'not_applicable') {
    return {
      mode: 'disabled',
      reason: 'policy_not_applicable',
      verifier_prompt: prompt,
      message: `阶段 ${where} 的 evidence policy 判 verifier=not_applicable：这条轴对本 track 不存在，零产物、零要求。`,
    };
  }
  if (level === 'off') {
    return {
      mode: 'disabled',
      reason: 'policy_off',
      verifier_prompt: prompt,
      message: `阶段 ${where} 的 evidence policy 判 verifier=off：本轮不生成任何 verifier 产物，闭环不要求 verifier 证据。`,
    };
  }

  if (!input.adapterHasVerifierSubagent) {
    return {
      mode: 'disabled',
      reason: 'adapter_has_no_reviewer',
      verifier_prompt: prompt,
      message:
        `阶段 ${where}：当前 adapter${input.adapterName ? ` "${input.adapterName}"` : ''} 未登记 ` +
        'verifier_subagent（agents/<adapter>/adapter.yaml），本工具起不了 verifier 子 agent。' +
        '不生成 request、不重跑；闭环照常进行，verifier 轴如实记 not_reviewed 并披露——' +
        '这是环境事实，不是产物缺陷。',
    };
  }

  return {
    mode: 'enabled',
    reason: level === 'required' ? 'policy_required' : 'policy_optional',
    verifier_prompt: prompt,
    message: `阶段 ${where} 启用 verifier（policy=${level}，模板 ${prompt}）：生成 request 并由 verifier 子 agent 执行。`,
  };
}

// ---------------------------------------------------------------------------
// D1（plan 3a7f9c12）：request **生产资格**——脚本非 PASS 时的窄放行
// ---------------------------------------------------------------------------
// 病根（F01，宿主生产 writer 复现）：Step 4 与 writeRunSummaryBase 都写死
// `enabled ∧ 脚本 verdict=PASS` 才装配/签发。于是 review 的负面裁决
// （negative_verdict_closure / conditional_pass_closure）与 UT 的真实断言失败
// 永远拿不到 verifier request——而这两类失败的回修候选恰恰**依赖** verifier
// 逐条确认。产品 FAIL 于是只能原地重试到耗尽。
//
// 收口：只放行**已复现**的两类可诊断失败，其余 FAIL/INCOMPLETE 一律保持原样
// （先修输入/环境的出路不能被"叫个 verifier 看看"顶掉）。本函数**只判资格**：
// 不读模型、不执行 provider、不改产品 verdict/closure，也不新建模块或配置。
// Step 4 与 writer 共用它——两处判据不得再各写一套。
// ---------------------------------------------------------------------------

/** UT 运行/编译门禁的 legacy ≡ canonical 别名（capability-registry 同一对照，此处只取字面量避免反向依赖）。 */
const UT_RUN_CHECK_IDS: ReadonlySet<string> = new Set(['ut_hvigor_test', 'ut_run']);
const UT_COMPILE_CHECK_IDS: ReadonlySet<string> = new Set(['ut_hvigor_build', 'ut_compile']);

/** D1 放行的 review 负面裁决 check（产品裁决传播门禁，报告本身合法）。 */
export const REVIEW_NEGATIVE_CLOSURE_CHECK_IDS: ReadonlySet<string> = new Set([
  'negative_verdict_closure',
  'conditional_pass_closure',
]);

/** CheckResult 的最小只读形状（只取形状与一个纯谓词 isCheckNotApplicable；不依赖 capability-registry）。 */
export interface VerifierEligibilityCheck {
  id: string;
  status: string;
  severity?: string;
  /** 机器归因（优先）；缺失才用 details 文本回退。 */
  failure_kind?: string;
  details?: string;
  affected_files?: readonly string[];
  /** 结构化附加信息；`applicability=not_applicable` 表示已确认不适用（CHECK_NOT_APPLICABLE_MARKER）。 */
  structured?: unknown;
}

export interface CanProduceVerifierRequestInput {
  /** resolveVerifierPlan 的结果模式。 */
  planMode: VerifierPlanMode;
  phase: string;
  /** 脚本报告顶层 verdict（PASS / FAIL / INCOMPLETE）。 */
  scriptVerdict: string;
  checks: ReadonlyArray<VerifierEligibilityCheck>;
  /** harness 派生的 report_validity（quality-axes deriveReportValidity）。 */
  reportValidity: 'PASS' | 'FAIL' | 'UNVERIFIED';
  /** deriveSummaryVerdictLattice 的 has_blocked 投影（capability 输入未解析）。 */
  hasBlockedCapability: boolean;
  currentAxes?: CurrentDispositionPhaseFact['axes'];
  /** Stage-authored proposals with concrete current readable evidence, resolved by the shared issue reader. */
  upstreamDiagnosis?: { rows: readonly unknown[] } | null;
  /**
   * details 文本兜底归因解析器（harness-runner 的 extractFailureClassification）。
   * **不在这里复制第二段"失败归因：xxx"正则**——归因口径全仓只有一处实现。
   */
  parseClassificationFromDetails?: (details: string) => string | undefined;
}

export interface VerifierRequestEligibility {
  /** 是否装配 ai-prompt 并签发 request。 */
  allowed: boolean;
  /**
   * · `normal`：原成功路径（enabled ∧ 脚本 PASS），资格与本 plan 之前完全一致；
   * · `repair_diagnosis`：D1 窄放行的产品失败诊断；
   * · `none`：不生产。
   */
  kind: 'normal' | 'repair_diagnosis' | 'none';
  /** 人读一句话（控制台 / ai-prompt 诊断说明共用）。 */
  reason: string;
  /** 诊断分支下**已被放行**的失败 check id（进 ai-prompt 的诊断说明；normal/none 为空）。 */
  diagnosticCheckIds: string[];
}

const NOT_ALLOWED = (reason: string): VerifierRequestEligibility => ({
  allowed: false,
  kind: 'none',
  reason,
  diagnosticCheckIds: [],
});

/** Independent diagnosis consumes actual current objects and the common repair disposition, never a phase whitelist. */
export function canProduceVerifierRequest(
  input: CanProduceVerifierRequestInput,
): VerifierRequestEligibility {
  if (input.planMode !== 'enabled') {
    return NOT_ALLOWED('verifier plan 判 disabled：缺席即为零，不装配也不签发。');
  }
  if (input.scriptVerdict === 'PASS' && !input.checks.some(check => isRequiredCheckGap(check))) {
    return { allowed: true, kind: 'normal', reason: '脚本 verdict=PASS：按原成功路径签发。', diagnosticCheckIds: [] };
  }
  const testStrength = input.checks.filter(check => check.id === 'coding_existing_test_preserved'
    && (check.status === 'FAIL' || check.status === 'PASS') && !!check.details?.trim()
    && check.affected_files?.length && check.affected_files.every(file => typeof file === 'string' && file.trim()));
  if (testStrength.length && input.reportValidity !== 'FAIL') return {
    allowed: true, kind: 'repair_diagnosis', diagnosticCheckIds: testStrength.map(check => check.id),
    reason: '已有实际测试对象与原文本对比事实：独立核验断言强度，不按作者phase禁写。其它FAIL、未执行及环境/设备/编译缺口保留，不能由此签完成。',
  };
  const current = resolveCurrentDisposition({ endpoint: 'request', phases: [{ phase: input.phase, summaryPresent: false,
    verdict: input.scriptVerdict, schemaCurrent: true, closureCommitted: true, checks: input.checks,
    failingChecks: input.checks.filter(check => check.status === 'FAIL'), axes: input.currentAxes }] });
  const readableObjects = input.checks.some(check => check.status !== 'SKIP' && !!check.details?.trim()
    && !!check.affected_files?.length && check.affected_files.every(file => typeof file === 'string' && file.trim()));
  if (current.completionBlocking.some(problem => problem.action === 'repair') && readableObjects || input.upstreamDiagnosis?.rows.length) {
    return { allowed: true, kind: 'repair_diagnosis',
      reason: '当前有可独立核验的真实修复事实或有据问题；原FAIL、未执行与环境缺口全部保留，独核不签授权或工具通过。\n' + renderCurrentDisposition(current),
      diagnosticCheckIds: [...new Set(current.completionBlocking.filter(problem => problem.action === 'repair').map(problem => problem.id))] };
  }
  return NOT_ALLOWED('当前只有输入/执行条件或未完成证据缺口；先恢复原producer，不购买无对象的独立核验。\n' + renderCurrentDisposition(current));
}

// ---------------------------------------------------------------------------
// 薄 I/O 装配（不做裁决，只把声明面取齐）
// ---------------------------------------------------------------------------

/**
 * 取 workflow 中该 phase 的 `verifier_prompt` 声明。**声明即真源**：
 * 找不到 artifact 或未声明都返回 null（= 不适用），不做任何推断或回退。
 */
export function workflowVerifierPrompt(spec: WorkflowSpec | null | undefined, phase: string): string | null {
  const artifact = spec?.artifacts?.find((a) => a.id === phase);
  const raw = artifact?.verifier_prompt;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

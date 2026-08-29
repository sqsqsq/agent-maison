// ============================================================================
// verifier-plan.ts — verifier「能力是否启用」的唯一解析 SSOT（plan a9d4e7c2 T1）
// ============================================================================
// 病根（宿主 bc-openCard-1 实锤）：verifier 被做成了**每阶段必跑的仪式**——policy 说
// off、runner 仍无条件装配 ai-prompt 与 subject、Skill 仍无条件要求四件套、
// check-receipt 到最后一步才发现 lite 不适用。适用性只在消费端判断，生产端与文档写死
// 全流程，于是「不适用」与「该有却缺失」被混成同一种 missing。
//
// 收口：verifier 降为**按 workflow/track/policy/adapter 能力动态启用的能力**。
// 四个互不越权的问题只在这里解析一次，runner / check-receipt / Skill 指引 / hook
// 恢复话术全部消费同一结果：
//
//   这个阶段是否存在？          → workflow + feature track（调用方已裁掉轨外 phase）
//   这个阶段是否需要 verifier？ → workflow 的 verifier_prompt 声明 + evidence policy
//   当前 adapter 能不能执行？   → adapter 的 verifier_capability（仅实测 mode 登记）
//   本次报告属于哪个 run？      → verifier request 的 subject（见 verifier-request.ts）
//
// ─── 三态语义 ───────────────────────────────────────────────────────────────
//   disabled：不生成 ai-prompt / request / subject，不调用，不校验——**缺席即为零**；
//   enabled ：生成 request 并执行 verifier；
//   blocked ：policy=required 但当前 adapter 无能力——**脚本检查照常完整执行**，
//             script PASS 后才报 INCOMPLETE / verifier_provider_unavailable
//            （provider 缺失不覆盖真实脚本失败、不禁基本诊断，也不拖到 receipt 才死）。
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

export type VerifierPlanMode = 'disabled' | 'enabled' | 'blocked';

export type VerifierPlanReason =
  /** profile 禁用整个 phase */
  | 'phase_disabled_by_profile'
  /** workflow 未声明 verifier_prompt = 该 phase 无此能力（不是"缺失"） */
  | 'workflow_capability_absent'
  /** evidence policy 判 off（如 balanced 档的非保留 phase） */
  | 'policy_off'
  /** evidence policy 判 not_applicable（如 lite track） */
  | 'policy_not_applicable'
  | 'policy_required'
  | 'policy_optional'
  /** required 但当前 adapter 未登记该 mode 的 verifier 能力 */
  | 'verifier_provider_unavailable';

export interface VerifierPlan {
  mode: VerifierPlanMode;
  reason: VerifierPlanReason;
  /** workflow 声明的 prompt 模板相对路径；disabled(workflow_capability_absent) 时为 null。 */
  verifier_prompt: string | null;
  /** 人读一句话（控制台 / Skill 指引 / check-receipt 话术共用，避免各写一份）。 */
  message: string;
}

// ---------------------------------------------------------------------------
// adapter 能力声明
// ---------------------------------------------------------------------------

/** 证据投递机制 id（机制名非厂商名——多个 adapter 可共用同一机制）。 */
export const VERIFIER_CAPABILITY_TRANSPORTS = ['repo_file_request'] as const;
export type VerifierCapabilityTransport = (typeof VERIFIER_CAPABILITY_TRANSPORTS)[number];

/** 证据发布机制 id。 */
export const VERIFIER_CAPABILITY_PUBLISHERS = ['subagent_stop'] as const;
export type VerifierCapabilityPublisher = (typeof VERIFIER_CAPABILITY_PUBLISHERS)[number];

/** 可登记的运行模式（= RuntimeMode；**只登记真实实测过的**，不许预填）。 */
export const VERIFIER_CAPABILITY_MODES = ['interactive', 'headless', 'goal'] as const;

export interface VerifierCapabilityDeclaration {
  transport: VerifierCapabilityTransport;
  publisher: VerifierCapabilityPublisher;
  modes: readonly RuntimeMode[];
}

// ---------------------------------------------------------------------------
// 纯函数解析
// ---------------------------------------------------------------------------

export interface ResolveVerifierPlanInput {
  phase: string;
  /** feature track（lite 的 policy 已是 off，此处只进话术；不另立第二套判定）。 */
  track: FeatureTrack;
  runtimeMode: RuntimeMode;
  /** 已求解的 evidence policy（runtime-policy.resolveEvidencePolicy 唯一出处）。 */
  policy: Pick<EvidencePolicy, 'verifier'>;
  /** workflow artifact 的 `verifier_prompt`；缺席 = 该 phase 不具备 verifier 能力。 */
  workflowVerifierPrompt?: string | null;
  phaseDisabledByProfile?: boolean;
  /** adapter 的 verifier_capability 声明；null/undefined = 未声明 = 无能力。 */
  adapterCapability?: VerifierCapabilityDeclaration | null;
  /** 仅用于话术。 */
  adapterName?: string;
}

function hasMode(cap: VerifierCapabilityDeclaration | null | undefined, mode: RuntimeMode): boolean {
  return Boolean(cap && cap.modes.includes(mode));
}

/**
 * 四问一次解析。**顺序即优先级**，任何调用方都不得插队或另判：
 *   profile 禁用 > workflow 未声明 > policy 不适用/off > adapter 能力 > 启用。
 *
 * adapter 能力判定**本轮仅 interactive**：goal/headless 的 verifier 发布权责由
 * goal 侧 bedside 特例承担（其删除另立后续，须真实 goal payload 验收），此处若也按
 * 「未登记即 blocked」判定，会把 full×goal 一刀切成 INCOMPLETE，属越权。
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

  if (level === 'required' && input.runtimeMode === 'interactive' && !hasMode(input.adapterCapability, 'interactive')) {
    return {
      mode: 'blocked',
      reason: 'verifier_provider_unavailable',
      verifier_prompt: prompt,
      message:
        `阶段 ${where} 的 evidence policy 判 verifier=required，但当前 adapter` +
        `${input.adapterName ? ` "${input.adapterName}"` : ''} 未登记 interactive 模式的 verifier 能力` +
        '（agents/<adapter>/adapter.yaml 的 verifier_capability.modes）。' +
        '脚本检查照常完整执行；脚本 PASS 时本阶段按 INCOMPLETE / verifier_provider_unavailable 处理。',
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

// ============================================================================
// quality-axes.ts — summary 1.1 多轴产品裁决（blind-visual-hardening d1 切片二）
// ----------------------------------------------------------------------------
// 背景（bc-openCard 二轮）：报告合法性(report_validity)与产品裁决混用一个 PASS，
// 「视觉未验真」被埋进 WARN/soft_advisories，「达标可发布」裸奔。本模块：
//   ① 从**同一份** check 结果派生 functional/visual/asset/evidence 四轴对象化裁决
//     （harness 派生，非 agent 自报）；
//   ② report_validity 独立顶层字段（报告工件可解析/可信——不是产品质量轴，
//     不进 quality_axes，防被消费方当产品轴参与 release 判定；design §1.2 定案）；
//   ③ 双投影分立：phase-advance 投影（旧顶层 verdict 兼容语义）/ release 投影
//     （release_readiness + completion_status 标签）；
//   ④ 防 split-brain：外部阻塞分类以 resolveVerdictFromChecks 为唯一 oracle
//     （不重复实现 device-external 判定），且 deriveSummaryVerdictLattice 输出
//     projected_verdict 供写盘方与 legacy verdict 对账（不一致=独立派生缺陷，显式记录；
//     pre===legacy 的 capability 合法投影除外——t2 因果归因，不报）。
// 新 writer 只产生 needs_fix 或 external_dependency。needs_human/owner=human 仅为 legacy
// summary schema 的兼容读取值，任何人签都不能解除确定性 FAIL/UNVERIFIED。
// ============================================================================

import type { CheckResult, Phase } from './types';
import type { CapabilityResolutionReport } from './capability-resolution';
import { resolveVerdictFromChecks } from './report-generator';
import { validateRepairCandidatesShape } from './repair-candidates';

export type AxisId = 'functional' | 'visual' | 'asset' | 'evidence';
export const AXIS_IDS: readonly AxisId[] = ['functional', 'visual', 'asset', 'evidence'];

/** STALE/MISSING 为 evidence 轴保留态（P1-E 证据新鲜度接入时启用；schema 先行稳定） */
export type AxisVerdict = 'PASS' | 'FAIL' | 'UNVERIFIED' | 'STALE' | 'MISSING' | 'NOT_APPLICABLE';
export type ResolutionClass = 'needs_fix' | 'needs_human' | 'external_dependency';
export type ResolutionOwner = 'agent' | 'human' | 'toolchain' | 'external';

export interface AxisResolution {
  class: ResolutionClass;
  owner: ResolutionOwner;
  retry_phase: string | null;
}

export interface QualityAxis {
  applicable: boolean;
  required_for_release: boolean;
  verdict: AxisVerdict;
  blocking_class: ResolutionClass | null;
  source_checks: string[];
  resolution: AxisResolution | null;
}

export type QualityAxes = Record<AxisId, QualityAxis>;
export type ReportValidity = 'PASS' | 'FAIL' | 'UNVERIFIED';
export type ReleaseReadiness = 'READY' | 'BLOCKED';

export interface VerdictLattice {
  report_validity: ReportValidity;
  quality_axes: QualityAxes;
  /** capability 投影前的 phase-advance verdict（t2 因果归因的 pre）。 */
  pre_projection_verdict: 'PASS' | 'FAIL' | 'INCOMPLETE';
  /** 含 hasBlocked 顶层钳制的最终投影 verdict（t2 因果归因的 post；不拿 rawPost 归因）。 */
  projected_verdict: 'PASS' | 'FAIL' | 'INCOMPLETE';
  /** capability 投影是否产生 blocked（t2 因果归因/next_action 需要）。 */
  has_blocked: boolean;
  release_readiness: ReleaseReadiness;
  completion_status: string;
}

export interface DeriveAxesOptions {
  phase: Phase | string;
  /** UI 需求（spec.md ui_change 需要 ui-spec）→ visual 轴 applicable */
  visualApplicable: boolean;
  /** ui-spec 声明了 assets → asset 轴 applicable（蕴含 visualApplicable） */
  assetApplicable: boolean;
}

/**
 * Release requirement SSOT for quality axes. The current policy requires every
 * applicable axis for release; callers that must decide before summary
 * materialization reuse this projector instead of inferring optionality from
 * fidelity/strictness.
 */
export function projectAxisRequiredForRelease(axis: AxisId, applicable: boolean): boolean {
  return AXIS_IDS.includes(axis) && applicable;
}

// ---------------------------------------------------------------------------
// check id → 轴 映射（显式前缀表；匹配顺序 asset → visual → evidence → functional 兜底）
// 注：visual_parity_unverified_crop 是素材验真门禁（'visual_' 前缀但语义属 asset），
//     故 asset 表先匹配。
// ---------------------------------------------------------------------------

const ASSET_PREFIXES = [
  'asset_',
  'visual_parity_unverified_crop',
  'blind_crop_prohibition',
  'placeholder_',
];
const VISUAL_PREFIXES = [
  'visual_',
  'capture_',
  'static_fidelity',
  'layout_oracle',
  'fidelity_',
  'ux_reference',
  'render_visibility',
  'baked_text',
  'visible_text',
  'quiescence',
  // S7（visual-capability-truth）：结构保真拆轴——运行时挂载轴（testing 侧）与静态轴分立聚合
  // plan e6b3f8d2 t3：`ui_kit_` 族前缀随强制 Maison UI kit 撤销一并删除（已无该族 check id）。
  'runtime_mount_conformance',
  'ui_spec_',
];
const EVIDENCE_PREFIXES = [
  'device_test_',
  'hylyre_',
  'review_closure_attestation',
  'headless_assumptions',
  'p0_semantic',
  'p0_coverage',
  'p0_pass_rate',
  'p0_runtime_step',
  'report_trace_reconciliation',
  'evidence_',
];

export function mapCheckToAxis(checkId: string): AxisId {
  const id = checkId.toLowerCase();
  if (ASSET_PREFIXES.some(p => id.startsWith(p))) return 'asset';
  if (VISUAL_PREFIXES.some(p => id.startsWith(p))) return 'visual';
  if (EVIDENCE_PREFIXES.some(p => id.startsWith(p))) return 'evidence';
  return 'functional';
}

/** 报告合法性 check 集（report_validity 输入面；产品裁决 check 不在此列） */
const REPORT_VALIDITY_CHECK_IDS = new Set([
  'conclusion_with_verdict',
  'report_conclusion_with_verdict',
  'required_chapters',
  'report_required_chapters',
  'plan_required_chapters',
  'issue_table_format',
  'severity_values',
  'issue_category_values',
  'statistics_summary',
  'metadata_header',
  'plan_metadata_header',
  'execution_result_table',
  'defect_table_format',
  'pass_rate_calculated',
  'test_case_table_format',
]);

interface CheckLike {
  id: string;
  status: CheckResult['status'];
  severity: CheckResult['severity'];
  blocking_class?: string;
  failure_kind?: string;
}

// ---------------------------------------------------------------------------
// 派生
// ---------------------------------------------------------------------------

/** phase-advance 时 UNVERIFIED 也阻断（INCOMPLETE）的轴集合——按 phase。
 * visual/asset 的 UNVERIFIED **不**阻断推进（由 phase matrix 决定），但继续阻断 release；
 * 后续 testing/owner 必须补齐机器证据，不存在人签清偿。 */
const ADVANCE_UNVERIFIED_BLOCKING: Record<AxisId, (phase: string) => boolean> = {
  functional: () => true,
  evidence: phase => phase === 'ut' || phase === 'testing',
  visual: () => false,
  asset: () => false,
};

export function deriveQualityAxes(
  checks: CheckLike[],
  opts: DeriveAxesOptions,
  capabilityReport?: Pick<CapabilityResolutionReport, 'capabilities'>,
): QualityAxes {
  // 外部阻塞唯一 oracle：legacy INCOMPLETE ⇔ 全部 BLOCKER FAIL 均为 device-external
  // （resolveVerdictFromChecks 内部判定；此处不重复实现其 id/class 细则）。
  const legacy = resolveVerdictFromChecks(checks as CheckResult[]);
  const allBlockerFailsExternal = legacy === 'INCOMPLETE';
  // Contract axis is the single source for migrated capability-backed checks.
  // Prefix mapping remains fallback for all ordinary legacy checks.
  const capabilityAxisByCheckId = new Map(
    (capabilityReport?.capabilities ?? [])
      .filter((capability) => capability.active && capability.state === 'resolved')
      .map((capability) => [capability.id, capability.axis] as const),
  );

  const applicableOf: Record<AxisId, boolean> = {
    functional: true,
    visual: opts.visualApplicable,
    // asset 蕴含 visual：ui-spec 都没有就谈不上素材轴
    asset: opts.visualApplicable && opts.assetApplicable,
    evidence: true, // 是否真的有证据面由"零执行→NOT_APPLICABLE 降解"处理（见下）
  };

  interface Bucket {
    sources: string[];
    hardFails: CheckLike[];
    externalFails: CheckLike[];
    executed: number;
  }
  const buckets: Record<AxisId, Bucket> = {
    functional: { sources: [], hardFails: [], externalFails: [], executed: 0 },
    visual: { sources: [], hardFails: [], externalFails: [], executed: 0 },
    asset: { sources: [], hardFails: [], externalFails: [], executed: 0 },
    evidence: { sources: [], hardFails: [], externalFails: [], executed: 0 },
  };

  for (const c of checks) {
    // codex 实施 review P2-7：报告合法性 check 只喂 report_validity，不入产品轴——
    // "报告格式坏了"不得被描述成"产品功能失败"（其阻断由 projectPhaseAdvanceVerdict 的
    // reportValidity 输入承担，推进照样被拦，责任归属不混）。
    if (REPORT_VALIDITY_CHECK_IDS.has(c.id)) continue;
    let axis = capabilityAxisByCheckId.get(c.id) ?? mapCheckToAxis(c.id);
    // 安全网：FAIL 绝不落进 inapplicable 轴而消失——重映射 functional
    if (!applicableOf[axis]) axis = 'functional';
    const b = buckets[axis];
    b.sources.push(c.id);
    if (c.status !== 'SKIP') b.executed++;
    if (c.status === 'FAIL' && c.severity === 'BLOCKER') {
      if (allBlockerFailsExternal) b.externalFails.push(c);
      else b.hardFails.push(c);
    }
  }

  const phase = String(opts.phase);
  const axes = {} as QualityAxes;
  for (const id of AXIS_IDS) {
    const b = buckets[id];
    let applicable = applicableOf[id];
    // evidence 轴数据驱动降解：无任何映射 check 或全 SKIP（能力被 profile 关闭/该 phase 无证据面）
    // → NOT_APPLICABLE，不制造假 UNVERIFIED（对齐"勿造假分母"纪律）。
    if (id === 'evidence' && applicable && b.executed === 0 && b.hardFails.length === 0) {
      applicable = false;
    }

    let verdict: AxisVerdict;
    let resolution: AxisResolution | null = null;
    if (!applicable) {
      verdict = 'NOT_APPLICABLE';
    } else if (b.hardFails.length > 0) {
      verdict = 'FAIL';
      resolution = { class: 'needs_fix', owner: 'agent', retry_phase: phase };
    } else if (b.externalFails.length > 0) {
      verdict = 'UNVERIFIED';
      resolution = { class: 'external_dependency', owner: 'external', retry_phase: phase };
    } else if (b.executed === 0) {
      // 轴 applicable 但本 phase 零执行（如 spec 期 functional 测试未运行、
      // 盲档下 visual 检查整体 SKIP）——如实 UNVERIFIED。
      verdict = 'UNVERIFIED';
      resolution = { class: 'needs_fix', owner: 'agent', retry_phase: phase };
    } else {
      verdict = 'PASS';
    }

    axes[id] = {
      applicable,
      required_for_release: projectAxisRequiredForRelease(id, applicable),
      verdict,
      blocking_class: resolution?.class ?? null,
      source_checks: [...new Set(b.sources)].sort(),
      resolution,
    };
  }
  return axes;
}

// ---------------------------------------------------------------------------
// S7（visual-capability-truth P2-J.2）：asset 轴带 provenance 继承——testing 期无本阶段
// asset 检查时，继承的是**证据引用**而非裸 verdict 复制：五指纹（source summary hash /
// source&build fingerprint / gate fingerprint / inventory hash / debt revision）由调用方
// I/O 判定一致性；任一漂移 → STALE/needs_fix，不得复制上游 PASS。
// ---------------------------------------------------------------------------

export interface AssetAxisInheritance {
  upstreamPhase: string;
  upstreamVerdict: AxisVerdict;
  /** 调用方判定的五指纹一致性（任一漂移=false） */
  provenanceIntact: boolean;
  provenanceDetail: string;
  /** 证据引用（coding summary hash / inventory hash / debt revision 等） */
  evidenceRefs: string[];
}

export function applyAssetAxisInheritance(axes: QualityAxes, inh: AssetAxisInheritance): void {
  const a = axes.asset;
  // 只接管「applicable 但本阶段零 asset 检查」的 UNVERIFIED（有本阶段检查时以本阶段为准）
  if (!a.applicable || a.verdict !== 'UNVERIFIED' || a.source_checks.length > 0) return;
  if (inh.provenanceIntact && inh.upstreamVerdict === 'PASS') {
    axes.asset = {
      ...a,
      verdict: 'PASS',
      blocking_class: null,
      resolution: null,
      source_checks: inh.evidenceRefs.map(r => `inherited:${inh.upstreamPhase}:${r}`).sort(),
    };
    return;
  }
  axes.asset = {
    ...a,
    verdict: 'STALE',
    blocking_class: 'needs_fix',
    resolution: { class: 'needs_fix', owner: 'agent', retry_phase: inh.upstreamPhase },
    source_checks: [`stale_inheritance:${inh.upstreamPhase}:${inh.provenanceDetail}`],
  };
}

export function deriveReportValidity(checks: CheckLike[]): ReportValidity {
  let executed = 0;
  for (const c of checks) {
    if (!REPORT_VALIDITY_CHECK_IDS.has(c.id)) continue;
    if (c.status === 'SKIP') continue;
    executed++;
    if (c.status === 'FAIL') return 'FAIL';
  }
  return executed > 0 ? 'PASS' : 'UNVERIFIED';
}

// ---------------------------------------------------------------------------
// 投影（唯一解析器——消费方不得各自从轴另算一套）
// ---------------------------------------------------------------------------

export function projectPhaseAdvanceVerdict(
  axes: QualityAxes,
  phase: string,
  reportValidity: ReportValidity = 'PASS',
): 'PASS' | 'FAIL' | 'INCOMPLETE' {
  // 报告工件坏了 → phase 不可闭合（阻断保留，但责任在 report_validity 不在产品轴——P2-7）
  if (reportValidity === 'FAIL') return 'FAIL';
  for (const id of AXIS_IDS) {
    const a = axes[id];
    if (a.applicable && a.verdict === 'FAIL') return 'FAIL';
  }
  for (const id of AXIS_IDS) {
    const a = axes[id];
    if (!a.applicable) continue;
    if (a.verdict === 'UNVERIFIED' && ADVANCE_UNVERIFIED_BLOCKING[id](phase)) return 'INCOMPLETE';
  }
  return 'PASS';
}

export function projectReleaseReadiness(axes: QualityAxes): ReleaseReadiness {
  for (const id of AXIS_IDS) {
    const a = axes[id];
    if (!a.applicable || !a.required_for_release) continue;
    if (a.verdict !== 'PASS') return 'BLOCKED';
  }
  return 'READY';
}

/** completion 投影标签（仅标签——不构成状态机；当前负面态走 needs_fix/external_dependency） */
export function projectCompletionStatus(axes: QualityAxes): string {
  const anyFail = AXIS_IDS.some(id => axes[id].applicable && axes[id].verdict === 'FAIL');
  if (anyFail) return 'INCOMPLETE';
  const visualPending =
    (axes.visual.applicable && axes.visual.verdict !== 'PASS') ||
    (axes.asset.applicable && axes.asset.verdict !== 'PASS');
  if (visualPending) return 'FUNCTIONALLY_COMPLETE_VISUAL_PENDING';
  if (axes.evidence.applicable && axes.evidence.verdict !== 'PASS') return 'EVIDENCE_PENDING';
  if (axes.functional.verdict !== 'PASS') return 'FUNCTIONAL_PENDING';
  return 'COMPLETE';
}

/**
 * A capability report is a pre-check fact. Authorized pruning remains visible in
 * assurance/report/assess provenance, while only blocked capabilities tighten the
 * quality lattice and make PASS closure impossible.
 */
export function applyCapabilityResolutionProjection(
  axes: QualityAxes,
  report: Pick<CapabilityResolutionReport, 'capabilities'> | undefined,
  phase: string,
): { hasBlocked: boolean } {
  if (!report) return { hasBlocked: false };
  let hasBlocked = false;
  for (const capability of report.capabilities) {
    if (!capability.active || capability.state !== 'blocked') continue;
    const axis = axes[capability.axis];
    const resolution: AxisResolution = { class: 'needs_fix', owner: 'agent', retry_phase: phase };
    // review P1：capability 投影**不得**把既有 FAIL 降成 UNVERIFIED——axis 已 FAIL 时保留其
    // verdict/blocking_class/resolution，只追加 capability source（否则顶层被 runner 救回 FAIL 而
    // axis 却是 UNVERIFIED，形成分裂）。非 FAIL 轴才投影为 UNVERIFIED（blocked → 阻断）。
    const alreadyFail = axis.verdict === 'FAIL';
    axes[capability.axis] = {
      ...axis,
      applicable: true,
      required_for_release: true,
      ...(alreadyFail ? {} : { verdict: 'UNVERIFIED' as const, blocking_class: resolution.class, resolution }),
      source_checks: [...new Set([...axis.source_checks, `capability:${capability.id}`])].sort(),
    };
    hasBlocked = true;
  }
  return { hasBlocked };
}

/**
 * plan c8e5b3f1 t2 B：顶层 verdict 的因果归因纯函数——runner 与单测共用（评审：裁决逻辑不应埋在
 * runner 内联，且须有守门测试）。规则：
 *   · post===legacy → verdict=legacy；mismatch 仍按 pre!==legacy 判定（独立派生缺陷照报）；
 *   · post!==legacy → verdict 取**更严一侧**（FAIL > INCOMPLETE > PASS）——capability 投影只能收紧
 *     （PASS→INCOMPLETE），不得把既有 FAIL 降成 INCOMPLETE；
 *   · mismatch = pre!==legacy（独立派生缺陷照报；pre===legacy 的 capability 合法投影不报）。
 */
export function resolveEffectiveVerdict(input: {
  pre: 'PASS' | 'FAIL' | 'INCOMPLETE';
  post: 'PASS' | 'FAIL' | 'INCOMPLETE';
  legacy: 'PASS' | 'FAIL' | 'INCOMPLETE';
}): { verdict: 'PASS' | 'FAIL' | 'INCOMPLETE'; mismatch: boolean } {
  // review：post===legacy 时 verdict 就是 legacy，但 mismatch 仍须按 pre!==legacy 判定——
  // pre!==legacy 属独立派生缺陷，即使最终 verdict 未变也要报告（如 pre=PASS/post=INCOMPLETE/legacy=INCOMPLETE）。
  if (input.post === input.legacy) return { verdict: input.legacy, mismatch: input.pre !== input.legacy };
  const strictness: Record<string, number> = { FAIL: 2, INCOMPLETE: 1, PASS: 0 };
  const stricter = strictness[input.post] > strictness[input.legacy] ? input.post : input.legacy;
  return { verdict: stricter, mismatch: input.pre !== input.legacy };
}

export function deriveSummaryVerdictLattice(
  checks: CheckLike[],
  opts: DeriveAxesOptions,
  capabilityReport?: Pick<CapabilityResolutionReport, 'capabilities'>,
): VerdictLattice {
  const quality_axes = deriveQualityAxes(checks, opts, capabilityReport);
  const report_validity = deriveReportValidity(checks);
  // plan c8e5b3f1 t2：手动投影以暴露 pre/rawPost/post 供因果归因——projectPhaseAdvanceVerdict 纯函数、
  // applyCapabilityResolutionProjection 原地改 axes，前后各调一次即得标量；post 必须含 hasBlocked 顶层
  // 钳制（visual/asset blocked 依赖它，否则会被误判）。
  const pre = projectPhaseAdvanceVerdict(quality_axes, String(opts.phase), report_validity);
  const { hasBlocked } = applyCapabilityResolutionProjection(quality_axes, capabilityReport, String(opts.phase));
  const rawPost = projectPhaseAdvanceVerdict(quality_axes, String(opts.phase), report_validity);
  const post = hasBlocked && rawPost === 'PASS' ? 'INCOMPLETE' : rawPost;
  return {
    report_validity,
    quality_axes,
    pre_projection_verdict: pre,
    projected_verdict: post,
    has_blocked: hasBlocked,
    release_readiness: hasBlocked ? 'BLOCKED' : projectReleaseReadiness(quality_axes),
    completion_status: hasBlocked ? 'INCOMPLETE' : projectCompletionStatus(quality_axes),
  };
}

// ---------------------------------------------------------------------------
// schema 不变量（codex 三轮①）：机器校验，消费外部（含 legacy/篡改）输入时使用
// ---------------------------------------------------------------------------

const NEGATIVE_VERDICTS = new Set<AxisVerdict>(['FAIL', 'UNVERIFIED', 'STALE', 'MISSING']);

/**
 * summary 1.1 完整契约校验——**唯一权威**（codex 三轮 P1-4：lite schema 无条件 required，
 * 各消费方只验局部会碎片化）。writer 落盘前 fail-fast 调用；verify-feature-completion 与
 * upstream-verdict-gate 消费 1.1 时统一调用。校验面：四字段 presence + 枚举 + 轴不变量。
 */
export function validateSummaryV11(summary: unknown): string[] {
  if (!summary || typeof summary !== 'object') return ['summary 非对象'];
  const s = summary as Record<string, unknown>;
  // 责任阶段统一路由（plan b6e4c9f2）：repair_candidates 可选字段——存在即须形状合法
  const rcErrors = validateRepairCandidatesShape(s.repair_candidates);
  if (rcErrors.length > 0) return rcErrors;
  if (s.schema_version !== '1.1' && s.schema_version !== '1.2') {
    return [`schema_version=${String(s.schema_version)} 非 1.1/1.2`];
  }
  const errors: string[] = [];
  if (s.report_validity !== 'PASS' && s.report_validity !== 'FAIL' && s.report_validity !== 'UNVERIFIED') {
    errors.push(`report_validity 缺失/非法（${String(s.report_validity)}）`);
  }
  if (s.release_readiness !== 'READY' && s.release_readiness !== 'BLOCKED') {
    errors.push(`release_readiness 缺失/非法（${String(s.release_readiness)}）`);
  }
  if (typeof s.completion_status !== 'string' || s.completion_status.trim().length === 0) {
    errors.push('completion_status 缺失/空');
  }
  if (s.quality_axes == null) errors.push('quality_axes 缺失');
  else errors.push(...validateQualityAxes(s.quality_axes));
  if (s.schema_version === '1.2') {
    if (typeof s.assurance !== 'string' || !['blocked', 'degraded', 'full', 'not_applicable'].includes(s.assurance)) {
      errors.push('assurance 缺失/非法');
    }
    if (!Array.isArray(s.capability_resolutions)) errors.push('capability_resolutions 缺失/非法');
    if (typeof s.capability_resolution_contract_fingerprint !== 'string' && s.capability_resolution_contract_fingerprint !== null) {
      errors.push('capability_resolution_contract_fingerprint 缺失/非法');
    }
    if (s.closure_status !== 'open' && s.closure_status !== 'closed') {
      errors.push(`closure_status 缺失/非法（${String(s.closure_status)}）`);
    }
  }
  return errors;
}

const AXIS_VERDICT_ENUM = new Set<string>(['PASS', 'FAIL', 'UNVERIFIED', 'STALE', 'MISSING', 'NOT_APPLICABLE']);
const BLOCKING_CLASS_ENUM = new Set<string>(['needs_fix', 'needs_human', 'external_dependency']);
const RESOLUTION_OWNER_ENUM = new Set<string>(['agent', 'human', 'toolchain', 'external']);
const AXIS_FIELD_SET = new Set<string>(['applicable', 'required_for_release', 'verdict', 'blocking_class', 'source_checks', 'resolution']);

/**
 * 全字段严格校验（codex 四轮 P0-2：{} 空轴对象曾通过——applicable≠false 跳过不变量、
 * verdict undefined 不进任何分支、消费端 applicable!==true 再全跳=半 lattice 绕过）。
 * 每字段类型+枚举强制；未知轴/未知字段拒绝。
 */
export function validateQualityAxes(value: unknown): string[] {
  const errors: string[] = [];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return ['quality_axes 须为对象'];
  }
  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!(AXIS_IDS as readonly string[]).includes(key)) errors.push(`未知轴 ${key}`);
  }
  for (const id of AXIS_IDS) {
    const a = obj[id] as Partial<QualityAxis> | undefined;
    if (!a || typeof a !== 'object' || Array.isArray(a)) {
      errors.push(`缺轴 ${id}`);
      continue;
    }
    for (const f of Object.keys(a)) {
      if (!AXIS_FIELD_SET.has(f)) errors.push(`${id}: 未知字段 ${f}`);
    }
    // 键在场性（codex 五轮 P1-4：schema required 声明六键存在——`!= null` 曾放行整键省略）
    for (const f of AXIS_FIELD_SET) {
      if (!Object.prototype.hasOwnProperty.call(a, f)) errors.push(`${id}: 缺必填键 ${f}`);
    }
    // 基础字段类型+枚举（{} 空对象在此全数落网）
    if (typeof a.applicable !== 'boolean') errors.push(`${id}: applicable 须为 boolean`);
    if (typeof a.required_for_release !== 'boolean') errors.push(`${id}: required_for_release 须为 boolean`);
    if (typeof a.verdict !== 'string' || !AXIS_VERDICT_ENUM.has(a.verdict)) {
      errors.push(`${id}: verdict 缺失/非法（${String(a.verdict)}）`);
    }
    if (a.blocking_class != null && !BLOCKING_CLASS_ENUM.has(String(a.blocking_class))) {
      errors.push(`${id}: blocking_class 非法（${String(a.blocking_class)}）`);
    }
    if (!Array.isArray(a.source_checks) || a.source_checks.some(s => typeof s !== 'string')) {
      errors.push(`${id}: source_checks 须为字符串数组`);
    }
    if (a.resolution != null) {
      const r = a.resolution as Partial<AxisResolution>;
      if (typeof r !== 'object' || Array.isArray(r)) errors.push(`${id}: resolution 须为对象或 null`);
      else {
        for (const rf of Object.keys(r)) {
          if (rf !== 'class' && rf !== 'owner' && rf !== 'retry_phase') {
            errors.push(`${id}: resolution 未知字段 ${rf}`);
          }
        }
        if (!BLOCKING_CLASS_ENUM.has(String(r.class))) errors.push(`${id}: resolution.class 非法（${String(r.class)}）`);
        if (!RESOLUTION_OWNER_ENUM.has(String(r.owner))) errors.push(`${id}: resolution.owner 非法（${String(r.owner)}）`);
        if (r.retry_phase !== null && typeof r.retry_phase !== 'string') {
          errors.push(`${id}: resolution.retry_phase 须为 string|null`);
        }
        // 一致性：blocking_class 是 resolution.class 的投影，两处必须同值
        if (a.blocking_class !== r.class) {
          errors.push(`${id}: blocking_class(${String(a.blocking_class)}) ≠ resolution.class(${String(r.class)})`);
        }
      }
    } else if (Object.prototype.hasOwnProperty.call(a, 'resolution') && a.blocking_class != null) {
      errors.push(`${id}: resolution=null ⇒ blocking_class 须为 null`);
    }
    // 交叉不变量（原有三条）
    if (a.applicable === false) {
      if (a.verdict !== 'NOT_APPLICABLE') errors.push(`${id}: applicable=false ⇒ verdict 须为 NOT_APPLICABLE`);
      if (a.required_for_release !== false) errors.push(`${id}: applicable=false ⇒ required_for_release 须为 false`);
      if (a.blocking_class != null) errors.push(`${id}: applicable=false ⇒ blocking_class 须为 null`);
    }
    if (a.verdict === 'PASS' || a.verdict === 'NOT_APPLICABLE') {
      if (a.resolution != null) errors.push(`${id}: verdict=${a.verdict} ⇒ resolution 须为 null`);
    }
    if (typeof a.verdict === 'string' && NEGATIVE_VERDICTS.has(a.verdict as AxisVerdict)) {
      if (!a.resolution || typeof a.resolution !== 'object') {
        errors.push(`${id}: verdict=${a.verdict} ⇒ resolution 必填`);
      }
    }
  }
  return errors;
}

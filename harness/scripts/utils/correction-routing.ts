// ============================================================================
// correction-routing.ts — 中途 NL 修正的归属与分层（C5-min correction-routing，
// plan d4a7c1e8）
// ============================================================================
// 修正三问（SSOT：AGENTS.md.template §4.0 修正三问 / OpenSpec correction-routing）：
//   Q1 需求/验收本身变了？        → spec 层
//   Q2 需求没变，接口/契约/设计变？ → plan 层
//   Q3 上游都没错——要改产品代码？  → 是=coding；否（纯补验证）= verification
// 本模块只做**确定性判定**（纯函数）：答案由 agent/用户经 `correction.layer` gate
// 给出；层→phase 的映射按 feature track 投影（lite 的 spec/plan 职能由 change.md
// 承载 → change phase；verification → exit）。
// 重验≠重做：revalidate = 落点 phase + 其下游**已闭环** phase 的脚本门禁。

import type { WorkflowSpec } from '../../workflow-loader';
import { resolvePhaseChain, type FeatureTrack } from './runtime-policy';

// --------------------------------------------------------------------------
// 三问 → 根因类别
// --------------------------------------------------------------------------

/** 修正三问的答案（gate 确认后的事实输入） */
export interface CorrectionAnswers {
  /** Q1 需求/验收本身变了 */
  requirement_changed: boolean;
  /** Q2 接口/契约/设计要变 */
  contract_changed: boolean;
  /** Q3 要改产品代码 */
  code_change_needed: boolean;
}

/** 与 phase 解耦的根因类别（track 投影前的中间态） */
export type CorrectionCategory = 'spec' | 'plan' | 'coding' | 'verification';

/** 三问按序短路：Q1 > Q2 > Q3 > 纯验证。 */
export function resolveCorrectionCategory(a: CorrectionAnswers): CorrectionCategory {
  if (a.requirement_changed) return 'spec';
  if (a.contract_changed) return 'plan';
  if (a.code_change_needed) return 'coding';
  return 'verification';
}

/** 三问的全部"是"类别（组合修正：改 spec 同轮把代码修到新契约 → touched 含 coding）。 */
export function touchedCategories(a: CorrectionAnswers): CorrectionCategory[] {
  const out: CorrectionCategory[] = [];
  if (a.requirement_changed) out.push('spec');
  if (a.contract_changed) out.push('plan');
  if (a.code_change_needed) out.push('coding');
  if (out.length === 0) out.push('verification');
  return out;
}

// --------------------------------------------------------------------------
// 类别 → phase（track 投影）
// --------------------------------------------------------------------------

/**
 * 把根因类别投影到当前 track 的 phase。full：spec/plan/coding 同名，verification→ut；
 * lite：spec/plan 职能由 change.md 承载 → change，verification→exit。
 * 投影结果不在该 track 链内时回退链首（防 workflow 自定义链缺 phase 时产出幽灵 phase）。
 */
export function mapCategoryToPhase(
  category: CorrectionCategory,
  spec: WorkflowSpec,
  track: FeatureTrack,
): string {
  const chain = resolvePhaseChain(spec, track).featureOrdered;
  const preferred: Record<CorrectionCategory, string[]> =
    track === 'lite'
      ? { spec: ['change'], plan: ['change'], coding: ['coding'], verification: ['exit'] }
      : { spec: ['spec'], plan: ['plan'], coding: ['coding'], verification: ['ut', 'testing'] };
  for (const p of preferred[category]) {
    if (chain.includes(p)) return p;
  }
  return chain[0];
}

// --------------------------------------------------------------------------
// 分类主函数
// --------------------------------------------------------------------------

export interface RevalidateEntry {
  phase: string;
  status: 'pending' | 'done';
}

export interface CorrectionClassification {
  /** 根因层（phase id，已按 track 投影） */
  root_layer: string;
  /** 声明触及的层（phase id 去重，按链序） */
  touched_layers: string[];
  /** 级联重验清单：根因 phase + 其下游**已闭环** phase */
  revalidate: RevalidateEntry[];
}

/**
 * classifyCorrection：三问答案 + workflow/track + 已闭环 phase 集 → 分层与重验清单。
 * `closedPhases` 由调用方注入（receipt / script-report 存在性）——保持纯函数可测。
 * 根因 phase 恒在 revalidate 内（无论是否闭环过：修正后该层门禁必须绿）。
 */
export function classifyCorrection(input: {
  answers: CorrectionAnswers;
  spec: WorkflowSpec;
  track: FeatureTrack;
  closedPhases: readonly string[];
}): CorrectionClassification {
  const { answers, spec, track, closedPhases } = input;
  const chain = resolvePhaseChain(spec, track).featureOrdered;
  const rootLayer = mapCategoryToPhase(resolveCorrectionCategory(answers), spec, track);

  const touchedSet = new Set(touchedCategories(answers).map((c) => mapCategoryToPhase(c, spec, track)));
  const touched = chain.filter((p) => touchedSet.has(p));

  const rootIdx = chain.indexOf(rootLayer);
  const closed = new Set(closedPhases);
  const revalidate: RevalidateEntry[] = chain
    .filter((p, i) => i === rootIdx || (i > rootIdx && closed.has(p)))
    .map((p) => ({ phase: p, status: 'pending' as const }));

  return { root_layer: rootLayer, touched_layers: touched, revalidate };
}

// --------------------------------------------------------------------------
// 归属（编辑前）
// --------------------------------------------------------------------------

export type CorrectionTarget =
  | { kind: 'feature'; feature: string }
  | { kind: 'no_feature' }
  | { kind: 'ask_user'; reason: string };

/**
 * resolveCorrectionTarget：修正归属判定（**编辑前**执行）。
 *   1. 用户点名 feature 且目录存在 → 归属该 feature；点名但不存在 → 问人（禁止猜）。
 *   2. 未点名但 .current-phase.json 有活跃 feature → 归属之。
 *   3. 都没有 → no_feature 模式（--adhoc-correction 载体，不建临时假 feature 目录）。
 */
export function resolveCorrectionTarget(input: {
  requestedFeature?: string | null;
  activeStateFeature?: string | null;
  featureDirExists: (feature: string) => boolean;
}): CorrectionTarget {
  const requested = input.requestedFeature?.trim();
  if (requested) {
    if (input.featureDirExists(requested)) return { kind: 'feature', feature: requested };
    return {
      kind: 'ask_user',
      reason: `点名的 feature "${requested}" 目录不存在——请确认 feature 名，禁止按相近名猜测归属`,
    };
  }
  const active = input.activeStateFeature?.trim();
  if (active && input.featureDirExists(active)) {
    return { kind: 'feature', feature: active };
  }
  return { kind: 'no_feature' };
}

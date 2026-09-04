// ============================================================================
// hylyre-selector-gates-v1.ts — v1 selector runtime gate（plan a6c4e9f2 D1 / T2 运行时）
// ----------------------------------------------------------------------------
// 与 0.3-p0 版的三处根本差别：
//
// 1. **成败不由这里裁决**。步骤成败读 `outcome`+`observation`；本门只消费
//    `selector.resolution` 的**身份事实**与**否定证据**。旧版把
//    `unique && candidate_count=1 && selected.id` 当成所有 selector 成功的统一硬条件，
//    在冻结包 §6.1 下会**误杀整片 by_text**——native provider 侧解析时身份对执行器
//    不可见，合法形态就是 `passed + resolution=not_attempted`。
//
// 2. **不做封闭世界**。旧版有一条「canonical ui-spec 映射为空即失败」分支，会把
//    "不在 feature ui-spec 却被真机唯一命中"的既有入口判失败——那正是事故里静态门
//    误杀入口之后、运行时又补一刀的地方。feature ui-spec 是开放世界，miss 只是 WARN。
//
// 3. **不按 request.kind 写固定旁路**。语义取决于执行路径：resolver 自己解析到文本节点时
//    `by_text` 同样可以是 `unique`（`selected.id=null` + `bounds` 非空合法）。
//
// 身份护栏：P0 checkpoint 的 required/forbidden 身份证据必须由 `by_id` 断言承载；
// `by_text` 的 observation 成功不得替代身份证明（`required_element_ids` 本就是 id）。
// 本模块提供 `provenIdentitiesByCase` 供 P0 语义门消费，未证明的身份**保持未证明**，
// 但绝不因此改判原 StepResult 的 outcome。
// ============================================================================

import {
  evaluateSelectorIdentity,
  type SelectorSelectedV1,
  type StepResultV1,
  type TraceV1,
} from './hylyre-result-protocol';

export interface SelectorRuntimeViolationV1 {
  caseId: string;
  stepIndex: number;
  /** 冻结契约的状态机违例 / 回填冒充身份；不含"成败"判定 */
  code: 'resolution_invariant_violated' | 'identity_impersonated';
  message: string;
}

export interface SelectorRuntimeResultV1 {
  violations: SelectorRuntimeViolationV1[];
  /** case → 该 case 内**已证明**的实际选中身份（仅来自 state=unique 的合法 resolution） */
  provenIdentitiesByCase: Map<string, Array<{ stepIndex: number; identity: SelectorSelectedV1 }>>;
}

function isImpersonation(message: string): boolean {
  // plan 07a41ec6 T2：判词已改成"回显了 request.value…不构成身份证据"（形状问题，不是执行器造假），
  // 分类码保留 identity_impersonated 供既有消费者，匹配同时认旧词"回填"与新词"回显"。
  return /回填|回显/.test(message);
}

/**
 * 只做两件事：① 复算 resolution 状态机不变量并揪出回填冒充；
 * ② 汇总**已证明**的选中身份，供 P0 身份护栏消费。
 * 任何情况下都不改判步骤成败。
 */
export function evaluateSelectorRuntimeV1(trace: TraceV1): SelectorRuntimeResultV1 {
  const violations: SelectorRuntimeViolationV1[] = [];
  const provenIdentitiesByCase = new Map<string, Array<{ stepIndex: number; identity: SelectorSelectedV1 }>>();

  for (const traceCase of trace.cases ?? []) {
    const caseId = (traceCase.id ?? '').toUpperCase();
    const proven: Array<{ stepIndex: number; identity: SelectorSelectedV1 }> = [];
    for (const step of (traceCase.steps ?? []) as StepResultV1[]) {
      if (!step.selector) continue; // 无 selector 的 operation（back/home/wait 等）
      const verdict = evaluateSelectorIdentity(step.selector);
      if (verdict.kind === 'invalid') {
        violations.push({
          caseId,
          stepIndex: step.index,
          code: isImpersonation(verdict.detail) ? 'identity_impersonated' : 'resolution_invariant_violated',
          message: verdict.detail,
        });
        continue;
      }
      if (verdict.kind === 'proven') proven.push({ stepIndex: step.index, identity: verdict.identity });
      // unproven：合法但无身份证据——不记违规，也不进 proven（身份保持未证明）
    }
    if (proven.length > 0) provenIdentitiesByCase.set(caseId, proven);
  }
  return { violations, provenIdentitiesByCase };
}

/**
 * 身份护栏：某 case 是否**已证明**选中过给定 canonical target id。
 * 只认 `state=unique` 且 `selected.id` 非空的结构化身份——
 * `by_text` 的 observation 成功、`not_attempted`、`bounds`-only 命中都不算身份证明。
 */
export function hasProvenIdentity(
  result: SelectorRuntimeResultV1,
  caseId: string,
  targetElementId: string,
): boolean {
  const proven = result.provenIdentitiesByCase.get(caseId.toUpperCase()) ?? [];
  return proven.some(entry => entry.identity.id === targetElementId);
}

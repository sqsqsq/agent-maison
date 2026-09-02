// ============================================================================
// hylyre-failure-routing-v1.ts — Step Outcome v1 的责任路由与 disposition 投影
// ----------------------------------------------------------------------------
// plan a6c4e9f2 T4（D3 根治）。事故形态：0.3-p0 的 collector 只排除 status=passed，
// 于是把「1 个真实 failed + N 个继承根因的 blocked + 1 个 policy skipped」全部再造成
// 独立 failure route——一次 run 产出 56 selector + 14 capability 共 70 个 BLOCKER，
// 让 capability defer、报告 blocker 数、repair 预算与责任统计同时失真。
//
// v1 的基数不变式（本模块的全部职责）：
//   · 每个**实际尝试且实际失败**的 step ⇒ 恰好 1 条 failure route；
//   · 未尝试的 blocked/skipped ⇒ **0** route、0 owner、0 coding candidate；
//     它们只解释因果，且**不得继承**根失败的分类；
//   · 机器证明的 blocked capability/infrastructure 根 ⇒ 0 route + **1** 次
//     defer/external disposition，按 case/index/cause 去重；
//   · `blocked/prior_step` 恒 0 route / 0 disposition，且**不按被引用次数**重复投影
//     （Q8 已裁决：prior_step 可引用同 case 内任意更早的 eligible root，不要求最近根，
//     故"选了哪个合法根"不影响任何投影基数）；
//   · 同 case 多个真实 failed ⇒ 各自一条 route，不做 first-only 去重。
//
// 另一条准入（wrong-screen 防线）：`assertion.mismatch` 只有在同 case 存在**较小 index
// 且实际 passed 的 action** 时才可 codingCandidate=true；否则留 testing、零 coding。
// 不从 diagnostic/precondition 猜屏幕状态。
// ============================================================================

import type {
  CaseResultV1,
  FailureDomainV1,
  StepResultV1,
  TraceV1,
} from './hylyre-result-protocol';

export type FailureOwnerV1 = 'coding' | 'testing' | 'capability' | 'external' | 'spec_plan';
export type RepairCategoryV1 = 'coding' | 'spec' | 'plan';

export interface FailureRouteV1 {
  caseId: string;
  stepIndex: number;
  domain: FailureDomainV1;
  /** namespaced code，仅用于说明，不作路由判据 */
  code: string;
  owner: FailureOwnerV1;
  codingCandidate: boolean;
  repairCategory?: RepairCategoryV1;
  /** failed/capability 与 failed/infrastructure 的 route 自带 disposition */
  disposition?: 'capability_defer' | 'external_toolchain';
  reason: string;
}

export interface CauseDispositionV1 {
  caseId: string;
  stepIndex: number;
  causeType: 'capability' | 'infrastructure';
  code: string;
  disposition: 'capability_defer' | 'external_toolchain';
  reason: string;
}

export interface RoutingResultV1 {
  routes: FailureRouteV1[];
  dispositions: CauseDispositionV1[];
}

/** 同 case 内是否存在较小 index 且实际 passed 的 action（wrong-screen 准入的唯一判据）。 */
export function hasPassedActionBefore(steps: StepResultV1[], index: number): boolean {
  return steps.some(
    step => step.index < index && step.role === 'action' && step.outcome.status === 'passed',
  );
}

/**
 * 单条**已失败**步骤的责任路由。只接受 `outcome.status=failed`——非 failed 输入是调用方
 * 的编程错误，生产 collector 不会传入（保留抛错以便测试边界立刻暴露）。
 */
export function routeFailedStepV1(
  caseId: string,
  step: StepResultV1,
  caseSteps: StepResultV1[],
): FailureRouteV1 {
  if (step.outcome.status !== 'failed') {
    throw new Error(
      `routeFailedStepV1 只消费 outcome.status=failed，收到 ${step.outcome.status}` +
      `（${caseId}#${step.index}）——未尝试的 blocked/skipped 不得进入责任路由`,
    );
  }
  const { domain, code } = step.outcome.failure;
  const base = { caseId, stepIndex: step.index, domain, code };

  switch (domain) {
    case 'assertion': {
      // wrong-screen 防线：没有同 case 较小 index 的 passed action，就不能断言"页面已到位、
      // 是产品渲染错了"。TC-015 正是这种：入口被跳过，首断言在首页求值。
      const admitted = hasPassedActionBefore(caseSteps, step.index);
      return {
        ...base,
        owner: admitted ? 'coding' : 'testing',
        codingCandidate: admitted,
        ...(admitted ? { repairCategory: 'coding' as const } : {}),
        reason: admitted
          ? '已执行 assertion 失败，且同 case 较小 index 有已通过 action：进入 coding/product candidate'
          : '同 case 无较小 index 的已通过 action，无法证明断言在目标页求值：留 testing、零 coding',
      };
    }
    case 'selector':
      return {
        ...base,
        owner: 'testing',
        codingCandidate: false,
        reason: 'selector 失败：testing 先重派生/补消歧，不投 coding',
      };
    case 'capability':
      return {
        ...base,
        owner: 'capability',
        codingCandidate: false,
        disposition: 'capability_defer',
        reason: '已尝试后能力不可用：该 failed route 的 disposition 为 capability defer，零 coding',
      };
    case 'infrastructure':
      return {
        ...base,
        owner: 'external',
        codingCandidate: false,
        disposition: 'external_toolchain',
        reason: '已尝试后设备/传输失败：走 external/toolchain disposition',
      };
    case 'contract':
      return {
        ...base,
        owner: 'testing',
        codingCandidate: false,
        reason: '计划契约违例：由 testing 修计划，不投 coding',
      };
    case 'internal':
    default:
      return {
        ...base,
        owner: 'testing',
        codingCandidate: false,
        reason: '执行器内部异常：testing fail-closed，不按 diagnostic 猜产品缺陷',
      };
  }
}

/**
 * 全 trace 的路由与 disposition 投影。
 * 未尝试的行只用于**解释**，不产生任何 route/owner/candidate/disposition——
 * 唯一例外是"机器证明的 blocked capability/infrastructure 根"，它投影一次既有 disposition。
 */
export function collectFailureRoutesV1(trace: TraceV1): RoutingResultV1 {
  const routes: FailureRouteV1[] = [];
  const dispositions: CauseDispositionV1[] = [];
  const seenDisposition = new Set<string>();

  for (const traceCase of trace.cases ?? []) {
    const caseId = (traceCase.id ?? '').toUpperCase();
    const steps = Array.isArray(traceCase.steps) ? traceCase.steps : [];
    for (const step of steps) {
      const outcome = step.outcome;
      if (outcome.status === 'failed') {
        routes.push(routeFailedStepV1(caseId, step, steps));
        continue;
      }
      if (outcome.status !== 'blocked') continue; // passed / skipped：零投影
      const cause = outcome.cause;
      // prior_step 是账本完整性，不是新的责任事实——被引用多少次都不投影。
      if (cause.type !== 'capability' && cause.type !== 'infrastructure') continue;
      // 机器事实缺失（只有 diagnostic 散文）时不得驱动 defer（冻结契约 §5.2）。
      if (!cause.facts || !cause.code) continue;
      const key = `${caseId}#${step.index}#${cause.type}#${cause.code}`;
      if (seenDisposition.has(key)) continue;
      seenDisposition.add(key);
      dispositions.push({
        caseId,
        stepIndex: step.index,
        causeType: cause.type,
        code: cause.code,
        disposition: cause.type === 'capability' ? 'capability_defer' : 'external_toolchain',
        reason: cause.type === 'capability'
          ? '执行前机器 probe 证明能力不可用：零 failure route，投一次 capability defer'
          : '执行前机器 probe 证明基础设施不可用：零 failure route，投一次 external/toolchain disposition',
      });
    }
  }
  return { routes, dispositions };
}

/**
 * 跨行不变量复算（Schema 表达不了，必须由消费侧验，否则等于没跑）。
 * Q8 裁决：`prior_step` 可引用同 case 内**任意**更早的 eligible real root，不要求最近根。
 */
export function verifyPriorStepReferences(traceCase: CaseResultV1): string[] {
  const problems: string[] = [];
  const steps = Array.isArray(traceCase.steps) ? traceCase.steps : [];
  const byIndex = new Map(steps.map(s => [s.index, s]));
  for (const step of steps) {
    if (step.outcome.status !== 'blocked') continue;
    const cause = step.outcome.cause;
    if (cause.type !== 'prior_step') continue;
    const target = typeof cause.step_index === 'number' ? byIndex.get(cause.step_index) : undefined;
    const where = `${traceCase.id}#${step.index}`;
    if (typeof cause.step_index !== 'number' || cause.step_index < 0) {
      problems.push(`${where}: prior_step 缺合法 step_index`);
      continue;
    }
    if (cause.step_index >= step.index) {
      problems.push(`${where}: prior_step 只能引用更小 index，实际引用 ${cause.step_index}`);
      continue;
    }
    if (!target) {
      problems.push(`${where}: prior_step 引用的 index ${cause.step_index} 不在同一 case（禁止跨 case 引用）`);
      continue;
    }
    const eligible =
      target.outcome.status === 'failed' ||
      (target.outcome.status === 'blocked' &&
        (target.outcome.cause.type === 'capability' || target.outcome.cause.type === 'infrastructure'));
    if (!eligible) {
      problems.push(
        `${where}: prior_step 必须指向真实根（failed 或 blocked/capability|infrastructure），` +
        `实际指向 ${target.outcome.status}` +
        (target.outcome.status === 'blocked' ? `/${target.outcome.cause.type}` : ''),
      );
    }
  }
  return problems;
}

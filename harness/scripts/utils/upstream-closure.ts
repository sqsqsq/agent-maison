// ============================================================================
// upstream-closure.ts — 上游阶段的**确定性关环**（plan b3e8d4c7 t2）
// ----------------------------------------------------------------------------
// 立项事故 run 20260804T033834Z-99c0a1（bc-openCard，无人值守）：
// coding 自身 PASS/closed，assess 却推荐 `complete_closure:plan`——而
// `selectRunnerActionFromAssess`（goal-assess-driver.ts）对 relation=earlier 只放行
// `backtrack_to_coding`，complete_closure 落**无条件 halt**。重试 coding 永远修不好
// plan 的闭环，却烧掉 coding 的内容重试预算，最后被标成 content_retry_exhausted/TERMINAL。
//
// 本模块只做一件事：**上游阶段的回执已经合法时，runner 自己把它关环**——
// 复用既有 tryValidateReceipt + finalizePhaseClosure（当前阶段本来就是这么关的），
// 不启动 agent、不消耗内容重试预算、不新增 PhaseVerdictAction。
//
// 顺序是硬约束（codex 五轮订正，勿调换）：
//
//   预算/fencing 检查
//   → tryValidateReceipt（非 passed → 按五态分派，不做 freshness 检查）
//   → passed 后**重算** freshness（stale → 诚实停止，绝不 rebound）
//   → fresh 才 finalizePhaseClosure
//   → 调用方重新 assess → 唯一 decideAndEmit()
//
// freshness 为何必须在 validator **之后**：validator 自己会经 soft_advisories 回写
// summary，先验 fresh 再跑 validator 等于白验——validator 把证据写 stale 后
// finalizePhaseClosure 的 evidence rebound 能力（phase-closure-finalizer.ts:331 起）
// 会把旧 PASS summary 重新绑定到新文件，制造假闭环。
// ============================================================================

import type { AssessRecommendation } from './assess';
import { recomputePhaseEvidenceStaleness } from './phase-evidence-manifest';
import { finalizePhaseClosure } from './phase-closure-finalizer';
import { tryValidateReceipt } from './phase-state';

/** 关环尝试的结果。`blocked` 携带**已定好的事故 id**，调用方不得再重新贴标签。 */
export type UpstreamClosureOutcome =
  /** 推荐不是 complete_closure:<更早阶段>，本模块不介入 */
  | { kind: 'skipped'; reason: string }
  /** 关环成功——调用方须**重新 assess** 后再决策 */
  | { kind: 'closed'; phase: string }
  /** 诚实停止：incident 已按 validator 五态/新鲜度分派好 */
  | { kind: 'blocked'; phase: string; incident: string; detail: string };

export interface UpstreamClosureInput {
  projectRoot: string;
  frameworkRoot: string;
  harnessRoot: string;
  feature: string;
  /** 当前正在跑的 phase（关环目标必须严格早于它） */
  currentPhase: string;
  chain: readonly string[];
  recommendation: AssessRecommendation;
  goalRunId: string;
  attemptId: string;
  /** 关环子进程的剩余预算（ms）；<=0 视为零预算，**调 validator 之前**即拦截 */
  remainingBudgetMs: number;
  /** owner fencing / closure mutex——finalize 之前调用，抛错即视为 blocked */
  fence?: () => void;
  /** 测试注入；缺省走真实 CLI */
  validate?: typeof tryValidateReceipt;
  /** 测试注入；缺省走真实 finalizer（其内部行为另有专测，本模块只验决策与顺序） */
  finalize?: typeof finalizePhaseClosure;
}

/**
 * 一次确定性关环尝试。**不循环**：同一 gap 第二次出现由调用方停止。
 */
export function tryCloseUpstreamPhase(input: UpstreamClosureInput): UpstreamClosureOutcome {
  const target = input.recommendation.phase;
  if (input.recommendation.action !== 'complete_closure' || !target) {
    return { kind: 'skipped', reason: '推荐不是 complete_closure' };
  }
  const targetIdx = input.chain.indexOf(target);
  const currentIdx = input.chain.indexOf(input.currentPhase);
  if (targetIdx < 0 || currentIdx < 0 || targetIdx >= currentIdx) {
    // 同阶段/更晚阶段的 complete_closure 走既有路径（retry/advance），本模块只管上游。
    return { kind: 'skipped', reason: `目标 ${target} 非当前阶段的上游` };
  }

  // ① 零预算：**调 validator 之前**拦截（validator 会 spawn 子进程，零预算下不该开工）
  if (!(input.remainingBudgetMs > 0)) {
    return {
      kind: 'blocked',
      phase: target,
      incident: 'budget_wall_clock',
      detail: `剩余预算不足（${input.remainingBudgetMs}ms），不启动上游关环探针`,
    };
  }

  // ② fence **先于 validator**——validator 已知会经 soft_advisories 回写 summary，
  // 失去 owner 的旧 runner 不得先写盘再被拒。fencing 失败**直接抛**，不伪装成上游内容缺口。
  input.fence?.();

  // ③ validator（非 passed 一律按五态分派，**不做 freshness 检查**）
  const validation = (input.validate ?? tryValidateReceipt)(
    input.harnessRoot,
    input.projectRoot,
    target,
    input.feature,
    {
      timeoutMs: Math.min(300_000, input.remainingBudgetMs),
      // b3e8d4c7 t1：权威路径与 agent 路径同一套门禁。
      // **attemptPhase 必须是 attemptId 真正所属的阶段（= currentPhase）**，不是校验目标：
      // attemptId 是当前阶段的（如 coding 的 i5），传成 target 会让 check-receipt 以为
      // "同阶段验 plan"，于是照旧拿 plan 回执的 i3 比 i5 —— 原事故原样复现。
      goalIdentity: {
        runId: input.goalRunId,
        attemptId: input.attemptId,
        attemptPhase: input.currentPhase,
      },
    },
  );
  if (validation.status !== 'passed') {
    const incident =
      validation.status === 'failed' || validation.status === 'missing'
        ? 'upstream_closure_gap'
        : // error（含 checker 缺失/spawn 失败/超时——ReceiptValidation 无法区分，不细分）
          // 与 not_applicable（lite track，在 full-track 上游关环路径上理论不可达，
          // 到达即不变量被破坏）统一按框架缺陷处理。
          'framework_bug';
    return {
      kind: 'blocked',
      phase: target,
      incident,
      detail: `上游 ${target} 回执校验 status=${validation.status}：${validation.message ?? '(无消息)'}`,
    };
  }

  // ③ passed 之后**重算** freshness——stale 绝不 rebound（顺序见文件头）
  const [staleness] = recomputePhaseEvidenceStaleness(input.projectRoot, input.feature, [target]);
  if (staleness && staleness.verdict !== 'fresh') {
    return {
      kind: 'blocked',
      phase: target,
      incident: 'upstream_closure_gap',
      detail:
        `上游 ${target} 证据 ${staleness.verdict}（${(staleness.changed_paths ?? []).slice(0, 3).join(', ') || '无变更清单'}）` +
        '——不在 stale 证据上关环（那会把旧 PASS 重新绑定到新文件，制造假闭环）',
    };
  }

  // ⑤ 写盘前**复验** fence（validator/freshness 期间 owner 可能已交接）——同样直接抛
  input.fence?.();
  try {
    (input.finalize ?? finalizePhaseClosure)({
      projectRoot: input.projectRoot,
      frameworkRoot: input.frameworkRoot,
      feature: input.feature,
      phase: target,
      goalRunId: input.goalRunId,
      receipt: { ...validation, status: 'passed' },
      blockerCount: 0,
      // 上游关环**不动当前 phase 指针**——本模块只补上游的 closure 凭证。
      persistPhaseState: () => { /* no-op：不改 .current-phase.json */ },
    });
  } catch (error) {
    // finalizer 自身失败（磁盘/mutex/summary 不变量）复用既有 `closure_finalization_failed`，
    // **不**混标成 upstream_closure_gap（那是"上游内容缺口"，语义不同）。
    return {
      kind: 'blocked',
      phase: target,
      incident: 'closure_finalization_failed',
      detail: `上游 ${target} 关环写盘失败：${(error as Error).message}`,
    };
  }
  return { kind: 'closed', phase: target };
}

import * as crypto from 'crypto';
import type { ReconcileObservationV1 } from './assess';
import type { DependencyPolicy } from './phase-transition-policy';
import {
  lookupIncident,
  projectToObservedActionability,
  type ObservedActionability,
} from './adjudication';

export interface GoalReconcileBlockerInput {
  id: string;
  blocking_class?: string;
}

export interface GoalReconcileObservationInput {
  phase: string;
  verdict: string;
  legacyAction: string;
  failureKind?: string;
  blockingClass?: string;
  propagateToDownstream?: boolean;
  dependencyPolicy?: DependencyPolicy;
  blockers?: GoalReconcileBlockerInput[];
  deterministicDefects?: string[];
  retriesUsed: number;
  maxRetriesPerPhase?: number;
  backtracksUsed: number;
  repeatedCount?: number;
  /** adjudicated-repair-loop M1（plan e2b7c4a9 t1.3）：整轮 repair candidates 集合指纹
   *  （roundFingerprintOfCandidates）——缺省回落 stableFingerprint。assess 把它连同
   *  count 消费入 stop 理由（整轮全等→无进展）。 */
  repeatedRoundFingerprint?: string;
  /** adjudicated-repair-loop M1（plan e2b7c4a9 t1.3）：信号级候选收敛状态
   *  （runner backtrack 决策点计算；assess 消费见 ReconcileObservationV1）。 */
  repairConvergence?: {
    eligibleEmpty: boolean;
    openSignalCount: number;
    attemptedSignalCount: number;
  };
  residualFingerprints?: string[];
  invalidatablePhases?: string[];
  timedOut?: boolean;
  operatorInterrupted?: boolean;
  apiDisconnected?: boolean;
  fused?: boolean;
  fuseReason?: string;
}

/**
 * plan a5f9c3e2 t2：**分类 SSOT 归裁决内核**，本层只消费并投影，不再自行分类。
 *
 * 收编边界（诚实记录）：INCIDENT_REGISTRY 的键空间是 **incident id**（halt_reason 家族
 * 与同形态的 harness blocking_class）。仍有一部分 `blocking_class` 是**内容质量 blocker
 * 类目**而非 incident（asset_integrity / product_verdict / visual_parity 等），把它们
 * 塞进 incident 注册表属于概念错配。故：**注册表命中即以内核为准；未命中保留既有正则
 * 兜底**（legacy，随类目逐步注册而收敛）——不因收编而改判历史 blocking_class。
 */
function actionability(blockingClass?: string): ObservedActionability {
  if (!blockingClass) return 'unknown';
  const spec = lookupIncident(blockingClass);
  if (spec) return projectToObservedActionability(spec.class);
  // legacy 兜底：未注册类目沿用改造前口径（fail-open，行为不变）
  if (/external|device|environment|api/i.test(blockingClass)) return 'external';
  if (/human|confirmation|authorization|interaction/i.test(blockingClass)) return 'human';
  if (/code|test|contract|artifact|quality|review/i.test(blockingClass)) return 'automatic';
  return 'unknown';
}

function stableFingerprint(input: GoalReconcileObservationInput): string {
  const body = JSON.stringify({
    phase: input.phase,
    verdict: input.verdict,
    action: input.legacyAction,
    failure_kind: input.failureKind ?? null,
    blockers: (input.blockers ?? []).map((item) => [item.id, item.blocking_class ?? null]).sort(),
    defects: [...(input.deterministicDefects ?? [])].sort(),
  });
  return crypto.createHash('sha256').update(body, 'utf8').digest('hex');
}

/** Pure event/process-state boundary. It does not choose the next phase. */
export function deriveReconcileObservation(
  input: GoalReconcileObservationInput,
): ReconcileObservationV1 {
  const fingerprint = stableFingerprint(input);
  return {
    schema_version: '1.0',
    state: input.fused ? 'fused' : 'active',
    ...(input.fuseReason ? { reason: input.fuseReason } : {}),
    residual_fingerprints: input.residualFingerprints ?? [fingerprint],
    phase_outcome: {
      phase: input.phase,
      verdict: input.verdict,
      legacy_action: input.legacyAction,
      ...(input.failureKind ? { failure_kind: input.failureKind } : {}),
      ...(input.blockingClass ? { blocking_class: input.blockingClass } : {}),
      ...(input.propagateToDownstream !== undefined
        ? { propagate_to_downstream: input.propagateToDownstream }
        : {}),
      ...(input.dependencyPolicy ? { dependency_policy: input.dependencyPolicy } : {}),
    },
    blockers: (input.blockers ?? []).map((item) => ({
      id: item.id,
      actionability: actionability(item.blocking_class),
      ...(item.blocking_class ? { blocking_class: item.blocking_class } : {}),
    })),
    // 责任阶段统一路由：候选**不进 reconcile**（唯一真源=phase summary，assess 直读）——
    // 避免第二份事实与 batch/in-session 链路漏传（codex review 冻结项②③）。
    deterministic_defects: [...new Set(input.deterministicDefects ?? [])].sort(),
    budgets: {
      retries_used: Math.max(0, Math.trunc(input.retriesUsed)),
      ...(input.maxRetriesPerPhase !== undefined
        ? { max_retries_per_phase: Math.max(0, Math.trunc(input.maxRetriesPerPhase)) }
        : {}),
      backtracks_used: Math.max(0, Math.trunc(input.backtracksUsed)),
    },
    repeated_round: {
      fingerprint: input.repeatedRoundFingerprint?.trim() || fingerprint,
      count: Math.max(0, Math.trunc(input.repeatedCount ?? 0)),
    },
    ...(input.repairConvergence
      ? {
          repair_convergence: {
            eligible_empty: input.repairConvergence.eligibleEmpty,
            open_signal_count: Math.max(0, Math.trunc(input.repairConvergence.openSignalCount)),
            attempted_signal_count: Math.max(0, Math.trunc(input.repairConvergence.attemptedSignalCount)),
          },
        }
      : {}),
    invalidatable_phases: [...new Set(input.invalidatablePhases ?? [])],
    signals: {
      timed_out: input.timedOut === true,
      operator_interrupted: input.operatorInterrupted === true,
      api_disconnected: input.apiDisconnected === true,
    },
  };
}

/**
 * Historical zero-change adapter retained only for the pre-rewire boundary fixtures.
 * Production goal-runner must not import it; the static assess-driver check enforces that boundary.
 */
export function preserveLegacyAction<T extends string>(
  observation: ReconcileObservationV1,
  action: T,
): T {
  if (observation.phase_outcome?.legacy_action !== action) {
    throw new Error('[goal-reconcile] observation/action mismatch');
  }
  return action;
}

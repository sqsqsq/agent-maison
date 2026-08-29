// change-unit-design-preparation.ts — M7：P2「设计准备子流程」。
//
// 关闭"首个 canonical CU 由谁创建"的责任空档。它**不是**新机制：完全复用 P2 规格既有的
// CU decomposition Seam Card（provider 只产临时候选 → consumer validator 校验后原子写
// canonical CU），只是把这条路径显式暴露成一个入口，并允许**初始 canonical CU 数量为 0**。
//
// 边界（P2 spec「Design preparation accepts an admitted blueprint with zero change units」）：
//   - 入口 = admitted blueprint（0 CU 合法）；
//   - provider/设计者只提临时候选（内存/临时报告），不写 canonical；
//   - 只有 consumer validator 可接受候选，并**原子**写出 1..N canonical `change-unit@1`；
//   - 重复接受 fail-closed；
//   - 终点 = design gate / readiness，**停在 selector 与 Goal Mode 执行之前**。
//
// 不新增 CLI、状态、registry、跨单元 ledger，也不新增第二套 CU 写入机制。

import {
  enumerateCanonicalChangeUnits,
  loadCanonicalChangeUnit,
} from './change-unit-path';
import { validateChangeUnitDesign } from './change-unit-design-gate';
import { loadCanonicalBlueprint } from './component-blueprint-path';
import { blockerIssues, validateComponentBlueprint } from './component-blueprint-validator';
import { asRecord } from './component-blueprint-model';
import {
  ChangeUnitCandidate,
  ChangeUnitCandidateRejected,
  acceptChangeUnitCandidates,
} from './change-unit-provider-boundary';

export interface DesignPreparationEntry {
  /** 是否可以进入设计准备段。admitted blueprint + 0 CU 是**合法**入口。 */
  canEnter: boolean;
  blueprintAdmitted: boolean;
  existingChangeUnitIds: string[];
  reasons: string[];
}

/**
 * 设计准备段入口前提。与 selector/施工段前提不同：这里不要求 ≥1 canonical CU。
 */
export function evaluateDesignPreparationEntry(
  projectRoot: string,
  blueprintId: string,
): DesignPreparationEntry {
  const reasons: string[] = [];
  let blueprintAdmitted = false;
  try {
    const loaded = loadCanonicalBlueprint(projectRoot, blueprintId);
    const issues = blockerIssues(validateComponentBlueprint(loaded.blueprint, {
      projectRoot,
      canonicalPath: loaded.canonicalPath,
    }));
    if (issues.length > 0) {
      reasons.push(`blueprint_not_admitted:${issues.map(item => item.id).join(',')}`);
    } else if (asRecord(asRecord(loaded.blueprint.review_summary)?.admission)?.status !== 'pass') {
      reasons.push('blueprint_admission_not_pass');
    } else {
      blueprintAdmitted = true;
    }
  } catch (error) {
    reasons.push(`blueprint_unresolvable:${(error as Error).message}`);
  }
  const existingChangeUnitIds = blueprintAdmitted
    ? enumerateCanonicalChangeUnits(projectRoot, blueprintId)
      .map(loaded => String(loaded.changeUnit.change_unit_id))
      .sort()
    : [];
  if (blueprintAdmitted && existingChangeUnitIds.length === 0) {
    reasons.push('zero_canonical_change_units_is_a_legal_design_preparation_entry');
  }
  return { canEnter: blueprintAdmitted, blueprintAdmitted, existingChangeUnitIds, reasons };
}

/**
 * 施工段（selector / Goal Mode）入口前提：仍然要求至少一个 canonical CU。
 * 设计准备段放宽入口，**不放宽施工段**——两段前提在同一处并列声明，避免只改一边。
 */
export function evaluateConstructionEntry(
  projectRoot: string,
  blueprintId: string,
): { canEnter: boolean; reasons: string[] } {
  const preparation = evaluateDesignPreparationEntry(projectRoot, blueprintId);
  if (!preparation.blueprintAdmitted) return { canEnter: false, reasons: preparation.reasons };
  if (preparation.existingChangeUnitIds.length === 0) {
    return { canEnter: false, reasons: ['construction_requires_at_least_one_canonical_change_unit'] };
  }
  return { canEnter: true, reasons: [] };
}

/**
 * 设计准备段拒绝候选时抛出的错误。
 *
 * 它是既有 consumer validator 的 `ChangeUnitCandidateRejected` 的**别名**——本模块只做
 * 入口/readiness 编排，不持有第二份校验或落盘实现，因此也不该有第二种错误类型。
 */
export { ChangeUnitCandidateRejected as ChangeUnitDecompositionRejected } from './change-unit-provider-boundary';

export interface AcceptedDecomposition {
  accepted: ReturnType<typeof loadCanonicalChangeUnit>[];
  changeUnitIds: string[];
}

/**
 * 设计准备段的接受入口：**委托**既有唯一 consumer validator
 * （`acceptChangeUnitCandidates`）完成校验与原子写出，本函数只补一条编排层前置——
 * 候选必须归属目标工作区。
 *
 * 校验/落盘/回滚/重复接受 fail-closed 的语义全部由 consumer 承担，此处不复制。
 */
export function acceptChangeUnitDecomposition(
  projectRoot: string,
  blueprintId: string,
  candidates: readonly ChangeUnitCandidate[],
): AcceptedDecomposition {
  for (const candidate of candidates) {
    if (candidate.artifact.blueprint_id !== blueprintId) {
      throw new ChangeUnitCandidateRejected(
        'change_unit_candidate_blueprint_mismatch',
        `候选 ${candidate.artifact.change_unit_id} 归属 ${candidate.artifact.blueprint_id}，与目标工作区 ${blueprintId} 不一致。`,
      );
    }
  }
  const accepted = acceptChangeUnitCandidates(projectRoot, candidates);
  return {
    accepted,
    changeUnitIds: accepted.map(loaded => String(loaded.changeUnit.change_unit_id)).sort(),
  };
}

export interface DesignPreparationReadiness {
  /** 设计准备段是否完成：≥1 canonical CU 且每个都过设计可施工门。 */
  ready: boolean;
  changeUnitIds: string[];
  perUnit: Array<{ changeUnitId: string; verdict: string; issueIds: string[] }>;
  /** 恒为 false —— 设计准备段不进入 selector、Goal Mode 施工循环与 P3 closure。 */
  entersConstruction: false;
  nextEntry: 'change-unit-progression' | 'component-design';
}

/**
 * 设计准备段的终点：派生 design gate / readiness，并把下一步指回既有施工入口。
 * 它 MUST NOT 选择 CU、MUST NOT 启动 Goal Mode、MUST NOT 触碰 closure。
 */
export function deriveDesignPreparationReadiness(
  projectRoot: string,
  blueprintId: string,
): DesignPreparationReadiness {
  const units = enumerateCanonicalChangeUnits(projectRoot, blueprintId);
  const perUnit = units.map(loaded => {
    const design = validateChangeUnitDesign(projectRoot, loaded.changeUnit);
    return {
      changeUnitId: String(loaded.changeUnit.change_unit_id),
      verdict: design.verdict as string,
      issueIds: design.issues.map(item => item.id),
    };
  }).sort((a, b) => (a.changeUnitId < b.changeUnitId ? -1 : a.changeUnitId > b.changeUnitId ? 1 : 0));
  const ready = perUnit.length > 0 && perUnit.every(item => item.verdict === 'constructable');
  return {
    ready,
    changeUnitIds: perUnit.map(item => item.changeUnitId),
    perUnit,
    entersConstruction: false,
    nextEntry: ready ? 'change-unit-progression' : 'component-design',
  };
}

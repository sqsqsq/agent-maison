// ============================================================================
// feature-assessment.ts — Feature 完成的唯一评估入口（plan b2d7f4e9 §3.1）
// ----------------------------------------------------------------------------
// 三问分开回答，全部拆自既有判据、不新写判据：
//   record      —— 完成记录本身可不可信（verify-feature-completion.ts `inspectCompletionRecord`，按记录自己的 run 范围）；
//   obligations —— 本次合法范围里每条义务是否仍被覆盖 = 绑定新鲜（`executionScopeEvidenceFindings`）
//                  ∧ 执行结果通过（`collectCleanPassIssues` 按 owner_phase 摊回）∧ 有证据（责任阶段在记录内或有 satisfied_by）；
//                  `cu-` Feature 另核 Feature↔CU 精确绑定（`inspectDerivedFeatureBinding` + ID-only 映射）；
//   blocking    —— 与义务无关、阻止"完成"的世界事实（晚于凭证的未终局 run、corrupt run），不路由到阶段。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import { featureFilePath } from '../../config';
import type { ExecutionScope } from './execution-scope';
import { loadEffectiveExecutionScope } from './goal-run-creation';
import { classifyGoalRunsDir, computeRunRequirementSha } from './fidelity-shared';
import { tryParseCuFeatureId } from './feature-identity';
import { asChangeUnitArtifact, inspectDerivedFeatureBinding, loadCanonicalChangeUnit } from './change-unit-path';
import { changeUnitMappingIssues } from './change-unit-feature-projection';
import { recomputePhaseEvidenceStaleness } from './phase-evidence-manifest';
import { definitionAuthorityGap } from './feature-track';
import { resolveProbeFrameworkRoot } from '../../repo-layout';
import {
  FEATURE_COMPLETION_FILENAME,
  collectCleanPassIssues,
  executionScopeEvidenceFindings,
  inspectCompletionRecord,
} from './verify-feature-completion';

export type ObligationGapClass = 'binding' | 'evidence' | 'result' | 'unknown';

export interface AssessedObligation {
  id: string;
  kind: string;
  owner_phase: string;
  applicability: string;
  status: 'covered' | 'uncovered';
  class?: ObligationGapClass;
  reason?: string;
}

export interface FeatureAssessment {
  record:
    | { state: 'absent' }
    | { state: 'ok' | 'broken'; run_id: string | null; generated_at: string | null; reasons: string[] };
  obligations: AssessedObligation[];
  blocking: string[];
  complete: boolean;
}

export interface AssessFeatureOptions {
  /** 消费方独立解析的 track / 链（legacy 1.1 记录据此对账；1.2 记录按自身出生范围对账）。 */
  expectedTrack: string;
  expectedChain: string[];
  frameworkRoot?: string;
  /** 本次合法范围；省略 = Feature 当前有效范围（记录的 run 范围，或 feature 冻结记录的有效范围）。 */
  scope?: ExecutionScope;
  /**
   * 本次最终需求的血缘哈希（`computeRequirementShaFromText`）：阶段结果按它判 requirement lineage。
   * 省略 = 记录 run 的需求（`computeRunRequirementSha`）。record 恒按历史 run 核验，不受它影响。
   */
  requirementSha?: string;
}

/**
 * clean-pass 条件 → 缺口类（§3.1 表：clean-pass 违例摊回为 result 或 evidence）。证据新鲜度 / 闭环记录 / 机器证据
 * 在场属 evidence（二档，重做责任阶段即可），验收绑定属 binding；其余（verdict、质量轴、投影一致性……）是产品真值 result。
 */
const CLEAN_PASS_CLASS: Readonly<Record<string, ObligationGapClass>> = {
  lineage_fresh: 'evidence', attestation_present: 'evidence', summary_schema_current: 'evidence', closure_commit_present: 'evidence',
  runtime_step_evidence: 'evidence', runtime_step_evidence_identity: 'evidence', acceptance_binding: 'binding',
};

const CONTRACTS_SOURCES = (binding: ExecutionScope['obligations'][number]['basis'][number]): boolean =>
  binding.source.kind === 'artifact' ? binding.source.artifact === 'contracts@1' : binding.source.provider_id === 'derive.blueprint-contracts';

/** Feature↔CU 精确绑定：contracts.yaml `change_unit_ref` 与 canonical CU 的 revision / artifact_sha256，及 ID-only 映射完整性。 */
function changeUnitBindingIssues(projectRoot: string, feature: string, checkMappings: boolean): string[] {
  const identity = tryParseCuFeatureId(feature);
  if (!identity) return [];
  let canonical: ReturnType<typeof loadCanonicalChangeUnit> | undefined;
  try { canonical = loadCanonicalChangeUnit(projectRoot, identity.blueprintId, identity.changeUnitId); } catch { canonical = undefined; }
  const cu = canonical ? asChangeUnitArtifact(canonical.changeUnit) : undefined;
  const binding = inspectDerivedFeatureBinding(projectRoot, identity.blueprintId, identity.changeUnitId, cu?.component_id);
  if (binding.status === 'conflict') return [`CU 绑定冲突：${binding.reason}`];
  if (binding.status !== 'matched') return [];
  if (!canonical || !cu) return ['CU 绑定失配：canonical CU 不可加载'];
  if (binding.ref.revision !== cu.revision || binding.ref.artifact_sha256 !== canonical.artifactSha256) {
    return [`CU 绑定失配：contracts.yaml change_unit_ref=rev${binding.ref.revision}/${binding.ref.artifact_sha256} ≠ canonical CU rev${cu.revision}/${canonical.artifactSha256}`];
  }
  // 映射完整性只对有出生范围的（现代）完成核——legacy 无范围记录沿用旧观察器的口径，不追溯。
  if (!checkMappings) return [];
  const contracts = YAML.parse(fs.readFileSync(path.join(binding.featurePath, 'contracts.yaml'), 'utf8')) as { change_unit?: Record<string, unknown> };
  return changeUnitMappingIssues(projectRoot, contracts.change_unit ?? {}, cu, 'review').map(item => `CU 映射不完整：${item.id}: ${item.message}`);
}

export function assessFeature(projectRoot: string, feature: string, opts: AssessFeatureOptions): FeatureAssessment {
  const inspected = fs.existsSync(featureFilePath(projectRoot, feature, FEATURE_COMPLETION_FILENAME))
    ? inspectCompletionRecord({ projectRoot, feature, expectedChain: opts.expectedChain, expectedTrack: opts.expectedTrack, frameworkRoot: opts.frameworkRoot })
    : undefined;
  const completion = inspected?.completion;
  const runId = completion?.run_id ?? null;
  const record: FeatureAssessment['record'] = inspected
    ? { state: inspected.verdict === 'VALID' ? 'ok' : 'broken', run_id: runId, generated_at: completion?.generated_at ?? null, reasons: inspected.reasons }
    : { state: 'absent' };

  let scope = opts.scope ?? inspected?.scope;
  if (!scope) { try { scope = loadEffectiveExecutionScope(projectRoot, feature, runId ?? undefined); } catch { scope = undefined; } }

  const rows = new Map<string, AssessedObligation>();
  for (const o of scope?.obligations ?? []) rows.set(o.id, { id: o.id, kind: o.kind, owner_phase: o.owner_phase, applicability: o.applicability, status: 'covered' });
  const findings = new Map<string, Array<{ class: ObligationGapClass; detail: string }>>();
  const add = (id: string, cls: ObligationGapClass, detail: string, synth?: Omit<AssessedObligation, 'id' | 'status'>): void => {
    if (!rows.has(id)) rows.set(id, { id, ...(synth ?? { kind: 'synthetic', owner_phase: '', applicability: 'required' }), status: 'covered' });
    findings.set(id, [...(findings.get(id) ?? []), { class: cls, detail }]);
  };
  /** 阶段级事实摊回该阶段的 required 义务；范围里没有时合成 `phase:<p>`，保证不静默丢失。 */
  const addToPhase = (phase: string, cls: ObligationGapClass, detail: string): void => {
    const targets = [...rows.values()].filter(row => row.applicability === 'required' && row.owner_phase === phase && !row.id.startsWith('phase:'));
    if (!targets.length) add(`phase:${phase}`, cls, detail, { kind: 'phase-result', owner_phase: phase, applicability: 'required' });
    for (const row of targets) add(row.id, cls, detail);
  };

  const recordPhases = new Set(completion?.chain ?? []);
  if (scope) {
    for (const f of executionScopeEvidenceFindings(projectRoot, feature, scope, undefined, runId ?? undefined)) {
      const gap = scope.unresolved.find(item => item.obligation_id === f.obligation_id);
      add(f.obligation_id, f.class, f.detail, gap ? { kind: 'unresolved', owner_phase: gap.owner, applicability: 'unknown' } : undefined);
    }
    for (const o of scope.obligations) {
      if (o.applicability === 'unknown') add(o.id, 'unknown', 'applicability unknown');
      // codex P1-1：绑定无错不等于覆盖——required 义务既无复用证据、责任阶段也不在完成记录内 = 没有执行证据。
      if (o.applicability === 'required' && !o.satisfied_by?.length && !recordPhases.has(o.owner_phase)) add(o.id, 'evidence', `责任阶段 ${o.owner_phase} 不在完成记录内且无复用证据`);
    }
  }
  if (completion && recordPhases.size) {
    try {
      const currentRequirementSha = opts.requirementSha ?? computeRunRequirementSha(projectRoot, feature, runId ?? undefined);
      for (const issue of collectCleanPassIssues({
        projectRoot, feature, chain: completion.chain, executionScope: scope, frameworkRoot: opts.frameworkRoot,
        currentRequirementSha, runId: runId ?? undefined,
      })) {
        // execution_scope 条目是绑定缺口在 chain[0] 上的重复（已逐义务计过，§6 #18）；corrupt run 进 blocking。
        if (issue.condition === 'execution_scope' || issue.condition === 'goal_run_identity_intact') continue;
        if (issue.propagated_from) {
          // 沿链传染不是本阶段结果失效：失效只沿真实消费关系传播——直查本阶段自身证据（其输入含上游产物时照样判出）。
          const own = recomputePhaseEvidenceStaleness(projectRoot, feature, [issue.phase], { currentRequirementSha, frameworkRoot: opts.frameworkRoot })[0];
          if (own?.verdict === 'fresh') continue;
          addToPhase(issue.phase, 'evidence', `[lineage_fresh] ${own?.verdict}：${[...(own?.changed_paths ?? []), ...(own?.receipt_changed ? ['<receipt>'] : [])].join(', ')}`);
          continue;
        }
        addToPhase(issue.phase, CLEAN_PASS_CLASS[issue.condition] ?? 'result', `[${issue.condition}] ${issue.detail}`);
      }
    } catch (error) { addToPhase(completion.chain[0], 'result', `完成结果不可重算：${String(error)}`); }
  }
  for (const d of inspected?.drift ?? []) addToPhase(d.phase, d.class, d.detail);
  const cuIssues = changeUnitBindingIssues(projectRoot, feature, !!scope);
  if (cuIssues.length) {
    const bound = (scope?.obligations ?? []).filter(o => o.basis.some(CONTRACTS_SOURCES));
    for (const detail of cuIssues) {
      if (!bound.length) add('cu:feature-binding', 'binding', detail, { kind: 'change-unit-binding', owner_phase: 'plan', applicability: 'required' });
      for (const o of bound) add(o.id, 'binding', detail);
    }
  }
  // plan c4e7a9b2 §3.1 A1：手写验收 / 设计与当前设计权威按稳定 ID 对齐（与出生候选同一判定 `definitionAuthorityGap`）。
  // 摊到以该手写产物为来源的定义义务；范围里没有时合成一条，沿用上方 `cu:feature-binding` 先例。
  // 不传 frameworkRoot 的默认调用方（goal-status / observeChangeUnitCompletion）按既有布局解析补齐（工程内框架树，
  // 找不到回落当前 harness 所在框架，不抛），传与不传同一裁决。
  if (tryParseCuFeatureId(feature)) {
    const frameworkRoot = opts.frameworkRoot ?? resolveProbeFrameworkRoot(projectRoot);
    for (const [kind, contextKind, owner] of [['acceptance', 'acceptance-context', 'spec'], ['contracts', 'design-context', 'plan']] as const) {
      const gap = definitionAuthorityGap({ projectRoot, feature, frameworkRoot }, kind);
      if (!gap) continue;
      const bound = (scope?.obligations ?? []).filter(o => o.kind === contextKind && o.basis.some(b => b.source.kind === 'artifact' && b.source.artifact === `${kind}@1`));
      if (!bound.length) add(`${contextKind}:authority`, 'binding', gap, { kind: contextKind, owner_phase: owner, applicability: 'required' });
      for (const o of bound) add(o.id, 'binding', gap);
    }
  }

  const obligations = [...rows.values()].map(row => {
    const list = findings.get(row.id);
    return list ? { ...row, status: 'uncovered' as const, class: list[0].class, reason: list.map(item => item.detail).join('；') } : row;
  });
  const blocking = [
    ...classifyGoalRunsDir(featureFilePath(projectRoot, feature, 'goal-runs')).corruptRuns
      .map(item => `goal-run ${item.runId} 损坏：${item.reason}——人工核查该目录（恢复 manifest 或确认废弃）后重验`),
    ...(inspected?.laterRuns ?? []),
  ];
  return {
    record,
    obligations,
    blocking,
    complete: record.state === 'ok' && blocking.length === 0 && obligations.every(o => o.status === 'covered'),
  };
}

/** 人读理由：记录不可信原因 + uncovered 清单 + blocking（消费方展示与 CU INCOMPLETE 的 legal blocker 共用）。 */
export function assessmentReasons(a: FeatureAssessment): string[] {
  return [
    ...(a.record.state === 'absent' ? ['无 feature-completion 投影'] : a.record.reasons.map(r => `[record] ${r}`)),
    ...a.obligations.filter(o => o.status === 'uncovered').map(o => `${o.id}（${o.owner_phase || '-'}/${o.class}）：${o.reason}`),
    ...a.blocking,
  ];
}

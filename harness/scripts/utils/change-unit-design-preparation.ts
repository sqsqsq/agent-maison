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

import * as fs from 'fs';
import * as YAML from 'yaml';
import { resolveFeatureArtifact } from '../../config';
import { resolveProbeFrameworkRoot } from '../../repo-layout';
import {
  LoadedChangeUnit,
  asChangeUnitArtifact,
  deriveChangeUnitFeatureId,
  enumerateCanonicalChangeUnits,
  loadCanonicalChangeUnit,
} from './change-unit-path';
import {
  BLUEPRINT_PROJECTION_FILES,
  inspectProjectionStamps,
  materializeBlueprintSkillInputs,
  type ProjectionRefresh,
} from './blueprint-skill-projection';
import { validateChangeUnitDesign } from './change-unit-design-gate';
import { loadCanonicalBlueprint, sha256Bytes } from './component-blueprint-path';
import { blockerIssues, validateComponentBlueprint } from './component-blueprint-validator';
import { asRecord } from './component-blueprint-model';
import { ChangeUnitArtifact, ChangeUnitRecord, changeUnitRecords } from './change-unit-model';
import { evaluateChangeUnitCarryForward } from './change-unit-reconciliation';
import { retiredChangeUnitIds } from './component-closure-inputs';
import { blockerChangeUnitIssues, validateChangeUnit } from './change-unit-validator';
import {
  ChangeUnitCandidate,
  ChangeUnitCandidateRejected,
  acceptChangeUnitCandidates,
  writeCanonicalChangeUnit,
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

export interface BlueprintRefReconciliation {
  bumped: Array<{ change_unit_id: string; revision: number; blueprint_revision: number }>;
  skipped: Array<{ change_unit_id: string; reasons: string[] }>;
}

/** CU 内全部蓝图身份指针：component_blueprint_ref、design_refs[]、touches[].design_ref。 */
function blueprintIdentityPointers(cu: ChangeUnitRecord): Array<Record<string, unknown> | undefined> {
  return [
    asRecord(cu.component_blueprint_ref),
    ...(Array.isArray(cu.design_refs) ? cu.design_refs.map(ref => asRecord(ref)) : []),
    ...changeUnitRecords(cu.touches).map(touch => asRecord(touch.design_ref)),
  ];
}

const IDENTITY_KEYS = ['revision', 'source_fingerprint', 'artifact_sha256'] as const;
const DERIVED_PROJECTION_FILES = Object.values(BLUEPRINT_PROJECTION_FILES);
const NOT_MACHINE_OWNED = 'derived_projection_not_machine_owned: 既有派生投影的来源戳不指向升版前 CU/蓝图，须人工处理（确认无人工决策后删除该 feature 的 acceptance/contracts/use-cases 三份派生文件，再重新调和）';

function identityKey(ref: Record<string, unknown> | undefined): string {
  return JSON.stringify(IDENTITY_KEYS.map(key => ref?.[key]));
}

/**
 * 无来源戳（agent 手写 / 阶段产出）的 contracts.yaml 不归投影 writer，但其中的身份指针随 CU 升版：
 * `change_unit.change_unit_ref` 精确指向升版前本 CU 时，把它的 revision / artifact_sha256 与全部仍指向升版前蓝图身份的
 * `component-blueprint@1` 引用（design_ref_mappings[].design_ref 等）的三个身份字段改为升版后值——按原文位置替换标量，
 * 其余字节一个不动（内容变化仍由 plan 义务绑定过期交责任阶段）。返回 null = 不归本批维护（无 ref / ref 不是升版前本 CU）。
 */
function repointHandWrittenContracts(
  text: string,
  cu: { blueprintId: string; changeUnitId: string; from: [number, string]; to: [number, string] },
  blueprint: { from: Record<string, unknown>; to: Record<string, unknown> },
): string | null {
  const doc = YAML.parseDocument(text);
  const ref = doc.getIn(['change_unit', 'change_unit_ref'], true);
  if (!YAML.isMap(ref)) return null;
  const same = (map: YAML.YAMLMap, values: Record<string, unknown>): boolean => Object.entries(values).every(([key, value]) => map.get(key) === value);
  if (!same(ref, { blueprint_id: cu.blueprintId, change_unit_id: cu.changeUnitId, revision: cu.from[0], artifact_sha256: cu.from[1] })) return null;
  const edits: Array<{ node: YAML.Scalar; value: unknown }> = [];
  const edit = (map: YAML.YAMLMap, values: Record<string, unknown>): void => {
    for (const [key, value] of Object.entries(values)) edits.push({ node: map.get(key, true) as YAML.Scalar, value });
  };
  edit(ref, { revision: cu.to[0], artifact_sha256: cu.to[1] });
  YAML.visit(doc, { Map: (_key, map) => {
    if (same(map, { artifact: 'component-blueprint@1', blueprint_id: cu.blueprintId, ...Object.fromEntries(IDENTITY_KEYS.map(key => [key, blueprint.from[key]])) })) {
      edit(map, Object.fromEntries(IDENTITY_KEYS.map(key => [key, blueprint.to[key]])));
    }
  } });
  let next = text;
  for (const { node, value } of edits.sort((a, b) => b.node.range![0] - a.node.range![0])) {
    const quoted = node.type === 'QUOTE_DOUBLE' ? JSON.stringify(String(value)) : node.type === 'QUOTE_SINGLE' ? `'${String(value)}'` : String(value);
    next = next.slice(0, node.range![0]) + quoted + next.slice(node.range![1]);
  }
  const check = asRecord(asRecord(YAML.parse(next)?.change_unit)?.change_unit_ref);
  if (check?.revision !== cu.to[0] || check?.artifact_sha256 !== cu.to[1]) throw new Error('contracts.yaml 身份指针原位替换后复核不一致');
  return next;
}

/**
 * b2d7f4e9 §3.3：蓝图升 admitted revision 后，把 canonical CU 的三处蓝图身份指针
 * （revision / source_fingerprint / artifact_sha256）原位升到当前蓝图，CU `revision + 1`；
 * change_unit_id 与契约字段（provides / requires / target_predicates / touches / preserved_invariants /
 * design_refs 的 target 地址）不变。已完成与未完成 CU 同规则。
 *
 * 前提 = 既有 `evaluateChangeUnitCarryForward` 通过（判据不改），不通过进 `skipped` 带原因、不改写。
 * 三处指针身份本就不一致的 CU（例如按新蓝图手工追加了 touch）不是指针漂移而是契约变化，同样跳过——
 * 契约变化走新 change_unit_id + supersedes。待写 CU 先全量 `validateChangeUnit`，任一失败整批不落盘；
 * 写入与 accept 同一原语，中途失败回滚本批。幂等：指针已指向当前蓝图的 CU 不在候选内。
 * t2c：CU 派生 feature 目录已有机器投影（acceptance/contracts/use-cases）时，同批经同一个物化 writer
 *（`materializeBlueprintSkillInputs` 的 refresh 模式）刷新为新投影；带机器来源戳却不指向升版前身份的，
 * 该 CU 不升版、进 skipped。没有机器来源戳的文件不归本 writer，内容原样保留；只有 contracts.yaml 的身份指针
 *（change_unit_ref 精确指向升版前本 CU 时）同批原位维护，ref 指向别处则一个字节不动。
 */
export function reconcileChangeUnitBlueprintRefs(
  projectRoot: string,
  blueprintId: string,
): BlueprintRefReconciliation {
  const result: BlueprintRefReconciliation = { bumped: [], skipped: [] };
  const units = enumerateCanonicalChangeUnits(projectRoot, blueprintId);
  let current: ReturnType<typeof loadCanonicalBlueprint>;
  try {
    current = loadCanonicalBlueprint(projectRoot, blueprintId);
  } catch (error) {
    for (const loaded of units) {
      result.skipped.push({ change_unit_id: String(loaded.changeUnit.change_unit_id), reasons: [(error as Error).message] });
    }
    return result;
  }
  const identity = {
    revision: Number(current.blueprint.revision),
    source_fingerprint: String(current.blueprint.source_fingerprint),
    artifact_sha256: current.artifactSha256,
  };
  const pending: Array<{ loaded: LoadedChangeUnit; next: ChangeUnitRecord; feature: string; refresh?: ProjectionRefresh; contracts?: { file: string; bytes: Buffer; text?: string } }> = [];
  for (const loaded of units) {
    const cu = loaded.changeUnit;
    const changeUnitId = String(cu.change_unit_id);
    const pointers = blueprintIdentityPointers(cu);
    const owner = identityKey(pointers[0]);
    if (owner === identityKey(identity)) continue;
    const skip = (reasons: string[]) => result.skipped.push({ change_unit_id: changeUnitId, reasons });
    if (pointers.some(ref => !ref || identityKey(ref) !== owner)) {
      skip(['blueprint_ref_identity_inconsistent: 三处蓝图指针身份不一致，属契约变化，须新建 change_unit_id + supersedes']);
      continue;
    }
    if (Number(pointers[0]?.revision) > identity.revision) {
      skip([`blueprint_revision_regressed: CU 绑定 revision=${String(pointers[0]?.revision)} 高于当前 ${identity.revision}`]);
      continue;
    }
    const verdict = evaluateChangeUnitCarryForward(projectRoot, asChangeUnitArtifact(cu));
    if (!verdict.allowed) {
      skip(verdict.reasons);
      continue;
    }
    const next = YAML.parse(loaded.bytes.toString('utf8')) as ChangeUnitRecord;
    for (const ref of blueprintIdentityPointers(next)) Object.assign(ref!, identity);
    next.revision = Number(cu.revision) + 1;
    // 派生 feature 目录里已有机器投影 → 升版必须同批刷新它们（否则该 feature 任何新 run 都被投影门拒绝）。
    // 来源戳全部指向升版前身份 = 旧机器投影，刷新即修复；部分带戳 / 戳指向别的身份 → 写任何东西之前就跳过。
    // 没有任何机器来源戳的文件（手写 / 阶段产出）不归本 writer：内容不刷新、不覆盖，指针照常升版；
    // 其中 contracts.yaml 的身份指针（change_unit_ref 精确指向升版前本 CU 时）同批原位维护（repointHandWrittenContracts）。
    const feature = deriveChangeUnitFeatureId(blueprintId, changeUnitId);
    const refresh = { changeUnitSha: loaded.artifactSha256, blueprintSha: String(pointers[0]?.artifact_sha256) };
    const stamps = inspectProjectionStamps(projectRoot, feature, refresh);
    if (Array.isArray(stamps)) {
      skip([`${NOT_MACHINE_OWNED}：来源戳不指向升版前 CU/蓝图 ${stamps.join(', ')}`]);
      continue;
    }
    const contractsFile = resolveFeatureArtifact(projectRoot, feature, BLUEPRINT_PROJECTION_FILES['contracts@1']);
    const contracts = stamps === 'none' && contractsFile.exists ? { file: contractsFile.actualPath, bytes: fs.readFileSync(contractsFile.actualPath) } : undefined;
    pending.push({ loaded, next, feature, ...(stamps === 'stamped' ? { refresh } : {}), ...(contracts ? { contracts } : {}) });
  }
  // supersedes 是对被引用 CU 的精确引用（revision + artifact_sha256），升版会改变这两项。只维护升版前精确成立的引用：
  //  · 引用方本批不升版 → 被引用者也不升版（退役 CU 本就不贡献，升了反而让引用失效）；按引用链收敛到不动点；
  //  · 引用方本批升版 → 先定被引用者升版后的字节，再把引用改写为其新 ref（链式 C→B→A 递归按拓扑序）。
  const exactRef = (ref: unknown, target: LoadedChangeUnit): boolean => {
    const record = asRecord(ref);
    return !!record && record.blueprint_id === blueprintId && record.change_unit_id === target.changeUnit.change_unit_id
      && record.revision === target.changeUnit.revision && record.artifact_sha256 === target.artifactSha256;
  };
  for (let pinned = true; pinned;) {
    pinned = false;
    for (const item of [...pending]) {
      const referrer = units.find(other => !pending.some(p => p.loaded === other) && exactRef(other.changeUnit.supersedes, item.loaded));
      if (!referrer) continue;
      pending.splice(pending.indexOf(item), 1);
      result.skipped.push({ change_unit_id: String(item.loaded.changeUnit.change_unit_id), reasons: [`superseded_by_unbumped: 被 ${String(referrer.changeUnit.change_unit_id)} 以 supersedes 精确引用、且它本批不升版——为保持该引用精确，不升版`] });
      pinned = true;
    }
  }
  const pendingById = new Map(pending.map(item => [String(item.loaded.changeUnit.change_unit_id), item]));
  const bumpedSha = new Map<string, string>();
  // 精确引用不可能成环（互相包含对方字节哈希），递归必然终止。
  const finalize = (item: typeof pending[number]): string => {
    const id = String(item.next.change_unit_id);
    const known = bumpedSha.get(id);
    if (known) return known;
    const target = pendingById.get(String(asRecord(item.next.supersedes)?.change_unit_id));
    if (target && exactRef(item.loaded.changeUnit.supersedes, target.loaded)) {
      Object.assign(item.next.supersedes!, { revision: Number(target.next.revision), artifact_sha256: finalize(target) });
    }
    const sha = sha256Bytes(Buffer.from(YAML.stringify(item.next), 'utf8'));
    bumpedSha.set(id, sha);
    return sha;
  };
  pending.forEach(finalize);
  for (const { loaded, next } of pending) {
    const issues = blockerChangeUnitIssues(validateChangeUnit(next, { projectRoot, canonicalPath: loaded.canonicalPath }));
    if (issues.length > 0) {
      throw new ChangeUnitCandidateRejected(
        'change_unit_blueprint_ref_bump_rejected',
        `CU ${String(next.change_unit_id)} 升版后未通过 canonical 校验（整批未落盘）：${issues.map(item => `${item.id}@${item.path}`).join(', ')}`,
      );
    }
  }
  for (const { loaded, next, contracts } of pending) {
    if (!contracts) continue;
    const id = String(next.change_unit_id);
    try {
      const text = repointHandWrittenContracts(contracts.bytes.toString('utf8'),
        { blueprintId, changeUnitId: id, from: [Number(loaded.changeUnit.revision), loaded.artifactSha256], to: [Number(next.revision), bumpedSha.get(id)!] },
        { from: asRecord(loaded.changeUnit.component_blueprint_ref)!, to: identity });
      if (text !== null) contracts.text = text;
    } catch (error) {
      throw new ChangeUnitCandidateRejected('change_unit_blueprint_ref_bump_rejected', `CU ${id} 的 contracts.yaml 身份指针无法原位维护（整批未落盘）：${(error as Error).message}`);
    }
  }
  const written: LoadedChangeUnit[] = [];
  const refreshed: Array<{ file: string; bytes: Buffer | null }> = [];
  const rollback = (): void => {
    for (const loaded of written) fs.writeFileSync(loaded.canonicalPath, loaded.bytes);
    for (const item of refreshed) {
      if (item.bytes) fs.writeFileSync(item.file, item.bytes); else fs.rmSync(item.file, { force: true });
    }
  };
  try {
    pending.forEach(({ loaded, next }, index) => {
      writeCanonicalChangeUnit(loaded.canonicalPath, next as unknown as ChangeUnitArtifact, `${process.pid}-bump-${index}`);
      written.push(loaded);
    });
    // 手写 contracts 的身份指针与 CU 指针同批：temp → rename，登记原字节供整批回滚。
    for (const { contracts } of pending) {
      if (contracts?.text === undefined) continue;
      const tmp = `${contracts.file}.tmp-${process.pid}`;
      try {
        fs.writeFileSync(tmp, contracts.text);
        fs.renameSync(tmp, contracts.file);
      } finally { fs.rmSync(tmp, { force: true }); }
      refreshed.push({ file: contracts.file, bytes: contracts.bytes });
    }
  } catch (error) {
    rollback();
    throw new ChangeUnitCandidateRejected(
      'change_unit_blueprint_ref_bump_write_failed',
      `指针升版写出失败并已回滚本批：${(error as Error).message}`,
    );
  }
  // 新投影依赖落盘后的 CU，所以刷新排在指针写出之后；任一失败按原字节回滚整批（指针 + 已刷新文件）。
  const frameworkRoot = pending.some(item => item.refresh) ? resolveProbeFrameworkRoot(projectRoot, __dirname) : '';
  for (const { loaded, feature, refresh } of pending) {
    if (!refresh) continue;
    const before = DERIVED_PROJECTION_FILES.map(name => {
      const location = resolveFeatureArtifact(projectRoot, feature, name);
      return location.exists
        ? { file: location.actualPath, bytes: fs.readFileSync(location.actualPath) }
        : { file: location.canonicalPath, bytes: null };
    });
    // 本项自身失败时由 writer 内部回滚（逐文件 temp→rename，写到一半的那份不落盘）；这里只登记已成功的项。
    try {
      materializeBlueprintSkillInputs(projectRoot, feature, frameworkRoot, refresh);
      refreshed.push(...before);
    } catch (error) {
      rollback();
      throw new ChangeUnitCandidateRejected(
        'change_unit_blueprint_ref_bump_rejected',
        `CU ${String(loaded.changeUnit.change_unit_id)} 升版后派生投影刷新失败（整批未落盘）：${(error as Error).message}`,
      );
    }
  }
  result.bumped = pending.map(({ next }) => ({
    change_unit_id: String(next.change_unit_id),
    revision: Number(next.revision),
    blueprint_revision: identity.revision,
  }));
  return result;
}

export interface DesignPreparationReadiness {
  /** 设计准备段是否完成：≥1 活动（未被精确 supersede 退役）canonical CU 且每个都过设计可施工门。 */
  ready: boolean;
  /** 派生前的蓝图指针原位升版结果（reconcileChangeUnitBlueprintRefs），供 agent 看见升了谁、跳过谁及原因。 */
  blueprintRefs: BlueprintRefReconciliation;
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
  const blueprintRefs = reconcileChangeUnitBlueprintRefs(projectRoot, blueprintId);
  // 只对活动 CU 要求可施工：被精确 supersede 的历史 CU 已退役，不重新施工（与 closure 同一退役判定）。
  const retired = retiredChangeUnitIds(projectRoot, blueprintId);
  const units = enumerateCanonicalChangeUnits(projectRoot, blueprintId)
    .filter(loaded => !retired.has(String(loaded.changeUnit.change_unit_id)));
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
    blueprintRefs,
    changeUnitIds: perUnit.map(item => item.changeUnitId),
    perUnit,
    entersConstruction: false,
    nextEntry: ready ? 'change-unit-progression' : 'component-design',
  };
}

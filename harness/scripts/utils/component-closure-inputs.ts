import * as fs from 'fs';
import * as crypto from 'crypto';
import { featureFilePath } from '../../config';
import { ComponentBlueprintRef } from './component-blueprint-model';
import { loadCanonicalBlueprint, resolveComponentBlueprintRef, sha256Bytes } from './component-blueprint-path';
import {
  currentScopeItems,
  requirementTraceability,
  resolveCurrentScopeSource,
} from './blueprint-requirement-traceability';
import { stableJson } from './blueprint-discovery';
import {
  ClosureChangeUnitInput,
  ClosureFeatureInput,
  ClosureInputManifest,
  ComponentClosureIssue,
  closureIssue,
  compareCodePoint,
  stableSortStrings,
} from './component-closure-model';
import {
  ChangeUnitCompletionAdapterOptions,
  ChangeUnitCompletionObservation,
  observeChangeUnitCompletion,
  readCompletedFeatureDesign,
} from './change-unit-completion';
import { ChangeUnitArtifact, ChangeUnitRef, sameBlueprintIdentity } from './change-unit-model';
import {
  LoadedChangeUnit,
  asChangeUnitArtifact,
  createChangeUnitRef,
  deriveChangeUnitFeatureId,
  enumerateCanonicalChangeUnits,
  resolveChangeUnitRef,
} from './change-unit-path';
import { evaluateChangeUnitCarryForward } from './change-unit-reconciliation';
import { validateChangeUnitFeatureProjection } from './change-unit-feature-projection';
import { loadPhaseEvidenceManifest } from './phase-evidence-manifest';

export interface ComponentClosureInputOptions {
  completion?: ChangeUnitCompletionAdapterOptions;
  observeCompletion?: (projectRoot: string, changeUnit: ChangeUnitArtifact) => ChangeUnitCompletionObservation;
}

/** owner ref 身份不等于当前蓝图的 CU 一律不贡献；升版出口唯一在设计交接（b2d7f4e9 §3.3）。 */
const NOT_REPOINTED = '未原位升版：请经 /component-design 设计交接派生 readiness（reconcileChangeUnitBlueprintRefs）升版指针。';

interface RawClosureUnit {
  loaded: LoadedChangeUnit;
  ref: ChangeUnitRef;
  changeUnit: ChangeUnitArtifact;
  /** 空 = 在当前蓝图上；非空 = 未升版原因 + carry-forward 不通过的原因（说明为何升不了）。 */
  carryForwardReasons: string[];
}

export interface ResolvedClosureChangeUnit {
  loaded: LoadedChangeUnit;
  ref: ChangeUnitRef;
  changeUnit: ChangeUnitArtifact;
  input: ClosureChangeUnitInput;
  completionObservation: ChangeUnitCompletionObservation;
}

export interface ResolvedComponentClosureInputs {
  blueprint: ReturnType<typeof loadCanonicalBlueprint>;
  blueprintRef: ComponentBlueprintRef;
  units: ResolvedClosureChangeUnit[];
  currentUnits: ResolvedClosureChangeUnit[];
  manifest: ClosureInputManifest;
  issues: ComponentClosureIssue[];
}

function rawFileHash(filePath: string): string | null {
  return fs.existsSync(filePath) && fs.statSync(filePath).isFile()
    ? sha256Bytes(fs.readFileSync(filePath))
    : null;
}

function featureInput(
  projectRoot: string,
  unit: ChangeUnitArtifact,
  completion: ChangeUnitCompletionObservation,
  onCurrentBlueprint: boolean,
): ClosureFeatureInput {
  // M5A §4.3：新编码 = base64url(blueprint_id \0 change_unit_id)；物理路径经 featureFilePath SSOT。
  const featureId = deriveChangeUnitFeatureId(unit.blueprint_id, unit.change_unit_id);
  const { spec } = readCompletedFeatureDesign(projectRoot, featureId, completion);
  // 未原位升版的 CU 已由 carry_forward:false 挡住并路由 reconcile_blueprint；其施工投影待升版后按当前蓝图再判，
  // 不拿旧蓝图 ref 过精确解析器（b2d7f4e9 §3.3/§3.4）。
  const projection = onCurrentBlueprint
    ? validateChangeUnitFeatureProjection(projectRoot, featureId, spec.contracts, spec.acceptance, Boolean(spec.useCases), 'review')
    : { issues: [], useCasesRequired: false, dagRequired: false };
  const evidenceHashes = stableSortStrings((completion.expectedChain ?? []).flatMap(phase => {
    const loaded = loadPhaseEvidenceManifest(projectRoot, featureId, phase);
    return loaded ? [loaded.fileSha256, loaded.manifest.aggregate_sha256] : [];
  }));
  return {
    feature_id: featureId,
    change_unit_id: unit.change_unit_id,
    contracts_sha256: rawFileHash(featureFilePath(projectRoot, featureId, 'contracts.yaml')),
    acceptance_sha256: rawFileHash(featureFilePath(projectRoot, featureId, 'acceptance.yaml')),
    completion_sha256: rawFileHash(featureFilePath(projectRoot, featureId, 'feature-completion.json')),
    evidence_manifest_hashes: evidenceHashes,
    projection_issue_ids: stableSortStrings([
      ...(spec.shape_issues ?? []).map((_, index) => `feature_spec_shape:${index}`),
      ...projection.issues.map(item => item.id),
    ]),
    use_cases_required: projection.useCasesRequired,
    dag_required: projection.dagRequired,
  };
}

function inspectRetirement(
  units: ReadonlyArray<Pick<RawClosureUnit, 'ref' | 'changeUnit'>>,
  issues: ComponentClosureIssue[],
): Map<string, string> {
  const byId = new Map(units.map(unit => [unit.changeUnit.change_unit_id, unit]));
  const retiredBy = new Map<string, string>();
  const supersedesGraph = new Map<string, string>();
  for (const unit of units) {
    const targetRef = unit.changeUnit.supersedes;
    if (!targetRef) continue;
    supersedesGraph.set(targetRef.change_unit_id, unit.changeUnit.change_unit_id);
    const target = byId.get(targetRef.change_unit_id);
    if (!target
      || targetRef.component_id !== unit.changeUnit.component_id
      || targetRef.blueprint_id !== unit.changeUnit.blueprint_id
      || target.ref.revision !== targetRef.revision
      || target.ref.artifact_sha256 !== targetRef.artifact_sha256) {
      issues.push(closureIssue(
        'component_closure_supersedes_invalid',
        `change-unit:${unit.changeUnit.change_unit_id}.supersedes`,
        `supersedes 必须精确绑定同部件 canonical CU：${targetRef.change_unit_id}。`,
        'BLOCKER',
        'repair_or_add_change_unit',
      ));
      continue;
    }
    const prior = retiredBy.get(targetRef.change_unit_id);
    if (prior && prior !== unit.changeUnit.change_unit_id) {
      issues.push(closureIssue(
        'component_closure_supersedes_conflict',
        `change-unit:${targetRef.change_unit_id}`,
        `${targetRef.change_unit_id} 被 ${prior} 与 ${unit.changeUnit.change_unit_id} 同时 supersede。`,
        'BLOCKER',
        'repair_or_add_change_unit',
      ));
    }
    retiredBy.set(targetRef.change_unit_id, unit.changeUnit.change_unit_id);
  }
  for (const start of byId.keys()) {
    const seen = new Set<string>();
    let cursor: string | undefined = start;
    while (cursor && supersedesGraph.has(cursor)) {
      if (seen.has(cursor)) {
        issues.push(closureIssue(
          'component_closure_supersedes_cycle',
          `change-unit:${start}`,
          `supersedes 形成环：${[...seen, cursor].join(' -> ')}。`,
          'BLOCKER',
          'repair_or_add_change_unit',
        ));
        break;
      }
      seen.add(cursor);
      cursor = supersedesGraph.get(cursor);
    }
  }
  return retiredBy;
}

/**
 * 活动 CU 集合的反面（b2d7f4e9 codex r2）：与 closure 同一个退役判定 `inspectRetirement`——被同部件 CU 以
 * supersedes 精确引用（目标 revision + artifact_sha256 与 canonical 一致）者退役。卷入冲突 / 环的不算退役（照旧阻断）。
 * 设计交接 readiness 与推进 ready set 只对活动 CU 要求可施工 / 计完成。
 */
export function retiredChangeUnitIds(projectRoot: string, blueprintId: string): Set<string> {
  // 枚举/单个 CU 不可加载时不判退役（= 按活动 CU 照旧校验、照旧阻断），错误由各消费方自己的加载报出。
  let loadedUnits: LoadedChangeUnit[];
  try { loadedUnits = enumerateCanonicalChangeUnits(projectRoot, blueprintId); } catch { return new Set(); }
  const units = loadedUnits.flatMap(loaded => {
    try { return [{ ref: createChangeUnitRef(loaded), changeUnit: asChangeUnitArtifact(loaded.changeUnit) }]; } catch { return []; }
  });
  const issues: ComponentClosureIssue[] = [];
  const retiredBy = inspectRetirement(units, issues);
  const disputed = new Set(issues.map(issue => issue.path));
  return new Set([...retiredBy.keys()].filter(id => !disputed.has(`change-unit:${id}`)));
}

export function resolveComponentClosureInputs(
  projectRoot: string,
  blueprintId: string,
  options: ComponentClosureInputOptions = {},
): ResolvedComponentClosureInputs {
  const issues: ComponentClosureIssue[] = [];
  const blueprint = loadCanonicalBlueprint(projectRoot, blueprintId);
  const blueprintRef: ComponentBlueprintRef = {
    artifact: 'component-blueprint@1',
    component_id: String(blueprint.blueprint.component_id),
    blueprint_id: String(blueprint.blueprint.blueprint_id),
    revision: Number(blueprint.blueprint.revision),
    source_fingerprint: String(blueprint.blueprint.source_fingerprint),
    artifact_sha256: blueprint.artifactSha256,
    target: { kind: 'blueprint', id: String(blueprint.blueprint.blueprint_id) },
  };
  try {
    resolveComponentBlueprintRef(projectRoot, blueprintRef);
  } catch (error) {
    issues.push(closureIssue('component_closure_blueprint_invalid', 'component_blueprint_ref', (error as Error).message, 'BLOCKER', 'reconcile_blueprint'));
  }

  const exactMappings = new Map(requirementTraceability(blueprint.blueprint).map(item => [item.item_id, item.blueprint_refs]));
  const requirements = currentScopeItems(blueprint.blueprint)
    .map(item => {
      let actualSourceSha256: string | undefined;
      try {
        actualSourceSha256 = resolveCurrentScopeSource(projectRoot, item.source_ref).source_sha256;
      } catch {
        actualSourceSha256 = undefined;
      }
      return {
        item_id: item.item_id,
        kind: item.kind,
        source_ref: item.source_ref,
        ...(item.source_revision ? { source_revision: item.source_revision } : {}),
        ...(actualSourceSha256 ? { source_sha256: actualSourceSha256 } : {}),
        blueprint_refs: stableSortStrings(exactMappings.get(item.item_id) ?? []),
      };
    })
    .sort((a, b) => compareCodePoint(a.item_id, b.item_id));

  const rawUnits: RawClosureUnit[] = [];
  // M5A §8.2：输入枚举限定同一 <features_dir>/<blueprint_id>/ 工作区（enumerateCanonicalChangeUnits
  // 只枚举该工作区含 change-unit.yaml 的子目录）；跨工作区 CU（含同 component_id 的早期演进）
  // 既不进入输入集、也不为任何 row 计分（proof 5）。
  // b2d7f4e9 §3.4 单路：owner ref = 当前蓝图者精确解析；其余 = 未原位升版，不贡献（carry_forward:false）。
  for (const loaded of enumerateCanonicalChangeUnits(projectRoot, blueprintId)) {
    try {
      const ref = createChangeUnitRef(loaded);
      const artifact = asChangeUnitArtifact(loaded.changeUnit);
      if (sameBlueprintIdentity(artifact.component_blueprint_ref, blueprintRef)) {
        const resolved = resolveChangeUnitRef(projectRoot, ref);
        rawUnits.push({ loaded: resolved, ref, changeUnit: asChangeUnitArtifact(resolved.changeUnit), carryForwardReasons: [] });
      } else {
        rawUnits.push({
          loaded,
          ref,
          changeUnit: artifact,
          carryForwardReasons: [NOT_REPOINTED, ...evaluateChangeUnitCarryForward(projectRoot, artifact).reasons],
        });
      }
    } catch (error) {
      issues.push(closureIssue(
        'component_closure_change_unit_invalid',
        `change-unit:${String(loaded.changeUnit.change_unit_id ?? '?')}`,
        (error as Error).message,
        'BLOCKER',
        'repair_or_add_change_unit',
      ));
    }
  }
  rawUnits.sort((a, b) => compareCodePoint(a.changeUnit.change_unit_id, b.changeUnit.change_unit_id));
  const retiredBy = inspectRetirement(rawUnits, issues);
  const observe = options.observeCompletion
    ?? ((root: string, unit: ChangeUnitArtifact) => observeChangeUnitCompletion(root, unit, options.completion));
  const units: ResolvedClosureChangeUnit[] = rawUnits.map(({ carryForwardReasons, ...unit }) => {
    const completion = observe(projectRoot, unit.changeUnit);
    const input: ClosureChangeUnitInput = {
      ref: unit.ref,
      current: !retiredBy.has(unit.changeUnit.change_unit_id),
      ...(retiredBy.has(unit.changeUnit.change_unit_id) ? { retired_by: retiredBy.get(unit.changeUnit.change_unit_id) } : {}),
      feature_id: completion.featureId,
      completion: completion.state,
      completion_reasons: stableSortStrings(completion.reasons),
      carry_forward: carryForwardReasons.length === 0,
      carry_forward_reasons: stableSortStrings(carryForwardReasons),
    };
    return { ...unit, input, completionObservation: completion };
  });
  const features = units
    .map(unit => featureInput(projectRoot, unit.changeUnit, unit.completionObservation, unit.input.carry_forward))
    .sort((a, b) => compareCodePoint(a.feature_id, b.feature_id));
  return {
    blueprint,
    blueprintRef,
    units,
    currentUnits: units.filter(unit => unit.input.current),
    manifest: {
      requirements,
      change_units: units.map(unit => unit.input),
      features,
    },
    issues,
  };
}

export function fingerprintComponentClosureInputs(value: unknown): string {
  return `sha256:${crypto.createHash('sha256').update(stableJson(value)).digest('hex')}`;
}

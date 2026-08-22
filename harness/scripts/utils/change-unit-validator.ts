import * as fs from 'fs';
import * as path from 'path';
import {
  ComponentBlueprintRef,
  BlueprintRecord,
  asRecord,
} from './component-blueprint-model';
import { resolveComponentBlueprintRef, validateComponentBlueprintRefShape } from './component-blueprint-path';
import { validateLiteSchema } from './lite-json-schema';
import {
  CHANGE_UNIT_ARTIFACT,
  ChangeUnitIssue,
  ChangeUnitRecord,
  blueprintRefAddress,
  changeUnitIssue,
  changeUnitNonEmpty,
  changeUnitRecords,
  changeUnitStrings,
  isChangeUnitRecord,
  sameBlueprintIdentity,
} from './change-unit-model';

export interface ChangeUnitValidationContext {
  projectRoot?: string;
  canonicalPath?: string;
}

function loadChangeUnitSchema(): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '..', '..', 'schemas', 'change-unit.schema.json'), 'utf8'),
  ) as Record<string, unknown>;
}

function duplicateIds(items: ChangeUnitRecord[], key: string): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const item of items) {
    const id = changeUnitNonEmpty(item[key]) ? String(item[key]).trim() : '';
    if (!id) continue;
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  return [...duplicates].sort();
}

function validateBlueprintRef(
  value: unknown,
  atPath: string,
  out: ChangeUnitIssue[],
): ComponentBlueprintRef | undefined {
  try {
    return validateComponentBlueprintRefShape(value);
  } catch (error) {
    out.push(changeUnitIssue('change_unit_blueprint_ref_invalid', atPath, (error as Error).message));
    return undefined;
  }
}

function arrayHasContent(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

function collectBlueprintSourceRefs(
  value: unknown,
  inheritedAuthoritative = false,
  all = new Set<string>(),
  authoritative = new Set<string>(),
): { all: Set<string>; authoritative: Set<string> } {
  if (Array.isArray(value)) {
    for (const item of value) collectBlueprintSourceRefs(item, inheritedAuthoritative, all, authoritative);
    return { all, authoritative };
  }
  const record = asRecord(value);
  if (!record) return { all, authoritative };
  const provenance = asRecord(record.provenance);
  const underAuthority = inheritedAuthoritative || provenance?.evidence_strength === 'authoritative';
  if (changeUnitNonEmpty(record.source_ref)) {
    const ref = String(record.source_ref);
    all.add(ref);
    if (underAuthority) authoritative.add(ref);
  }
  for (const child of Object.values(record)) {
    collectBlueprintSourceRefs(child, underAuthority, all, authoritative);
  }
  return { all, authoritative };
}

function validateProvenanceSource(
  provenance: BlueprintRecord,
  ownerRef: ComponentBlueprintRef | undefined,
  context: ChangeUnitValidationContext,
  out: ChangeUnitIssue[],
): void {
  if (!ownerRef) return;
  if (!context.projectRoot) {
    out.push(changeUnitIssue(
      'change_unit_provenance_context_missing',
      '$.provenance.source_ref',
      '校验正式 CU provenance 必须提供 projectRoot，以绑定 owner blueprint 或其已承认来源。',
    ));
    return;
  }
  try {
    const resolved = resolveComponentBlueprintRef(context.projectRoot, ownerRef);
    const ownerSourceRef = `${path.relative(context.projectRoot, resolved.canonicalPath).replace(/\\/g, '/')}#blueprint:${ownerRef.blueprint_id}`;
    const sourceRef = String(provenance.source_ref ?? '');
    if (sourceRef === ownerSourceRef) return;
    const acknowledged = collectBlueprintSourceRefs(resolved.blueprint);
    if (!acknowledged.all.has(sourceRef)) {
      out.push(changeUnitIssue(
        'change_unit_provenance_source_unrecognized',
        '$.provenance.source_ref',
        `source_ref=${sourceRef} 既未绑定 owner blueprint，也未被该 P1 blueprint 承认。`,
      ));
      return;
    }
    if (provenance.evidence_strength === 'authoritative' && !acknowledged.authoritative.has(sourceRef)) {
      out.push(changeUnitIssue(
        'change_unit_provenance_authority_invalid',
        '$.provenance',
        `source_ref=${sourceRef} 虽在 P1 blueprint 中出现，但不处于 authoritative provenance 下。`,
      ));
    }
  } catch (error) {
    out.push(changeUnitIssue(
      'change_unit_provenance_owner_unresolvable',
      '$.provenance.source_ref',
      `无法通过 owner blueprint 校验 provenance：${(error as Error).message}`,
    ));
  }
}

function validateCanonicalIdentity(
  cu: ChangeUnitRecord,
  canonicalPath: string | undefined,
  out: ChangeUnitIssue[],
): void {
  if (!canonicalPath) return;
  // M5A §3/§4.2 终态布局：`<features_dir>/<blueprint_id>/<change_unit_id>/change-unit.yaml`
  // 文件名固定 change-unit.yaml；unit=父目录名、blueprint=祖父目录名。
  const baseName = path.basename(canonicalPath);
  if (baseName !== 'change-unit.yaml') {
    out.push(changeUnitIssue(
      'change_unit_path_identity_mismatch',
      '$',
      `canonical Change Unit 文件名必须固定为 change-unit.yaml，实际=${baseName}。`,
    ));
  }
  const changeUnitId = path.basename(path.dirname(canonicalPath));
  const blueprintId = path.basename(path.dirname(path.dirname(canonicalPath)));
  if (cu.change_unit_id !== changeUnitId || cu.blueprint_id !== blueprintId) {
    out.push(changeUnitIssue(
      'change_unit_path_identity_mismatch',
      '$',
      `Change Unit identity 不一致：path blueprint=${blueprintId}, unit=${changeUnitId}; yaml blueprint=${String(cu.blueprint_id)}, unit=${String(cu.change_unit_id)}。`,
    ));
  }
  // M5A §4.2：CU 根 blueprint_id 必须等于 owner component_blueprint_ref.blueprint_id；
  // 根 blueprint_id 已在 schema required 中强制（validateLiteSchema）。
  const ownerRef = asRecord(cu.component_blueprint_ref);
  if (ownerRef && ownerRef.blueprint_id !== cu.blueprint_id) {
    out.push(changeUnitIssue(
      'change_unit_blueprint_mismatch',
      '$.component_blueprint_ref.blueprint_id',
      `owner blueprint_id=${String(ownerRef.blueprint_id)} 与 CU 根 blueprint_id=${String(cu.blueprint_id)} 不一致。`,
    ));
  }
}

export function validateChangeUnit(
  value: unknown,
  context: ChangeUnitValidationContext = {},
): ChangeUnitIssue[] {
  if (!isChangeUnitRecord(value)) {
    return [changeUnitIssue('change_unit_root_invalid', '$', 'canonical Change Unit YAML 根对象必须是 map。')];
  }
  const cu = value;
  const out: ChangeUnitIssue[] = [];
  for (const violation of validateLiteSchema(cu, loadChangeUnitSchema())) {
    out.push(changeUnitIssue('change_unit_schema_invalid', violation.path, violation.message));
  }
  if (cu.artifact !== CHANGE_UNIT_ARTIFACT) {
    out.push(changeUnitIssue('change_unit_artifact_invalid', '$.artifact', `artifact 必须为 ${CHANGE_UNIT_ARTIFACT}。`));
  }
  for (const forbidden of [
    'execution',
    'feature_id',
    'status',
    'ready',
    'completed',
    'completion',
    'component_closure',
    'p2_ready_set',
    'p3_closure',
    'runtime_flow_slices',
    'use_cases_required',
    'dag_required',
  ]) {
    if (Object.prototype.hasOwnProperty.call(cu, forbidden)) {
      out.push(changeUnitIssue(
        'change_unit_forbidden_authority_field',
        `$.${forbidden}`,
        `${forbidden} 不属于 canonical CU；Feature identity/ready/completion/closure 与派生义务不得由作者自报。`,
      ));
    }
  }
  validateCanonicalIdentity(cu, context.canonicalPath, out);

  const ownerRef = validateBlueprintRef(cu.component_blueprint_ref, '$.component_blueprint_ref', out);
  if (ownerRef?.target.kind !== 'blueprint') {
    out.push(changeUnitIssue(
      'change_unit_blueprint_owner_invalid',
      '$.component_blueprint_ref.target.kind',
      'component_blueprint_ref 必须 target.kind=blueprint。',
    ));
  }
  if (ownerRef && cu.component_id !== ownerRef.component_id) {
    out.push(changeUnitIssue(
      'change_unit_blueprint_owner_mismatch',
      '$.component_blueprint_ref.component_id',
      `CU component_id=${String(cu.component_id)} 与 blueprint owner=${ownerRef.component_id} 不一致。`,
    ));
  }

  const provenance = asRecord(cu.provenance);
  if (provenance) {
    const sourceKind = String(provenance.source_kind ?? '').toLowerCase();
    const sourceRef = String(provenance.source_ref ?? '').toLowerCase();
    if (sourceKind.includes('provider') || sourceRef.startsWith('provider:')) {
      out.push(changeUnitIssue(
        'change_unit_provenance_authority_invalid',
        '$.provenance',
        'Provider 只能出现在 extraction_method；正式 CU source_kind/source_ref 必须指向蓝图或权威事实。',
      ));
    }
    if (!changeUnitNonEmpty(provenance.observed_at) || Number.isNaN(Date.parse(String(provenance.observed_at)))) {
      out.push(changeUnitIssue('change_unit_provenance_time_invalid', '$.provenance.observed_at', 'observed_at 必须是可解析时间。'));
    }
    validateProvenanceSource(provenance, ownerRef, context, out);
  }

  if (!changeUnitNonEmpty(cu.purpose)) {
    out.push(changeUnitIssue('change_unit_purpose_missing', '$.purpose', 'purpose 必须非空。'));
  }
  const provides = changeUnitRecords(cu.provides);
  const predicates = changeUnitRecords(cu.target_predicates);
  const designRefs = Array.isArray(cu.design_refs) ? cu.design_refs : [];
  const touches = changeUnitRecords(cu.touches);
  const invariants = changeUnitRecords(cu.preserved_invariants);
  const blockers = changeUnitRecords(cu.blockers);
  const requirements = changeUnitRecords(cu.requires);

  for (const [items, key, id] of [
    [provides, 'provide_id', 'change_unit_provide_id_duplicate'],
    [predicates, 'predicate_id', 'change_unit_predicate_id_duplicate'],
    [invariants, 'invariant_id', 'change_unit_invariant_id_duplicate'],
    [requirements, 'require_id', 'change_unit_require_id_duplicate'],
    [blockers, 'blocker_id', 'change_unit_blocker_id_duplicate'],
  ] as Array<[ChangeUnitRecord[], string, string]>) {
    const duplicates = duplicateIds(items, key);
    if (duplicates.length > 0) out.push(changeUnitIssue(id, '$', `稳定 ID 重复：${duplicates.join(', ')}`));
  }
  if (provides.length === 0) {
    out.push(changeUnitIssue('change_unit_provides_missing', '$.provides', '至少声明一个 provide。'));
  }
  if (designRefs.length === 0) {
    out.push(changeUnitIssue('change_unit_design_refs_missing', '$.design_refs', '至少声明一个当前 delta design_ref。'));
  }
  if (touches.length === 0) {
    out.push(changeUnitIssue('change_unit_touches_missing', '$.touches', '至少声明一个有 owner 的真实写集/施工归属。'));
  }
  if (invariants.length === 0) {
    out.push(changeUnitIssue('change_unit_invariants_missing', '$.preserved_invariants', '至少声明一个 preserved invariant。'));
  }
  if (predicates.length === 0) {
    out.push(changeUnitIssue('change_unit_predicates_missing', '$.target_predicates', '至少声明一个 target predicate。'));
  }
  if (!arrayHasContent(cu.verification_refs)) {
    out.push(changeUnitIssue('change_unit_verification_missing', '$.verification_refs', '至少声明一个 verification ref。'));
  }

  const parsedDesignRefs: ComponentBlueprintRef[] = [];
  designRefs.forEach((ref, index) => {
    const parsed = validateBlueprintRef(ref, `$.design_refs[${index}]`, out);
    if (parsed) parsedDesignRefs.push(parsed);
  });
  if (ownerRef) {
    for (let index = 0; index < parsedDesignRefs.length; index++) {
      if (!sameBlueprintIdentity(ownerRef, parsedDesignRefs[index])) {
        out.push(changeUnitIssue(
          'change_unit_blueprint_identity_mismatch',
          `$.design_refs[${index}]`,
          'owner ref 与 design ref 的 component/blueprint/revision/source/artifact identity 必须完全一致。',
        ));
      }
    }
  }
  const designAddresses = new Set(parsedDesignRefs.map(blueprintRefAddress));
  touches.forEach((touch, index) => {
    const ref = validateBlueprintRef(touch.design_ref, `$.touches[${index}].design_ref`, out);
    if (ref && ownerRef && !sameBlueprintIdentity(ownerRef, ref)) {
      out.push(changeUnitIssue('change_unit_touch_blueprint_mismatch', `$.touches[${index}].design_ref`, 'touch ref 必须归属同一蓝图 identity。'));
    }
    if (ref && !designAddresses.has(blueprintRefAddress(ref))) {
      out.push(changeUnitIssue(
        'change_unit_touch_not_in_design_refs',
        `$.touches[${index}].design_ref`,
        `touch ${blueprintRefAddress(ref)} 必须同时出现在 design_refs。`,
      ));
    }
    if (!arrayHasContent(touch.write_refs)) {
      out.push(changeUnitIssue('change_unit_touch_write_refs_missing', `$.touches[${index}].write_refs`, 'touch 必须声明真实或计划写集引用。'));
    }
  });

  const provideIds = new Set(provides.map(item => String(item.provide_id ?? '')).filter(Boolean));
  predicates.forEach((predicate, index) => {
    const linked = changeUnitStrings(predicate.provide_ids);
    const unknown = linked.filter(id => !provideIds.has(id));
    if (linked.length === 0 || unknown.length > 0) {
      out.push(changeUnitIssue(
        'change_unit_predicate_provide_invalid',
        `$.target_predicates[${index}].provide_ids`,
        linked.length === 0 ? 'predicate 必须绑定本 CU provide。' : `predicate 引用未知 provide：${unknown.join(', ')}`,
      ));
    }
    if (!arrayHasContent(predicate.verification_refs)) {
      out.push(changeUnitIssue(
        'change_unit_predicate_verification_missing',
        `$.target_predicates[${index}].verification_refs`,
        'predicate 必须声明验证义务，但不在 CU 中编造施工文件/符号。',
      ));
    }
  });

  invariants.forEach((invariant, index) => {
    if (!arrayHasContent(invariant.evidence_refs)) {
      out.push(changeUnitIssue('change_unit_invariant_evidence_missing', `$.preserved_invariants[${index}].evidence_refs`, 'invariant 必须有证据引用。'));
    }
  });
  requirements.forEach((requirement, index) => {
    if (requirement.from_change_unit_id === cu.change_unit_id) {
      out.push(changeUnitIssue('change_unit_self_dependency', `$.requires[${index}]`, 'CU 不得 require 自己的 provide。'));
    }
  });

  const safe = asRecord(cu.safe_intermediate_state);
  if (!safe
    || !changeUnitNonEmpty(safe.description)
    || !arrayHasContent(safe.build_validation_refs)
    || !arrayHasContent(safe.compatibility_refs)
    || !arrayHasContent(safe.recovery_refs)) {
    out.push(changeUnitIssue(
      'change_unit_safe_intermediate_state_invalid',
      '$.safe_intermediate_state',
      '安全中间态必须说明独立构建、兼容与恢复证据；不能依赖未来单元才正确。',
    ));
  }

  blockers.forEach((blocker, index) => {
    if (Object.prototype.hasOwnProperty.call(blocker, 'resolved')) {
      out.push(changeUnitIssue('change_unit_blocker_self_resolved', `$.blockers[${index}].resolved`, 'blocker 活动性必须由 probe/权威事实重算。'));
    }
    if (blocker.observation === 'machine' && !isChangeUnitRecord(blocker.probe)) {
      out.push(changeUnitIssue('change_unit_blocker_probe_missing', `$.blockers[${index}].probe`, '机器可观测 blocker 必须声明 probe。'));
    }
    if (blocker.observation === 'human'
      && (!changeUnitNonEmpty(blocker.authority_ref) || !changeUnitNonEmpty(blocker.source_revision))) {
      out.push(changeUnitIssue(
        'change_unit_blocker_authority_missing',
        `$.blockers[${index}]`,
        'human-only blocker 必须声明 authority_ref 与 source_revision。',
      ));
    }
  });

  return out;
}

export function blockerChangeUnitIssues(issues: ChangeUnitIssue[]): ChangeUnitIssue[] {
  return issues.filter(item => item.severity === 'BLOCKER');
}

export function assertValidChangeUnit(
  value: unknown,
  context: ChangeUnitValidationContext = {},
): ChangeUnitRecord {
  const issues = blockerChangeUnitIssues(validateChangeUnit(value, context));
  if (issues.length > 0) {
    throw new Error(issues.map(item => `[${item.id}] ${item.path}: ${item.message}`).join('\n'));
  }
  return value as ChangeUnitRecord;
}

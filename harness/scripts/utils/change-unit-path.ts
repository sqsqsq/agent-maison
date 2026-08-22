import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import { featuresDirPath, hasFeatureConstructionMarkers } from '../../config';
// M5A §4.3：身份 ↔ 物理路径的唯一 SSOT（零依赖 CJS）；本文件只做 re-export 与
// 契约层校验，不另写 decoder/拼接实现（Hook 与 harness 同源，见 P2 tasks 8.4）。
import {
  encodeCuFeatureId,
  featureRelativePath,
  parseCuFeatureId,
  assertSafeSegment,
} from './feature-identity';
import { sha256Bytes } from './component-blueprint-path';
import {
  CHANGE_UNIT_ARTIFACT,
  ChangeUnitArtifact,
  ChangeUnitRecord,
  ChangeUnitRef,
  changeUnitNonEmpty,
  isChangeUnitRecord,
} from './change-unit-model';
import { blockerChangeUnitIssues, validateChangeUnit } from './change-unit-validator';

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;

export class ChangeUnitResolutionError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'ChangeUnitResolutionError';
  }
}

/** M5A §3 规则 1：blueprint_id / change_unit_id 收紧为安全路径段；component_id 沿用
 * HEAD 的 safeSegment 语义（不新增放宽；仅蓝图 schema root component_id 保持 stableId）。 */
export function assertChangeUnitSegment(value: string, name: 'component_id' | 'change_unit_id' | 'blueprint_id'): void {
  assertSafeSegment(value, name);
}

/**
 * M5A §3：工作区根 = `<features_dir>/<blueprint_id>`；CU 目录 = 工作区下一层，
 * 目录名即 change_unit_id（拒绝保留名 `blueprint`，与 blueprint/ 目录同层）。
 */
export function changeUnitDirectory(projectRoot: string, blueprintId: string): string {
  assertChangeUnitSegment(blueprintId, 'blueprint_id');
  return path.join(featuresDirPath(projectRoot), blueprintId);
}

/** M5A §3：CU canonical artifact = `<工作区>/<unit_id>/change-unit.yaml`（文件名固定）。 */
export function changeUnitPath(projectRoot: string, blueprintId: string, changeUnitId: string): string {
  assertChangeUnitSegment(changeUnitId, 'change_unit_id');
  if (changeUnitId === 'blueprint') {
    throw new ChangeUnitResolutionError(
      'change_unit_id_reserved',
      `change_unit_id=${JSON.stringify(changeUnitId)} 为保留名，不得与工作区 blueprint/ 目录同名。`,
    );
  }
  return path.join(changeUnitDirectory(projectRoot, blueprintId), changeUnitId, 'change-unit.yaml');
}

/** M5A §4.3 re-export：逻辑 featureId = `cu-` + base64url(blueprint_id \0 change_unit_id)。 */
export function deriveChangeUnitFeatureId(blueprintId: string, changeUnitId: string): string {
  return encodeCuFeatureId(blueprintId, changeUnitId);
}

export function parseChangeUnitFeatureId(featureId: string): { blueprintId: string; changeUnitId: string } {
  return parseCuFeatureId(featureId);
}

export interface LoadedChangeUnit {
  canonicalPath: string;
  bytes: Buffer;
  artifactSha256: string;
  changeUnit: ChangeUnitRecord;
}

/** M5A §4.2/8.1：以 (blueprint_id, change_unit_id) 定位；校验 YAML 根 blueprint_id /
 * change_unit_id 与路径段一致（目录名即 change_unit_id）。 */
export function loadCanonicalChangeUnit(
  projectRoot: string,
  blueprintId: string,
  changeUnitId: string,
): LoadedChangeUnit {
  const canonicalPath = changeUnitPath(projectRoot, blueprintId, changeUnitId);
  if (!fs.existsSync(canonicalPath)) {
    throw new ChangeUnitResolutionError(
      'change_unit_missing',
      `canonical Change Unit 不存在：${canonicalPath}；loader 不扫描 Feature/legacy 路径，不回退旧根 blueprint/component/。`,
    );
  }
  const bytes = fs.readFileSync(canonicalPath);
  let parsed: unknown;
  try {
    parsed = YAML.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new ChangeUnitResolutionError(
      'change_unit_yaml_invalid',
      `canonical Change Unit YAML 无法解析：${(error as Error).message}`,
    );
  }
  if (!isChangeUnitRecord(parsed)) {
    throw new ChangeUnitResolutionError('change_unit_root_invalid', 'canonical Change Unit YAML 根对象必须是 map。');
  }
  const mismatches: string[] = [];
  if (String(parsed.blueprint_id) !== blueprintId) {
    mismatches.push(`blueprint_id yaml=${String(parsed.blueprint_id)} path=${blueprintId}`);
  }
  if (String(parsed.change_unit_id) !== changeUnitId) {
    mismatches.push(`change_unit_id yaml=${String(parsed.change_unit_id)} path=${changeUnitId}`);
  }
  if (mismatches.length > 0) {
    throw new ChangeUnitResolutionError('change_unit_identity_mismatch', mismatches.join('；'));
  }
  return { canonicalPath, bytes, artifactSha256: sha256Bytes(bytes), changeUnit: parsed };
}

/** M5A §8.1：枚举同一工作区子目录中含 change-unit.yaml 者（排除 blueprint/），按目录名排序。 */
export function enumerateCanonicalChangeUnits(projectRoot: string, blueprintId: string): LoadedChangeUnit[] {
  const dir = changeUnitDirectory(projectRoot, blueprintId);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name !== 'blueprint'
      && fs.existsSync(path.join(dir, entry.name, 'change-unit.yaml')))
    .map(entry => entry.name)
    .sort((a, b) => a < b ? -1 : a > b ? 1 : 0)
    .map(changeUnitId => loadCanonicalChangeUnit(projectRoot, blueprintId, changeUnitId));
}

export function validateChangeUnitRefShape(value: unknown): ChangeUnitRef {
  const ref = isChangeUnitRecord(value) ? value : undefined;
  const errors: string[] = [];
  if (!ref) errors.push('ref 必须是对象');
  if (ref?.artifact !== CHANGE_UNIT_ARTIFACT) errors.push(`artifact 必须为 ${CHANGE_UNIT_ARTIFACT}`);
  if (!changeUnitNonEmpty(ref?.component_id)) errors.push('component_id 必填');
  if (!changeUnitNonEmpty(ref?.blueprint_id)) errors.push('blueprint_id 必填');
  if (!changeUnitNonEmpty(ref?.change_unit_id)) errors.push('change_unit_id 必填');
  if (!Number.isInteger(ref?.revision) || Number(ref?.revision) < 1) errors.push('revision 必须是正整数');
  if (!changeUnitNonEmpty(ref?.artifact_sha256) || !SHA256_PATTERN.test(String(ref?.artifact_sha256))) {
    errors.push('artifact_sha256 必须是 sha256:<64 lowercase hex>');
  }
  if (errors.length > 0) {
    throw new ChangeUnitResolutionError('change_unit_ref_invalid', errors.join('；'));
  }
  assertChangeUnitSegment(String(ref!.component_id), 'component_id');
  assertChangeUnitSegment(String(ref!.blueprint_id), 'blueprint_id');
  assertChangeUnitSegment(String(ref!.change_unit_id), 'change_unit_id');
  return value as ChangeUnitRef;
}

export function createChangeUnitRef(loaded: LoadedChangeUnit): ChangeUnitRef {
  const cu = loaded.changeUnit;
  return validateChangeUnitRefShape({
    artifact: CHANGE_UNIT_ARTIFACT,
    component_id: cu.component_id,
    blueprint_id: cu.blueprint_id,
    change_unit_id: cu.change_unit_id,
    revision: cu.revision,
    artifact_sha256: loaded.artifactSha256,
  });
}

export function resolveChangeUnitRef(projectRoot: string, value: unknown): LoadedChangeUnit & { ref: ChangeUnitRef } {
  const ref = validateChangeUnitRefShape(value);
  const loaded = loadCanonicalChangeUnit(projectRoot, ref.blueprint_id, ref.change_unit_id);
  const mismatches: string[] = [];
  if (loaded.changeUnit.component_id !== ref.component_id) {
    mismatches.push(`component_id yaml=${String(loaded.changeUnit.component_id)} ref=${ref.component_id}`);
  }
  if (loaded.changeUnit.blueprint_id !== ref.blueprint_id) {
    mismatches.push(`blueprint_id yaml=${String(loaded.changeUnit.blueprint_id)} ref=${ref.blueprint_id}`);
  }
  if (loaded.changeUnit.change_unit_id !== ref.change_unit_id) {
    mismatches.push(`change_unit_id yaml=${String(loaded.changeUnit.change_unit_id)} ref=${ref.change_unit_id}`);
  }
  if (loaded.changeUnit.revision !== ref.revision) {
    mismatches.push(`revision yaml=${String(loaded.changeUnit.revision)} ref=${ref.revision}`);
  }
  if (loaded.artifactSha256 !== ref.artifact_sha256) {
    mismatches.push(`artifact_sha256 bytes=${loaded.artifactSha256} ref=${ref.artifact_sha256}`);
  }
  if (mismatches.length > 0) {
    throw new ChangeUnitResolutionError('change_unit_identity_mismatch', mismatches.join('；'));
  }
  const ownerRef = isChangeUnitRecord(loaded.changeUnit.component_blueprint_ref)
    ? loaded.changeUnit.component_blueprint_ref
    : {};
  if (ownerRef.blueprint_id !== ref.blueprint_id || ownerRef.component_id !== ref.component_id) {
    mismatches.push(
      `component_blueprint_ref blueprint_id=${String(ownerRef.blueprint_id)} component_id=${String(ownerRef.component_id)}`
      + ` vs ref blueprint_id=${ref.blueprint_id} component_id=${ref.component_id}`,
    );
    throw new ChangeUnitResolutionError('change_unit_identity_mismatch', mismatches.join('；'));
  }
  const issues = blockerChangeUnitIssues(validateChangeUnit(loaded.changeUnit, {
    projectRoot,
    canonicalPath: loaded.canonicalPath,
  }));
  if (issues.length > 0) {
    throw new ChangeUnitResolutionError(
      'change_unit_invalid',
      `canonical Change Unit 未通过 schema/语义门：${issues.map(item => `${item.id}@${item.path}`).join(', ')}。`,
    );
  }
  const binding = inspectDerivedFeatureBinding(projectRoot, ref.blueprint_id, ref.change_unit_id, ref.component_id);
  if (binding.status === 'conflict') {
    throw new ChangeUnitResolutionError(
      'change_unit_feature_binding_conflict',
      `${binding.featureId} 无法接管：${binding.reason}。`,
    );
  }
  return { ...loaded, ref };
}

/** M5A §5.4 Feature binding 状态机（CU 目录与 Feature 目录合一后）。 */
export type FeatureBindingInspection =
  | { status: 'available'; featureId: string; featurePath: string }
  | { status: 'in_progress'; featureId: string; featurePath: string }
  | { status: 'matched'; featureId: string; featurePath: string; ref: ChangeUnitRef }
  | { status: 'conflict'; featureId: string; featurePath: string; reason: string };

/** M5A §5.4：判断目录是否有部分施工产物——复用 config.ts 共享 Feature 标志 SSOT
 *（hasFeatureConstructionMarkers / PHASE_SCOPED_ARTIFACTS），不另写第二份清单。 */
function hasPartialConstructionArtifacts(dirAbs: string): boolean {
  return hasFeatureConstructionMarkers(dirAbs);
}

/** M5A §5.4：CU 目录 = Feature 目录。换用 (blueprint_id, change_unit_id) 寻址；
 * 物理路径经唯一 SSOT（featureRelativePath）。componentId 参数（可选）来自调用方
 * 已加载的 canonical CU——binding 必须核对完整 CU 身份（含 component_id）。 */
export function inspectDerivedFeatureBinding(
  projectRoot: string,
  blueprintId: string,
  changeUnitId: string,
  componentId?: string,
): FeatureBindingInspection {
  const featureId = deriveChangeUnitFeatureId(blueprintId, changeUnitId);
  const rel = featureRelativePath(featureId);
  const featurePath = path.join(featuresDirPath(projectRoot), ...rel.split('/'));
  if (!fs.existsSync(featurePath)) return { status: 'available', featureId, featurePath };
  if (!fs.statSync(featurePath).isDirectory()) {
    return { status: 'conflict', featureId, featurePath, reason: '派生 Feature 物理路径存在但不是目录' };
  }
  const contractsPath = path.join(featurePath, 'contracts.yaml');
  if (!fs.existsSync(contractsPath)) {
    // §5.4：有施工产物但尚无 contracts.yaml → in_progress（正常链路：spec/plan 先行）
    if (hasPartialConstructionArtifacts(featurePath)) {
      return { status: 'in_progress', featureId, featurePath };
    }
    return { status: 'available', featureId, featurePath };
  }
  try {
    const contracts = YAML.parse(fs.readFileSync(contractsPath, 'utf8')) as unknown;
    const root = isChangeUnitRecord(contracts) ? contracts : undefined;
    const section = isChangeUnitRecord(root?.change_unit) ? root!.change_unit as ChangeUnitRecord : undefined;
    const ref = validateChangeUnitRefShape(section?.change_unit_ref);
    if (ref.blueprint_id !== blueprintId || ref.change_unit_id !== changeUnitId
      || (componentId !== undefined && ref.component_id !== componentId)) {
      return {
        status: 'conflict',
        featureId,
        featurePath,
        reason: `派生 Feature 已绑定 ${ref.blueprint_id}/${ref.change_unit_id}（component=${ref.component_id}）`,
      };
    }
    return { status: 'matched', featureId, featurePath, ref };
  } catch (error) {
    return { status: 'conflict', featureId, featurePath, reason: (error as Error).message };
  }
}

export function asChangeUnitArtifact(value: ChangeUnitRecord): ChangeUnitArtifact {
  return value as unknown as ChangeUnitArtifact;
}

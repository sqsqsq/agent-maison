import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import { featureDir } from '../../config';
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

const SAFE_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;

export class ChangeUnitResolutionError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'ChangeUnitResolutionError';
  }
}

export function assertChangeUnitSegment(value: string, name: 'component_id' | 'change_unit_id'): void {
  if (!SAFE_SEGMENT_PATTERN.test(value) || value === '.' || value === '..') {
    throw new ChangeUnitResolutionError(
      `${name}_invalid`,
      `${name}=${JSON.stringify(value)} 非法；只允许单个安全路径段，不接受空值、分隔符或 ..。`,
    );
  }
}

export function changeUnitDirectory(projectRoot: string, componentId: string): string {
  assertChangeUnitSegment(componentId, 'component_id');
  return path.resolve(projectRoot, 'blueprint', 'component', componentId, 'change-units');
}

export function changeUnitPath(projectRoot: string, componentId: string, changeUnitId: string): string {
  assertChangeUnitSegment(changeUnitId, 'change_unit_id');
  return path.join(changeUnitDirectory(projectRoot, componentId), `${changeUnitId}.yaml`);
}

export function deriveChangeUnitFeatureId(componentId: string, changeUnitId: string): string {
  assertChangeUnitSegment(componentId, 'component_id');
  assertChangeUnitSegment(changeUnitId, 'change_unit_id');
  const payload = Buffer.from(`${componentId}\0${changeUnitId}`, 'utf8').toString('base64url');
  return `cu-${payload}`;
}

export function parseChangeUnitFeatureId(featureId: string): { componentId: string; changeUnitId: string } {
  if (!featureId.startsWith('cu-') || featureId.length <= 3) {
    throw new ChangeUnitResolutionError('change_unit_feature_id_invalid', `Feature id 非 CU 派生 identity：${featureId}`);
  }
  let decoded: string;
  try {
    decoded = Buffer.from(featureId.slice(3), 'base64url').toString('utf8');
  } catch {
    throw new ChangeUnitResolutionError('change_unit_feature_id_invalid', `Feature id base64url 无法解析：${featureId}`);
  }
  const separator = decoded.indexOf('\0');
  if (separator <= 0 || separator !== decoded.lastIndexOf('\0') || separator === decoded.length - 1) {
    throw new ChangeUnitResolutionError('change_unit_feature_id_invalid', `Feature id payload 缺唯一 NUL 分隔：${featureId}`);
  }
  const componentId = decoded.slice(0, separator);
  const changeUnitId = decoded.slice(separator + 1);
  assertChangeUnitSegment(componentId, 'component_id');
  assertChangeUnitSegment(changeUnitId, 'change_unit_id');
  if (deriveChangeUnitFeatureId(componentId, changeUnitId) !== featureId) {
    throw new ChangeUnitResolutionError('change_unit_feature_id_invalid', `Feature id 非 canonical base64url：${featureId}`);
  }
  return { componentId, changeUnitId };
}

export interface LoadedChangeUnit {
  canonicalPath: string;
  bytes: Buffer;
  artifactSha256: string;
  changeUnit: ChangeUnitRecord;
}

export function loadCanonicalChangeUnit(
  projectRoot: string,
  componentId: string,
  changeUnitId: string,
): LoadedChangeUnit {
  const canonicalPath = changeUnitPath(projectRoot, componentId, changeUnitId);
  if (!fs.existsSync(canonicalPath)) {
    throw new ChangeUnitResolutionError(
      'change_unit_missing',
      `canonical Change Unit 不存在：${canonicalPath}；loader 不扫描 Feature/legacy 路径。`,
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
  return { canonicalPath, bytes, artifactSha256: sha256Bytes(bytes), changeUnit: parsed };
}

export function enumerateCanonicalChangeUnits(projectRoot: string, componentId: string): LoadedChangeUnit[] {
  const dir = changeUnitDirectory(projectRoot, componentId);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.yaml'))
    .map(entry => entry.name.slice(0, -'.yaml'.length))
    .sort((a, b) => a < b ? -1 : a > b ? 1 : 0)
    .map(changeUnitId => loadCanonicalChangeUnit(projectRoot, componentId, changeUnitId));
}

export function validateChangeUnitRefShape(value: unknown): ChangeUnitRef {
  const ref = isChangeUnitRecord(value) ? value : undefined;
  const errors: string[] = [];
  if (!ref) errors.push('ref 必须是对象');
  if (ref?.artifact !== CHANGE_UNIT_ARTIFACT) errors.push(`artifact 必须为 ${CHANGE_UNIT_ARTIFACT}`);
  if (!changeUnitNonEmpty(ref?.component_id)) errors.push('component_id 必填');
  if (!changeUnitNonEmpty(ref?.change_unit_id)) errors.push('change_unit_id 必填');
  if (!Number.isInteger(ref?.revision) || Number(ref?.revision) < 1) errors.push('revision 必须是正整数');
  if (!changeUnitNonEmpty(ref?.artifact_sha256) || !SHA256_PATTERN.test(String(ref?.artifact_sha256))) {
    errors.push('artifact_sha256 必须是 sha256:<64 lowercase hex>');
  }
  if (errors.length > 0) {
    throw new ChangeUnitResolutionError('change_unit_ref_invalid', errors.join('；'));
  }
  assertChangeUnitSegment(String(ref!.component_id), 'component_id');
  assertChangeUnitSegment(String(ref!.change_unit_id), 'change_unit_id');
  return value as ChangeUnitRef;
}

export function createChangeUnitRef(loaded: LoadedChangeUnit): ChangeUnitRef {
  const cu = loaded.changeUnit;
  return validateChangeUnitRefShape({
    artifact: CHANGE_UNIT_ARTIFACT,
    component_id: cu.component_id,
    change_unit_id: cu.change_unit_id,
    revision: cu.revision,
    artifact_sha256: loaded.artifactSha256,
  });
}

export function resolveChangeUnitRef(projectRoot: string, value: unknown): LoadedChangeUnit & { ref: ChangeUnitRef } {
  const ref = validateChangeUnitRefShape(value);
  const loaded = loadCanonicalChangeUnit(projectRoot, ref.component_id, ref.change_unit_id);
  const mismatches: string[] = [];
  if (loaded.changeUnit.component_id !== ref.component_id) {
    mismatches.push(`component_id yaml=${String(loaded.changeUnit.component_id)} ref=${ref.component_id}`);
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
  const binding = inspectDerivedFeatureBinding(projectRoot, ref.component_id, ref.change_unit_id);
  if (binding.status === 'conflict') {
    throw new ChangeUnitResolutionError(
      'change_unit_feature_binding_conflict',
      `${binding.featureId} 无法接管：${binding.reason}。`,
    );
  }
  return { ...loaded, ref };
}

export type FeatureBindingInspection =
  | { status: 'available'; featureId: string; featurePath: string }
  | { status: 'matched'; featureId: string; featurePath: string; ref: ChangeUnitRef }
  | { status: 'conflict'; featureId: string; featurePath: string; reason: string };

export function inspectDerivedFeatureBinding(
  projectRoot: string,
  componentId: string,
  changeUnitId: string,
): FeatureBindingInspection {
  const featureId = deriveChangeUnitFeatureId(componentId, changeUnitId);
  const featurePath = featureDir(projectRoot, featureId);
  if (!fs.existsSync(featurePath)) return { status: 'available', featureId, featurePath };
  const entries = fs.statSync(featurePath).isDirectory() ? fs.readdirSync(featurePath) : [];
  if (entries.length === 0) return { status: 'available', featureId, featurePath };
  const contractsPath = path.join(featurePath, 'contracts.yaml');
  if (!fs.existsSync(contractsPath)) {
    return { status: 'conflict', featureId, featurePath, reason: '派生 Feature 已非空但缺 contracts.change_unit 绑定' };
  }
  try {
    const contracts = YAML.parse(fs.readFileSync(contractsPath, 'utf8')) as unknown;
    const root = isChangeUnitRecord(contracts) ? contracts : undefined;
    const section = isChangeUnitRecord(root?.change_unit) ? root!.change_unit as ChangeUnitRecord : undefined;
    const ref = validateChangeUnitRefShape(section?.change_unit_ref);
    if (ref.component_id !== componentId || ref.change_unit_id !== changeUnitId) {
      return {
        status: 'conflict',
        featureId,
        featurePath,
        reason: `派生 Feature 已绑定 ${ref.component_id}/${ref.change_unit_id}`,
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

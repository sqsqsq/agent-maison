import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import {
  BLUEPRINT_ARTIFACT,
  BLUEPRINT_TARGET_KINDS,
  BlueprintRecord,
  ComponentBlueprintResolutionError,
  ComponentBlueprintRef,
  ResolvedBlueprintTarget,
  asRecord,
  nonEmptyString,
} from './component-blueprint-model';
import { resolveBlueprintTarget } from './blueprint-addressing';
import { blockerIssues, validateComponentBlueprint } from './component-blueprint-validator';

const COMPONENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;

export function assertComponentId(componentId: string): void {
  if (!COMPONENT_ID_PATTERN.test(componentId) || componentId === '.' || componentId === '..') {
    throw new ComponentBlueprintResolutionError(
      'component_id_invalid',
      `component_id=${JSON.stringify(componentId)} 非法；只允许单个安全路径段，不接受空值、分隔符或 ..。`,
    );
  }
}

export function componentBlueprintPath(projectRoot: string, componentId: string): string {
  assertComponentId(componentId);
  return path.resolve(projectRoot, 'blueprint', 'component', componentId, 'component-blueprint.yaml');
}

export function sha256Bytes(bytes: Buffer): string {
  return `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
}

export function validateComponentBlueprintRefShape(value: unknown): ComponentBlueprintRef {
  const ref = asRecord(value);
  const target = asRecord(ref?.target);
  const errors: string[] = [];
  if (!ref) errors.push('ref 必须是对象');
  if (ref?.artifact !== BLUEPRINT_ARTIFACT) errors.push(`artifact 必须为 ${BLUEPRINT_ARTIFACT}`);
  if (!nonEmptyString(ref?.component_id)) errors.push('component_id 必填');
  if (!nonEmptyString(ref?.blueprint_id)) errors.push('blueprint_id 必填');
  if (!Number.isInteger(ref?.revision) || Number(ref?.revision) < 1) errors.push('revision 必须是正整数');
  if (!nonEmptyString(ref?.source_fingerprint) || !SHA256_PATTERN.test(String(ref?.source_fingerprint))) {
    errors.push('source_fingerprint 必须是 sha256:<64 lowercase hex>');
  }
  if (!nonEmptyString(ref?.artifact_sha256) || !SHA256_PATTERN.test(String(ref?.artifact_sha256))) {
    errors.push('artifact_sha256 必须是 sha256:<64 lowercase hex>');
  }
  if (!target) errors.push('target 必须是对象');
  const kind = target?.kind;
  if (typeof kind !== 'string' || !BLUEPRINT_TARGET_KINDS.includes(kind as never)) {
    errors.push(`target.kind 必须为 ${BLUEPRINT_TARGET_KINDS.join('|')}`);
  }
  if (!nonEmptyString(target?.id)) errors.push('target.id 必填');
  if ((kind === 'node' || kind === 'flow') && !nonEmptyString(target?.view_id)) {
    errors.push(`target.kind=${String(kind)} 时 target.view_id 必填`);
  }
  if (target?.view_id !== undefined && !nonEmptyString(target.view_id)) {
    errors.push('target.view_id 若存在必须为非空字符串');
  }
  if (errors.length > 0) {
    throw new ComponentBlueprintResolutionError('component_blueprint_ref_invalid', errors.join('；'));
  }
  assertComponentId(String(ref!.component_id));
  return value as ComponentBlueprintRef;
}

export function loadCanonicalBlueprint(projectRoot: string, componentId: string): {
  canonicalPath: string;
  bytes: Buffer;
  artifactSha256: string;
  blueprint: BlueprintRecord;
} {
  const canonicalPath = componentBlueprintPath(projectRoot, componentId);
  if (!fs.existsSync(canonicalPath)) {
    throw new ComponentBlueprintResolutionError(
      'component_blueprint_missing',
      `canonical blueprint 不存在：${canonicalPath}；resolver 不扫描 feature/legacy 路径。`,
    );
  }
  const bytes = fs.readFileSync(canonicalPath);
  let parsed: unknown;
  try {
    parsed = YAML.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new ComponentBlueprintResolutionError(
      'component_blueprint_yaml_invalid',
      `canonical YAML 无法解析：${(error as Error).message}`,
    );
  }
  const blueprint = asRecord(parsed);
  if (!blueprint) {
    throw new ComponentBlueprintResolutionError('component_blueprint_root_invalid', 'canonical YAML 根对象必须是 map。');
  }
  return { canonicalPath, bytes, artifactSha256: sha256Bytes(bytes), blueprint };
}

export function resolveComponentBlueprintRef(projectRoot: string, value: unknown): ResolvedBlueprintTarget {
  const ref = validateComponentBlueprintRefShape(value);
  const loaded = loadCanonicalBlueprint(projectRoot, ref.component_id);
  const yamlComponentId = loaded.blueprint.component_id;
  if (yamlComponentId !== ref.component_id) {
    const pathComponentId = path.basename(path.dirname(loaded.canonicalPath));
    throw new ComponentBlueprintResolutionError(
      'component_identity_mismatch',
      `component identity 不一致：path=${pathComponentId}, yaml=${String(yamlComponentId)}, ref=${ref.component_id}。`,
    );
  }
  const identityMismatches: string[] = [];
  if (loaded.blueprint.blueprint_id !== ref.blueprint_id) {
    identityMismatches.push(`blueprint_id yaml=${String(loaded.blueprint.blueprint_id)} ref=${ref.blueprint_id}`);
  }
  if (loaded.blueprint.revision !== ref.revision) {
    identityMismatches.push(`revision yaml=${String(loaded.blueprint.revision)} ref=${ref.revision}`);
  }
  if (loaded.blueprint.source_fingerprint !== ref.source_fingerprint) {
    identityMismatches.push(
      `source_fingerprint yaml=${String(loaded.blueprint.source_fingerprint)} ref=${ref.source_fingerprint}`,
    );
  }
  if (loaded.artifactSha256 !== ref.artifact_sha256) {
    identityMismatches.push(`artifact_sha256 bytes=${loaded.artifactSha256} ref=${ref.artifact_sha256}`);
  }
  if (identityMismatches.length > 0) {
    throw new ComponentBlueprintResolutionError('component_blueprint_identity_mismatch', identityMismatches.join('；'));
  }
  const validationIssues = blockerIssues(validateComponentBlueprint(loaded.blueprint, {
    projectRoot,
    canonicalPath: loaded.canonicalPath,
  }));
  if (validationIssues.length > 0) {
    throw new ComponentBlueprintResolutionError(
      'component_blueprint_invalid',
      `canonical blueprint 未通过 schema/完整性门：${validationIssues.map(item => `${item.id}@${item.path}`).join(', ')}。`,
    );
  }
  const target = resolveBlueprintTarget(loaded.blueprint, ref.target);
  return { canonicalPath: loaded.canonicalPath, blueprint: loaded.blueprint, target, ref };
}

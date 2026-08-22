import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import { featuresDirPath } from '../../config';
import { sha256Bytes } from './component-blueprint-path';
import { COMPONENT_CLOSURE_ARTIFACT, ComponentClosureArtifact } from './component-closure-model';
import { assertBlueprintId } from './component-blueprint-path';

export class ComponentClosureResolutionError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'ComponentClosureResolutionError';
  }
}

/** M5A §8.1：closure 投影落入工作区 blueprint/ 子目录。 */
export function componentClosurePath(projectRoot: string, blueprintId: string): string {
  assertBlueprintId(blueprintId);
  return path.join(featuresDirPath(projectRoot), blueprintId, 'blueprint', 'component-closure.yaml');
}

export function componentClosureReviewPath(projectRoot: string, blueprintId: string): string {
  assertBlueprintId(blueprintId);
  return path.join(featuresDirPath(projectRoot), blueprintId, 'blueprint', 'component-closure.md');
}

export interface LoadedComponentClosure {
  canonicalPath: string;
  bytes: Buffer;
  artifactSha256: string;
  closure: ComponentClosureArtifact;
}

export function loadCanonicalComponentClosure(projectRoot: string, blueprintId: string): LoadedComponentClosure {
  const canonicalPath = componentClosurePath(projectRoot, blueprintId);
  if (!fs.existsSync(canonicalPath)) {
    throw new ComponentClosureResolutionError('component_closure_missing', `canonical Component closure 不存在：${canonicalPath}`);
  }
  const bytes = fs.readFileSync(canonicalPath);
  let parsed: unknown;
  try {
    parsed = YAML.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new ComponentClosureResolutionError('component_closure_yaml_invalid', (error as Error).message);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ComponentClosureResolutionError('component_closure_root_invalid', 'canonical Component closure 根对象必须是 map。');
  }
  const closure = parsed as ComponentClosureArtifact;
  if (closure.artifact !== COMPONENT_CLOSURE_ARTIFACT) {
    throw new ComponentClosureResolutionError('component_closure_artifact_invalid', `artifact 必须为 ${COMPONENT_CLOSURE_ARTIFACT}。`);
  }
  // M5A §8.1/8.4：path/content/ref 三方 blueprint_id 一致；content/ref（与 owner
  // blueprint）的 component_id 一致；任一方不符即以三值齐报（不依赖路径查找）。
  const refBlueprint = closure.component_blueprint_ref?.blueprint_id;
  const refComponent = closure.component_blueprint_ref?.component_id;
  if (closure.blueprint_id !== blueprintId || refBlueprint !== blueprintId) {
    throw new ComponentClosureResolutionError(
      'component_closure_identity_mismatch',
      `blueprint identity 不一致：path=${blueprintId}, yaml=${String(closure.blueprint_id)}, blueprint_ref=${String(refBlueprint)}。`,
    );
  }
  if (closure.component_id !== refComponent) {
    throw new ComponentClosureResolutionError(
      'component_closure_identity_mismatch',
      `component identity 不一致：yaml=${String(closure.component_id)}, blueprint_ref=${String(refComponent)}。`,
    );
  }
  if (closure.component_blueprint_ref?.target?.kind !== 'blueprint') {
    throw new ComponentClosureResolutionError('component_closure_blueprint_ref_invalid', 'component_blueprint_ref 必须 target=blueprint。');
  }
  return { canonicalPath, bytes, artifactSha256: sha256Bytes(bytes), closure };
}

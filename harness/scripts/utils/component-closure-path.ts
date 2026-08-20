import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import { assertComponentId, sha256Bytes } from './component-blueprint-path';
import { COMPONENT_CLOSURE_ARTIFACT, ComponentClosureArtifact } from './component-closure-model';

export class ComponentClosureResolutionError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'ComponentClosureResolutionError';
  }
}

export function componentClosurePath(projectRoot: string, componentId: string): string {
  assertComponentId(componentId);
  return path.resolve(projectRoot, 'blueprint', 'component', componentId, 'component-closure.yaml');
}

export function componentClosureReviewPath(projectRoot: string, componentId: string): string {
  assertComponentId(componentId);
  return path.resolve(projectRoot, 'blueprint', 'component', componentId, 'component-closure.md');
}

export interface LoadedComponentClosure {
  canonicalPath: string;
  bytes: Buffer;
  artifactSha256: string;
  closure: ComponentClosureArtifact;
}

export function loadCanonicalComponentClosure(projectRoot: string, componentId: string): LoadedComponentClosure {
  const canonicalPath = componentClosurePath(projectRoot, componentId);
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
  const refComponent = closure.component_blueprint_ref?.component_id;
  if (closure.component_id !== componentId || refComponent !== componentId) {
    throw new ComponentClosureResolutionError(
      'component_closure_identity_mismatch',
      `component identity 不一致：path=${componentId}, yaml=${String(closure.component_id)}, blueprint_ref=${String(refComponent)}。`,
    );
  }
  if (closure.component_blueprint_ref?.target?.kind !== 'blueprint') {
    throw new ComponentClosureResolutionError('component_closure_blueprint_ref_invalid', 'component_blueprint_ref 必须 target=blueprint。');
  }
  return { canonicalPath, bytes, artifactSha256: sha256Bytes(bytes), closure };
}

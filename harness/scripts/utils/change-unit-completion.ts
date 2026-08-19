import * as fs from 'fs';
import { featureFilePath } from '../../config';
import { resolveWorkflowSpec } from '../../workflow-loader';
import { featurePhasesFromWorkflow } from './phase-transition-policy';
import { loadFeatureTrackDecl } from './feature-track';
import { resolveFeatureTrack } from './runtime-policy';
import { CompletionVerdict, verifyFeatureCompletion } from './verify-feature-completion';
import { ChangeUnitArtifact } from './change-unit-model';
import {
  deriveChangeUnitFeatureId,
  inspectDerivedFeatureBinding,
  loadCanonicalChangeUnit,
} from './change-unit-path';

export type ChangeUnitCompletionState = 'ABSENT' | 'VALID' | 'STALE' | 'INVALID';

export interface ChangeUnitCompletionObservation {
  state: ChangeUnitCompletionState;
  featureId: string;
  expectedTrack?: string;
  expectedChain?: string[];
  reasons: string[];
}

export interface ChangeUnitCompletionAdapterOptions {
  projectionExists?: (projectRoot: string, featureId: string) => boolean;
  resolveExpected?: (projectRoot: string, featureId: string) => { expectedTrack: string; expectedChain: string[] };
  verify?: (input: {
    projectRoot: string;
    feature: string;
    expectedTrack: string;
    expectedChain: string[];
  }) => CompletionVerdict;
}

export function resolveChangeUnitExpectedExecution(
  projectRoot: string,
  featureId: string,
): { expectedTrack: string; expectedChain: string[] } {
  const workflow = resolveWorkflowSpec(projectRoot);
  const track = resolveFeatureTrack(loadFeatureTrackDecl(projectRoot, featureId));
  return { expectedTrack: track, expectedChain: featurePhasesFromWorkflow(workflow, track) };
}

export function observeChangeUnitCompletion(
  projectRoot: string,
  changeUnit: ChangeUnitArtifact,
  options: ChangeUnitCompletionAdapterOptions = {},
): ChangeUnitCompletionObservation {
  const featureId = deriveChangeUnitFeatureId(changeUnit.component_id, changeUnit.change_unit_id);
  const binding = inspectDerivedFeatureBinding(projectRoot, changeUnit.component_id, changeUnit.change_unit_id);
  if (binding.status === 'conflict') {
    return { state: 'INVALID', featureId, reasons: [binding.reason] };
  }
  if (binding.status === 'matched'
    && (binding.ref.revision !== changeUnit.revision
      || binding.ref.artifact_sha256 !== changeUnitRefHash(projectRoot, changeUnit))) {
    return { state: 'STALE', featureId, reasons: ['Feature contracts 绑定的是不同 CU revision/artifact hash。'] };
  }
  const projectionExists = options.projectionExists
    ?? ((root: string, feature: string) => fs.existsSync(featureFilePath(root, feature, 'feature-completion.json')));
  if (!projectionExists(projectRoot, featureId)) {
    return { state: 'ABSENT', featureId, reasons: ['从未形成可验证 feature-completion 投影。'] };
  }
  let expected: { expectedTrack: string; expectedChain: string[] };
  try {
    expected = (options.resolveExpected ?? resolveChangeUnitExpectedExecution)(projectRoot, featureId);
  } catch (error) {
    return { state: 'INVALID', featureId, reasons: [`workflow/track SSOT 无法解析：${(error as Error).message}`] };
  }
  const verdict = (options.verify ?? verifyFeatureCompletion)({
    projectRoot,
    feature: featureId,
    expectedTrack: expected.expectedTrack,
    expectedChain: expected.expectedChain,
  });
  return {
    state: verdict.verdict,
    featureId,
    expectedTrack: expected.expectedTrack,
    expectedChain: expected.expectedChain,
    reasons: verdict.reasons,
  };
}

function changeUnitRefHash(projectRoot: string, changeUnit: ChangeUnitArtifact): string {
  try {
    return loadCanonicalChangeUnit(projectRoot, changeUnit.component_id, changeUnit.change_unit_id).artifactSha256;
  } catch {
    return '';
  }
}

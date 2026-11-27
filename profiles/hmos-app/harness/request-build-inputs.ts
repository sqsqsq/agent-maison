import * as path from 'path';
import { listBuildProfileModules, discoverAppHapArtifacts, detectStaleSignedSuspect } from './hvigor-runner';
import { ROOT_BUILD_INPUTS, snapshotDeviceTestBuildInputs } from './device-test-build-reuse';
import { resolveProductSelection } from './product-selection';
import { resolveDeviceTestBuildMode } from './testing-build-conventions';
import { computeHapSha256Full } from './build-fingerprint';
import { realProjectPath } from '../../../harness/scripts/utils/project-relative-path';
import type { RequestExecutionInputs, RequestExecutionPhase, RequestBuildArtifact } from '../../../harness/scripts/utils/request-execution-inputs';

/** The project compile and installed app share build inputs; a Hypium request uses its selected modules. */
export function readRequestBuildInputs(projectRoot: string, _frameworkRoot: string, phase: RequestExecutionPhase,
  targets: readonly string[]): RequestExecutionInputs | null {
  const selection = resolveProductSelection({ projectRoot, purpose: phase === 'compile' ? 'coding' : phase === 'ut' ? 'ut' : 'device_test' });
  if (!selection.product) return null;
  const registered = listBuildProfileModules(projectRoot).map(module => module.srcPath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, ''));
  if (targets.some(file => !registered.some(module => file.startsWith(module + '/'))
    && !ROOT_BUILD_INPUTS.some(input => file === input || file.startsWith(input + '/')))) return null;
  const scope = [...new Set(registered.filter(module => phase !== 'ut' || targets.some(file => file.startsWith(module + '/'))))].sort();
  if (!scope.length) return null;
  const mode = phase === 'ut' ? 'test' : resolveDeviceTestBuildMode();
  const snapshot = snapshotDeviceTestBuildInputs(projectRoot, selection.product, mode, scope);
  return snapshot && { scope, sha256: snapshot.sha256 };
}

export function readRequestCompileHap(projectRoot: string): RequestBuildArtifact | null {
  const product = resolveProductSelection({ projectRoot, purpose: 'coding' }).product;
  if (!product) return null;
  const discovery = discoverAppHapArtifacts(projectRoot, product);
  const candidate = discovery.candidates[0];
  if (!candidate || !discovery.signedPath || detectStaleSignedSuspect(discovery.signedPath).status !== 'valid') return null;
  const safe = path.relative(projectRoot, discovery.signedPath).replace(/\\/g, '/');
  const sha256 = computeHapSha256Full(realProjectPath(projectRoot, safe, 'request compile HAP'));
  return sha256 ? { path: safe, sha256, module: candidate.moduleName } : null;
}

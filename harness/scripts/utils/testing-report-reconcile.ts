import * as fs from 'fs';
import * as path from 'path';
import { featurePhaseReportsDir, loadFrameworkConfig, resolveFeatureArtifact } from '../../config';
import { isCapabilitySkipped } from '../../capability-registry';
import { loadResolvedProfile } from '../../profile-loader';
import { loadPhaseEvidenceManifest, evidenceEntryMatchesCurrentFile } from './phase-evidence-manifest';
import { parseReviewIssueRows, reviewIssueRequiresRepair } from './repair-candidates';
import { listExecutionKeyRuns, FROZEN_RUN_ARTIFACTS } from '../../../profiles/hmos-app/harness/execution-key';
import { parseHylyreTrace } from '../../../profiles/hmos-app/harness/providers/device-test-run';
import { resolveCurrentHapSha256Full } from './actionable-evidence';
import type { ArtifactSnapshot } from './goal-failure-classifier';
import { resolveP0DeviceObligations } from './p0-semantic-gates';
import { validateRecordedNativeTraceArtifactBinding } from './native-trace-binding';

export function isRecordedDeviceBuildResult(value: unknown): boolean {
  const record = value as { hapPath?: unknown; reused?: unknown; hvigorExitCode?: unknown } | null | undefined;
  return !!record && typeof record.hapPath === 'string' && !!record.hapPath.trim()
    && typeof record.reused === 'boolean' && record.hvigorExitCode === 0;
}

/** Admission only: report gates still read every current obligation and retain the original execution outcome. */
export function canReconcileTestingReport(input: {
  projectRoot: string; frameworkRoot: string; feature: string;
  previous?: ArtifactSnapshot; current: ArtifactSnapshot; productChanged?: boolean; scopeChanged?: boolean;
}): boolean {
  if (input.productChanged || input.scopeChanged || !input.previous) return false;
  const previous = input.previous;
  const keys = Object.keys(input.current).sort();
  if (!keys.length || keys.join('\0') !== Object.keys(previous).sort().join('\0')) return false;
  const reports = ['review-report.md', 'test-report.md'].map(name =>
    path.resolve(resolveFeatureArtifact(input.projectRoot, input.feature, name).actualPath));
  const changed = keys.filter(key => previous[key].exists !== input.current[key].exists
    || previous[key].contentHash !== input.current[key].contentHash);
  if (!changed.length || changed.some(key => !reports.includes(path.resolve(input.projectRoot, key)))) return false;
  const manifest = loadPhaseEvidenceManifest(input.projectRoot, input.feature, 'testing');
  if (!manifest?.integrityOk || [...manifest.manifest.inputs, ...manifest.manifest.outputs]
    .some(entry => !reports.includes(path.resolve(input.projectRoot, entry.path))
      && !evidenceEntryMatchesCurrentFile(input.projectRoot, entry, input.feature))) return false;
  const reportsDir = featurePhaseReportsDir(input.projectRoot, input.feature, 'testing', input.frameworkRoot);
  const latest = listExecutionKeyRuns(reportsDir)[0];
  if (!latest || latest.record.outcome === 'started' || !latest.record.trace_path
    || latest.record.inputs.hap_sha256_full !== resolveCurrentHapSha256Full(input.projectRoot, reportsDir)
    || FROZEN_RUN_ARTIFACTS.some(file => file.group === 'execution'
      && (!(latest.record.frozen_files ?? []).includes(file.frozen) || !fs.existsSync(path.join(latest.runDir, file.frozen))))) return false;
  const evidencePath = path.join(reportsDir, 'device-test-evidence.json');
  try {
    const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
    if (evidence.hap_sha256_full !== latest.record.inputs.hap_sha256_full
      || path.resolve(evidence.trace_path) !== path.resolve(latest.record.trace_path)) return false;
  } catch { return false; }
  const trace = parseHylyreTrace(latest.record.trace_path);
  if (!trace) return false;
  try {
    const profile = loadResolvedProfile(input.projectRoot, loadFrameworkConfig(input.projectRoot), input.frameworkRoot);
    if (!isCapabilitySkipped(profile, 'device_test.build')) {
      const build = JSON.parse(fs.readFileSync(path.join(reportsDir, 'device-test-build.result.json'), 'utf8'));
      if (!isRecordedDeviceBuildResult(build)) return false;
    }
    if (resolveP0DeviceObligations(input.projectRoot, input.feature).device.length) {
      const run = JSON.parse(fs.readFileSync(path.join(reportsDir, 'device-test-run.meta.json'), 'utf8'));
      if (!validateRecordedNativeTraceArtifactBinding({
        trace, expectedFeature: input.feature, tracePath: latest.record.trace_path,
        testPlanPath: resolveFeatureArtifact(input.projectRoot, input.feature, 'test-plan.md').actualPath,
      }, run?.artifact_binding).ok) return false;
    }
  } catch { return false; }
  const review = resolveFeatureArtifact(input.projectRoot, input.feature, 'review-report.md').actualPath;
  if (fs.existsSync(review)) {
    for (const issue of parseReviewIssueRows(fs.readFileSync(review, 'utf8')).filter(row => reviewIssueRequiresRepair(row))) {
      const refs = [...`${issue.summary}\n${issue.evidence ?? ''}`.matchAll(/\bTC-\d+\b/gi)].map(match => match[0].toUpperCase());
      // A newly asserted passing/unobserved behavior needs a new observation, not a report-only SKIP.
      if (!refs.length || refs.some(id => !trace.cases?.some(item => item.id.toUpperCase() === id
        && (item.execution !== 'completed' || item.verification !== 'passed')))) return false;
    }
  }
  return true;
}

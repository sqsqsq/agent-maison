/**
 * Run-scoped harness artifact snapshots — avoid global reports/ overwrite across runs.
 */

import * as fs from 'fs';
import * as path from 'path';
import { featurePhaseReportsDir } from '../../config';
import type { FeaturePhase } from './phase-transition-policy';

export const PHASE_SNAPSHOT_FILES = [
  'summary.json',
  'script-report.json',
  'merged-report.md',
  'verifier.report.md',
  'trace.json',
] as const;

export type PhaseSnapshotFiles = Record<(typeof PHASE_SNAPSHOT_FILES)[number], string | null>;

export function snapshotPhaseHarness(
  projectRoot: string,
  feature: string,
  phase: FeaturePhase,
  runReportDir: string,
  frameworkRoot?: string,
): { snapshotDirRel: string; snapshot_files: PhaseSnapshotFiles } {
  const srcDir = featurePhaseReportsDir(projectRoot, feature, phase, frameworkRoot);
  const dstDir = path.join(projectRoot, runReportDir, 'phases', phase, 'harness');
  fs.mkdirSync(dstDir, { recursive: true });

  const snapshot_files = {} as PhaseSnapshotFiles;
  for (const file of PHASE_SNAPSHOT_FILES) {
    const src = path.join(srcDir, file);
    if (fs.existsSync(src)) {
      const dst = path.join(dstDir, file);
      fs.copyFileSync(src, dst);
      snapshot_files[file] = path.relative(projectRoot, dst).replace(/\\/g, '/');
    } else {
      snapshot_files[file] = null;
    }
  }

  return {
    snapshotDirRel: path.relative(projectRoot, dstDir).replace(/\\/g, '/'),
    snapshot_files,
  };
}

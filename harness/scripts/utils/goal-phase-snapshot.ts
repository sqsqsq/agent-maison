/**
 * Run-scoped harness artifact snapshots — avoid global reports/ overwrite across runs.
 */

import * as fs from 'fs';
import * as path from 'path';
import { featurePhaseReportsDir } from '../../config';
import type { FeaturePhase } from './phase-transition-policy';
import { loadVerifierEvidence } from './verifier-evidence';

/**
 * 快照名保持**稳定**（下游按固定名读存档），但 verifier 两份产物的**源文件**不再按固定名
 * 从 reports 目录直读——证据已按 subject 分区，源文件必须由 loader 选出当前 subject 后
 * 再复制（review 四轮 P0）。机器字段一律取自 JSON；MD 只为人读存档，任何消费者都不得
 * 回头解析它。
 */
export const PHASE_SNAPSHOT_FILES = [
  'summary.json',
  'script-report.json',
  'merged-report.md',
  'verifier.report.md',
  'trace.json',
] as const;

/** 由 loader 选出当前 subject 后再复制（不参与固定名直读）。 */
const SUBJECT_SCOPED_SNAPSHOT_FILES: ReadonlySet<string> = new Set(['verifier.report.md']);

export type PhaseSnapshotFiles = Record<(typeof PHASE_SNAPSHOT_FILES)[number], string | null>;

/** 快照时点的 verifier 机器事实（校验通过才有值；不通过=null，不猜）。 */
export interface PhaseSnapshotVerifierEvidence {
  subject_id: string;
  verdict: 'PASS' | 'FAIL';
  blocker_count: number;
}

export function snapshotPhaseHarness(
  projectRoot: string,
  feature: string,
  phase: FeaturePhase,
  runReportDir: string,
  frameworkRoot?: string,
): {
  snapshotDirRel: string;
  snapshot_files: PhaseSnapshotFiles;
  verifier_evidence: PhaseSnapshotVerifierEvidence | null;
} {
  const srcDir = featurePhaseReportsDir(projectRoot, feature, phase, frameworkRoot);
  const dstDir = path.join(projectRoot, runReportDir, 'phases', phase, 'harness');
  fs.mkdirSync(dstDir, { recursive: true });

  const snapshot_files = {} as PhaseSnapshotFiles;
  const copyInto = (src: string, snapshotName: (typeof PHASE_SNAPSHOT_FILES)[number]): void => {
    if (fs.existsSync(src)) {
      const dst = path.join(dstDir, snapshotName);
      fs.copyFileSync(src, dst);
      snapshot_files[snapshotName] = path.relative(projectRoot, dst).replace(/\\/g, '/');
    } else {
      snapshot_files[snapshotName] = null;
    }
  };

  for (const file of PHASE_SNAPSHOT_FILES) {
    if (SUBJECT_SCOPED_SNAPSHOT_FILES.has(file)) continue;
    copyInto(path.join(srcDir, file), file);
  }

  // 源文件**直接取 loader 这一次的结果**，不再另读一次 summary（review 五轮 P1）。
  // 独立第二次读取会引入不一致：loader 验证 A 之后 summary 换成 B，快照会得到
  // `verifier_evidence=A` 却复制 B 的文件。校验不通过就是没有可存档的机器证据。
  const loaded = loadVerifierEvidence(projectRoot, feature, phase, { frameworkRoot });
  if (loaded.ok) {
    copyInto(loaded.evidence.md_path_abs, 'verifier.report.md');
  } else {
    snapshot_files['verifier.report.md'] = null;
  }

  return {
    snapshotDirRel: path.relative(projectRoot, dstDir).replace(/\\/g, '/'),
    snapshot_files,
    verifier_evidence: loaded.ok
      ? {
          subject_id: loaded.evidence.subject_id,
          verdict: loaded.evidence.verdict,
          blocker_count: loaded.evidence.blocker_count,
        }
      : null,
  };
}

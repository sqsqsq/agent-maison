/**
 * Run-scoped harness artifact snapshots — avoid global reports/ overwrite across runs.
 */

import * as fs from 'fs';
import * as path from 'path';
import { featurePhaseReportsDir } from '../../config';
import type { FeaturePhase } from './phase-transition-policy';
import { loadVerifierEvidence, loadVerifierEvidenceForSubject } from './verifier-evidence';

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
  /**
   * plan 2f8a6d40 D3：这份报告审的是**被沿用的旧 subject**，不是当前材料
   * （闭环模式 completed_with_prior_review）。只在回落命中时置位——缺席即"当前材料自己
   * 审过"。不加第二个 subject 字段：`subject_id` 已是被沿用那份的 id，与同目录
   * `summary.json` 的 `verifier_closure.reviewed_subject_id` 对得上。
   */
  reused_from_prior_review?: true;
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
  //
  // plan 2f8a6d40 D3：当前 subject 无报告但本 phase 以 `completed_with_prior_review` 闭了环时，
  // 回落到 `summary.verifier_closure.reviewed_subject_id`——照抄 receipt-scaffold.ts:128 的形状
  // （当前 subject 优先，回落次之，取第一份验真通过的）。回落读的是**同目录刚复制的那份**
  // summary.json，与 loader 的锚同源，不新读第三份文件。
  let loaded = loadVerifierEvidence(projectRoot, feature, phase, { frameworkRoot });
  let reused = false;
  if (!loaded.ok) {
    const reusedSubject = readReusedSubjectId(snapshot_files['summary.json'], projectRoot);
    if (reusedSubject) {
      const fallback = loadVerifierEvidenceForSubject(projectRoot, feature, phase, reusedSubject, {
        frameworkRoot,
      });
      if (fallback.ok) {
        loaded = fallback;
        reused = true;
      }
    }
  }
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
          ...(reused ? { reused_from_prior_review: true as const } : {}),
        }
      : null,
  };
}

/** 从**已复制进快照目录**的 summary.json 取被沿用的 subject（缺文件/坏 JSON/无该字段=null，不抛）。 */
function readReusedSubjectId(summaryRel: string | null, projectRoot: string): string | null {
  if (!summaryRel) return null;
  try {
    const parsed = JSON.parse(
      fs.readFileSync(path.join(projectRoot, summaryRel), 'utf-8'),
    ) as { verifier_closure?: { reviewed_subject_id?: unknown } };
    const raw = parsed?.verifier_closure?.reviewed_subject_id;
    return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
  } catch {
    return null;
  }
}

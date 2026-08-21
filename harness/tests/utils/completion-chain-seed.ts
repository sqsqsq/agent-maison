// completion-chain-seed.ts —— 用生产 writer 造"一次成功 Goal run 的完成事实"
//
// 唯一实现，两处消费：
//   - verify-feature-completion.unit.test.ts（原 seedCleanChain，2 阶段链）
//   - mechanical-loop-closure.unit.test.ts（MG-A 跨层正链，workflow 真实全链）
//
// 纪律（plan 2d6b4f83 §5）：只调生产 writer，不手抄 feature-completion.json、
// 不复制 summary/manifest 结构；chain 由调用方给，本文件不推导也不裁决。

import * as fs from 'fs';
import * as path from 'path';

import { featureFilePath, receiptDirPath, resolveFeatureArtifact } from '../../config';
import { computeRunRequirementSha } from '../../scripts/utils/fidelity-shared';
import {
  loadPhaseEvidenceManifest,
  receiptPathForPhase,
  resolvePhaseEvidenceManifest,
  writePhaseEvidenceManifest,
  writeReceiptManifestPointer,
} from '../../scripts/utils/phase-evidence-manifest';
import { writeReviewClosureAttestation } from '../../scripts/utils/closure-attestation';
import type { Phase } from '../../scripts/utils/types';

export interface SeedCompletionChainOptions {
  projectRoot: string;
  feature: string;
  chain: readonly string[];
  /** 默认 RUN1；同一 feature 多次 seed 时由调用方区分 */
  runId?: string;
  /** 确定性时间；默认与既有夹具同锚 */
  now?: () => Date;
}

const DEFAULT_NOW = () => new Date('2026-07-13T00:00:00.000Z');

/** 最小合法 lattice（validateSummaryV11：裸 1.1 拒收，夹具须带轴） */
export function minimalQualityAxes(): Record<string, unknown> {
  const na = {
    applicable: false,
    required_for_release: false,
    verdict: 'NOT_APPLICABLE',
    blocking_class: null,
    source_checks: [],
    resolution: null,
  };
  return {
    functional: {
      applicable: true,
      required_for_release: true,
      verdict: 'PASS',
      blocking_class: null,
      source_checks: [],
      resolution: null,
    },
    visual: na,
    asset: na,
    evidence: na,
  };
}

export function writeFeatureArtifact(
  projectRoot: string,
  feature: string,
  name: string,
  content: string,
): void {
  const target = resolveFeatureArtifact(projectRoot, feature, name).canonicalPath;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf-8');
}

/**
 * 只补缺失产物。seed 的职责是"把干净链补齐"，不是抹掉已有事实——真实 CU Feature 的
 * `contracts.yaml` 承载 `change_unit_ref` 绑定，覆写它会让 Feature binding 直接 conflict。
 */
function seedFeatureArtifactIfAbsent(
  projectRoot: string,
  feature: string,
  name: string,
  content: string,
): void {
  if (resolveFeatureArtifact(projectRoot, feature, name).exists) return;
  writeFeatureArtifact(projectRoot, feature, name, content);
}

/** summary 1.2 + lattice + closure_commit——completion 唯一可干净消费的形状 */
export function writePhaseSummary(
  projectRoot: string,
  feature: string,
  phase: string,
  verdict: string,
): void {
  const target = path.join(receiptDirPath(projectRoot, feature, phase), 'reports', 'summary.json');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify({
    schema_version: '1.2',
    verdict,
    report_validity: 'PASS',
    quality_axes: minimalQualityAxes(),
    release_readiness: 'READY',
    completion_status: 'COMPLETE',
    assurance: 'full',
    capability_resolutions: [],
    capability_resolution_contract_fingerprint: null,
    closure_status: 'closed',
    closure_commit: { schema_version: '1.0' },
  }), 'utf-8');
}

export function writePhaseReceipt(projectRoot: string, feature: string, phase: string): void {
  const target = receiptPathForPhase(projectRoot, feature, phase);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `feature: "${feature}"\nphase: "${phase}"\nverdict: PASS\n`, 'utf-8');
}

/**
 * 真实 runner 恒在启动即写 manifest——夹具同步落一份，否则"有 events 无 manifest"
 * 会被残留二分正确判为 corrupt run。
 */
export function writeRunEvents(
  projectRoot: string,
  feature: string,
  runId: string,
  events: Array<Record<string, unknown>>,
): void {
  const eventsPath = featureFilePath(projectRoot, feature, path.join('goal-runs', runId, 'events.jsonl'));
  fs.mkdirSync(path.dirname(eventsPath), { recursive: true });
  fs.writeFileSync(eventsPath, events.map(event => JSON.stringify(event)).join('\n') + '\n', 'utf-8');
  const manifestPath = featureFilePath(projectRoot, feature, path.join('goal-runs', runId, 'manifest.json'));
  if (!fs.existsSync(manifestPath)) {
    // requirement 留空：feature 级 intent 拼接对空 requirement 零贡献
    fs.writeFileSync(manifestPath, JSON.stringify({ schema_version: '1.0', feature, run_id: runId }), 'utf-8');
  }
}

/**
 * 既有 phase manifest 已声明的输入路径。重写 manifest 时原样带回，
 * 保住"证据 ↔ 被执行源码版本"的血缘绑定（`recomputePhaseEvidenceStaleness` 据此判 fresh）。
 */
function existingManifestInputs(projectRoot: string, feature: string, phase: string): string[] {
  const loaded = loadPhaseEvidenceManifest(projectRoot, feature, phase);
  if (!loaded) return [];
  return (loaded.manifest.inputs ?? [])
    .map(entry => entry.path)
    .filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
}

/** 成功终局事件序列：run_start + 每阶段 phase_start + CHAIN_SLICE_COMPLETED */
export function successfulRunEvents(chain: readonly string[]): Array<Record<string, unknown>> {
  return [
    { ts: '2026-07-12T23:00:00.000Z', type: 'run_start', chain: [...chain] },
    ...chain.map((phase, index) => ({
      ts: `2026-07-12T23:${String(index + 1).padStart(2, '0')}:00.000Z`,
      type: 'phase_start',
      phase,
    })),
    { ts: '2026-07-12T23:30:00.000Z', type: 'run_end', status: 'CHAIN_SLICE_COMPLETED' },
  ];
}

/**
 * 全链干净现场：artifacts + PASS summaries + receipts + evidence manifests(+回执指针)
 * + 成功 run 事件；chain 含 review 时补 review closure attestation（clean_pass ⑥）。
 */
export function seedCleanCompletionChain(options: SeedCompletionChainOptions): void {
  const { projectRoot, feature, chain } = options;
  const runId = options.runId ?? 'RUN1';
  const now = options.now ?? DEFAULT_NOW;

  seedFeatureArtifactIfAbsent(projectRoot, feature, 'spec.md', '# spec\n');
  seedFeatureArtifactIfAbsent(projectRoot, feature, 'acceptance.yaml', 'criteria: []\n');
  seedFeatureArtifactIfAbsent(projectRoot, feature, 'plan.md', '# plan\n');
  seedFeatureArtifactIfAbsent(projectRoot, feature, 'contracts.yaml', 'files: []\n');

  writeRunEvents(projectRoot, feature, runId, successfulRunEvents(chain));

  if (chain.includes('review')) {
    writeReviewClosureAttestation({ projectRoot, feature, expectProductSources: false, now });
  }

  const requirementSha = computeRunRequirementSha(projectRoot, feature, runId);
  for (const phase of chain) {
    writePhaseSummary(projectRoot, feature, phase, 'PASS');
    writePhaseReceipt(projectRoot, feature, phase);
    const written = writePhaseEvidenceManifest(projectRoot, resolvePhaseEvidenceManifest({
      projectRoot,
      feature,
      phase: phase as Phase,
      now,
      requirementSha,
      // 同"只补缺失产物"的道理：既有 manifest 已声明的输入（例如被执行的证明源码）
      // 必须原样带走。抹掉它们等于解开证据与源码版本的绑定——报告生成后改源码就不再 stale。
      extraInputs: existingManifestInputs(projectRoot, feature, phase),
    }));
    writeReceiptManifestPointer(
      projectRoot,
      feature,
      phase,
      path.relative(projectRoot, written.absPath).split(path.sep).join('/'),
      written.sha256,
    );
  }
}

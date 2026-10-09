// completion-chain-seed.ts —— 用生产 writer 造"一次成功 Goal run 的完成事实"
//
// 完成链种子复用生产 evidence/attestation writer；历史回执指针仅作测试 shape 构造。
//
// 完成记录不手抄，chain 由调用方给；测试回执 shape 不参与生产 freshness 或阶段裁决。

import * as fs from 'fs';
import * as path from 'path';

import { featureFilePath, receiptDirPath, resolveFeatureArtifact, type FeaturePathOptions } from '../../config';
import { computeRunRequirementSha } from '../../scripts/utils/fidelity-shared';
import {
  loadPhaseEvidenceManifest,
  resolvePhaseEvidenceManifest,
  writePhaseEvidenceManifest,
} from '../../scripts/utils/phase-evidence-manifest';
import { writeReviewClosureAttestation } from '../../scripts/utils/closure-attestation';
import type { Phase } from '../../scripts/utils/types';

/** 历史回执指针 shape 的替换键，仅测试 helper 内部使用。 */
const RECEIPT_MANIFEST_POINTER_KEYS = [
  'evidence_manifest',
  'evidence_manifest_sha256',
  'phase_closure_fingerprint',
] as const;

export function receiptPathForPhase(
  projectRoot: string,
  feature: string,
  phase: string,
  opts?: FeaturePathOptions,
): string {
  return featureFilePath(projectRoot, feature, path.join(phase, 'phase-completion-receipt.md'), opts);
}

/** 只构造历史回执指针 shape；当前生产 freshness 不消费它。 */
export function writeReceiptManifestPointer(
  projectRoot: string,
  feature: string,
  phase: string,
  manifestRelPath: string,
  manifestSha256: string,
  opts?: FeaturePathOptions,
): void {
  const p = receiptPathForPhase(projectRoot, feature, phase, opts);
  if (!fs.existsSync(p)) {
    throw new Error(`[phase-evidence-manifest] 回执不存在，无法写指针：${p}`);
  }
  const keyAlt = RECEIPT_MANIFEST_POINTER_KEYS.join('|');
  const pointerLine = new RegExp(`^\\s*(${keyAlt})\\s*:.*$`);
  const kept = fs
    .readFileSync(p, 'utf-8')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => !pointerLine.test(line));
  while (kept.length > 0 && kept[kept.length - 1].trim() === '') kept.pop();
  kept.push('', `evidence_manifest: "${manifestRelPath}"`, `evidence_manifest_sha256: "${manifestSha256}"`, '');
  fs.writeFileSync(p, kept.join('\n'), 'utf-8');
}

export interface SeedCompletionChainOptions {
  projectRoot: string;
  feature: string;
  chain: readonly string[];
  /** 默认 RUN1；同一 feature 多次 seed 时由调用方区分 */
  runId?: string;
  /** 确定性时间；默认与既有夹具同锚 */
  now?: () => Date;
  invocations?: boolean;
  beforeClosure?: (projectRoot: string) => void;
  /** 每阶段 summary 的结论（缺省 PASS）；调用方用生产的共享结论函数求值后传入。 */
  phaseVerdict?: (phase: string) => string;
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

  options.beforeClosure?.(projectRoot);
  const events = successfulRunEvents(chain);
  writeRunEvents(projectRoot, feature, runId, options.invocations
    ? events.flatMap(event => event.type === 'phase_start'
      ? [event, { ...event, type: 'agent_invoke_start', invoke_id: `${runId}-${event.phase}-i${chain.indexOf(String(event.phase)) + 2}` }]
      : [event])
    : events);

  if (chain.includes('review')) {
    writeReviewClosureAttestation({ projectRoot, feature, expectProductSources: false, now });
  }

  const requirementSha = computeRunRequirementSha(projectRoot, feature, runId);
  for (const phase of chain) {
    writePhaseSummary(projectRoot, feature, phase, options.phaseVerdict?.(phase) ?? 'PASS');
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

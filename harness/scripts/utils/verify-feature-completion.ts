// ============================================================================
// verify-feature-completion.ts — feature 完成凭证：生成与唯一验证入口
// （goal-fakepass-hardening t8；openspec goal-runner delta）
// ============================================================================
// 事故背景：run1 HALTED 后 run2 截断链（ut→testing）报 COMPLETED，被读成"需求完成"；
// 上游 PASS 仅是 manifest 文本断言。修复：feature 级完成只认 feature-completion——
// 且消费方**禁止**看文件存在性/自报字段，一切经 verifyFeatureCompletion() 重算，
// 返回 VALID | STALE | INVALID 三态。
//
// clean_pass（openspec design §3.3，六条件）：
//   verdict PASS ∧ 无 pending must-review ∧ 无 P0/行为开关 waiver ∧ 无档位钳制封顶
//   ∧ 非 DEFERRED/PARTIAL ∧ closure 血缘一致（evidence manifest fresh + review
//   attestation 对账 ok）。任一不满足 → 禁止生成 completion（generate 直接 throw）。
//
// 原件落 runner-owned run 目录（goal-runs/<run_id>/feature-completion.json，原子写），
// feature 根只放投影（路径+sha256 指针）。手工伪造：投影/原件哈希对不上、或重算
// 血缘失配 → INVALID；源码/输入后改、出现更晚未终局 run → STALE。
// ============================================================================

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import { featureFilePath, receiptDirPath, resolveFeatureArtifact } from '../../config';
import {
  loadReviewClosureAttestation,
  reconcileSourceTreeAgainstAttestation,
} from './closure-attestation';
import { collectAutoDecisions, countPendingMustReview } from './headless-assumptions';
import { collectRequirementIntentText, collectRequirementSsotPaths, computeRunRequirementSha } from './fidelity-shared';
import { validateSummaryV11 } from './quality-axes';
import { buildSourceInventory } from './closure-attestation';
import { defaultTrustRegistryPath, validateConfirmationReceiptFile } from './confirmation-receipt';
import { evaluateFlowContract, isP0DeviceInteractive, loadAcceptanceFlowsDoc } from './p0-semantic-gates';
import {
  computeCanonicalReceiptSha256,
  loadPhaseEvidenceManifest,
  recomputePhaseEvidenceStaleness,
  sha256File,
  stableStringify,
} from './phase-evidence-manifest';

export const FEATURE_COMPLETION_FILENAME = 'feature-completion.json';
// 1.1（codex 八轮 P2）：新增 requirement_sha256/testing_source_aggregate/per-phase attempt
// 等必需绑定字段——旧 1.0 completion 结构不同，schema_version 不匹配即 INVALID。
export const FEATURE_COMPLETION_SCHEMA_VERSION = '1.1';

export type CompletionVerdictKind = 'VALID' | 'STALE' | 'INVALID';

export interface CompletionPhaseRecord {
  phase: string;
  run_id: string;
  /** per-phase attempt 身份（events phase_start.attempt 字符串化；不可得为 null）——
   * codex 八轮 P1-1：生产接线（resolvePhaseRunIds 读事件），非装饰。 */
  attempt: string | null;
  gate_fingerprint: string | null;
  receipt_sha256: string | null;
  evidence_manifest_aggregate: string | null;
}

export interface FeatureCompletion {
  schema_version: string;
  feature: string;
  generated_at: string;
  /** 生成本凭证的 run（原件必须位于该 run 的 runner-owned 目录内） */
  run_id: string;
  workflow_track: string;
  chain: string[];
  artifact_hashes: {
    spec_md: string | null;
    acceptance_yaml: string | null;
    contracts_yaml: string | null;
  };
  /** codex 七轮 P1-3：需求 SSOT 聚合哈希（内联 manifest.requirement + 解引用文档 + ux-reference） */
  requirement_sha256: string | null;
  /** review 闭环快照 aggregate（源码树 inventory）——与 review-closure-attestation 对账 */
  review_attestation_aggregate: string | null;
  /** testing 期产品源码树 aggregate（review attestation 同源或单调演进链） */
  testing_source_aggregate: string | null;
  phases: CompletionPhaseRecord[];
  parent_run_id: string | null;
  supersedes: string[];
}

export interface CompletionProjection {
  schema_version: string;
  original_path: string;
  original_sha256: string;
}

export interface CompletionVerdict {
  verdict: CompletionVerdictKind;
  reasons: string[];
}

// ----------------------------------------------------------------------------
// clean_pass 检测（生成与验证共用）
// ----------------------------------------------------------------------------

/**
 * clean_pass 违例分类（codex 七轮 P1-2）：
 * - `needs_fix`：确定性故障（verdict FAIL / 血缘 stale-tampered / attestation 缺失失配）
 *   ——须修复或重跑，投影 FEATURE_INCOMPLETE，**不**是"待人工确认"；
 * - `needs_human`：设计内求人（flow_contract 缺 receipt / waiver / 档位钳制 /
 *   运行时证据未采集）——封顶 AWAITING_HUMAN_REVIEW。
 * 两类都令 clean_pass 失败（不生成 completion），但 run 级状态投影不同。
 */
export type CleanPassIssueKind = 'needs_fix' | 'needs_human';

export interface CleanPassIssue {
  phase: string;
  condition: string;
  detail: string;
  kind: CleanPassIssueKind;
}

function summaryVerdict(projectRoot: string, feature: string, phase: string): string | null {
  const p = path.join(receiptDirPath(projectRoot, feature, phase), 'reports', 'summary.json');
  if (!fs.existsSync(p)) return null;
  try {
    return (JSON.parse(fs.readFileSync(p, 'utf-8')) as { verdict?: string }).verdict ?? null;
  } catch {
    return null;
  }
}

/** ①b 消费面：schema_version + quality_axes（1.1 多轴；读取失败按 legacy 处理） */
function readSummaryLattice(
  projectRoot: string,
  feature: string,
  phase: string,
): {
  exists: boolean;
  schemaVersion: string | null;
  axes: Record<string, {
    applicable?: boolean;
    verdict?: string;
    resolution?: { class?: string; owner?: string } | null;
  }> | null;
  releaseReadiness: string | null;
  completionStatus: string | null;
  raw: unknown;
} {
  const p = path.join(receiptDirPath(projectRoot, feature, phase), 'reports', 'summary.json');
  if (!fs.existsSync(p)) return { exists: false, schemaVersion: null, axes: null, releaseReadiness: null, completionStatus: null, raw: null };
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf-8')) as {
      schema_version?: string;
      quality_axes?: Record<string, { applicable?: boolean; verdict?: string; resolution?: { class?: string; owner?: string } | null }>;
      release_readiness?: string;
      completion_status?: string;
    };
    return {
      exists: true,
      schemaVersion: typeof parsed.schema_version === 'string' ? parsed.schema_version : null,
      axes: parsed.quality_axes ?? null,
      releaseReadiness: typeof parsed.release_readiness === 'string' ? parsed.release_readiness : null,
      completionStatus: typeof parsed.completion_status === 'string' ? parsed.completion_status : null,
      raw: parsed as unknown,
    };
  } catch {
    return { exists: true, schemaVersion: null, axes: null, releaseReadiness: null, completionStatus: null, raw: null };
  }
}

function waiverFilesPresent(projectRoot: string, feature: string, phase: string): string[] {
  const found: string[] = [];
  const candidates = [
    featureFilePath(projectRoot, feature, path.join('testing', 'skip-waivers.yaml')),
    featureFilePath(projectRoot, feature, path.join(phase, 'behavior-switch-waivers.yaml')),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p) && fs.readFileSync(p, 'utf-8').trim().length > 0) {
      found.push(path.basename(p));
    }
  }
  return [...new Set(found)];
}

export interface CleanPassOptions {
  projectRoot: string;
  feature: string;
  chain: string[];
  /** 档位钳制封顶标记（runner 传入；档位被钳制且属强意图时 true） */
  fidelityCapped?: boolean;
  /** 当前权威 run 的规范化 requirement 内容哈希（P0-2）——血缘重算比对，抓换需求复用旧 closure */
  currentRequirementSha?: string | null;
}

/** 六条件逐一检测；返回全部违例（空数组=全链 clean_pass） */
export function collectCleanPassIssues(opts: CleanPassOptions): CleanPassIssue[] {
  const { projectRoot, feature, chain } = opts;
  const issues: CleanPassIssue[] = [];

  // ① verdict PASS（needs_fix：FAIL 须修复/重跑，非人工确认）
  for (const phase of chain) {
    const v = summaryVerdict(projectRoot, feature, phase);
    if (v !== 'PASS') {
      issues.push({ phase, condition: 'verdict_pass', detail: `summary verdict=${v ?? '缺失'}`, kind: 'needs_fix' });
    }
  }

  // ①b summary schema 1.1（blind-visual-hardening d1：legacy 1.0 不作 completion 干净依据——
  //    历史假 PASS 不得重入新状态机；须当前 gate_fingerprint 下重跑该阶段）+
  //    多轴负面裁决消费：visual/asset 等轴 UNVERIFIED(needs_human) → 封顶求人；
  //    轴 FAIL 已由 ① 的 verdict 投影覆盖，此处不重复计。
  for (const phase of chain) {
    const s = readSummaryLattice(projectRoot, feature, phase);
    if (!s.exists) continue; // 缺 summary 由 ① 报"缺失"
    if (s.schemaVersion !== '1.1') {
      issues.push({
        phase,
        condition: 'summary_schema_current',
        detail: `summary schema_version=${s.schemaVersion ?? '缺失'}（legacy 1.0 不作 completion 干净依据，须在当前 gate_fingerprint 下重跑本阶段）`,
        kind: 'needs_fix',
      });
      continue;
    }
    // codex 实施 review P0-3 + 三轮 P1-4：1.1 完整契约唯一权威校验（四字段+轴不变量）——
    // 手搓裸/半 summary 不得干净放行。
    const v11Errors = validateSummaryV11(s.raw);
    if (v11Errors.length > 0) {
      issues.push({
        phase,
        condition: 'quality_axes_valid',
        detail: `summary 1.1 契约违反（${v11Errors.slice(0, 3).join('；')}）——非 harness 生成或已被篡改，须重跑本阶段`,
        kind: 'needs_fix',
      });
      continue;
    }
    // codex 三轮 P0-2：消费面统一规则——任一 required_for_release 轴非 PASS 都不得干净完成：
    //   needs_human → 等待人工（AWAITING_HUMAN_REVIEW 封顶）；
    //   needs_fix / external_dependency / 无 resolution 的负面态 → 必须修复/解除后重跑（needs_fix）。
    for (const [axisId, axis] of Object.entries(s.axes ?? {})) {
      if (!axis || axis.applicable !== true) continue;
      if ((axis as { required_for_release?: boolean }).required_for_release === false) continue;
      if (axis.verdict === 'PASS' || axis.verdict === 'NOT_APPLICABLE') continue;
      const cls = axis.resolution?.class;
      issues.push({
        phase,
        condition: 'quality_axis_verified',
        detail: `${axisId} 轴 ${axis.verdict}（resolution=${cls ?? '缺失'}${axis.resolution?.owner ? `/${axis.resolution.owner}` : ''}）`,
        kind: cls === 'needs_human' ? 'needs_human' : 'needs_fix',
      });
    }
    // 投影一致性独立校验（防 release_readiness/completion_status 被单独篡改成 READY/COMPLETE）：
    // 存在非 PASS 必需轴时 release_readiness 必须 BLOCKED；DEBT_PIPELINE_ERROR 一律 needs_fix。
    const anyRequiredNotPass = Object.values(s.axes ?? {}).some(
      a => a && a.applicable === true &&
        (a as { required_for_release?: boolean }).required_for_release !== false &&
        a.verdict !== 'PASS' && a.verdict !== 'NOT_APPLICABLE',
    );
    if (anyRequiredNotPass && s.releaseReadiness === 'READY') {
      issues.push({
        phase,
        condition: 'release_projection_consistent',
        detail: `release_readiness=READY 与非 PASS 必需轴矛盾（投影被篡改/派生缺陷）`,
        kind: 'needs_fix',
      });
    }
    if (s.completionStatus === 'DEBT_PIPELINE_ERROR') {
      issues.push({
        phase,
        condition: 'debt_pipeline_healthy',
        detail: '视觉债务管线故障（DEBT_PIPELINE_ERROR）——治理链自身失败不得干净完成，修复环境后重跑',
        kind: 'needs_fix',
      });
    }
  }

  // ② 无 pending must-review（needs_human）
  const decisions = collectAutoDecisions(projectRoot, feature, chain);
  const pending = countPendingMustReview(decisions);
  if (pending > 0) {
    issues.push({ phase: '*', condition: 'no_pending_must_review', detail: `${pending} 项自动决议待人工复核`, kind: 'needs_human' });
  }

  // ③ 无 waiver（needs_human：真人签发/裁决）
  for (const phase of chain) {
    const waivers = waiverFilesPresent(projectRoot, feature, phase);
    if (waivers.length > 0) {
      issues.push({ phase, condition: 'no_waivers', detail: `存在 waiver：${waivers.join(', ')}`, kind: 'needs_human' });
    }
  }

  // ④ 无档位钳制封顶（needs_human）
  if (opts.fidelityCapped) {
    issues.push({ phase: '*', condition: 'no_fidelity_cap', detail: '强意图下档位被能力钳制（AWAITING_HUMAN_REVIEW 封顶）', kind: 'needs_human' });
  }

  // ⑤ 血缘一致（needs_fix：stale/tampered/missing 须重跑闭环）——含 requirement 血缘比对
  for (const r of recomputePhaseEvidenceStaleness(projectRoot, feature, chain, {
    currentRequirementSha: opts.currentRequirementSha,
  })) {
    if (r.verdict !== 'fresh') {
      issues.push({
        phase: r.phase,
        condition: 'lineage_fresh',
        detail: r.verdict === 'missing'
          ? '缺 phase-evidence-manifest（旧版产物/未闭环）'
          : `closure 后证据变更：${[...r.changed_paths, ...(r.receipt_changed ? ['<receipt>'] : [])].join(', ') || `传染自 ${r.propagated_from}`}`,
        kind: 'needs_fix',
      });
    }
  }

  // ⑥ review attestation（needs_fix：缺失/失配须回跑 review 闭环）
  if (chain.includes('review')) {
    const att = loadReviewClosureAttestation(projectRoot, feature);
    if (!att) {
      issues.push({ phase: 'review', condition: 'attestation_present', detail: '缺 review-closure-attestation.json', kind: 'needs_fix' });
    } else {
      const rec = reconcileSourceTreeAgainstAttestation(projectRoot, att);
      if (!rec.ok) {
        issues.push({
          phase: 'review',
          condition: 'attestation_reconciled',
          detail: `review 后产品源码变更 added=${rec.added.length} modified=${rec.modified.length} deleted=${rec.deleted.length} new_roots=${rec.new_roots.length}`,
          kind: 'needs_fix',
        });
      }
    }
  }

  // ⑦ flow_contract receipt（needs_human）——首次结构化流程模型须真人确认。
  {
    const fc = evaluateFlowContract(
      projectRoot,
      feature,
      collectRequirementIntentText(projectRoot, feature),
    );
    if (fc[0]?.status === 'WARN') {
      issues.push({ phase: 'spec', condition: 'flow_contract_receipt', detail: fc[0].details.split('。')[0], kind: 'needs_human' });
    }
  }

  // ⑧ P0 运行时忠实性证据（codex 八轮 P0-1：不再用文件存在性——空文件即可解除是后门）——
  // 有 P0 device flow 的 feature，在 Hylyre provider step 采集落地前，"计划写对+TC 自报
  // 通过+运行时 fast path"仍能骗过计划级对账。唯一解除通道=带外 runtime_fidelity_attestation
  // receipt（绑定 testing 源码 aggregate + acceptance flows hash；provider 落地后 runner
  // 自动签发，落地前真人带外确认）。无有效 receipt → needs_human 封顶，不得 FEATURE_COMPLETED。
  {
    const doc = loadAcceptanceFlowsDoc(projectRoot, feature);
    const hasP0DeviceFlow = doc && doc.criteria.some(isP0DeviceInteractive);
    if (hasP0DeviceFlow && !runtimeFidelityAttested(projectRoot, feature)) {
      issues.push({
        phase: 'testing',
        condition: 'runtime_step_evidence',
        detail:
          '存在 P0 device flow 但无有效 runtime_fidelity_attestation receipt——计划级对账不能' +
          '证明运行时忠实执行；须真人带外确认（或待 Hylyre provider step 采集落地由 runner 签发）' +
          '方可 FEATURE_COMPLETED。空文件不再能解除封顶。',
        kind: 'needs_human',
      });
    }
  }

  return issues;
}

/** runtime_fidelity_attestation 绑定哈希口径（签发侧对齐）：feature + acceptance flows +
 * testing 产品源码 aggregate——运行时证据必须与被测代码和声明流程绑定，防跨对象重放。 */
export function runtimeFidelityObjectHash(projectRoot: string, feature: string): string {
  const acc = resolveFeatureArtifact(projectRoot, feature, 'acceptance.yaml');
  const accHash = acc.exists ? sha256File(acc.actualPath) ?? '' : '';
  const srcAgg = buildSourceInventory(projectRoot, { expectProductSources: false }).aggregate_sha256;
  return crypto.createHash('sha256').update(`${feature}\n${accHash}\n${srcAgg}`, 'utf-8').digest('hex');
}

export function runtimeFidelityReceiptPath(projectRoot: string, feature: string): string {
  return featureFilePath(projectRoot, feature, path.join('testing', 'runtime-fidelity.receipt.json'));
}

/**
 * 运行时忠实性证明（P0-1 重构）：消费 runtime_fidelity_attestation receipt（信任锚同 t10：
 * 预置 registry 取键、绑定 feature+acceptance+源码 aggregate、改动即 stale）。文件存在性
 * 判定已废弃——空的 runtime-step-evidence.json 不再解除封顶。
 */
export function runtimeFidelityAttested(projectRoot: string, feature: string): boolean {
  return validateConfirmationReceiptFile(
    runtimeFidelityReceiptPath(projectRoot, feature),
    defaultTrustRegistryPath(projectRoot),
    { action: 'runtime_fidelity_attestation', feature, object_hash: runtimeFidelityObjectHash(projectRoot, feature) },
  ).valid;
}

/** run 级状态投影（codex 七轮 P1-2）：needs_human 存在 → AWAITING；仅 needs_fix →
 * FEATURE_INCOMPLETE（该 run 通常已因 verdict 走非成功侧，此处是完成侧兜底分类）。 */
export function classifyCleanPassIssues(issues: CleanPassIssue[]): {
  needsHuman: boolean;
  needsFix: boolean;
} {
  return {
    needsHuman: issues.some((i) => i.kind === 'needs_human'),
    needsFix: issues.some((i) => i.kind === 'needs_fix'),
  };
}

/**
 * P1-1（codex 六轮）+ P1-2（七轮）：run 结束"是否有**待人工**事项"只消费 needs_human 类
 * clean_pass 违例（flow_contract 缺 receipt / waiver / 档位钳制 / 待复核 / 运行时证据
 * 未采集）——确定性故障（needs_fix：verdict FAIL / stale-tampered / attestation 失配）
 * 不投影为 AWAITING（那是修复/重跑事项，非人工确认）。与 completion 生成同源 issues 集。
 */
export function hasPendingHumanReview(opts: CleanPassOptions): boolean {
  return classifyCleanPassIssues(collectCleanPassIssues(opts)).needsHuman;
}

// ----------------------------------------------------------------------------
// 生成（runner-owned）
// ----------------------------------------------------------------------------

export interface GenerateCompletionOptions extends CleanPassOptions {
  workflowTrack: string;
  runId: string;
  /** run 目录绝对路径（goal-runs/<run_id>）——原件唯一合法落点 */
  runDirAbs: string;
  phaseRunIds: Record<string, string>;
  /** per-phase attempt 身份（events 回放序数）；缺省 null */
  phaseAttempts?: Record<string, string>;
  parentRunId?: string | null;
  supersedes?: string[];
  now?: () => Date;
}

/** 需求 SSOT 聚合哈希（内联 manifest.requirement + 解引用文档 + ux-reference 的稳定摘要） */
export function computeRequirementSsotAggregate(projectRoot: string, feature: string): string | null {
  const paths = collectRequirementSsotPaths(projectRoot, feature);
  if (paths.length === 0) return null;
  const parts: string[] = [];
  for (const rel of paths) {
    const h = sha256File(path.join(projectRoot, rel));
    parts.push(rel + ':' + (h === null ? 'missing' : h));
  }
  parts.sort();
  return crypto.createHash('sha256').update(parts.join('\n'), 'utf-8').digest('hex');
}

export function generateFeatureCompletion(opts: GenerateCompletionOptions): {
  originalAbs: string;
  projectionAbs: string;
  completion: FeatureCompletion;
} {
  const issues = collectCleanPassIssues({
    ...opts,
    currentRequirementSha: opts.currentRequirementSha ?? computeRunRequirementSha(opts.projectRoot, opts.feature, opts.runId),
  });
  if (issues.length > 0) {
    const brief = issues.slice(0, 6).map((i) => `[${i.phase}] ${i.condition}: ${i.detail}`).join('；');
    throw new Error(`[feature-completion] 非 clean_pass，禁止生成完成凭证：${brief}${issues.length > 6 ? '…' : ''}`);
  }
  const { projectRoot, feature } = opts;

  const phases: CompletionPhaseRecord[] = opts.chain.map((phase) => {
    const manifest = loadPhaseEvidenceManifest(projectRoot, feature, phase);
    return {
      phase,
      run_id: opts.phaseRunIds[phase] ?? opts.runId,
      attempt: opts.phaseAttempts?.[phase] ?? null,
      gate_fingerprint: manifest?.manifest.environment.gate_fingerprint ?? null,
      receipt_sha256: computeCanonicalReceiptSha256(projectRoot, feature, phase),
      evidence_manifest_aggregate: manifest?.manifest.aggregate_sha256 ?? null,
    };
  });

  const art = (name: string): string | null => {
    const r = resolveFeatureArtifact(projectRoot, feature, name);
    return r.exists ? sha256File(r.actualPath) : null;
  };
  const attestation = loadReviewClosureAttestation(projectRoot, feature);

  const completion: FeatureCompletion = {
    schema_version: FEATURE_COMPLETION_SCHEMA_VERSION,
    feature,
    generated_at: (opts.now ? opts.now() : new Date()).toISOString(),
    run_id: opts.runId,
    workflow_track: opts.workflowTrack,
    chain: [...opts.chain],
    artifact_hashes: {
      spec_md: art('spec.md'),
      acceptance_yaml: art('acceptance.yaml'),
      contracts_yaml: art('contracts.yaml'),
    },
    requirement_sha256: computeRequirementSsotAggregate(projectRoot, feature),
    review_attestation_aggregate: attestation?.inventory.aggregate_sha256 ?? null,
    testing_source_aggregate: buildSourceInventory(projectRoot, { expectProductSources: false }).aggregate_sha256,
    phases,
    parent_run_id: opts.parentRunId ?? null,
    supersedes: opts.supersedes ?? [],
  };

  const originalAbs = path.join(opts.runDirAbs, FEATURE_COMPLETION_FILENAME);
  fs.mkdirSync(path.dirname(originalAbs), { recursive: true });
  const text = JSON.stringify(completion, null, 2) + '\n';
  const tmp = `${originalAbs}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text, 'utf-8');
  fs.renameSync(tmp, originalAbs);

  const projection: CompletionProjection = {
    schema_version: FEATURE_COMPLETION_SCHEMA_VERSION,
    original_path: path.relative(projectRoot, originalAbs).split(path.sep).join('/'),
    original_sha256: crypto.createHash('sha256').update(text, 'utf-8').digest('hex'),
  };
  const projectionAbs = featureFilePath(projectRoot, feature, FEATURE_COMPLETION_FILENAME);
  fs.mkdirSync(path.dirname(projectionAbs), { recursive: true });
  fs.writeFileSync(projectionAbs, JSON.stringify(projection, null, 2) + '\n', 'utf-8');

  return { originalAbs, projectionAbs, completion };
}

// ----------------------------------------------------------------------------
// 唯一验证入口
// ----------------------------------------------------------------------------

/** goal-runs 目录内所有 run 的最新 run_end 状态（更晚未终局 run 检测用） */
function scanRunTerminalStates(
  projectRoot: string,
  feature: string,
): Array<{ run_id: string; status: string | null; last_ts: string | null }> {
  const runsDir = featureFilePath(projectRoot, feature, 'goal-runs');
  if (!fs.existsSync(runsDir)) return [];
  const out: Array<{ run_id: string; status: string | null; last_ts: string | null }> = [];
  for (const ent of fs.readdirSync(runsDir, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const eventsPath = path.join(runsDir, ent.name, 'events.jsonl');
    if (!fs.existsSync(eventsPath)) continue;
    let status: string | null = null;
    let lastTs: string | null = null;
    try {
      for (const line of fs.readFileSync(eventsPath, 'utf-8').split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
          const ev = JSON.parse(line) as { type?: string; status?: string; ts?: string };
          if (ev.ts) lastTs = ev.ts;
          if (ev.type === 'run_end') status = ev.status ?? null;
        } catch { /* 单行损坏不吞整文件 */ }
      }
    } catch { /* unreadable → 视为未知 run */ }
    out.push({ run_id: ent.name, status, last_ts: lastTs });
  }
  return out;
}

const NON_TERMINAL_OK = new Set(['CHAIN_SLICE_COMPLETED', 'COMPLETED']);
/** 可作为 clean 血缘的 run 终局态（成功侧）——AWAITING_HUMAN_REVIEW 有待人工事项不算 */
const RUN_END_LINEAGE_OK = new Set(['CHAIN_SLICE_COMPLETED', 'COMPLETED']);

/**
 * goal-runner completion 生成辅助：逐 phase 解析"最后一次执行该 phase 的 run"——
 * 扫描各 run events 的 phase_start 事件，按事件 ts 取最新。当前 run 已执行的 phase
 * 由调用方覆盖（本 run 身份权威）。
 */
function readRunEventLines(projectRoot: string, feature: string, runId: string): Array<Record<string, unknown>> {
  const eventsPath = featureFilePath(projectRoot, feature, path.join('goal-runs', runId, 'events.jsonl'));
  if (!fs.existsSync(eventsPath)) return [];
  const out: Array<Record<string, unknown>> = [];
  try {
    for (const line of fs.readFileSync(eventsPath, 'utf-8').split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line) as Record<string, unknown>);
      } catch { /* 单行损坏跳过 */ }
    }
  } catch { /* unreadable */ }
  return out;
}

/**
 * codex 九轮 P1：per-phase attempt 的**规范口径**——run 内该 phase 最后一次
 * agent_invoke_start 的 invoke_id 尾段（`i${totalTurns}` invocation 序数，跨 resume
 * 单调，critic-loop 同源）。phase_start.attempt=retries+1 会在 resume 归零，不是身份。
 *
 * codex 十轮 P1：三态返回——malformed invoke_id 不得退化为 null（否则与"无 invocation"
 * 不可区分，null===null 直接放行）。任何一条该 phase 的 agent_invoke_start 事件
 * invoke_id 缺失/畸形即 invalid（生产 invoke_id 全部框架生成，畸形=损坏/篡改）；
 * 完全无 invoke 事件（legacy/非 goal）→ absent 兼容态。
 */
export type PhaseInvocationAttempt =
  | { kind: 'absent' }
  | { kind: 'valid'; ordinal: string }
  | { kind: 'invalid'; detail: string };

export function derivePhaseInvocationAttempt(
  events: Array<Record<string, unknown>>,
  phase: string,
): PhaseInvocationAttempt {
  let out: PhaseInvocationAttempt = { kind: 'absent' };
  for (const ev of events) {
    if (ev.type !== 'agent_invoke_start' || ev.phase !== phase) continue;
    const invokeId = typeof ev.invoke_id === 'string' ? ev.invoke_id : '';
    const m = /-(i\d+)$/.exec(invokeId);
    if (!m) {
      return { kind: 'invalid', detail: invokeId ? `invoke_id 畸形（无 i<N> 尾段）：${invokeId}` : 'invoke_id 缺失' };
    }
    out = { kind: 'valid', ordinal: m[1] };
  }
  return out;
}

export function resolvePhaseRunIds(
  projectRoot: string,
  feature: string,
  chain: string[],
): { runIds: Record<string, string>; attempts: Record<string, string> } {
  const runsDir = featureFilePath(projectRoot, feature, 'goal-runs');
  const latest: Record<string, { run_id: string; ts: string }> = {};
  if (fs.existsSync(runsDir)) {
    for (const ent of fs.readdirSync(runsDir, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      for (const ev of readRunEventLines(projectRoot, feature, ent.name)) {
        if (ev.type !== 'phase_start' || typeof ev.phase !== 'string' || typeof ev.ts !== 'string') continue;
        const cur = latest[ev.phase];
        if (!cur || ev.ts > cur.ts) latest[ev.phase] = { run_id: ent.name, ts: ev.ts };
      }
    }
  }
  const runIds: Record<string, string> = {};
  const attempts: Record<string, string> = {};
  for (const phase of chain) {
    if (!latest[phase]) continue;
    runIds[phase] = latest[phase].run_id;
    const attempt = derivePhaseInvocationAttempt(
      readRunEventLines(projectRoot, feature, latest[phase].run_id),
      phase,
    );
    // codex 十轮 P1：invocation 事件存在但不可推导 → 生成侧 fail-closed（拒产凭证），
    // 不得静默落 attempt:null 冒充"无 invocation"。
    if (attempt.kind === 'invalid') {
      throw new Error(
        `[feature-completion] phase ${phase} run ${latest[phase].run_id} invocation 事件非法（${attempt.detail}）——attempt 不可推导，拒绝生成`,
      );
    }
    if (attempt.kind === 'valid') attempts[phase] = attempt.ordinal;
  }
  return { runIds, attempts };
}

export interface VerifyCompletionOptions {
  projectRoot: string;
  feature: string;
  /**
   * 期望链（由调用方独立自 workflow SSOT/track 解析，如 resolveWorkflowSpec +
   * loadFeatureTrackDecl）——codex 五轮 P0：verifier 不得信凭证自报 chain，
   * 否则 chain=["testing"] 缩链即 VALID（事故原形）。
   */
  expectedChain: string[];
  /**
   * 消费方独立解析的 track（九轮 P2：workflow_track 自报同样不作数）。
   * codex 十轮 P2：必填——可选参数=fail-open API，省略即绕过 track 对账。
   */
  expectedTrack: string;
  fidelityCapped?: boolean;
}

/**
 * 唯一消费入口：重算投影→原件→schema→**chain/feature/落点/run 存在性对账**→
 * clean_pass（血缘/attestation/must-review/waiver）→逐阶段 receipt/manifest 对账→
 * supersedes 审计事件核验→更晚未终局 run。
 * INVALID=凭证本身不可信（伪造/哈希断裂/schema 坏/自报失配）；STALE=凭证曾合法但世界变了。
 */
export function verifyFeatureCompletion(opts: VerifyCompletionOptions): CompletionVerdict {
  const { projectRoot, feature } = opts;
  const reasons: string[] = [];
  if (!Array.isArray(opts.expectedChain) || opts.expectedChain.length === 0) {
    return { verdict: 'INVALID', reasons: ['expectedChain 缺失——消费方必须独立解析 workflow 链，不得信凭证自报'] };
  }
  // codex 十轮 P2：expectedTrack 与 expectedChain 同为消费方义务——缺失/空即 INVALID
  if (typeof opts.expectedTrack !== 'string' || opts.expectedTrack.length === 0) {
    return { verdict: 'INVALID', reasons: ['expectedTrack 缺失——消费方必须独立解析 workflow track，不得信凭证自报'] };
  }

  const projectionAbs = featureFilePath(projectRoot, feature, FEATURE_COMPLETION_FILENAME);
  if (!fs.existsSync(projectionAbs)) {
    return { verdict: 'INVALID', reasons: ['无 feature-completion 投影'] };
  }
  let projection: CompletionProjection;
  try {
    projection = JSON.parse(fs.readFileSync(projectionAbs, 'utf-8')) as CompletionProjection;
  } catch {
    return { verdict: 'INVALID', reasons: ['投影 JSON 解析失败'] };
  }
  if (!projection.original_path || !projection.original_sha256) {
    return { verdict: 'INVALID', reasons: ['投影缺 original_path/original_sha256（禁止以文件存在性为完成依据）'] };
  }
  const originalAbs = path.join(projectRoot, projection.original_path);
  if (!fs.existsSync(originalAbs)) {
    return { verdict: 'INVALID', reasons: [`原件缺失：${projection.original_path}`] };
  }
  const originalText = fs.readFileSync(originalAbs, 'utf-8');
  const originalSha = crypto.createHash('sha256').update(originalText, 'utf-8').digest('hex');
  if (originalSha !== projection.original_sha256) {
    return { verdict: 'INVALID', reasons: ['投影与原件哈希失配（疑似手工改写）'] };
  }
  let completion: FeatureCompletion;
  try {
    completion = JSON.parse(originalText) as FeatureCompletion;
  } catch {
    return { verdict: 'INVALID', reasons: ['原件 JSON 解析失败'] };
  }
  // codex 八轮 P2：完整结构校验——畸形/旧版应 INVALID 而非 .map 抛异常。
  if (completion.schema_version !== FEATURE_COMPLETION_SCHEMA_VERSION) {
    return { verdict: 'INVALID', reasons: [`schema_version 非法/旧版：${String(completion.schema_version)}（要求 ${FEATURE_COMPLETION_SCHEMA_VERSION}）`] };
  }
  if (!Array.isArray(completion.chain) || completion.chain.length === 0 || !completion.chain.every((p) => typeof p === 'string')) {
    return { verdict: 'INVALID', reasons: ['chain 非法（须非空字符串数组）'] };
  }
  if (!Array.isArray(completion.phases)) {
    return { verdict: 'INVALID', reasons: ['phases 非数组'] };
  }
  const structOk = completion.phases.every(
    (p) =>
      p && typeof p === 'object' &&
      typeof p.phase === 'string' &&
      typeof p.run_id === 'string' &&
      (p.attempt === null || typeof p.attempt === 'string') &&
      (p.gate_fingerprint === null || typeof p.gate_fingerprint === 'string') &&
      (p.receipt_sha256 === null || typeof p.receipt_sha256 === 'string') &&
      (p.evidence_manifest_aggregate === null || typeof p.evidence_manifest_aggregate === 'string'),
  );
  if (!structOk) {
    return { verdict: 'INVALID', reasons: ['phases 记录字段类型非法'] };
  }
  for (const [k, v] of [
    ['requirement_sha256', completion.requirement_sha256],
    ['review_attestation_aggregate', completion.review_attestation_aggregate],
    ['testing_source_aggregate', completion.testing_source_aggregate],
  ] as const) {
    if (v !== null && typeof v !== 'string') {
      return { verdict: 'INVALID', reasons: [`${k} 类型非法`] };
    }
  }
  // codex 九轮 P2：完整字段守卫——缺 artifact_hashes/supersedes 等应 INVALID 而非抛异常
  if (
    !completion.artifact_hashes || typeof completion.artifact_hashes !== 'object' ||
    ([completion.artifact_hashes.spec_md, completion.artifact_hashes.acceptance_yaml, completion.artifact_hashes.contracts_yaml]
      .some((v) => v !== null && typeof v !== 'string'))
  ) {
    return { verdict: 'INVALID', reasons: ['artifact_hashes 缺失/类型非法'] };
  }
  if (!Array.isArray(completion.supersedes) || !completion.supersedes.every((s) => typeof s === 'string')) {
    return { verdict: 'INVALID', reasons: ['supersedes 缺失/类型非法'] };
  }
  if (typeof completion.generated_at !== 'string' || Number.isNaN(Date.parse(completion.generated_at))) {
    return { verdict: 'INVALID', reasons: ['generated_at 缺失/非法时间戳'] };
  }
  if (typeof completion.workflow_track !== 'string' || !completion.workflow_track) {
    return { verdict: 'INVALID', reasons: ['workflow_track 缺失/类型非法'] };
  }
  if (completion.parent_run_id !== null && typeof completion.parent_run_id !== 'string') {
    return { verdict: 'INVALID', reasons: ['parent_run_id 类型非法'] };
  }
  // workflow_track 与消费方独立解析的 track 对账（expectedChain 同哲学：不信自报；
  // 十轮 P2 后 expectedTrack 必填，此处无条件比对）
  if (completion.workflow_track !== opts.expectedTrack) {
    return {
      verdict: 'INVALID',
      reasons: [`workflow_track 与消费方解析失配：${completion.workflow_track} ≠ ${opts.expectedTrack}`],
    };
  }

  // ---- 自报字段对账（codex 五轮 P0：缩链/跨 feature/落点漂移全部在此拦） ----
  if (completion.feature !== feature) {
    return { verdict: 'INVALID', reasons: [`凭证 feature 失配：${completion.feature} ≠ ${feature}`] };
  }
  if (
    completion.chain.length !== opts.expectedChain.length ||
    completion.chain.some((p, i) => p !== opts.expectedChain[i])
  ) {
    return {
      verdict: 'INVALID',
      reasons: [`凭证 chain 与 workflow 解析链失配：[${completion.chain.join(',')}] ≠ [${opts.expectedChain.join(',')}]（缩链冒充全链即事故原形）`],
    };
  }
  const phaseList = completion.phases.map((p) => p.phase);
  if (phaseList.length !== completion.chain.length || phaseList.some((p, i) => p !== completion.chain[i])) {
    return { verdict: 'INVALID', reasons: [`phases 与 chain 不一一对应：[${phaseList.join(',')}]`] };
  }
  if (typeof completion.run_id !== 'string' || !completion.run_id) {
    return { verdict: 'INVALID', reasons: ['凭证缺 run_id'] };
  }
  // 原件落点：必须位于本 feature goal-runs/<completion.run_id>/ 之内（runner-owned）
  const expectedRunDir = path.resolve(featureFilePath(projectRoot, feature, path.join('goal-runs', completion.run_id)));
  if (!path.resolve(originalAbs).startsWith(expectedRunDir + path.sep) && path.resolve(path.dirname(originalAbs)) !== expectedRunDir) {
    return { verdict: 'INVALID', reasons: [`原件落点非法（须在 goal-runs/${completion.run_id}/ 内）：${projection.original_path}`] };
  }
  // run-event 血缘核验（codex 六轮 P0-4：只查 events.jsonl 存在=没验血缘）——
  // 每个 phase 引用的 run 必须真实执行过该 phase（phase_start 事件）且该 run 终局非失败态。
  for (const rec of completion.phases) {
    const evAbs = featureFilePath(projectRoot, feature, path.join('goal-runs', rec.run_id, 'events.jsonl'));
    if (!fs.existsSync(evAbs)) {
      reasons.push(`[${rec.phase}] 引用 run ${rec.run_id} 无 events.jsonl——自报失配`);
      continue;
    }
    let sawPhaseStart = false;
    let runEndStatus: string | null = null;
    try {
      for (const line of fs.readFileSync(evAbs, 'utf-8').split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
          const ev = JSON.parse(line) as { type?: string; phase?: string; status?: string };
          if (ev.type === 'phase_start' && ev.phase === rec.phase) sawPhaseStart = true;
          if (ev.type === 'run_end') runEndStatus = ev.status ?? null;
        } catch { /* 单行损坏跳过 */ }
      }
    } catch {
      reasons.push(`[${rec.phase}] run ${rec.run_id} events.jsonl 不可读`);
      continue;
    }
    if (!sawPhaseStart) {
      reasons.push(`[${rec.phase}] 引用 run ${rec.run_id} 从未执行该 phase（无 phase_start 事件）——血缘伪造`);
    }
    // codex 七轮 P0-1：run_end **缺失**（崩溃/中断/截断）同样不得作 clean 血缘——
    // null 放行是漏洞（run 未终局也能证完成）。要求成功侧 run_end 显式存在。
    if (runEndStatus === null) {
      reasons.push(`[${rec.phase}] 引用 run ${rec.run_id} 无 run_end 事件（未终局/崩溃/截断）——血缘不成立`);
    } else if (!RUN_END_LINEAGE_OK.has(runEndStatus)) {
      reasons.push(`[${rec.phase}] 引用 run ${rec.run_id} 终局为 ${runEndStatus}（非成功态不得作为 clean 血缘）`);
    }
    // codex 九轮 P1：attempt 与事件对账（规范口径=最后一次 agent_invoke_start 的
    // invocation 序数）——自报 attempt 改写即 INVALID，不再是装饰字段。
    // codex 十轮 P1：三态——invalid（事件存在但 invoke_id 缺失/畸形）单独 fail-closed，
    // 不与 absent 合流成 null===null 放行。
    const derivedAttempt = derivePhaseInvocationAttempt(
      readRunEventLines(projectRoot, feature, rec.run_id),
      rec.phase,
    );
    if (derivedAttempt.kind === 'invalid') {
      reasons.push(
        `[${rec.phase}] run ${rec.run_id} invocation 事件非法（${derivedAttempt.detail}）——attempt 不可推导，血缘不成立`,
      );
    } else {
      const expected = derivedAttempt.kind === 'valid' ? derivedAttempt.ordinal : null;
      if ((rec.attempt ?? null) !== expected) {
        reasons.push(
          `[${rec.phase}] attempt 与事件推导失配：凭证=${rec.attempt ?? 'null'} ≠ 事件=${expected ?? 'null'}`,
        );
      }
    }
  }
  // 生成 run 自身必须有 events
  {
    const genEv = featureFilePath(projectRoot, feature, path.join('goal-runs', completion.run_id, 'events.jsonl'));
    if (!fs.existsSync(genEv)) reasons.push(`生成 run ${completion.run_id} 无 events.jsonl——自报失配`);
  }

  // 逐阶段自报值 vs 当前重算（receipt 规范化哈希 + manifest aggregate）——失配即 INVALID
  for (const rec of completion.phases) {
    const nowReceipt = computeCanonicalReceiptSha256(projectRoot, feature, rec.phase);
    if (nowReceipt !== rec.receipt_sha256) {
      reasons.push(`[${rec.phase}] 回执规范化哈希与凭证记录失配`);
    }
    const manifest = loadPhaseEvidenceManifest(projectRoot, feature, rec.phase);
    if ((manifest?.manifest.aggregate_sha256 ?? null) !== rec.evidence_manifest_aggregate) {
      reasons.push(`[${rec.phase}] evidence manifest aggregate 与凭证记录失配`);
    }
  }
  // 顶层 artifact 自报 vs 重算
  const artNow = (name: string): string | null => {
    const r = resolveFeatureArtifact(projectRoot, feature, name);
    return r.exists ? sha256File(r.actualPath) : null;
  };
  const artPairs: Array<[string, string | null]> = [
    ['spec.md', completion.artifact_hashes.spec_md],
    ['acceptance.yaml', completion.artifact_hashes.acceptance_yaml],
    ['contracts.yaml', completion.artifact_hashes.contracts_yaml],
  ];
  const artChanged = artPairs.filter(([name, recorded]) => artNow(name) !== recorded).map(([n]) => n);
  if (artChanged.length > 0) reasons.push(`顶层 artifact 变更：${artChanged.join(', ')}`);

  // codex 七轮 P1-3：需求 SSOT/testing 源码/review attestation 绑定字段重算对账
  if (computeRequirementSsotAggregate(projectRoot, feature) !== completion.requirement_sha256) {
    reasons.push('requirement_sha256 与凭证记录失配（需求 SSOT 变更）');
  }
  const attNow = loadReviewClosureAttestation(projectRoot, feature);
  if ((attNow?.inventory.aggregate_sha256 ?? null) !== completion.review_attestation_aggregate) {
    reasons.push('review_attestation_aggregate 与凭证记录失配');
  }
  if (buildSourceInventory(projectRoot, { expectProductSources: false }).aggregate_sha256 !== completion.testing_source_aggregate) {
    reasons.push('testing_source_aggregate 与凭证记录失配（产品源码树变更）');
  }

  // clean_pass 全量重算（血缘 fresh / attestation / must-review / waiver / verdict / 运行时证据）
  // ——currentRequirementSha 用生成 run 的 requirement（P0-2：换需求复用旧 closure 在此判 stale）。
  const issues = collectCleanPassIssues({
    projectRoot, feature, chain: completion.chain, fidelityCapped: opts.fidelityCapped,
    currentRequirementSha: computeRunRequirementSha(projectRoot, feature, completion.run_id),
  });
  for (const i of issues) reasons.push(`[${i.phase}] ${i.condition}(${i.kind}): ${i.detail}`);

  // supersedes 审计核验（codex 五轮 P1：自报 Set 直接豁免=把绕过固化）：
  // 每个被废弃 run 必须在生成 run 的 events.jsonl 里有 {type:'supersede', target_run_id}
  // 审计事件；无事件的自报条目不生效且判自报失配。
  const auditedSupersedes = new Set<string>();
  {
    const genEvents = featureFilePath(projectRoot, feature, path.join('goal-runs', completion.run_id, 'events.jsonl'));
    if (fs.existsSync(genEvents)) {
      for (const line of fs.readFileSync(genEvents, 'utf-8').split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
          const ev = JSON.parse(line) as { type?: string; target_run_id?: string };
          if (ev.type === 'supersede' && typeof ev.target_run_id === 'string') {
            auditedSupersedes.add(ev.target_run_id);
          }
        } catch { /* 单行损坏跳过 */ }
      }
    }
    for (const claimed of completion.supersedes) {
      if (!auditedSupersedes.has(claimed)) {
        reasons.push(`supersedes 自报 ${claimed} 无对应审计事件（--supersede 未真实执行）——自报失配`);
      }
    }
  }

  // 更晚未终局 run（仅经审计核验的 supersede 生效豁免）
  const gen = completion.generated_at;
  for (const run of scanRunTerminalStates(projectRoot, feature)) {
    if (auditedSupersedes.has(run.run_id) && completion.supersedes.includes(run.run_id)) continue;
    if (run.run_id === completion.run_id) continue;
    if (run.last_ts && run.last_ts > gen && !NON_TERMINAL_OK.has(run.status ?? '')) {
      reasons.push(`存在晚于凭证的未终局 run：${run.run_id}（status=${run.status ?? '未知'}）`);
    }
  }

  if (reasons.length === 0) return { verdict: 'VALID', reasons: [] };
  // 凭证内部自报失配/血缘伪造=INVALID；其余（世界后变）=STALE
  const invalid = reasons.some((r) => /失配|非法|缺失|伪造|血缘/.test(r));
  return { verdict: invalid ? 'INVALID' : 'STALE', reasons };
}

/**
 * Goal-runner failure classification — SSOT for no-progress guard + retry context.
 * Consumed by goal-runner.ts (guard + priorFailure prompt shaping).
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
  isDeferrableExternalBlock,
  type DependencyPolicy,
  DEFAULT_DEPENDENCY_POLICY,
} from './phase-transition-policy';

export type FailureKind =
  | 'deterministic_gate_or_artifact_missing'
  | 'toolchain'
  | 'capture'
  | 'visual_gap'
  | 'code_regression'
  | 'external_block';

/**
 * T6：失败按互斥 bucket 归因，使 goal-mode 不再把 testing 的工具链/采集/视觉差距一律塞 code_regression
 * （实测病灶：homepage testing 3 次/177 分钟空转，两次 timeout/FAIL 全归 code_regression 盲重试）。
 * 分流后：toolchain/capture 属环境/基建失败、盲重试无益 → 与 deterministic 一样 signature 重复即 halt（不吃视觉迭代预算）；
 * visual_gap 属 UI 差距、coding 回修可改善，但同一组视觉门禁连续重复（无改善）→ 熔断求人。
 */
// review#2：**不**用 `device_test_` 前缀整体归类——device_test_run 覆盖派生计划缺失/真机崩溃/用例失败/trace blocked
// 等多因，其中只有"环境启动/runner 崩溃"才是 toolchain，用例失败更接近 code_regression（须改码、可重试）。
// 故 toolchain id 仅取确切的 build/install + hylyre/hvigor；device_test_run 的 toolchain 子类由 check 层
// 显式打 `blocking_class: 'device_toolchain'`（仅 `!run.ok` 崩溃路径），见下方 hasToolchainBlockingClass。
const TOOLCHAIN_BLOCKER_PREFIXES = ['device_test_build', 'device_test_install', 'hylyre_', 'hvigor_'];
/** check 层显式标注的 toolchain 子类（device_test_run 崩溃等）；用例失败不打此标 → 归 code_regression */
const TOOLCHAIN_BLOCKING_CLASSES: ReadonlySet<string> = new Set(['device_toolchain']);
/**
 * round5 P0-A/X4：精确 id（非前缀）也归 toolchain。`visual_parity_ocr_unavailable`——pixel_1to1 下
 * OCR（烤字门禁唯一承重探测）不可用属工具依赖缺失，须归 toolchain（signature 重复即 halt、指向"修 OCR 环境"），
 * 否则其 `visual_parity_*` 前缀会掉进 code_regression 被盲重试。
 */
const TOOLCHAIN_BLOCKER_IDS: ReadonlySet<string> = new Set<string>(['visual_parity_ocr_unavailable']);
/**
 * round5 P1-B：采集/导航身份类精确 id 归 capture。`visual_diff_screenshot_dedup`（≥2 屏共享 hash=Tab
 * 未切换/重复采集）本质是采集导航 bug（非 UI 差距），归 capture 而非 visual_gap——halt 原因/重试指导才
 * 指向"修采集导航"而非"改 UI"（isVisualGapBlockerId 已 `&& !isCaptureBlockerId` 自动排除之）。
 */
const CAPTURE_BLOCKER_IDS: ReadonlySet<string> = new Set<string>(['visual_diff_screenshot_dedup']);

/** 采集失败（截图 IO/Permission denied/screensWritten=0 / 撞 hash 未切屏）；属基建 → 早 halt */
export function isCaptureBlockerId(id: string): boolean {
  return id.startsWith('visual_diff_capture') || CAPTURE_BLOCKER_IDS.has(id);
}

/** 真机工具链失败（build/install/hylyre/hvigor + OCR 依赖缺失）；盲重试无益 → 早 halt。device_test_run 不在此（见 blocking_class 路径） */
export function isToolchainBlockerId(id: string): boolean {
  return TOOLCHAIN_BLOCKER_PREFIXES.some((p) => id.startsWith(p)) || TOOLCHAIN_BLOCKER_IDS.has(id);
}

/** check 层把 device_test_run 崩溃等显式标 blocking_class='device_toolchain' → 归 toolchain；用例失败无此标 */
export function hasToolchainBlockingClass(summary: GoalSummaryLike | null | undefined): boolean {
  if (!summary) return false;
  if (summary.blocking_class && TOOLCHAIN_BLOCKING_CLASSES.has(summary.blocking_class)) return true;
  return (summary.blockers ?? []).some(
    (b) => typeof b.blocking_class === 'string' && TOOLCHAIN_BLOCKING_CLASSES.has(b.blocking_class),
  );
}

/** 视觉差距门禁（visual_diff* 除 capture，含 layout_divergence / out_of_bounds_element / must_fix） */
export function isVisualGapBlockerId(id: string): boolean {
  return id.startsWith('visual_diff') && !isCaptureBlockerId(id);
}

/** signature 重复即 halt 的 kind（基建类 + 视觉无改善——盲重试都无益） */
export const SIGNATURE_HALT_KINDS: ReadonlySet<FailureKind> = new Set<FailureKind>([
  'deterministic_gate_or_artifact_missing',
  'toolchain',
  'capture',
  'visual_gap',
]);

/**
 * Blocker ids where retry without user input is structurally pointless.
 * Grep-verified against harness/scripts/check-*.ts (no ghost ids).
 * Coverage: spec/plan/review artifact gates + receipt trace/context gates.
 */
export const DETERMINISTIC_GATE_BLOCKER_IDS = new Set<string>([
  // check-spec.ts
  'spec_file_exists',
  'terminology_mapping_table',
  // check-plan.ts
  'plan_file_exists',
  // check-review.ts
  'review_report_exists',
  // check-receipt.ts (trace + context exploration)
  'trace_json_exists_false',
  'trace_json_path_missing',
  'trace_json_file_not_found',
  'context_exploration_exists_false',
  'context_exploration_summary_path_missing',
  'context_exploration_file_not_found',
  'verifier_report_missing',
  'verifier_report_path_missing',
]);

export interface GoalSummaryBlocker {
  id?: string;
  blocking_class?: string;
  classification?: string;
  affected_files?: string[];
}

export interface GoalSummaryLike {
  verdict?: string;
  blocking_class?: string;
  failure_kind?: string;
  blockers?: GoalSummaryBlocker[];
}

export interface ArtifactSnapshotEntry {
  exists: boolean;
  contentHash: string;
}

export type ArtifactSnapshot = Record<string, ArtifactSnapshotEntry>;

function blockerIds(summary: GoalSummaryLike | null | undefined): string[] {
  if (!summary?.blockers?.length) return [];
  return summary.blockers
    .map((b) => b.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
    .sort();
}

function topBlockingMeta(summary: GoalSummaryLike | null | undefined): {
  blocking_class?: string;
  failure_kind?: string;
} {
  if (!summary) return {};
  if (summary.blocking_class || summary.failure_kind) {
    return { blocking_class: summary.blocking_class, failure_kind: summary.failure_kind };
  }
  const b = summary.blockers?.[0];
  if (!b) return {};
  return { blocking_class: b.blocking_class, failure_kind: b.classification };
}

/**
 * Stable signature for cross-attempt comparison (sorted blocker ids).
 */
export function extractBlockerSignature(summary: GoalSummaryLike | null | undefined): string {
  const ids = blockerIds(summary);
  return ids.length > 0 ? ids.join('|') : '';
}

/**
 * Classify harness failure for guard + retry-context. Unknown ids → code_regression (prefer retry).
 */
export function classifyFailureKind(
  summary: GoalSummaryLike | null | undefined,
  dependencyPolicy: DependencyPolicy = DEFAULT_DEPENDENCY_POLICY,
): FailureKind {
  const meta = topBlockingMeta(summary);
  if (
    isDeferrableExternalBlock(meta.blocking_class, meta.failure_kind, dependencyPolicy)
  ) {
    return 'external_block';
  }
  const ids = blockerIds(summary);
  if (ids.some((id) => DETERMINISTIC_GATE_BLOCKER_IDS.has(id))) {
    return 'deterministic_gate_or_artifact_missing';
  }
  // T6：基建/视觉分流。toolchain（build/install/hylyre 或 check 层标注的 device_test_run 崩溃）优先于 capture，再于 visual_gap。
  // device_test_run 的"用例失败"不带 device_toolchain 标 → 落到 code_regression（须改码、可重试），不误导成"先查环境"。
  if (ids.some(isToolchainBlockerId) || hasToolchainBlockingClass(summary)) return 'toolchain';
  if (ids.some(isCaptureBlockerId)) return 'capture';
  if (ids.some(isVisualGapBlockerId)) return 'visual_gap';
  return 'code_regression';
}

/** Collect affected_files from deterministic blockers on the summary. */
export function extractDeterministicAffectedFiles(
  summary: GoalSummaryLike | null | undefined,
): string[] {
  const out = new Set<string>();
  for (const b of summary?.blockers ?? []) {
    if (!b.id || !DETERMINISTIC_GATE_BLOCKER_IDS.has(b.id)) continue;
    for (const f of b.affected_files ?? []) {
      if (f.trim()) out.add(f.trim().replace(/\\/g, '/'));
    }
  }
  return [...out];
}

function hashFileContent(absPath: string): string {
  const buf = fs.readFileSync(absPath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/** Snapshot existence + content hash (not mtime). */
export function snapshotArtifacts(
  projectRoot: string,
  relativePaths: string[],
): ArtifactSnapshot {
  const snap: ArtifactSnapshot = {};
  for (const rel of relativePaths) {
    const norm = rel.replace(/\\/g, '/');
    const abs = path.join(projectRoot, norm);
    if (!fs.existsSync(abs)) {
      snap[norm] = { exists: false, contentHash: '' };
    } else {
      try {
        snap[norm] = { exists: true, contentHash: hashFileContent(abs) };
      } catch {
        snap[norm] = { exists: true, contentHash: '' };
      }
    }
  }
  return snap;
}

/**
 * True when any watched artifact gained existence or changed content (ignores mtime-only bumps).
 */
export function artifactsProgressed(
  prior: ArtifactSnapshot | null | undefined,
  current: ArtifactSnapshot,
): boolean {
  if (!prior || Object.keys(prior).length === 0) return false;
  for (const [rel, cur] of Object.entries(current)) {
    const prev = prior[rel];
    if (!prev) {
      if (cur.exists) return true;
      continue;
    }
    if (prev.exists !== cur.exists) return true;
    if (cur.exists && prev.contentHash !== cur.contentHash) return true;
  }
  return false;
}

export interface NoProgressGuardInput {
  failureKind: FailureKind;
  priorBlockerSignature: string | null;
  currentBlockerSignature: string;
  priorArtifactSnapshot: ArtifactSnapshot | null;
  currentArtifactSnapshot: ArtifactSnapshot;
}

/**
 * Halt when a signature-halt kind repeats with zero progress (2nd+ identical failure).
 * T6 起覆盖 {deterministic_gate, toolchain, capture, visual_gap}：
 *   - deterministic/toolchain/capture：基建/缺件类，盲重试无益 → identical signature 即 halt
 *     （toolchain/capture 无 watched artifact，artifactsProgressed 恒 false，纯靠 signature 重复判定，
 *      达成"工具链/采集反复失败不吃视觉迭代预算"的预算分流）。
 *   - visual_gap：同一组视觉门禁 signature 重复（coding 上一轮"修"未改变任何失败门禁）= 无改善 → 熔断求人，
 *     避免 homepage 那种"3 轮把卡包瞎挪、视觉门禁原样复现"的空转。
 *   - code_regression：仍永不 guard-halt（偏好重试，可能是自引入回归）。
 */
export function shouldHaltNoProgress(input: NoProgressGuardInput): boolean {
  if (!SIGNATURE_HALT_KINDS.has(input.failureKind)) return false;
  if (!input.priorBlockerSignature || input.priorBlockerSignature.length === 0) return false;
  if (input.priorBlockerSignature !== input.currentBlockerSignature) return false;
  return !artifactsProgressed(input.priorArtifactSnapshot, input.currentArtifactSnapshot);
}

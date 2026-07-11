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
  | 'external_block'
  | 'agent_timeout'
  | 'transient_api_error'
  | 'agent_no_output'
  /** P0-9b：唯一阻塞=T2 真人过目确认（设计内求人时刻，重试无意义，不入 no_progress 口径） */
  | 'await_human_confirm'
  /**
   * t1（plan f7a3d9c2）：指纹级无进展熔断——check 层比对轮次账本（visual-rounds.ledger.jsonl）
   * 判"连续两有效轮缺陷指纹集相等且仍有 loop-actionable 残差"。首触即 halt（重试只会
   * 复现同指纹，不烧预算）；不入 SIGNATURE_HALT_KINDS（那是 runner 侧粗熔断兜底，本 kind
   * 由 check 侧细粒度判定先触发）。duplicate 重放的 fuse 同样走本 kind（rev5）。
   */
  | 'no_progress_fuse'
  /** E4（案B chrys 银行卡实证）：用户主动 Ctrl+C（Windows STATUS_CONTROL_C_EXIT / POSIX
   * SIGINT）——不是超时/断流/空产出/内容失败，重试是对用户意图的冒犯，须首触即 halt。 */
  | 'operator_interrupt'
  /** C5-min 验证转嫁禁令：修正触及验证层而宿主无 device 能力（evidence 缺口，与 await_human 系同构，不入 no_progress 口径）。
   * 【合并时留下的开放问题，未拍板】它和 await_human_confirm 结构同构——都设计成"首触即 halt"；
   * 但 await_human_confirm 在 chrys 实证里被证明会被 agent_timeout 掩盖而未能首触即拦，因此才
   * 被拉进 CUMULATIVE_HALT_FAMILY 累计兜底。verification_evidence_gap 目前**未**加入该家族——
   * 是否也需要同样的累计兜底，取决于它在真实场景里是否会被类似掩盖，尚无实证，留待观察后决定。 */
  | 'verification_evidence_gap';

/** Windows STATUS_CONTROL_C_EXIT，spawn/spawnSync 在 win32 上把 Ctrl+C 杀死的子进程 exit code 报成这个无符号 32 位值。 */
export const WINDOWS_CTRL_C_EXIT_CODE = 3221225786;

/** True when the invoke result indicates the OPERATOR (not our own tree-kill) interrupted the process. */
export function isOperatorInterruptSignal(
  exitCode: number,
  signal: string | null | undefined,
): boolean {
  return exitCode === WINDOWS_CTRL_C_EXIT_CODE || signal === 'SIGINT';
}

/**
 * P0-B/P0-D（b8f36a12）：agent 级基建失败信号——由 goal-runner 从 invoke 结果 +
 * agent-output.log 哨兵采集后传入，**优先于 summary blocker 归因**（blocker 只是症状：
 * 超时/断流 attempt 的 spec_file_exists 是"没跑完"的派生物，不是内容失败）。
 * 优先级：operator_interrupt（人手动 Ctrl+C，压过一切）> agent_timeout（runner tree-kill
 * 确定性事实，但若 summary blockers 全为 await_human 家族则让位于 await_human_confirm——
 * E4：案B chrys 现场实证 agentTimedOut 会遮蔽"其实只差真人签字"的判定）>
 * transient_api_error（断流串可能是被杀连带产生，故 timed_out 时不判断流）>
 * agent_no_output > blocker 归因。
 */
export interface AgentInvokeSignals {
  /** invoke.timed_out === true（maison 自己的预算 tree-kill） */
  agentTimedOut?: boolean;
  /** parseHeadlessApiError 非空信封命中（不依赖 exit code） */
  agentApiError?: boolean;
  /** 0 字节输出保守兜底（preflight 已过 + 无 spawn error + 极短时长 + exit≠0） */
  agentNoOutput?: boolean;
  /** isOperatorInterruptSignal(exitCode, signal) 命中——用户手动中断，非任何一种"失败"。 */
  operatorInterrupt?: boolean;
}

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

/**
 * signature 重复即 halt 的 kind（基建类 + 视觉无改善——盲重试都无益）。
 * P0-B：agent_timeout 加入——同专用 signature（agent_timeout@<phase>）重复且产物零进展
 * → 熔断求人（§六-4）；有进展则 guard 放行走 resume 续作（不吃内容重试预算，P0-B.5）。
 * P0-D：transient_api_error **不加入**——网络抖动重试有意义，走独立 backoff 上限；
 * agent_no_output 也不加入——它在 runner 层第一次出现即 halt（不盲重试），无需 signature 熔断。
 */
export const SIGNATURE_HALT_KINDS: ReadonlySet<FailureKind> = new Set<FailureKind>([
  'deterministic_gate_or_artifact_missing',
  'toolchain',
  'capture',
  'visual_gap',
  'agent_timeout',
]);

/**
 * E4（多模态降级阶梯 plan d4a8f3c6）：跨 attempt **累计**（非仅连续）重复同一 blocker_signature
 * 即 halt/降档 的家族——基建类（toolchain）与求人类（await_human_confirm）反复出现却被其他
 * 产物的变化"冲淡"掩盖（spec.md 内容每轮在变 ≠ 这个具体 blocker 真的在改善）。
 * 【扩展位已废弃，E3 后确认无需启用】此处原计划给盲档（effective_image_input=none）下的
 * capture_completeness_external 单开一个 'blind_review' FailureKind 归入本家族；E3 落地时
 * 该 check 改走另一条路径——直接把命中降为 WARN/MAJOR + 落 blind-review-pending.yaml
 * 结构化清单，不再产出 BLOCKER，本就不会进入需要 halt 的重试循环，无需新增分类/家族成员。
 */
export const CUMULATIVE_HALT_FAMILY: ReadonlySet<FailureKind> = new Set<FailureKind>([
  'toolchain',
  'await_human_confirm',
]);

/** 同一 blocker_signature 在 CUMULATIVE_HALT_FAMILY 家族内累计出现达到此次数即 halt（非连续）。 */
export const CUMULATIVE_HALT_THRESHOLD = 3;

/** advance_blocked（script PASS 但 closure 打不开）累计出现达到此次数（含本次）即 halt 求人，不再退化到无限重试。 */
export const ADVANCE_BLOCKED_HALT_THRESHOLD = 2;

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
 * P0-B（§七.3）：跨 attempt 比较用的**有效** signature。PASS+timeout 常无普通 blocker
 * → 空 signature 会被 shouldHaltNoProgress 的 `!priorBlockerSignature` 短路、熔断恒不
 * 触发（逃逸）。agent_timeout 无 blocker 时构造专用 signature `agent_timeout@<phase>`，
 * 使"连续超时且产物零进展"能被 guard 抓到。
 */
export function buildEffectiveBlockerSignature(
  summary: GoalSummaryLike | null | undefined,
  failureKind: FailureKind,
  phase: string,
): string {
  const base = extractBlockerSignature(summary);
  if (base) return base;
  if (failureKind === 'agent_timeout') return `agent_timeout@${phase}`;
  return base;
}

/**
 * Classify harness failure for guard + retry-context. Unknown ids → code_regression (prefer retry).
 * P0-B/P0-D：agent 级信号（signals）优先于 blocker 归因——超时/断流 attempt 的
 * deterministic blocker 只是"没跑完"的派生症状，按症状归因即误熔断（bc-openCard 现场）。
 */
export function classifyFailureKind(
  summary: GoalSummaryLike | null | undefined,
  dependencyPolicy: DependencyPolicy = DEFAULT_DEPENDENCY_POLICY,
  signals?: AgentInvokeSignals,
): FailureKind {
  // agent 级基建失败优先（优先级见 AgentInvokeSignals 注释）。operator_interrupt 压过一切——
  // 用户手动 Ctrl+C 时无论是否也恰好超时/断流/空产出，都不是"失败"，重试是对用户意图的冒犯。
  if (signals?.operatorInterrupt) return 'operator_interrupt';
  if (signals?.agentTimedOut) {
    // E4（cursor+codex 双 review 采纳）：agentTimedOut 最高优先没错，但若这轮 summary 的
    // blockers 非空且**全部**已被 check 层判定为 await_human_confirm（真人签字家族），
    // 说明超时只是"顺带杀死了一个本来就只差人签的 attempt"——归 agent_timeout 会让 runner
    // 继续做免预算重试（P0-B.5 不吃 retries），而人签墙不会因重试消失，等同无限空转。
    const blockers = summary?.blockers ?? [];
    if (blockers.length > 0 && blockers.every((b) => b.classification === 'await_human_confirm')) {
      return 'await_human_confirm';
    }
    return 'agent_timeout';
  }
  if (signals?.agentApiError) return 'transient_api_error';
  if (signals?.agentNoOutput) return 'agent_no_output';

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
  // P0-9b：visual-diff-check 收窄判定后置的 await_human_confirm classification——全 P0 屏 pass
  // 候选且零 must_fix/stale，唯一 BLOCKER=真人确认。agent 不能替人签，重试无意义 → 独立 kind。
  if ((summary?.blockers ?? []).some((b) => b.classification === 'await_human_confirm')) {
    return 'await_human_confirm';
  }
  // t1（f7a3d9c2）：指纹级无进展熔断——须在 isVisualGapBlockerId 前缀归类**之前**判
  // （fuse blocker id 以 visual_diff 开头，否则被吸成 visual_gap 走粗熔断路径）。
  // 与 await_human_confirm 互斥由 check 侧保证（仅 awaitHumanOnly=false 才计算 fuse）。
  if ((summary?.blockers ?? []).some((b) => b.classification === 'no_progress_fuse')) {
    return 'no_progress_fuse';
  }
  // C5-min：验证转嫁禁令的 evidence 缺口（check 层 failure_kind: verification_evidence_gap）——
  // 设计内求人时刻，重试无意义，首触即 halt；不入 SIGNATURE_HALT_KINDS（不吃 no_progress 口径）。
  if ((summary?.blockers ?? []).some((b) => b.classification === 'verification_evidence_gap')) {
    return 'verification_evidence_gap';
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

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
  /** f4b2c8e6 t1：可信真机 evidence 的根失败非空且全部为 test_contract。
   * 只修 goal 级归因/提示，不驱动产品代码回退。 */
  | 'test_contract'
  /** P0-4(d)（plan 7c4f2e9b）：spec 捕获完整性缺口——独立命名防误标 code_regression；
   * 主出口=actionability 聚合层，不入 SIGNATURE_HALT_KINDS。 */
  | 'spec_capture_gap'
  | 'code_regression'
  | 'external_block'
  | 'agent_timeout'
  | 'transient_api_error'
  | 'agent_no_output'
  /** legacy event vocabulary；当前 summary 中同类视觉缺口重投影为 visual_gap。 */
  | 'await_human_confirm'
  /**
   * t1（plan f7a3d9c2）：指纹级无进展熔断——check 层比对轮次账本（visual-rounds.ledger.jsonl）
   * 判"连续两有效轮缺陷指纹集相等且仍有 loop-actionable 残差"。首触即 halt（重试只会
   * 复现同指纹，不烧预算）；不入 SIGNATURE_HALT_KINDS（那是 runner 侧粗熔断兜底，本 kind
   * 由 check 侧细粒度判定先触发）。duplicate 重放的 fuse 同样走本 kind（rev5）。
   */
  | 'no_progress_fuse'
  /**
   * E4（案B chrys 银行卡实证）：**控制台中断类退出**（Windows STATUS_CONTROL_C_EXIT /
   * POSIX SIGINT——Ctrl+C、窗口关闭、conhost 终止等，可能来自操作者有意中断，也可能
   * 是宿主环境清理）。不是超时/断流/空产出/内容失败，重试是冒犯，须首触即 halt；
   * 归因话术不得武断写成「用户手动」——只描述控制台中断类退出本身。
   */
  | 'operator_interrupt'
  /** C5-min 验证转嫁禁令：修正触及验证层而宿主无 device 能力。
   * 当前由 capability/external 路由诚实 defer，不以人工签字替代 evidence。 */
  | 'verification_evidence_gap'
  /** 当前机器产生的 integrity blocker（如 process_injection）首触 halt；历史 framework
   * Git/hash subtype 只读兼容。普通运行不再生产 framework Git dirty 结果。 */
  | 'framework_integrity_block'
  /** P0-3（plan d9b4f7e2）：门禁脚本自身程序员错误（safeRun 捕获的 TypeError/RangeError/
   * SyntaxError，[Harness 内部错误]）——agent 的产物修不好框架代码，重试只会空转（案发
   * 现场 spec 前 5 轮反复"修"不存在于自己产物里的问题）→ 首触即 halt，指向回灌源仓。 */
  | 'framework_bug'
  /** Harness closure finalizer failed after a PASS/receipt gate. */
  | 'closure_finalization_failed';

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
 * 优先级：operator_interrupt（控制台中断类退出，压过一切）> agent_timeout（runner tree-kill
 * 确定性事实）>
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
  /** isOperatorInterruptSignal(exitCode, signal) 命中——控制台中断类退出，非任何一种"内容失败"。 */
  operatorInterrupt?: boolean;
  /**
   * P0-5/P0-3 freshness（plan d9b4f7e2 决策表）：resolved.stale_summary——本轮 harness 是否
   * **没有**产出新 summary（mtime 未更新）。fresh（false）时超时轮的确定性 integrity/
   * framework_bug 证据可信（harness 在 tree-kill agent 之后新鲜跑出），优先于 agent_timeout；
   * stale（true）时旧 summary 的此类证据不可信，一律归 agent_timeout。未传视同 stale
   * （fail-safe：宁可多续作一轮，不凭旧证据 halt）。
   */
  staleSummary?: boolean;
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
const TOOLCHAIN_BLOCKER_IDS: ReadonlySet<string> = new Set<string>([
  'visual_parity_ocr_unavailable',
  // P0-4（plan 7c4f2e9b）迁移表：该 id 的 suggestion 一直自述「归 toolchain」但从未注册
  // ——事故里它与 capture_completeness* 一起落 code_regression 盲重试。
  'capture_completeness_external_ocr_unavailable',
]);
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
 * 即 halt/降档 的家族——基建类（toolchain）反复出现却被其他产物的变化"冲淡"掩盖
 * （spec.md 内容每轮在变 ≠ 这个具体 blocker 真的在改善）。
 * 【扩展位已废弃，E3 后确认无需启用】此处原计划给盲档（effective_image_input=none）下的
 * capture_completeness_external 单开一个 'blind_review' FailureKind 归入本家族；E3 落地时
 * 该 check 改走另一条路径——直接把命中降为 WARN/MAJOR + 落 blind-review-pending.yaml
 * 结构化清单，不再产出 BLOCKER，本就不会进入需要 halt 的重试循环，无需新增分类/家族成员。
 */
export const CUMULATIVE_HALT_FAMILY: ReadonlySet<FailureKind> = new Set<FailureKind>([
  'toolchain',
]);

/**
 * f9c2e6b4 t3：重试耗尽时的**责任归属**——哪些 FailureKind 属"外部条件未满足"。
 *
 * 立项事故 run 20260803T103413Z-3f72a8：耗尽后产生端发
 * `assess_halt:phase_verdict:halt; failure_kind=project_build`，被 `normalizeIncidentId`
 * 截到首个 `:` 变成 `assess_halt`，registry 固定 `operator` → **WAITING/human**。
 * 真实责任类别在这一步被抹平，而 WAITING 会让 supervisor 永不拉起。
 *
 * 本集合**复用既有 FailureKind 分类**，不新建正则、不新建第二套责任表——
 * 它只回答一个问题：这个失败是"内容没做对"（重启无用，人来看）还是"外部条件不满足"
 * （环境恢复后可继续）。不在集合内的一律按内容失败处理（保守：内容失败 → TERMINAL，
 * 不会让 supervisor 反复拉起一个注定再死的 run）。
 */
export const EXTERNAL_RETRY_RESPONSIBILITY_KINDS: ReadonlySet<FailureKind> = new Set<FailureKind>([
  'toolchain',
  'external_block',
  'capture',
  'agent_timeout',
  'transient_api_error',
  'agent_no_output',
]);

/**
 * plan b3e8d4c7 t3：**assess-halt 汇点的事故 id**。
 *
 * 该汇点（goal-runner 的 `action==='halt' && !haltReason`）承载多类 halt，f9c2e6b4 t3
 * 曾把它**整体**假设成"重试耗尽"，于是宿主 run 20260804T033834Z-99c0a1 里预算只用了 1/2、
 * 真因是"推荐无路由"，却被标 content_retry_exhausted + TERMINAL（halt_reason 说 exhausted、
 * reason 说 unclosed，自相矛盾，还让 supervisor 永不拉起）。
 *
 * `retries >= max` 只是**必要**条件——预算恰好用满时任何落进 catch-all 的 halt 都会被误标。
 * 充分证据须同时满足：来自 phase-outcome SSOT 的 halt（runner_action==='halt'）、
 * 本轮非 PASS、且未熔断。其余一律 fail-closed 到 framework_bug——**不给 catch-all 起精确名字**。
 */
export function resolveAssessHaltIncident(input: {
  retriesUsed: number;
  maxRetriesPerPhase: number;
  /** assess recommendation 的 SSOT 动作（仅当推荐派生自 phase outcome 时存在） */
  runnerAction?: string;
  verdict: string;
  fused: boolean;
  failureKind: FailureKind;
}): 'content_retry_exhausted' | 'external_retry_exhausted' | 'framework_bug' {
  const exhausted =
    input.retriesUsed >= input.maxRetriesPerPhase &&
    input.runnerAction === 'halt' &&
    input.verdict !== 'PASS' &&
    !input.fused;
  if (!exhausted) return 'framework_bug';
  return EXTERNAL_RETRY_RESPONSIBILITY_KINDS.has(input.failureKind)
    ? 'external_retry_exhausted'
    : 'content_retry_exhausted';
}

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
  /** P0-4（plan 7c4f2e9b）：check 侧显式 actionability（优先级链第一环；缺省走注册表映射） */
  actionability?: BlockerActionability;
}

// ============================================================================
// P0-4（plan 7c4f2e9b）：blocker actionability 单一注册表（codex 四轮 SF#4：复用既有
// toolchain 判定，不造第三套 taxonomy）。summary 映射 / runner 重试回喂 / goal-report
// 三方共同消费本注册表；优先级链：显式 actionability → failure_kind/blocking_class
// 兼容映射 → 缺省 agent_fixable（未登记 blocker 行为不变）。
// ============================================================================

export type BlockerActionability = 'agent_fixable' | 'human_only' | 'toolchain_blocked';

/** human_only 兼容映射：仅剩已退役的历史门禁 id。当前 blocker 不得进入人签队列。 */
const HUMAN_ONLY_BLOCKER_IDS: ReadonlySet<string> = new Set<string>([
  'fidelity_deferrals_human_sign',
]);
/** human_only 兼容映射：仅解释旧产物；当前 writer 不产生这些 classification。 */
const HUMAN_ONLY_CLASSIFICATIONS: ReadonlySet<string> = new Set<string>([
  'await_human_confirm',
  'await_human_fidelity_tier',
  'capability_missing_strong_intent',
]);
const RUNTIME_OWNED_BASELINE_BLOCKERS: ReadonlySet<string> = new Set<string>([
  'ui_scope_base_missing',
  'ui_scope_diff_unavailable',
  'run_base_sha_missing',
  'run_base_sha_invalid',
  'run_created_missing',
  'creation_incomplete',
]);

export function resolveBlockerActionability(b: GoalSummaryBlocker): BlockerActionability {
  if (b.actionability) return b.actionability;
  const id = b.id ?? '';
  if (HUMAN_ONLY_BLOCKER_IDS.has(id)) return 'human_only';
  if (b.classification && HUMAN_ONLY_CLASSIFICATIONS.has(b.classification)) return 'human_only';
  if (
    RUNTIME_OWNED_BASELINE_BLOCKERS.has(id) ||
    (b.classification && RUNTIME_OWNED_BASELINE_BLOCKERS.has(b.classification))
  ) return 'toolchain_blocked';
  if (isToolchainBlockerId(id)) return 'toolchain_blocked';
  if (b.blocking_class && TOOLCHAIN_BLOCKING_CLASSES.has(b.blocking_class)) return 'toolchain_blocked';
  return 'agent_fixable';
}

export interface ActionabilityAggregate {
  hasToolchain: boolean;
  /** blockers 非空且全部 human_only（求人谓词 ¬∃agent_fixable ∧ ∃human_only） */
  allHumanOnly: boolean;
  agentFixableIds: string[];
  humanOnlyIds: string[];
  toolchainIds: string[];
}

export function aggregateBlockerActionability(
  summary: GoalSummaryLike | null | undefined,
): ActionabilityAggregate {
  const blockers = summary?.blockers ?? [];
  const agentFixableIds: string[] = [];
  const humanOnlyIds: string[] = [];
  const toolchainIds: string[] = [];
  for (const b of blockers) {
    const id = b.id ?? '(unnamed)';
    switch (resolveBlockerActionability(b)) {
      case 'toolchain_blocked': toolchainIds.push(id); break;
      case 'human_only': humanOnlyIds.push(id); break;
      default: agentFixableIds.push(id);
    }
  }
  return {
    hasToolchain: toolchainIds.length > 0,
    allHumanOnly: blockers.length > 0 && agentFixableIds.length === 0 && toolchainIds.length === 0 && humanOnlyIds.length > 0,
    agentFixableIds,
    humanOnlyIds,
    toolchainIds,
  };
}

/**
 * P0-4(b)+九轮 P0：timeout 分流统一四步（timed_out 且有 fresh blockers 时调用；
 * integrity/framework-bug 由更早的安全终态层处理，不进本函数）。
 * 返回 null = 走既有 agent_timeout 语义。
 */
export function classifyTimedOutWithFreshBlockers(
  summary: GoalSummaryLike | null | undefined,
): 'await_operator_toolchain' | null {
  const agg = aggregateBlockerActionability(summary);
  if (agg.hasToolchain) return 'await_operator_toolchain';
  // Human-only quality parking is retired. Legacy classifications are
  // revalidated by the owning quality/capability path and never create a new
  // resume-by-signature halt.
  return null;
}

/**
 * P0-4(b)：no-progress 签名剔除 human_only blockers（防对着修不了的部分空转熔断）。
 * 供 buildEffectiveBlockerSignature 消费。
 */
export function filterSignatureBlockers(summary: GoalSummaryLike | null | undefined): GoalSummaryLike | null | undefined {
  if (!summary?.blockers?.length) return summary;
  const kept = summary.blockers.filter(b => resolveBlockerActionability(b) !== 'human_only');
  if (kept.length === summary.blockers.length) return summary;
  return { ...summary, blockers: kept };
}

export interface GoalSummaryLike {
  verdict?: string;
  blocking_class?: string;
  failure_kind?: string;
  blockers?: GoalSummaryBlocker[];
}

const CURRENT_INTEGRITY_ID = 'node_options_injection';
const CURRENT_INTEGRITY_CLASSIFICATION = 'process_injection';

function isCurrentIntegrityBlocker(blocker: GoalSummaryBlocker): boolean {
  return (
    blocker.id === CURRENT_INTEGRITY_ID &&
    blocker.blocking_class === 'integrity' &&
    blocker.classification === CURRENT_INTEGRITY_CLASSIFICATION
  );
}

/**
 * 生成当前裁决视图：只保留现行 node_options_injection/process_injection。
 * 其它 integrity 行（含旧 framework_integrity/manifest/foreign/dirty）仅供历史 renderer，
 * 不得进入 current classification/halt/retry/continuation prompt。
 */
export function stripRetiredFrameworkIntegrityForCurrentRun<T extends GoalSummaryLike>(
  summary: T | null | undefined,
): T | null {
  if (!summary) return null;
  const retiredIntegrityIds = new Set(
    (summary.blockers ?? [])
      .filter((blocker) => blocker.blocking_class === 'integrity' && !isCurrentIntegrityBlocker(blocker))
      .flatMap((blocker) => [blocker.id, blocker.classification])
      .filter((id): id is string => typeof id === 'string' && id.length > 0),
  );
  if (
    summary.blocking_class === 'integrity' &&
    summary.failure_kind &&
    summary.failure_kind !== CURRENT_INTEGRITY_CLASSIFICATION
  ) {
    retiredIntegrityIds.add(summary.failure_kind);
  }
  const hadIntegrity =
    summary.blocking_class === 'integrity' ||
    (summary.blockers ?? []).some((blocker) => blocker.blocking_class === 'integrity');
  const blockers = (summary.blockers ?? []).filter(
    (blocker) => blocker.blocking_class !== 'integrity' || isCurrentIntegrityBlocker(blocker),
  );
  const topIsCurrent =
    summary.blocking_class === 'integrity' &&
    summary.failure_kind === CURRENT_INTEGRITY_CLASSIFICATION;
  const next = { ...summary, blockers } as T & {
    repair_candidates?: Array<{ id?: string }>;
  };
  if (Array.isArray(next.repair_candidates) && retiredIntegrityIds.size > 0) {
    next.repair_candidates = next.repair_candidates.filter(
      (candidate) => !candidate.id || !retiredIntegrityIds.has(candidate.id),
    );
  }
  if (summary.blocking_class === 'integrity' && !topIsCurrent) {
    delete next.blocking_class;
    delete next.failure_kind;
  }
  if (
    hadIntegrity &&
    blockers.length === 0 &&
    !next.blocking_class &&
    !next.failure_kind &&
    (next.repair_candidates?.length ?? 0) === 0
  ) return null;
  return next;
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

/** 只识别现行 node_options_injection/process_injection；历史 framework integrity 不参与。 */
export function hasIntegrityBlocker(summary: GoalSummaryLike | null | undefined): boolean {
  const current = stripRetiredFrameworkIntegrityForCurrentRun(summary);
  if (!current) return false;
  if ((current.blockers ?? []).some(isCurrentIntegrityBlocker)) return true;
  return (
    current.blocking_class === 'integrity' &&
    current.failure_kind === CURRENT_INTEGRITY_CLASSIFICATION
  );
}

/**
 * 从所有 integrity blocker 收集 classification（多值去重）。当前值用于 source-sensitive
 * guidance（如 process_injection）；退役 framework subtype 仅作历史 provenance。
 * 字段名对码：check 层 CheckResult.failure_kind 经 buildSummaryBlockers 落到 summary
 * blocker 的 **classification**（blocker 无 failure_kind 字段）；必须按
 * blocking_class==='integrity' 过滤，否则内容 blocker 的 classification 混入。
 * 顶层回落（旧 summary 兼容）同样带过滤：仅 summary.blocking_class==='integrity' 且
 * failure_kind 非空才回填——防"无合格 integrity blocker、顶层却是内容类 failure_kind"误塞。
 */
export function extractIntegritySubtypes(summary: GoalSummaryLike | null | undefined): string[] {
  if (!summary) return [];
  const out: string[] = [];
  for (const b of summary.blockers ?? []) {
    if (b.blocking_class !== 'integrity') continue;
    const c = (b.classification ?? '').trim();
    if (c && !out.includes(c)) out.push(c);
  }
  if (
    out.length === 0 &&
    summary.blocking_class === 'integrity' &&
    typeof summary.failure_kind === 'string' &&
    summary.failure_kind.trim().length > 0
  ) {
    out.push(summary.failure_kind.trim());
  }
  return out;
}

/**
 * P0-3（决策表"非空且全部 framework_bug"行）：blockers 非空且每条 classification 均为
 * framework_bug。**length > 0 是硬条件**——空数组 `.every()` 真空真值会把"无 blocker"
 * 误判成"全是框架 bug"（rev5 codex）。
 */
export function isAllFrameworkBugBlockers(summary: GoalSummaryLike | null | undefined): boolean {
  const blockers = summary?.blockers ?? [];
  return blockers.length > 0 && blockers.every((b) => b.classification === 'framework_bug');
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
  // P0-4(b)（plan 7c4f2e9b）：human_only blockers 不入 no-progress 签名——agent 修不了的
  // 签字项恒在会让签名恒等、把仍在推进 agent_fixable 部分的 attempt 误判零进展熔断。
  const base = extractBlockerSignature(filterSignatureBlockers(summary));
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
  const currentSummary = stripRetiredFrameworkIntegrityForCurrentRun(summary);
  // agent 级基建失败优先（优先级见 AgentInvokeSignals 注释）。operator_interrupt 压过一切——
  // 控制台中断类退出（Ctrl+C/关窗/conhost 终止，可能来自操作者或宿主环境清理）无论是否也
  // 恰好超时/断流/空产出，都不按内容失败重试。
  if (signals?.operatorInterrupt) return 'operator_interrupt';
  if (signals?.agentTimedOut) {
    // P0-5/P0-3 freshness 决策表（plan d9b4f7e2 rev5 写死，P0-5.4 为 SSOT）：
    //   stale                          → agent_timeout（旧 summary 证据不可信）
    //   fresh + 含当前机器 integrity   → framework_integrity_block（如 process_injection）
    //   fresh + 非空全 framework_bug   → framework_bug（length>0 防真空真值）
    //   fresh + 混装/纯 content        → agent_timeout（framework_bug 混装依赖 P0-2 收敛，
    //                                    见开放问题 3；integrity 不适用回落）
    // staleSummary 未传视同 stale（fail-safe）。
    const fresh = signals.staleSummary === false;
    if (fresh && hasIntegrityBlocker(currentSummary)) {
      return 'framework_integrity_block';
    }
    if (fresh && isAllFrameworkBugBlockers(currentSummary)) {
      return 'framework_bug';
    }
    // 旧 await_human_confirm 不再压过超时事实；恢复后由当前视觉 checker 重算机器证据。
    return 'agent_timeout';
  }
  if (signals?.agentApiError) return 'transient_api_error';
  if (signals?.agentNoOutput) return 'agent_no_output';
  // 历史 framework-only summary 没有当前失败事实。返回中性 continuation kind，且
  // goal-phase-runtime 会在调用 classifier 前直接剥离，不把该值写入 prompt/halt/retry。
  if (!currentSummary) return 'agent_timeout';

  // Closure finalization is a distinct machine-visible halt class; do not downgrade it to content regression.
  if ((currentSummary.blockers ?? []).some((b) => b.classification === 'closure_finalization_failed')) {
    return 'closure_finalization_failed';
  }
  // 当前机器 integrity（如进程预加载注入）优先于外部阻塞；历史 summary 仍可读。
  if (hasIntegrityBlocker(currentSummary)) {
    return 'framework_integrity_block';
  }
  const meta = topBlockingMeta(currentSummary);
  if (
    isDeferrableExternalBlock(meta.blocking_class, meta.failure_kind, dependencyPolicy)
  ) {
    return 'external_block';
  }
  // P0-3：非超时轮全 framework_bug（门禁自身崩溃）→ 首触 halt 指向回灌源仓；混装（框架
  // bug + 内容 blocker）走既有归因——内容 blocker 仍可修，不因框架 bug 把整轮判死。
  if (isAllFrameworkBugBlockers(currentSummary)) {
    return 'framework_bug';
  }
  const ids = blockerIds(currentSummary);
  if (ids.some((id) => DETERMINISTIC_GATE_BLOCKER_IDS.has(id))) {
    return 'deterministic_gate_or_artifact_missing';
  }
  // legacy compatibility：旧 await_human_confirm 不是通行证，也不再进入等待用户的 kind；
  // 回到视觉责任路径，以当前机器证据重验。
  if ((currentSummary.blockers ?? []).some((b) => b.classification === 'await_human_confirm')) {
    return 'visual_gap';
  }
  // t1（f7a3d9c2）：指纹级无进展熔断——须在 isVisualGapBlockerId 前缀归类**之前**判
  // （fuse blocker id 以 visual_diff 开头，否则被吸成 visual_gap 走粗熔断路径）。
  // 当前 check 侧直接用机器证据计算 fuse。
  if ((currentSummary.blockers ?? []).some((b) => b.classification === 'no_progress_fuse')) {
    return 'no_progress_fuse';
  }
  // C5-min：验证转嫁禁令的 evidence 缺口（check 层 failure_kind: verification_evidence_gap）——
  // 当前由 capability/external 责任路由处理，不以人工确认替代验证 evidence。
  if ((currentSummary.blockers ?? []).some((b) => b.classification === 'verification_evidence_gap')) {
    return 'verification_evidence_gap';
  }
  // T6：基建/视觉分流。toolchain（build/install/hylyre 或 check 层标注的 device_test_run 崩溃）优先于 capture，再于 visual_gap。
  // device_test_run 的"用例失败"不带 device_toolchain 标 → 落到 code_regression（须改码、可重试），不误导成"先查环境"。
  if (ids.some(isToolchainBlockerId) || hasToolchainBlockingClass(currentSummary)) return 'toolchain';
  if (ids.some(isCaptureBlockerId)) return 'capture';
  if (ids.some(isVisualGapBlockerId)) return 'visual_gap';
  // P0-4(d)（plan 7c4f2e9b，cursor 二轮 must-fix#6）：spec 捕获完整性缺口独立命名——
  // 不落 code_regression（事故 i3/i4 即被误标）、不复用 capture 桶（其语义=修采集导航）、
  // 不入 SIGNATURE_HALT_KINDS（主出口=actionability 聚合层即时求人，不靠粗熔断兜底）。
  if (ids.some(isSpecCaptureGapBlockerId)) return 'spec_capture_gap';
  return 'code_regression';
}

/** spec 期捕获完整性缺口族（capture_completeness / capture_completeness_external 等；
 * ocr_unavailable 已被 toolchain 表先行吸收） */
export function isSpecCaptureGapBlockerId(id: string): boolean {
  return id.startsWith('capture_completeness');
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

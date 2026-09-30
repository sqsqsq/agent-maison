// ============================================================================
// reliability-metrics.ts — 可靠性指标采集器（plan 1dbe4fa4 t1 / §3；上位总纲 272acb5f §4）
// ----------------------------------------------------------------------------
// 只读：读 goal-runs 下的 events.jsonl / manifest.json（与可选的完整工程目录），输出每个任务的三类事实
// （框架是否宣称完成 / 记录与当前义务 / 独立验收）、原始停止状态、操作者动作候选与确认、恢复成本，
// 以及总纲 §4 的六项指标。不写任何文件；只 import 既有纯函数，不复制它们的公式。
//
// 放在 harness/tests/utils（测试目录，不进发布件）。入口是仓根 scripts/reliability-metrics.mjs，
// 它经 harness 的 ts-node 起本文件（`require.main === module` 分支），参数经环境变量
// RELIABILITY_METRICS_OPTIONS 以 JSON 传入。场景套件（t2）直接 import `collectReliability`。
//
// 口径（逐条对应 plan §3.5「已知的坑」）：
//  · 有效终态以 resolveEffectiveRunEnd 为准（一个 run 可有多个 run_end）；
//  · run_end 缺 halt_reason → 回退到同一会话段最后一条 phase_halt；
//  · phase_verdict.action 不等于实际转移，实际转移读其后的回退/停机/推进事件；
//  · 本 run 回退数 = phase_backtrack_requested 事件数，累计字段 backtracks_used 只原样输出；
//  · 正式执行 = 以 run_start 开头的 authoritative 会话段；没有 run_start 的 run 正式活跃时长为 0
//    （孤儿段时长照样列出，只是不算正式执行）；
//  · heartbeat 的 turns_used / elapsed_ms 是血缘折叠值，只原样输出；
//  · 调用数只数 agent_invoke_start（countAgentInvokeStarts），不看 phase_start.attempt；
//  · 归因字段（reducer recovery、failure_kind_classified、INCIDENT_REGISTRY 类别）原样输出，不当根因。
// 事件下标 event_index = loadEventsJsonl 结果里的 0 基位置（与 events.jsonl 非空行序一致）。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { featureFilePath } from '../../config';
import { INCIDENT_REGISTRY } from '../../scripts/utils/adjudication';
import { resolveChangeUnitExpectedExecution } from '../../scripts/utils/change-unit-completion';
import { assessFeature } from '../../scripts/utils/feature-assessment';
import { readFeatureFrozenScope } from '../../scripts/utils/feature-execution-scope';
import { classifyGoalRunsDir } from '../../scripts/utils/fidelity-shared';
import {
  countAgentInvokeStarts,
  extractSupersedeTargets,
  filterAuthoritativeEvents,
  foldBudgetLineage,
  loadEventsJsonl,
  partitionExecutionSessions,
  resolveEffectiveRunEnd,
  type GoalRunEvent,
} from '../../scripts/utils/goal-runner-phase';
import { reduceRunState, type RecoveryDiagnostic } from '../../scripts/utils/run-state-reducer';
import { FEATURE_COMPLETION_FILENAME } from '../../scripts/utils/verify-feature-completion';

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

type Ev = GoalRunEvent & Record<string, unknown>;

export type AcceptanceResult = 'pass' | 'fail' | 'not_accepted';
export type Conclusion = 'correct_completion' | 'wrong_completion' | 'unaccepted_completion' | 'incomplete';
export type StopReading =
  | 'terminal' | 'waiting_human' | 'waiting_external_wakeable' | 'waiting_external_no_wake'
  | 'recoverable' | 'process_gone' | 'unclassified';
export type RunSource = 'lineage' | 'observation' | 'explicit';
export type CandidateSignal =
  | 'resume_without_supervisor' | 'supersede_successor' | 'manifest_identity_rebase'
  | 'fresh_run_override' | 'model_pin_change' | 'scope_revision';
export type InterventionKind = 'rescue_command' | 'manual_file_edit' | 'config_change' | 'reauthorization' | 'product_decision';

/** 观察记录里关联事件的写法：run + 事件下标或时间；feature 冻结记录的修订用 artifact + revision_index。 */
export interface RelatedEventRef {
  run_id?: string;
  event_index?: number;
  ts?: string;
  artifact?: string;
  revision_index?: number;
}

export interface Intervention {
  kind: InterventionKind;
  at?: string;
  content?: string;
  actor?: string;
  necessary?: boolean;
  related_events?: RelatedEventRef[];
}

/** 不受扰动影响的阶段 + 扰动点（run 与事件下标，或时间）。 */
export interface UnaffectedSpec {
  phases: string[];
  after: { run_id: string; event_index: number } | { ts: string };
}

export interface AcceptanceFact {
  result: AcceptanceResult;
  actor?: string;
  basis?: string;
}

/** plan §5.1 观察记录的 tasks[] 条目（recoverable_fault / unaffected 为采集所需的可选补充）。 */
export interface ObservationTask {
  label?: string;
  scenarios?: string[];
  feature?: string;
  runs?: string[];
  interventions?: Intervention[];
  independent_acceptance?: AcceptanceFact;
  source?: string;
  recoverable_fault?: boolean;
  unaffected?: UnaffectedSpec;
}

export interface ObservationFile {
  label?: string;
  tasks?: ObservationTask[];
  [key: string]: unknown;
}

export interface SessionFacts {
  start_index: number;
  end_index: number;
  start_ts: string | null;
  active_ms: number;
  has_run_end: boolean;
  mode: 'dry' | 'authoritative';
  /** 段首是 run_start = 正式执行段；否则是孤儿前缀（例如启动即失败、只有 run_created 的 run）。 */
  formal: boolean;
  run_end: RunEndFacts | null;
}

export interface RunEndFacts {
  event_index: number;
  ts: string | null;
  status: string | null;
  halt_reason: string | null;
  halt_reason_source: 'run_end' | 'phase_halt' | null;
}

export interface StopState {
  status: string | null;
  halt_reason: string | null;
  run_disposition: string;
  run_wait_kind: string | null;
  has_probe: boolean;
  /** 最后一个会话段有无 run_end。 */
  has_run_end: boolean;
  /** plan §3.1 读法表；已宣称完成（CHAIN_SLICE_COMPLETED）时为 null。 */
  reading: StopReading | null;
  /** INCIDENT_REGISTRY 已有类别，原样附上（归入六类是 P3 的工作）。 */
  incident_class: string | null;
}

export interface EventRef {
  run_id: string;
  event_index: number;
  ts: string | null;
}

/**
 * 一条故障：同一阶段在被该阶段 PASS 之前的连续失败（FAIL 裁决与 phase_halt）算同一条；PASS 之后再失败是新故障。
 * 终点 = 该阶段的 PASS 裁决，或成功封卷的 run_end（任务完成）；其它阶段的 PASS 不作终点。
 */
export interface FaultCost extends EventRef {
  phase: string | null;
  type: string;
  verdict: string | null;
  /** 并入本故障的事件里最后一个非空 halt_reason（原样）。 */
  halt_reason: string | null;
  status: 'recovered' | 'unrecovered';
  endpoint: (EventRef & { kind: 'phase_pass' | 'task_complete' }) | null;
  /** 未恢复时计到任务最后一个事件（task_end），不是恢复成本。 */
  measured_to: 'endpoint' | 'task_end';
  wall_ms: number | null;
  active_ms: number | null;
  agent_invocations: number;
}

export interface RecoveryCost {
  /** 无故障 = no_failure；全部故障已恢复且任务宣称完成 = recovered；否则 unrecovered。 */
  status: 'no_failure' | 'recovered' | 'unrecovered';
  /** 任务级窗口：首个故障 → 最后一个终点（recovered）或任务末（unrecovered，标 task_end）。 */
  measured_to: 'endpoint' | 'task_end' | null;
  wall_ms: number | null;
  active_ms: number | null;
  agent_invocations: number | null;
  faults: FaultCost[];
}

export interface VerdictTransition {
  event_index: number;
  phase: string | null;
  verdict: string | null;
  declared_action: string | null;
  actual: 'backtrack' | 'halt' | 'end' | 'advance' | 'retry' | 'none';
}

export interface RunFacts {
  run_id: string;
  source: RunSource;
  corrupt: string | null;
  manifest: { successor_of: string | null; adapter: string | null; adapter_model_pin: unknown; created_at: string | null } | null;
  events_total: number;
  heartbeat_count: number;
  has_run_created: boolean;
  run_start_count: number;
  sessions: SessionFacts[];
  formal_active_ms: number;
  agent_invocations: { total: number; by_phase: Record<string, number> };
  backtracks: { requested_events: number; cumulative_field_last: number | null };
  heartbeat_last: { turns_used: unknown; elapsed_ms: unknown; note: string } | null;
  run_end_count: number;
  effective_run_end: RunEndFacts | null;
  stop_state: StopState;
  verdict_transitions: VerdictTransition[];
  attribution_raw: { recovery: RecoveryDiagnostic | null; last_failure_kind_classified: string | null };
  recovery_cost: RecoveryCost;
}

export type RecordFacts =
  | { evaluable: false; reason: string }
  | {
      evaluable: true;
      state: 'absent' | 'ok' | 'broken';
      run_id: string | null;
      generated_at: string | null;
      /** 该完成记录是否由本任务的 run 签发。 */
      issued_in_task: boolean;
      reasons: string[];
      obligations_total: number;
      uncovered: Array<{ id: string; owner_phase: string; class?: string; reason?: string }>;
      blocking: string[];
      complete: boolean;
    };

export interface Candidate {
  signal: CandidateSignal;
  ref: { run_id: string | null; event_index: number | null; ts: string | null; artifact?: string; revision_index?: number };
  detail: Record<string, unknown>;
  status: 'confirmed' | 'unconfirmed';
  /** 关联到本候选的观察记录动作下标（interventions[]）。 */
  confirmed_by: number[];
}

export interface OperatorFacts {
  /** 观察记录显式给出 interventions 数组（空数组 = 明确零次）才算已知；缺该字段或无观察记录一律未知（候选不当作动作）。 */
  known: boolean;
  candidates: Candidate[];
  interventions: Intervention[];
  /** 已确认的操作者动作（不含产品决策），一条动作计一次。未知 = null。 */
  rescue_count: number | null;
  unnecessary_count: number | null;
  necessity_unknown: number | null;
  product_decisions: number | null;
}

export interface TaskReport {
  task_id: string;
  source: 'collector' | 'scenario_results';
  scenarios: string[];
  recoverable_fault: boolean | null;
  runs: RunFacts[];
  missing_runs: string[];
  /** manifest.successor_of：只作候选线索，不当作生产授权。 */
  successor_clues: Array<{ run_id: string; successor_of: string; in_task: boolean }>;
  facts: {
    claimed_complete: boolean;
    claimed_basis: 'run_end' | 'completion_record' | null;
    record: RecordFacts;
    acceptance: AcceptanceFact;
  };
  conclusion: Conclusion;
  stop_state: StopState | null;
  operator: OperatorFacts;
  recovery_cost: RecoveryCost;
  unaffected_reruns: { exact: number | null; proxy: number | null; note: string };
  /** 场景套件写出的元信息（分支键等），采集器只读 branch 用于重复运行分组。 */
  scenario_meta?: { branch?: string } & Record<string, unknown>;
}

export interface ReliabilityMetrics {
  correct_autonomous_completion: { numerator: number; denominator: number; unknown: number };
  auto_recovery: { numerator: number; denominator: number; unknown: number };
  rescues: { confirmed: number; product_decisions: number; tasks_unknown: number };
  observed_wrong_completions: number;
  recovery_cost: Array<{ task_id: string } & RecoveryCost>;
  repeat_stability: Record<string, Record<string, number> | '未测'>;
}

/**
 * 场景套件的函数级预判（例如 S10 出生链预判）：没有执行扰动后的任务，不是任务、不进任何指标，
 * 只原样列出，Markdown 单列为“函数级预判，未执行任务”。
 */
export interface FunctionLevelPrediction {
  id: string;
  branch: string;
  label?: string;
  predicted_chain: string[];
  executed_phases: string[];
  /** 预判出生链中已执行阶段的个数（预判，不是实际重跑次数）。 */
  predicted_reruns: number;
  note: string;
  [key: string]: unknown;
}

export interface ReliabilityReport {
  schema: 'reliability-metrics/1';
  input: Record<string, unknown>;
  cycle_boundary: string | null;
  corrupt_runs: Array<{ runId: string; reason: string }>;
  tasks: TaskReport[];
  metrics: ReliabilityMetrics;
  function_level_predictions: FunctionLevelPrediction[];
}

export interface CollectOptions {
  /** 完整工程根；给出时评估记录与当前义务。 */
  projectRoot?: string;
  feature?: string;
  /** 评估宿主完成记录时传宿主安装的框架根，否则门禁指纹对不上。 */
  frameworkRoot?: string;
  /** 只含若干 run 目录的目录（夹具）；缺省 = 工程的 feature goal-runs。 */
  runsDir?: string;
  /** 显式 run 列表：合成一个任务；缺省按交付周期内的 supersede 血缘分组。 */
  runIds?: string[];
  observations?: ObservationFile[];
  /** 场景套件（t2）产出：`{ tasks: TaskReport[] }`；结论按事实重新推导。 */
  scenarioResults?: Array<{ tasks?: TaskReport[]; predictions?: FunctionLevelPrediction[] }>;
}

// ---------------------------------------------------------------------------
// 单个 run
// ---------------------------------------------------------------------------

interface LoadedRun {
  id: string;
  dir: string;
  source: RunSource;
  raw: Ev[];
  auth: Ev[];
  index: Map<Ev, number>;
  manifest: Record<string, unknown> | null;
  corrupt: string | null;
}

/**
 * 成功封卷的 run_end.status——与 verify-feature-completion.ts 的 `RUN_END_LINEAGE_OK` / `NON_TERMINAL_OK`
 * （约 :776–778，未导出；§1 冻结生产代码不能加 export）同一集合：CHAIN_SLICE_COMPLETED 与 legacy COMPLETED。
 */
const SEALED_COMPLETE_STATUSES: ReadonlySet<string> = new Set(['CHAIN_SLICE_COMPLETED', 'COMPLETED']);
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const ms = (ts: unknown): number | null => {
  const t = typeof ts === 'string' ? Date.parse(ts) : NaN;
  return Number.isFinite(t) ? t : null;
};

function loadRun(runsDir: string, id: string, source: RunSource, corrupt: string | null = null): LoadedRun {
  const dir = path.join(runsDir, id);
  const raw = loadEventsJsonl(path.join(dir, 'events.jsonl')) as Ev[];
  let manifest: Record<string, unknown> | null = null;
  try { manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as Record<string, unknown>; } catch { manifest = null; }
  return {
    id, dir, source, raw, auth: filterAuthoritativeEvents(raw) as Ev[],
    index: new Map(raw.map((e, i) => [e, i])), manifest, corrupt,
  };
}

function runEndFacts(run: LoadedRun, end: Ev, segment: Ev[]): RunEndFacts {
  const own = str(end.halt_reason);
  const endAt = segment.indexOf(end);
  const halt = own ? undefined : segment.slice(0, endAt).reverse().find((e) => e.type === 'phase_halt');
  const fallback = halt ? str(halt.halt_reason) : null;
  return {
    event_index: run.index.get(end) ?? -1,
    ts: str(end.ts),
    status: str(end.status),
    halt_reason: own ?? fallback,
    halt_reason_source: own ? 'run_end' : fallback ? 'phase_halt' : null,
  };
}

/** 事件 → 所在会话段（partitionExecutionSessions 的段，按下标区间）。 */
function segmentOf(run: LoadedRun, sessions: ReturnType<typeof partitionExecutionSessions>['sessions'], e: Ev): Ev[] {
  const i = run.index.get(e) ?? -1;
  const s = sessions.find((x) => x.startIndex <= i && i <= x.endIndex);
  return s ? run.raw.slice(s.startIndex, s.endIndex + 1) : [e];
}

function isSealedComplete(status: string | null): boolean {
  return status !== null && SEALED_COMPLETE_STATUSES.has(status);
}

function readingOf(state: { run_disposition: string; run_wait_kind?: string }, hasProbe: boolean): StopReading {
  if (state.run_disposition === 'TERMINAL') return 'terminal';
  if (state.run_disposition === 'RECOVERY_PENDING' || state.run_disposition === 'RESUME_READY') return 'recoverable';
  if (state.run_disposition === 'WAITING' && state.run_wait_kind === 'human') return 'waiting_human';
  if (state.run_disposition === 'WAITING' && state.run_wait_kind === 'external') {
    return hasProbe ? 'waiting_external_wakeable' : 'waiting_external_no_wake';
  }
  return 'unclassified';
}

const TRANSITION_EVENTS = new Set(['phase_backtrack_requested', 'phase_halt', 'run_end', 'phase_start', 'agent_invoke_start', 'agent_invoke']);

function verdictTransitions(run: LoadedRun): VerdictTransition[] {
  const out: VerdictTransition[] = [];
  run.auth.forEach((v, k) => {
    if (v.type !== 'phase_verdict') return;
    const next = run.auth.slice(k + 1).find((e) => TRANSITION_EVENTS.has(String(e.type)));
    let actual: VerdictTransition['actual'] = 'none';
    if (next?.type === 'phase_backtrack_requested') actual = 'backtrack';
    else if (next?.type === 'phase_halt') actual = 'halt';
    else if (next?.type === 'run_end') actual = 'end';
    else if (next) actual = next.phase && next.phase !== v.phase ? 'advance' : 'retry';
    out.push({
      event_index: run.index.get(v) ?? -1, phase: str(v.phase), verdict: str(v.verdict),
      declared_action: str(v.action), actual,
    });
  });
  return out;
}

function runFacts(run: LoadedRun): RunFacts {
  const p = partitionExecutionSessions(run.raw);
  const sessions: SessionFacts[] = p.sessions.map((s) => {
    const seg = run.raw.slice(s.startIndex, s.endIndex + 1);
    const end = seg.find((e) => e.type === 'run_end');
    return {
      start_index: s.startIndex, end_index: s.endIndex, start_ts: str(run.raw[s.startIndex]?.ts),
      active_ms: s.activeMs, has_run_end: s.clean, mode: s.mode,
      formal: run.raw[s.startIndex]?.type === 'run_start',
      run_end: end ? runEndFacts(run, end, seg) : null,
    };
  });
  const formal = p.sessions.filter((s, i) => s.mode === 'authoritative' && sessions[i].formal);
  const formalEvents = formal.flatMap((s) => run.raw.slice(s.startIndex, s.endIndex + 1));
  const byPhase: Record<string, number> = {};
  for (const phase of new Set(formalEvents.map((e) => e.phase).filter((x): x is string => !!x))) {
    const n = countAgentInvokeStarts(formalEvents.filter((e) => e.phase === phase));
    if (n > 0) byPhase[phase] = n;
  }
  // 有效终态、最后会话、探针统一取 authoritative 视图（dry 会话只作明细，不参与完成状态）；
  // disposition 与恢复时间线本就取 run.auth，两边同源。
  const effective = resolveEffectiveRunEnd(run.auth) as Ev | undefined;
  const effectiveFacts = effective ? runEndFacts(run, effective, segmentOf(run, p.sessions, effective)) : null;
  const authSessions = p.sessions.filter((s) => s.mode === 'authoritative');
  const last = authSessions[authSessions.length - 1];
  const lastSeg = last ? run.raw.slice(last.startIndex, last.endIndex + 1) : [];
  const lastHalt = [...lastSeg].reverse().find((e) => e.type === 'phase_halt');
  const hasProbe = typeof lastHalt?.probe === 'string' && lastHalt.probe.trim() !== '';
  const state = reduceRunState(run.auth);
  const hasRunEnd = last ? last.clean : false;
  const status = effectiveFacts?.status ?? null;
  const haltReason = effectiveFacts?.halt_reason ?? null;
  const heartbeat = [...run.raw].reverse().find((e) => e.type === 'heartbeat');
  const cumulative = [...run.auth].reverse().find((e) => typeof e.backtracks_used === 'number');
  const lastFailureKind = [...run.auth].reverse().find((e) => e.type === 'phase_verdict' && typeof e.failure_kind_classified === 'string');
  const m = run.manifest;
  return {
    run_id: run.id,
    source: run.source,
    corrupt: run.corrupt,
    manifest: m ? {
      successor_of: str(m.successor_of), adapter: str(m.adapter),
      adapter_model_pin: m.adapter_model_pin ?? null, created_at: str(m.created_at),
    } : null,
    events_total: run.raw.length,
    heartbeat_count: run.raw.filter((e) => e.type === 'heartbeat').length,
    has_run_created: run.raw.some((e) => e.type === 'run_created'),
    run_start_count: run.raw.filter((e) => e.type === 'run_start').length,
    sessions,
    formal_active_ms: formal.reduce((acc, s) => acc + s.activeMs, 0),
    agent_invocations: { total: countAgentInvokeStarts(formalEvents), by_phase: byPhase },
    backtracks: {
      requested_events: run.auth.filter((e) => e.type === 'phase_backtrack_requested').length,
      cumulative_field_last: cumulative ? (cumulative.backtracks_used as number) : null,
    },
    heartbeat_last: heartbeat ? {
      turns_used: heartbeat.turns_used ?? null, elapsed_ms: heartbeat.elapsed_ms ?? null,
      note: '血缘折叠累计值，不是本 run 的值',
    } : null,
    run_end_count: run.raw.filter((e) => e.type === 'run_end').length,
    effective_run_end: effectiveFacts,
    stop_state: {
      status, halt_reason: haltReason,
      run_disposition: state.run_disposition, run_wait_kind: state.run_wait_kind ?? null,
      has_probe: hasProbe, has_run_end: hasRunEnd,
      reading: !last ? 'unclassified' : !hasRunEnd ? 'process_gone' : isSealedComplete(status) ? null : readingOf(state, hasProbe),
      incident_class: haltReason ? INCIDENT_REGISTRY[haltReason]?.class ?? null : null,
    },
    verdict_transitions: verdictTransitions(run),
    attribution_raw: {
      recovery: state.recovery ?? null,
      last_failure_kind_classified: lastFailureKind ? str(lastFailureKind.failure_kind_classified) : null,
    },
    recovery_cost: recoveryCost([run], isSealedComplete(status)),
  };
}

// ---------------------------------------------------------------------------
// 任务级：时间线、恢复成本、无影响阶段重跑、候选
// ---------------------------------------------------------------------------

interface TimelineEntry { run: LoadedRun; e: Ev; i: number }

const timeline = (runs: LoadedRun[]): TimelineEntry[] =>
  runs.flatMap((run) => run.auth.map((e) => ({ run, e, i: run.index.get(e) ?? -1 })));

const refOf = (x: TimelineEntry): EventRef => ({ run_id: x.run.id, event_index: x.i, ts: str(x.e.ts) });

/**
 * 正式执行段与 [t0, t1] 的重叠时长之和。段的活动时间取 partitionExecutionSessions 给出的真实区间（intervals）：
 * 段内第一个 run_end 之后的启动提前退出在时间上不与前段连续，不能把 [startMs, startMs + activeMs] 当连续区间。
 */
function activeWithin(runs: LoadedRun[], t0: number, t1: number): number {
  let total = 0;
  for (const run of runs) {
    for (const s of partitionExecutionSessions(run.raw).sessions) {
      if (s.mode !== 'authoritative' || run.raw[s.startIndex]?.type !== 'run_start') continue;
      for (const iv of s.intervals) total += Math.max(0, Math.min(iv.endMs, t1) - Math.max(iv.startMs, t0));
    }
  }
  return total;
}

/** 时间线下标 [from, to] 的墙钟、正式段活跃时长、(from, to] 内的 agent 调用数。 */
function measure(runs: LoadedRun[], tl: TimelineEntry[], from: number, to: number): { wall_ms: number | null; active_ms: number | null; agent_invocations: number } {
  const t0 = ms(tl[from].e.ts);
  const t1 = ms(tl[to].e.ts);
  return {
    wall_ms: t0 !== null && t1 !== null ? t1 - t0 : null,
    active_ms: t0 !== null && t1 !== null ? activeWithin(runs, t0, t1) : null,
    agent_invocations: countAgentInvokeStarts(tl.slice(from + 1, to + 1).map((x) => x.e)),
  };
}

/**
 * 恢复成本，按故障逐条：失败事件 = FAIL 裁决或 phase_halt。同一阶段在被该阶段 PASS 之前的失败并入同一条
 * （含紧随 FAIL 的停机），PASS 之后再失败是新故障。终点 = 该阶段的 PASS 裁决，或成功封卷的 run_end；
 * 其它阶段的 PASS 不作终点。任务级：全部故障已恢复且任务宣称完成才是 recovered，否则 unrecovered 并计到任务末。
 */
function recoveryCost(runs: LoadedRun[], claimedComplete: boolean): RecoveryCost {
  const tl = timeline(runs);
  const open = new Map<string, number>();
  const drafts: Array<{ start: number; end: number; kind: 'phase_pass' | 'task_complete'; halt: string | null }> = [];
  tl.forEach((x, k) => {
    const key = str(x.e.phase) ?? '';
    if ((x.e.type === 'phase_verdict' && x.e.verdict === 'FAIL') || x.e.type === 'phase_halt') {
      const n = open.get(key);
      if (n === undefined) {
        open.set(key, drafts.length);
        drafts.push({ start: k, end: -1, kind: 'phase_pass', halt: str(x.e.halt_reason) });
      } else if (str(x.e.halt_reason)) {
        drafts[n].halt = str(x.e.halt_reason);
      }
    } else if (x.e.type === 'phase_verdict' && x.e.verdict === 'PASS' && open.has(key)) {
      drafts[open.get(key)!].end = k;
      open.delete(key);
    } else if (x.e.type === 'run_end' && isSealedComplete(str(x.e.status))) {
      for (const n of open.values()) Object.assign(drafts[n], { end: k, kind: 'task_complete' });
      open.clear();
    }
  });
  const faults: FaultCost[] = drafts.map((d) => {
    const first = tl[d.start];
    return {
      ...refOf(first), phase: str(first.e.phase), type: String(first.e.type), verdict: str(first.e.verdict), halt_reason: d.halt,
      status: d.end >= 0 ? 'recovered' : 'unrecovered',
      endpoint: d.end >= 0 ? { ...refOf(tl[d.end]), kind: d.kind } : null,
      measured_to: d.end >= 0 ? 'endpoint' : 'task_end',
      ...measure(runs, tl, d.start, d.end >= 0 ? d.end : tl.length - 1),
    };
  });
  if (!drafts.length) return { status: 'no_failure', measured_to: null, wall_ms: null, active_ms: null, agent_invocations: null, faults };
  const recovered = claimedComplete && drafts.every((d) => d.end >= 0);
  return {
    status: recovered ? 'recovered' : 'unrecovered',
    measured_to: recovered ? 'endpoint' : 'task_end',
    ...measure(runs, tl, drafts[0].start, recovered ? Math.max(...drafts.map((d) => d.end)) : tl.length - 1),
    faults,
  };
}

function unaffectedReruns(runs: LoadedRun[], spec: UnaffectedSpec | undefined, cost: RecoveryCost): TaskReport['unaffected_reruns'] {
  const tl = timeline(runs);
  if (spec) {
    const after = spec.after;
    const pos = 'run_id' in after
      ? tl.findIndex((x) => x.run.id === after.run_id && x.i === after.event_index)
      : tl.reduce((acc, x, k) => ((ms(x.e.ts) ?? Infinity) <= (ms(after.ts) ?? -Infinity) ? k : acc), -1);
    if (pos < 0 && 'run_id' in after) {
      return { exact: null, proxy: null, note: `扰动点 ${after.run_id}#${after.event_index} 不在任务事件中` };
    }
    const phases = new Set(spec.phases);
    return {
      exact: countAgentInvokeStarts(tl.slice(pos + 1).filter((x) => phases.has(String(x.e.phase))).map((x) => x.e)),
      proxy: null,
      note: `精确值：扰动点之后 ${spec.phases.join('/')} 的 agent_invoke_start`,
    };
  }
  const firstFault = cost.faults[0];
  if (!firstFault) return { exact: null, proxy: null, note: '代理指标：无故障事件，不适用' };
  const f = tl.findIndex((x) => x.run.id === firstFault.run_id && x.i === firstFault.event_index);
  const passedBefore = new Set(tl.slice(0, f).filter((x) => x.e.type === 'phase_verdict' && x.e.verdict === 'PASS').map((x) => String(x.e.phase)));
  passedBefore.delete(String(firstFault.phase));
  return {
    exact: null,
    proxy: countAgentInvokeStarts(tl.slice(f + 1).filter((x) => passedBefore.has(String(x.e.phase))).map((x) => x.e)),
    note: '代理指标（上界）：首个故障后、故障前已 PASS 的其他阶段又被调用 agent 的次数，含合法回退重跑；'
      + '事件中没有构建指纹与证据复用字段，精确值需给出不受影响的阶段与扰动点',
  };
}

function candidateSignals(runs: LoadedRun[], featureRevisions: Array<{ revision_index: number; applied_at: string }>): Candidate[] {
  const out: Candidate[] = [];
  const add = (signal: CandidateSignal, ref: Candidate['ref'], detail: Record<string, unknown> = {}): void => {
    out.push({ signal, ref, detail, status: 'unconfirmed', confirmed_by: [] });
  };
  runs.forEach((run, k) => {
    for (const e of run.auth) {
      const i = run.index.get(e) ?? -1;
      const ref = { run_id: run.id, event_index: i, ts: str(e.ts) };
      if (e.type === 'resume') {
        // 本段 run_start 之前的上一段（含其尾部）里没有 supervisor_restart → 候选（宿主桥自行恢复或人工命令，无法区分）。
        const starts = run.raw.slice(0, i).map((x, j) => (x.type === 'run_start' ? j : -1)).filter((j) => j >= 0);
        const prevStart = starts.length >= 2 ? starts[starts.length - 2] : 0;
        const window = run.raw.slice(prevStart, i);
        if (window.some((x) => x.type === 'supervisor_restart')) continue;
        const prevEnd = [...window].reverse().find((x) => x.type === 'run_end');
        add('resume_without_supervisor', ref, { prior: prevEnd ? str(prevEnd.status) : 'no_run_end' });
      } else if (e.type === 'manifest_identity_rebase' || e.type === 'fresh_run_override') {
        add(e.type, ref, e.type === 'manifest_identity_rebase' ? { changed_fields: e.changed_fields ?? null } : {});
      } else if (e.type === 'scope_revised') {
        add('scope_revision', ref, { revision_index: e.revision_index ?? null });
      }
    }
    const targets = extractSupersedeTargets(run.auth);
    if (targets.length > 0) {
      const first = run.auth.find((e) => e.type === 'supersede')!;
      add('supersede_successor', { run_id: run.id, event_index: run.index.get(first) ?? -1, ts: str(first.ts) }, { targets });
    }
    if (k > 0) {
      const prev = JSON.stringify(runs[k - 1].manifest?.adapter_model_pin ?? null);
      const cur = JSON.stringify(run.manifest?.adapter_model_pin ?? null);
      if (prev !== cur) {
        add('model_pin_change', { run_id: run.id, event_index: 0, ts: str(run.raw[0]?.ts) }, { from: JSON.parse(prev), to: JSON.parse(cur) });
      }
    }
  });
  const tsList = runs.flatMap((r) => r.raw.map((e) => ms(e.ts)).filter((t): t is number => t !== null));
  const lo = Math.min(...tsList);
  const hi = Math.max(...tsList);
  for (const rev of featureRevisions) {
    const t = ms(rev.applied_at);
    if (t !== null && t >= lo && t <= hi) {
      add('scope_revision', { run_id: null, event_index: null, ts: rev.applied_at, artifact: 'execution-scope.json', revision_index: rev.revision_index });
    }
  }
  return out;
}

function matches(rel: RelatedEventRef, c: Candidate): boolean {
  if (rel.artifact !== undefined) return rel.artifact === c.ref.artifact && rel.revision_index === c.ref.revision_index;
  if (rel.run_id !== c.ref.run_id) return false;
  return (rel.event_index !== undefined && rel.event_index === c.ref.event_index) || (rel.ts !== undefined && rel.ts === c.ref.ts);
}

function operatorFacts(candidates: Candidate[], observation: ObservationTask | undefined): OperatorFacts {
  const interventions = observation?.interventions ?? [];
  interventions.forEach((iv, n) => {
    for (const c of candidates) {
      if ((iv.related_events ?? []).some((rel) => matches(rel, c))) {
        c.confirmed_by.push(n);
        c.status = 'confirmed';
      }
    }
  });
  // 只有显式给出 interventions 数组（含空数组 = 明确零次）才算动作已知；缺该字段 = 没有提供动作信息。
  if (!Array.isArray(observation?.interventions)) {
    return { known: false, candidates, interventions, rescue_count: null, unnecessary_count: null, necessity_unknown: null, product_decisions: null };
  }
  const rescue = interventions.filter((iv) => iv.kind !== 'product_decision');
  return {
    known: true, candidates, interventions,
    rescue_count: rescue.length,
    unnecessary_count: rescue.filter((iv) => iv.necessary === false).length,
    necessity_unknown: rescue.filter((iv) => typeof iv.necessary !== 'boolean').length,
    product_decisions: interventions.length - rescue.length,
  };
}

export function deriveConclusion(facts: TaskReport['facts']): Conclusion {
  if (!facts.claimed_complete) return 'incomplete';
  if (facts.acceptance.result === 'pass') return 'correct_completion';
  if (facts.acceptance.result === 'fail') return 'wrong_completion';
  return 'unaccepted_completion';
}

// ---------------------------------------------------------------------------
// 记录与当前义务（需完整工程目录）
// ---------------------------------------------------------------------------

type FeatureRecord = Exclude<RecordFacts, { evaluable: false }>;

function assessRecord(projectRoot: string, feature: string, frameworkRoot?: string): Omit<FeatureRecord, 'issued_in_task'> | { evaluable: false; reason: string } {
  try {
    const a = assessFeature(projectRoot, feature, {
      ...resolveChangeUnitExpectedExecution(projectRoot, feature),
      ...(frameworkRoot ? { frameworkRoot } : {}),
    });
    return {
      evaluable: true,
      state: a.record.state,
      run_id: a.record.state === 'absent' ? null : a.record.run_id,
      generated_at: a.record.state === 'absent' ? null : a.record.generated_at,
      reasons: a.record.state === 'absent' ? [] : a.record.reasons,
      obligations_total: a.obligations.length,
      uncovered: a.obligations.filter((o) => o.status === 'uncovered')
        .map((o) => ({ id: o.id, owner_phase: o.owner_phase, class: o.class, reason: o.reason })),
      blocking: a.blocking,
      complete: a.complete,
    };
  } catch (error) {
    return { evaluable: false, reason: `assessFeature 抛错，无法评估：${(error as Error).message}` };
  }
}

// ---------------------------------------------------------------------------
// 分组与汇总
// ---------------------------------------------------------------------------

/** 以生产预算折叠入口 foldBudgetLineage 求 head 的审计 supersede 血缘（交付周期边界之前的不计）。 */
function lineageOf(runsDir: string, head: LoadedRun, boundary: string | null): { ids: string[]; missing: string[] } {
  const loaded = new Map<string, Ev[]>();
  const fold = foldBudgetLineage({
    projectRoot: runsDir, featuresDir: '.', feature: 'x', currentEvents: head.auth,
    ...(boundary ? { cycleBoundary: boundary } : {}),
    loadEvents: (abs) => {
      const id = path.basename(path.dirname(abs));
      const evs = filterAuthoritativeEvents(loadEventsJsonl(path.join(runsDir, id, 'events.jsonl'))) as Ev[];
      loaded.set(id, evs);
      return evs;
    },
  });
  const kept = new Set(fold.ancestorEvents);
  return {
    ids: [...loaded].filter(([, evs]) => evs.length > 0 && kept.has(evs[0])).map(([id]) => id),
    missing: [...loaded].filter(([, evs]) => evs.length === 0).map(([id]) => id),
  };
}

interface TaskDraft { runs: Map<string, RunSource>; missing: Set<string>; observation?: ObservationTask }

/** run 的起始时刻：首个事件（run_created）的 ts，缺则取 manifest.created_at（均为毫秒精度）；都没有排最后。run id 的随机后缀不参与。 */
function createdMs(run: LoadedRun): number {
  return ms(run.raw[0]?.ts) ?? ms(run.manifest?.created_at) ?? Number.POSITIVE_INFINITY;
}

/** 任务内顺序：supersede 审计事件的目标先于后继（既有血缘），其余按创建时刻；同时刻再按 id 稳定。 */
function orderRuns(runs: LoadedRun[]): LoadedRun[] {
  const byTime = [...runs].sort((a, b) => (createdMs(a) - createdMs(b)) || a.id.localeCompare(b.id));
  const ids = new Set(runs.map((r) => r.id));
  const preds = new Map(runs.map((r) => [r.id, extractSupersedeTargets(r.auth).filter((t) => ids.has(t) && t !== r.id)]));
  const out: LoadedRun[] = [];
  const placed = new Set<string>();
  while (out.length < byTime.length) {
    const ready = byTime.find((r) => !placed.has(r.id) && preds.get(r.id)!.every((p) => placed.has(p)))
      ?? byTime.find((r) => !placed.has(r.id))!; // 血缘成环（不应出现）时按时间兜底
    out.push(ready);
    placed.add(ready.id);
  }
  return out;
}

function buildTask(
  draft: TaskDraft, runsDir: string, corrupt: Map<string, string>,
  record: ReturnType<typeof assessRecord> | null, revisions: Array<{ revision_index: number; applied_at: string }>,
): TaskReport {
  const runs = orderRuns([...draft.runs].map(([id, source]) => loadRun(runsDir, id, source, corrupt.get(id) ?? null)));
  const facts = runs.map(runFacts);
  const last = facts[facts.length - 1];
  const ids = new Set(runs.map((r) => r.id));
  const byRunEnd = !!last && isSealedComplete(last.effective_run_end?.status ?? null);
  const byRecord = runs.some((r) => fs.existsSync(path.join(r.dir, FEATURE_COMPLETION_FILENAME)));
  const claimed = byRunEnd || byRecord;
  const recordFact: RecordFacts = !record
    ? { evaluable: false, reason: '输入只有 events/manifest，缺完整工程目录，无法评估记录与当前义务' }
    : record.evaluable ? { ...record, issued_in_task: !!record.run_id && ids.has(record.run_id) } : record;
  const obs = draft.observation;
  const taskFacts: TaskReport['facts'] = {
    claimed_complete: claimed,
    claimed_basis: byRunEnd ? 'run_end' : byRecord ? 'completion_record' : null,
    record: recordFact,
    acceptance: obs?.independent_acceptance ?? { result: 'not_accepted' },
  };
  const cost = recoveryCost(runs, claimed);
  return {
    task_id: obs?.label ?? (last?.run_id ?? 'empty'),
    source: 'collector',
    scenarios: obs?.scenarios ?? [],
    recoverable_fault: typeof obs?.recoverable_fault === 'boolean' ? obs.recoverable_fault : null,
    runs: facts,
    missing_runs: [...draft.missing].filter((id) => !ids.has(id)).sort(),
    successor_clues: facts.flatMap((f) => (f.manifest?.successor_of
      ? [{ run_id: f.run_id, successor_of: f.manifest.successor_of, in_task: ids.has(f.manifest.successor_of) }]
      : [])),
    facts: taskFacts,
    conclusion: deriveConclusion(taskFacts),
    stop_state: last?.stop_state ?? null,
    operator: operatorFacts(candidateSignals(runs, revisions), obs),
    recovery_cost: cost,
    unaffected_reruns: unaffectedReruns(runs, obs?.unaffected, cost),
  };
}

export function computeMetrics(tasks: TaskReport[]): ReliabilityMetrics {
  const correct = tasks.filter((t) => t.conclusion === 'correct_completion');
  const actionsUnknown = (t: TaskReport): boolean => !t.operator.known || (t.operator.necessity_unknown ?? 0) > 0;
  const recoverable = tasks.filter((t) => t.recoverable_fault === true);
  const stability: Record<string, Record<string, number> | '未测'> = {};
  // 重复运行 = 同一场景、同一分支（前提相同）的不同次运行；分支键取场景结果的 scenario_meta.branch，无分支时只按场景。
  const byScenario = new Map<string, Conclusion[]>();
  for (const t of tasks) {
    for (const s of t.scenarios) {
      const key = t.scenario_meta?.branch ? `${s}/${t.scenario_meta.branch}` : s;
      byScenario.set(key, [...(byScenario.get(key) ?? []), t.conclusion]);
    }
  }
  for (const [s, list] of byScenario) {
    stability[s] = list.length < 2 ? '未测' : list.reduce<Record<string, number>>((acc, c) => ({ ...acc, [c]: (acc[c] ?? 0) + 1 }), {});
  }
  return {
    correct_autonomous_completion: {
      numerator: correct.filter((t) => !actionsUnknown(t) && t.operator.unnecessary_count === 0).length,
      denominator: tasks.length,
      unknown: correct.filter(actionsUnknown).length,
    },
    auto_recovery: {
      numerator: recoverable.filter((t) => t.conclusion === 'correct_completion' && t.operator.known && t.operator.rescue_count === 0).length,
      denominator: recoverable.length,
      unknown: recoverable.filter((t) => t.conclusion === 'correct_completion' && !t.operator.known).length,
    },
    rescues: {
      confirmed: tasks.reduce((acc, t) => acc + (t.operator.rescue_count ?? 0), 0),
      product_decisions: tasks.reduce((acc, t) => acc + (t.operator.product_decisions ?? 0), 0),
      tasks_unknown: tasks.filter((t) => !t.operator.known).length,
    },
    observed_wrong_completions: tasks.filter((t) => t.conclusion === 'wrong_completion').length,
    recovery_cost: tasks.map((t) => ({ task_id: t.task_id, ...t.recovery_cost })),
    repeat_stability: stability,
  };
}

/**
 * 主入口（场景套件 t2 直接调用）：按交付周期内的 supersede 血缘把 run 分成任务，观察记录补入 run 与操作者动作，
 * 合并场景结果，输出每个任务的事实与六项指标。不写任何文件。
 */
export function collectReliability(opts: CollectOptions): ReliabilityReport {
  const project = !!(opts.projectRoot && opts.feature);
  const runsDir = opts.runsDir ?? (project ? featureFilePath(opts.projectRoot!, opts.feature!, 'goal-runs') : undefined);
  const tasks: TaskReport[] = [];
  let boundary: string | null = null;
  let corruptRuns: Array<{ runId: string; reason: string }> = [];

  if (runsDir) {
    const record = project ? assessRecord(opts.projectRoot!, opts.feature!, opts.frameworkRoot) : null;
    boundary = record?.evaluable && record.state === 'ok' ? record.run_id : null;
    let revisions: Array<{ revision_index: number; applied_at: string }> = [];
    if (project) {
      try { revisions = readFeatureFrozenScope(opts.projectRoot!, opts.feature!)?.revisions ?? []; } catch { revisions = []; }
    }
    const listing = classifyGoalRunsDir(runsDir);
    corruptRuns = listing.corruptRuns;
    const corrupt = new Map(corruptRuns.map((c) => [c.runId, c.reason]));
    const all = [...listing.runs, ...corrupt.keys()].sort();
    const drafts: TaskDraft[] = [];
    if (opts.runIds?.length) {
      drafts.push({ runs: new Map(opts.runIds.map((id) => [id, 'explicit' as RunSource])), missing: new Set(opts.runIds.filter((id) => !all.includes(id))) });
    } else {
      // 交付周期：创建时刻晚于边界 run（完成记录所在 run）的 run；按时间比较，不按 run id 字典序（同秒随机后缀可颠倒）。
      const created = new Map(all.map((id) => [id, createdMs(loadRun(runsDir, id, 'lineage'))]));
      const boundaryMs = boundary && all.includes(boundary) ? created.get(boundary)! : null;
      const inCycle = all.filter((id) => !boundary || (id !== boundary && (boundaryMs === null || !Number.isFinite(boundaryMs) ? id > boundary : created.get(id)! >= boundaryMs)));
      const superseded = new Set(inCycle.flatMap((id) => extractSupersedeTargets(loadRun(runsDir, id, 'lineage').auth)));
      for (const head of inCycle.filter((id) => !superseded.has(id))) {
        const lineage = lineageOf(runsDir, loadRun(runsDir, head, 'lineage'), boundary);
        drafts.push({
          runs: new Map([head, ...lineage.ids].map((id) => [id, 'lineage' as RunSource])),
          missing: new Set(lineage.missing),
        });
      }
    }
    const observed = (opts.observations ?? []).flatMap((o) => o.tasks ?? [])
      .filter((t) => !opts.feature || !t.feature || t.feature === opts.feature);
    for (const obs of observed) {
      const obsRuns = obs.runs ?? [];
      const hit = drafts.filter((d) => obsRuns.some((id) => d.runs.has(id)));
      const primary = hit.find((d) => d.runs.has(obsRuns[0])) ?? hit[0];
      if (!primary) {
        if (opts.runIds?.length) continue; // 显式 run 列表之外的观察任务不纳入
        drafts.push({
          runs: new Map(obsRuns.filter((id) => all.includes(id)).map((id) => [id, 'observation' as RunSource])),
          missing: new Set(obsRuns.filter((id) => !all.includes(id))), observation: obs,
        });
        continue;
      }
      for (const other of hit.filter((d) => d !== primary)) {
        for (const id of other.runs.keys()) if (!primary.runs.has(id)) primary.runs.set(id, 'observation');
        for (const id of other.missing) primary.missing.add(id);
        drafts.splice(drafts.indexOf(other), 1);
      }
      for (const id of obsRuns) {
        if (primary.runs.has(id)) continue;
        if (all.includes(id)) primary.runs.set(id, 'observation');
        else primary.missing.add(id);
      }
      primary.observation = obs;
    }
    for (const d of drafts) if (d.runs.size > 0) tasks.push(buildTask(d, runsDir, corrupt, record, revisions));
  }

  for (const file of opts.scenarioResults ?? []) {
    for (const t of file.tasks ?? []) {
      tasks.push({ ...t, source: 'scenario_results', conclusion: deriveConclusion(t.facts) });
    }
  }

  return {
    schema: 'reliability-metrics/1',
    input: {
      project_root: opts.projectRoot ?? null, feature: opts.feature ?? null, framework_root: opts.frameworkRoot ?? null,
      runs_dir: runsDir ?? null, runs: opts.runIds ?? null,
      observations: (opts.observations ?? []).map((o) => o.label ?? null),
      scenario_result_files: (opts.scenarioResults ?? []).length,
    },
    cycle_boundary: boundary,
    corrupt_runs: corruptRuns,
    tasks,
    metrics: computeMetrics(tasks),
    function_level_predictions: (opts.scenarioResults ?? []).flatMap((file) => file.predictions ?? []),
  };
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

const CONCLUSION_ZH: Record<Conclusion, string> = {
  correct_completion: '正确完成', wrong_completion: '错误完成', unaccepted_completion: '未验收的完成', incomplete: '未完成',
};
const READING_ZH: Record<StopReading, string> = {
  terminal: '结构上无法继续', waiting_human: '等人', waiting_external_wakeable: '可唤醒等待',
  waiting_external_no_wake: '等外部条件，但没有唤醒手段', recoverable: '可恢复', process_gone: '进程已不在，原因未知', unclassified: '未分类',
};
const ACCEPT_ZH: Record<AcceptanceResult, string> = { pass: '通过', fail: '失败', not_accepted: '未验收' };
const dur = (v: number | null): string => (v === null ? '-' : `${(v / 60000).toFixed(1)} min`);
const cell = (v: unknown): string => String(v ?? '-').replace(/\|/g, '\\|').replace(/\n/g, ' ');

export function renderMarkdown(r: ReliabilityReport): string {
  const lines: string[] = ['# 可靠性指标', ''];
  lines.push(`- 输入：${cell(JSON.stringify(r.input))}`);
  lines.push(`- 交付周期边界：${r.cycle_boundary ?? '无（全部 run 参与分组）'}`);
  if (r.corrupt_runs.length) lines.push(`- 损坏 run：${r.corrupt_runs.map((c) => `${c.runId}（${c.reason}）`).join('；')}`);
  lines.push('', '## 任务', '');
  lines.push('| 任务 | run | 宣称完成 | 记录与当前义务 | 独立验收 | 结论 | 停止状态 | 操作者动作 | 候选（已确认/总） | 恢复成本 |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const t of r.tasks) {
    const rec = t.facts.record.evaluable
      ? `记录 ${t.facts.record.state}${t.facts.record.run_id ? `（${t.facts.record.run_id}${t.facts.record.issued_in_task ? '，本任务签发' : ''}）` : ''}；未覆盖 ${t.facts.record.uncovered.length}；阻塞 ${t.facts.record.blocking.length}`
      : `无法评估：${t.facts.record.reason}`;
    const s = t.stop_state;
    const stop = s
      ? `${s.status ?? '无 run_end'} / ${s.halt_reason ?? '-'} / ${s.run_disposition}${s.run_wait_kind ? `+${s.run_wait_kind}` : ''}${s.has_probe ? ' 带探针' : ''}${s.reading ? `（${READING_ZH[s.reading]}）` : ''}${s.incident_class ? ` [${s.incident_class}]` : ''}`
      : '-';
    const op = t.operator.known ? `${t.operator.rescue_count}（产品决策 ${t.operator.product_decisions}）` : '未知';
    const confirmed = t.operator.candidates.filter((c) => c.status === 'confirmed').length;
    const rc = t.recovery_cost;
    const cost = rc.status === 'no_failure' ? '无故障'
      : `${rc.status === 'recovered' ? '已恢复' : '未恢复'}：墙钟 ${dur(rc.wall_ms)}，活跃 ${dur(rc.active_ms)}，调用 ${rc.agent_invocations}${rc.status === 'unrecovered' ? '（计到任务末）' : ''}`;
    lines.push(`| ${cell(t.task_id)} | ${cell(t.runs.map((x) => `${x.run_id}${x.source === 'lineage' ? '' : `(${x.source})`}`).join(', '))}${t.missing_runs.length ? `；缺失 ${cell(t.missing_runs.join(', '))}` : ''} | ${t.facts.claimed_complete ? '是' : '否'} | ${cell(rec)} | ${ACCEPT_ZH[t.facts.acceptance.result]} | ${CONCLUSION_ZH[t.conclusion]} | ${cell(stop)} | ${op} | ${confirmed}/${t.operator.candidates.length} | ${cell(cost)} |`);
  }
  lines.push('', '## 故障明细', '');
  lines.push('| 任务 | 故障（run#事件） | 时间 | 阶段 | 类型 / verdict / halt_reason | 状态 | 终点 | 墙钟 | 活跃 | 调用 |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const t of r.tasks) {
    for (const f of t.recovery_cost.faults) {
      const end = f.endpoint ? `${f.endpoint.run_id}#${f.endpoint.event_index}（${f.endpoint.kind === 'phase_pass' ? '该阶段 PASS' : '任务完成'}）` : '-';
      lines.push(`| ${cell(t.task_id)} | ${f.run_id}#${f.event_index} | ${f.ts ?? '-'} | ${f.phase ?? '-'} | ${cell(`${f.type} / ${f.verdict ?? '-'} / ${f.halt_reason ?? '-'}`)} | ${f.status === 'recovered' ? '已恢复' : '未恢复'} | ${end} | ${dur(f.wall_ms)}${f.measured_to === 'task_end' ? '（计到任务末）' : ''} | ${dur(f.active_ms)} | ${f.agent_invocations} |`);
    }
  }
  lines.push('', '## run 明细', '');
  lines.push('| run | 会话段（无 run_end） | 正式活跃 | 调用（按阶段） | 实际回退 / 累计字段 | run_end 数 | 有效终态 | successor_of（线索） |');
  lines.push('|---|---|---|---|---|---|---|---|');
  for (const x of r.tasks.flatMap((t) => t.runs)) {
    lines.push(`| ${x.run_id} | ${x.sessions.length}（${x.sessions.filter((s) => !s.has_run_end).length}） | ${dur(x.formal_active_ms)} | ${x.agent_invocations.total} ${cell(JSON.stringify(x.agent_invocations.by_phase))} | ${x.backtracks.requested_events} / ${x.backtracks.cumulative_field_last ?? '-'} | ${x.run_end_count} | ${cell(x.effective_run_end ? `${x.effective_run_end.status} ${x.effective_run_end.halt_reason ?? ''}` : '-')} | ${x.manifest?.successor_of ?? '-'} |`);
  }
  lines.push('', '## 操作者动作候选', '');
  for (const t of r.tasks) {
    for (const c of t.operator.candidates) {
      lines.push(`- ${t.task_id}：${c.signal} @ ${c.ref.run_id ?? c.ref.artifact}#${c.ref.event_index ?? c.ref.revision_index} ${c.ref.ts ?? ''} → ${c.status === 'confirmed' ? `已确认（动作 ${c.confirmed_by.join(',')}）` : '未确认'}`);
    }
  }
  const m = r.metrics;
  lines.push('', '## 六项指标', '');
  lines.push(`- 正确自主完成：${m.correct_autonomous_completion.numerator}/${m.correct_autonomous_completion.denominator}（操作者动作未知 ${m.correct_autonomous_completion.unknown}，不计入分子）`);
  lines.push(`- 自动恢复：${m.auto_recovery.numerator}/${m.auto_recovery.denominator}（未知 ${m.auto_recovery.unknown}）`);
  lines.push(`- 人工救场次数：${m.rescues.confirmed}（产品决策 ${m.rescues.product_decisions}；动作未知的任务 ${m.rescues.tasks_unknown}）`);
  lines.push(`- 观察到的错误完成数：${m.observed_wrong_completions}（只描述本次运行）`);
  lines.push(`- 恢复成本：${m.recovery_cost.map((c) => `${c.task_id}=${c.status === 'recovered' ? `${dur(c.wall_ms)} 墙钟 / ${dur(c.active_ms)} 活跃 / ${c.agent_invocations} 调用` : c.status === 'unrecovered' ? '未恢复' : '无故障'}`).join('；') || '-'}`);
  lines.push(`- 重复运行稳定性：${Object.keys(m.repeat_stability).length ? cell(JSON.stringify(m.repeat_stability)) : '未测'}`);
  lines.push(`- 无影响阶段重跑：${r.tasks.map((t) => `${t.task_id}=${t.unaffected_reruns.exact ?? `代理 ${t.unaffected_reruns.proxy ?? '-'}`}`).join('；') || '-'}`);
  if (r.function_level_predictions.length) {
    lines.push('', '## 函数级预判，未执行任务（不计入任何指标）', '');
    lines.push('| 场景/分支 | 预判出生链 | 已执行阶段 | 预判会重跑的已执行阶段数 | 说明 |');
    lines.push('|---|---|---|---|---|');
    for (const p of r.function_level_predictions) {
      lines.push(`| ${cell(`${p.id}/${p.branch}`)} | ${cell(JSON.stringify(p.predicted_chain))} | ${cell(JSON.stringify(p.executed_phases))} | ${p.predicted_reruns}（预判，不是实际重跑） | ${cell(p.note)} |`);
    }
  }
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// 子进程入口（由 scripts/reliability-metrics.mjs 起）
// ---------------------------------------------------------------------------

if (require.main === module) {
  const write = process.stdout.write.bind(process.stdout);
  // 被 import 的生产模块偶有 console.log，改道 stderr，保证 stdout 只有报告本身。
  console.log = (...args: unknown[]): void => console.error(...args);
  try {
    const raw = JSON.parse(process.env.RELIABILITY_METRICS_OPTIONS ?? '{}') as {
      projectRoot?: string; feature?: string; frameworkRoot?: string; runsDir?: string; runIds?: string[];
      observations?: string; scenarioResults?: string; format?: 'json' | 'md';
    };
    const readJson = (p?: string): unknown => (p ? JSON.parse(fs.readFileSync(p, 'utf8')) : undefined);
    const report = collectReliability({
      projectRoot: raw.projectRoot, feature: raw.feature, frameworkRoot: raw.frameworkRoot,
      runsDir: raw.runsDir, runIds: raw.runIds,
      observations: raw.observations ? [readJson(raw.observations) as ObservationFile] : undefined,
      scenarioResults: raw.scenarioResults ? [readJson(raw.scenarioResults) as { tasks?: TaskReport[]; predictions?: FunctionLevelPrediction[] }] : undefined,
    });
    write(raw.format === 'md' ? renderMarkdown(report) : `${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    console.error(`[reliability-metrics] ${(error as Error).stack ?? String(error)}`);
    process.exitCode = 2;
  }
}

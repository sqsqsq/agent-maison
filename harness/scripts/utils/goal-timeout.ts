/**
 * goal-timeout.ts — per-phase 超时与 wall-clock 派生的单一 SSOT。
 *
 * 为何存在：旧实现全 6 阶段共用一个 `timeout_seconds ?? 3600`（runner / progress /
 * 默认 manifest / 6 个 adapter 各一份），spec 这种轻阶段与 review/testing 重阶段一刀切，
 * 且 runner 与 progress 各读各的会脑裂（runner 等 90min 但 progress 按 60min 报 STALLED）。
 * 本模块把"每 phase 该等多久"与"wall 该多大"收敛成两个纯函数，runner 与 progress 共用，
 * 杜绝脑裂；并保证"全链单次无重试在满预算下能跑完"这一预算自洽不变量。
 */

import type { FeaturePhase } from './phase-transition-policy';
import { FEATURE_PHASE_ORDER } from './phase-transition-policy';

export interface PhaseTimeoutManifestView {
  unattended?: {
    timeout_seconds?: number;
    /** 显式 per-phase 覆盖（最高优先）。 */
    phase_timeout_seconds?: Partial<Record<FeaturePhase, number>>;
  };
  budget?: { wall_clock_minutes?: number };
  start_phase?: FeaturePhase | string;
  end_phase?: FeaturePhase | string;
  chain_override?: readonly (FeaturePhase | string)[];
}

/**
 * 内置 per-phase 默认超时（秒）。依据反馈数据：plan/coding/review 实测单次 >60min。
 * P0-A（b8f36a12）：按 goal 闭环成本重定——goal 模式每个 feature 阶段都要 harness +
 * verifier 子 agent（Task 工具、在阶段预算内跑）+ receipt 四条件闭环，"spec 轻"是普通
 * 交互模式假设，漏进 goal 后 900s 实测被 tree-kill 砍断（bc-openCard 4×15m 空砍）。
 * 全部由 wall_clock 兜底。
 */
export const DEFAULT_PHASE_TIMEOUT_SECONDS: Record<FeaturePhase, number> = {
  spec: 2700, // 45m — verifier 子 agent 主导：主体工作轻但闭环重（实测 611–900s+ 零裕量）
  plan: 5400, // 90m
  coding: 5400, // 90m
  review: 7200, // 120m
  ut: 5400, // 90m — compile + hypium + verifier，与 coding 同量级
  testing: 7200, // 120m
};

/**
 * 任何 feature 阶段"默认表派生预算"的最小地板（30m）：须容纳一次 verifier 子 agent +
 * receipt 闭环。**仅兜底默认表派生值**——用户显式 override（per-phase 或扁平
 * timeout_seconds）豁免地板、尊重原值（低于地板只 WARN 不静默抬升，见
 * collectPhaseTimeoutWarnings），否则破坏显式 override 契约（§七.2）。
 */
export const MIN_PHASE_TIMEOUT_SECONDS = 1800;

/** 未知 phase / 全部回落用的最终兜底（= 旧全局值）。 */
export const DEFAULT_GLOBAL_TIMEOUT_SECONDS = 3600;

/**
 * P0-4（plan d9b4f7e2）：wall deadline 制下为**收尾**（checkpoint/report/snapshot/
 * completion receipt）预留的时间。agent/harness/backoff 的可用预算一律先扣本值；
 * run_end 之后的 best-effort 收尾超出本预留即跳过（finalize_skipped 留痕）。
 * 取值为保守常量（开放问题 4：收尾耗时分布未采样，事件回灌后再调）。
 */
export const FINALIZE_RESERVE_MS = 60_000;

/**
 * P0-4：连续超时升档——同 phase 连续第 CONSECUTIVE_TIMEOUT_ESCALATE_AFTER 次超时后，
 * 下一 attempt 的**默认表派生**预算 ×TIMEOUT_ESCALATION_FACTOR（显式 override 不动，
 * 与 MIN 地板同一豁免契约）；连续第 CONSECUTIVE_TIMEOUT_HALT_AT 次（升档后仍超时）
 * → halt agent_timeout_repeated 求人。签名无关（07-13 chrys 案：i1/i2/i4/i5 FAIL 签名
 * 互异，签名基熔断 6 连超时零命中）。
 */
export const TIMEOUT_ESCALATION_FACTOR = 1.5;
export const CONSECUTIVE_TIMEOUT_ESCALATE_AFTER = 2;
export const CONSECUTIVE_TIMEOUT_HALT_AT = 3;

/**
 * P0-4 第四轮复审：backoff 可负担性判定（纯函数，runner 接线 + 单测共用）。
 * 剩余预算装不下**配置的** backoff 即 false → 不睡直接 budget_wall_clock 终局——
 * 睡截断残量后本来也没预算再跑 attempt，只是把"卡到总超时"体验再拖一截。
 */
export function canAffordBackoff(configuredBackoffMs: number, availableMs: number): boolean {
  return availableMs >= configuredBackoffMs && configuredBackoffMs > 0;
}

// ============================================================================
// P0-5（plan 7c4f2e9b）：超时预算——授予高水位 + 实测棘轮（codex P1#8 + 五轮收敛）。
// 事故实证：i3 已获授 67.5min 且以 exit0@49.6min 证明全量一遍成本，i4/i5 仍回落 45min
// 被腰斩。completed 的 SSOT 钉死为 agent_invoke_end.exit_code===0 && timed_out!==true
// （i2 是 harness-PASS 但 agent 超时、i3 是 agent exit0 但 harness FAIL——棘轮只认后者）。
// 两值均从 events 重建（--resume 不丢）。显式配置=hard cap 不被棘轮突破，但实测逼近/超过
// 时输出 advisory（诚实呈现不可自愈面）。
// ============================================================================

export const OBSERVED_RATCHET_FACTOR = 1.2;

export interface TimeoutRatchetObservations {
  /** 本 phase 曾授予过的最高 effective_timeout_ms（agent_invoke_start/end + timeout_escalated 事件重建） */
  grantedHighwaterMs: number;
  /** 本 phase completed attempt（exit_code===0 && !timed_out）的最大 duration_ms；无则 0 */
  maxCompletedDurationMs: number;
}

interface RatchetEventLike {
  type?: string;
  phase?: string;
  exit_code?: number;
  duration_ms?: number;
  timed_out?: boolean;
  effective_timeout_ms?: number;
}

export function extractTimeoutRatchetFromEvents(
  events: RatchetEventLike[],
  phase: string,
): TimeoutRatchetObservations {
  let granted = 0;
  let completed = 0;
  for (const e of events) {
    if (e.phase !== phase) continue;
    if (
      (e.type === 'agent_invoke_start' || e.type === 'agent_invoke_end' || e.type === 'timeout_escalated') &&
      typeof e.effective_timeout_ms === 'number' &&
      e.effective_timeout_ms > granted
    ) {
      granted = e.effective_timeout_ms;
    }
    if (
      e.type === 'agent_invoke_end' &&
      e.exit_code === 0 &&
      e.timed_out !== true &&
      typeof e.duration_ms === 'number' &&
      e.duration_ms > completed
    ) {
      completed = e.duration_ms;
    }
  }
  return { grantedHighwaterMs: granted, maxCompletedDurationMs: completed };
}

export type TimeoutBudgetSource = 'base' | 'consecutive_timeouts' | 'granted_highwater' | 'observed_ratchet' | 'explicit_cap';

export interface EffectiveTimeoutResolution {
  effectiveMs: number;
  source: TimeoutBudgetSource;
  /** 显式配置疑似过小时的诚实提示（goal-report 呈现；null=无话可说） */
  advisory: string | null;
}

export function resolveEffectiveTimeoutMs(input: {
  baseMs: number;
  explicit: boolean;
  consecutiveTimeouts: number;
  observations: TimeoutRatchetObservations;
}): EffectiveTimeoutResolution {
  const { baseMs, explicit, consecutiveTimeouts, observations } = input;
  const observedMs =
    observations.maxCompletedDurationMs > 0
      ? Math.ceil(observations.maxCompletedDurationMs * OBSERVED_RATCHET_FACTOR)
      : 0;
  if (explicit) {
    // 显式配置=hard cap（棘轮不突破）；实测逼近/超过 → advisory 诚实提示
    const nearOrOver =
      observations.maxCompletedDurationMs >= baseMs * 0.9 || consecutiveTimeouts > 0;
    return {
      effectiveMs: baseMs,
      source: 'explicit_cap',
      advisory: nearOrOver
        ? `显式 phase 超时（${Math.round(baseMs / 60000)}min）疑似过小：实测完成/超时数据已逼近或超过该值` +
          `（max_completed=${Math.round(observations.maxCompletedDurationMs / 60000)}min，连续超时=${consecutiveTimeouts}）——考虑调大配置`
        : null,
    };
  }
  const escalatedMs =
    consecutiveTimeouts >= CONSECUTIVE_TIMEOUT_ESCALATE_AFTER
      ? Math.round(baseMs * TIMEOUT_ESCALATION_FACTOR)
      : 0;
  const candidates: Array<{ ms: number; source: TimeoutBudgetSource }> = [
    { ms: baseMs, source: 'base' },
    { ms: escalatedMs, source: 'consecutive_timeouts' },
    { ms: observations.grantedHighwaterMs, source: 'granted_highwater' },
    { ms: observedMs, source: 'observed_ratchet' },
  ];
  let best = candidates[0];
  for (const c of candidates) {
    if (c.ms > best.ms) best = c;
  }
  return { effectiveMs: best.ms, source: best.source, advisory: null };
}

/** 显式 override（per-phase 或扁平）在位即 true——升档只对默认表派生值生效。 */
export function isExplicitPhaseTimeout(
  phase: FeaturePhase,
  manifest: PhaseTimeoutManifestView,
): boolean {
  const u = manifest.unattended ?? {};
  const perPhase = u.phase_timeout_seconds?.[phase];
  if (typeof perPhase === 'number' && perPhase > 0) return true;
  return typeof u.timeout_seconds === 'number' && u.timeout_seconds > 0;
}

/** wall 派生时在"链路 per-phase 总和"上额外加的缓冲（分钟）。 */
export const WALL_CLOCK_BUFFER_MINUTES = 30;

/**
 * 解析单个 phase 的超时（秒）。优先级：
 *   unattended.phase_timeout_seconds[phase]（显式 per-phase，最高）
 *   → unattended.timeout_seconds（显式扁平全局——用户/测试显式设了就尊重，统一作用所有 phase）
 *   → 内置默认表 DEFAULT_PHASE_TIMEOUT_SECONDS[phase]（未显式时的 per-phase 默认）
 *   → DEFAULT_GLOBAL_TIMEOUT_SECONDS
 *
 * 注：默认 manifest / adapter 不再硬编码扁平 timeout_seconds（见 goal-runner 默认 manifest），
 * 故"开箱即用"走默认表；显式设 timeout_seconds 才覆盖全 phase。
 */
export function resolvePhaseTimeoutSeconds(
  phase: FeaturePhase,
  manifest: PhaseTimeoutManifestView,
): number {
  const u = manifest.unattended ?? {};
  // 两条显式路径都豁免 MIN 地板（尊重显式 override 契约；低于地板由 WARN 提示，不静默抬升）
  const explicitPerPhase = u.phase_timeout_seconds?.[phase];
  if (typeof explicitPerPhase === 'number' && explicitPerPhase > 0) return explicitPerPhase;

  if (typeof u.timeout_seconds === 'number' && u.timeout_seconds > 0) return u.timeout_seconds;

  // 默认表派生值：MIN 地板兜底，防未来某阶段再被设到地板以下
  const tableDefault = DEFAULT_PHASE_TIMEOUT_SECONDS[phase];
  if (typeof tableDefault === 'number' && tableDefault > 0) {
    return Math.max(tableDefault, MIN_PHASE_TIMEOUT_SECONDS);
  }

  return Math.max(DEFAULT_GLOBAL_TIMEOUT_SECONDS, MIN_PHASE_TIMEOUT_SECONDS);
}

/**
 * 显式 override 低于地板时的 WARN 文案（不抬升，仅提示；goal-runner 启动时打一次）。
 * 纯函数：runner 打印、单测断言共用；扁平 timeout_seconds 只报一条避免 6 phase 重复。
 */
export function collectPhaseTimeoutWarnings(
  manifest: PhaseTimeoutManifestView,
  chain: readonly FeaturePhase[],
): string[] {
  const u = manifest.unattended ?? {};
  const warnings: string[] = [];
  for (const phase of chain) {
    const v = u.phase_timeout_seconds?.[phase];
    if (typeof v === 'number' && v > 0 && v < MIN_PHASE_TIMEOUT_SECONDS) {
      warnings.push(
        `[goal-runner] WARN: 显式 phase_timeout_seconds.${phase}=${v}s 低于建议地板 ` +
          `${MIN_PHASE_TIMEOUT_SECONDS}s（goal 闭环含 verifier 子 agent + receipt，可能被砍断）；` +
          `尊重显式值，不抬升。`,
      );
    }
  }
  if (
    typeof u.timeout_seconds === 'number' &&
    u.timeout_seconds > 0 &&
    u.timeout_seconds < MIN_PHASE_TIMEOUT_SECONDS
  ) {
    warnings.push(
      `[goal-runner] WARN: 显式扁平 timeout_seconds=${u.timeout_seconds}s 低于建议地板 ` +
        `${MIN_PHASE_TIMEOUT_SECONDS}s（作用于无 per-phase 覆盖的所有 phase）；尊重显式值，不抬升。`,
    );
  }
  return warnings;
}

export function resolvePhaseTimeoutMs(
  phase: FeaturePhase,
  manifest: PhaseTimeoutManifestView,
): number {
  return resolvePhaseTimeoutSeconds(phase, manifest) * 1000;
}

const FEATURE_PHASE_SET = new Set<string>(FEATURE_PHASE_ORDER);

/**
 * 推导将要运行的 phase 集合（用于 wall 派生）。
 * 优先 chain_override；否则取 FEATURE_PHASE_ORDER 中 start..end 闭区间。
 * 对 wall 派生取"上界即安全"——宁可略大、由 max 兜底，绝不低估导致提前截断。
 */
export function resolveChainPhasesForBudget(manifest: PhaseTimeoutManifestView): FeaturePhase[] {
  const override = manifest.chain_override?.filter((p): p is FeaturePhase =>
    FEATURE_PHASE_SET.has(p as string),
  );
  if (override && override.length > 0) return [...override];

  const start = manifest.start_phase as FeaturePhase | undefined;
  const end = manifest.end_phase as FeaturePhase | undefined;
  const startIdx = start ? FEATURE_PHASE_ORDER.indexOf(start) : 0;
  const endIdx = end ? FEATURE_PHASE_ORDER.indexOf(end) : FEATURE_PHASE_ORDER.length - 1;
  const lo = startIdx < 0 ? 0 : startIdx;
  const hi = endIdx < 0 ? FEATURE_PHASE_ORDER.length - 1 : endIdx;
  if (lo > hi) return [...FEATURE_PHASE_ORDER];
  return FEATURE_PHASE_ORDER.slice(lo, hi + 1);
}

/**
 * 派生 wall-clock（分钟）。保证不变量：全链单次无重试在满 per-phase 预算下能跑完。
 *   返回 max(已配置 wall, ceil(Σ链路 per-phase 秒 / 60) + 缓冲)
 * 只增不减——绝不缩小用户显式配置的 wall。
 */
export function resolveWallClockMinutes(manifest: PhaseTimeoutManifestView): number {
  const configured = manifest.budget?.wall_clock_minutes ?? 0;
  const chain = resolveChainPhasesForBudget(manifest);
  const sumSeconds = chain.reduce((acc, p) => acc + resolvePhaseTimeoutSeconds(p, manifest), 0);
  const floorMinutes = Math.ceil(sumSeconds / 60) + WALL_CLOCK_BUFFER_MINUTES;
  return Math.max(configured, floorMinutes);
}

export function resolveWallClockMs(manifest: PhaseTimeoutManifestView): number {
  return resolveWallClockMinutes(manifest) * 60 * 1000;
}

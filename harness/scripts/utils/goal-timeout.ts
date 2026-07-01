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
 * spec 轻、plan/coding 中、review/testing 重、ut 中。全部由 wall_clock 兜底。
 */
export const DEFAULT_PHASE_TIMEOUT_SECONDS: Record<FeaturePhase, number> = {
  spec: 900, // 15m
  plan: 5400, // 90m
  coding: 5400, // 90m
  review: 7200, // 120m
  ut: 3600, // 60m
  testing: 7200, // 120m
};

/** 未知 phase / 全部回落用的最终兜底（= 旧全局值）。 */
export const DEFAULT_GLOBAL_TIMEOUT_SECONDS = 3600;

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
  const explicitPerPhase = u.phase_timeout_seconds?.[phase];
  if (typeof explicitPerPhase === 'number' && explicitPerPhase > 0) return explicitPerPhase;

  if (typeof u.timeout_seconds === 'number' && u.timeout_seconds > 0) return u.timeout_seconds;

  const tableDefault = DEFAULT_PHASE_TIMEOUT_SECONDS[phase];
  if (typeof tableDefault === 'number' && tableDefault > 0) return tableDefault;

  return DEFAULT_GLOBAL_TIMEOUT_SECONDS;
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

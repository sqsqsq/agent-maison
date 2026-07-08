// ============================================================================
// runtime-policy.ts — track / evidence / phase-chain 判定单点（C0，plan d4a7c1e8）
// ============================================================================
// 设计约束（OpenSpec change runtime-policy-core）：
//   - 本模块只提供纯函数：不做文件 I/O、不读 env（RuntimeContext 由调用方装配）。
//   - 运行时组件（runner / check-receipt / transition-policy / goal-*）的
//     feature phase 集合一律从 workflow 派生或从本模块取回退常量，
//     不得各自持有 'spec'|'plan'|... 硬编码枚举。
//   - default 等值不变式：无 feature.yaml、无 evidence_profile、spec-driven
//     workflow 下，各判定输出与收编前硬编码行为逐一等值（契约单测锁死）。

import type { WorkflowArtifact, WorkflowSpec } from '../../workflow-loader';
import { listWorkflowPhases } from '../../workflow-loader';
import { CANONICAL_FEATURE_PHASES } from './phase-alias';

// ---------------------------------------------------------------------------
// 类型契约
// ---------------------------------------------------------------------------

export type RequestRoute = 'direct' | 'feature';
export type FeatureTrack = 'lite' | 'full';
export type RuntimeMode = 'interactive' | 'headless' | 'goal';
export type EvidenceLevel = 'required' | 'optional' | 'off' | 'not_applicable';

export interface RuntimeContext {
  mode: RuntimeMode;
  adapter: string;
  phase: string;
  workflow: string;
  can_prompt_user: boolean;
  can_collect_usage: boolean;
}

export interface EvidencePolicy {
  verifier: EvidenceLevel;
  receipt: EvidenceLevel;
  trace: EvidenceLevel;
  exploration: EvidenceLevel;
}

/** .current-phase.json 内 policy 快照（Stop hook 消费；缺失/版本不符 → fail-safe strict）。 */
export interface PolicySnapshot {
  policy_schema_version: string;
  track: FeatureTrack;
  evidence: EvidencePolicy;
}

export const POLICY_SCHEMA_VERSION = '1.0';

// ---------------------------------------------------------------------------
// 回退常量（无 workflow 可用时的唯一合法来源；单一出处 = phase-alias）
// ---------------------------------------------------------------------------

/** 无 workflow 上下文时的 feature phase 顺序回退（= CANONICAL_FEATURE_PHASES）。 */
export const LEGACY_FEATURE_PHASE_ORDER: readonly string[] = CANONICAL_FEATURE_PHASES;

/**
 * 探索适用 phase（历史规则：feature phase 去掉 testing）。
 * C4 exploration-scale 将以 facts.md 契约重定义；在此之前保持等值。
 */
export const LEGACY_EXPLORATION_PHASES: readonly string[] = LEGACY_FEATURE_PHASE_ORDER.filter(
  (p) => p !== 'testing',
);

/** compat.yaml 合法 phase：探索集 + legacy alias（prd/design）。 */
export const LEGACY_COMPAT_PHASES: readonly string[] = [
  ...LEGACY_EXPLORATION_PHASES,
  'prd',
  'design',
];

// ---------------------------------------------------------------------------
// phase 集合派生（workflow 为 SSOT）
// ---------------------------------------------------------------------------

/** workflow 全部 phase id（含 global），拓扑序。 */
export function workflowOrderedPhases(spec: WorkflowSpec): string[] {
  return listWorkflowPhases(spec);
}

export const KNOWN_FEATURE_TRACKS: readonly FeatureTrack[] = ['full', 'lite'];

/** phase 是否属于某 track（global 恒属；feature 缺省 ["full"]，lite 须显式——C1）。 */
export function artifactInTrack(a: WorkflowArtifact, track: FeatureTrack): boolean {
  if (a.scope === 'global') return true;
  return (a.tracks ?? ['full']).includes(track);
}

/** 该 track 下的有效依赖：requires_by_track 覆写优先；否则 requires 过滤轨外 feature phase（loader 已保证仅无歧义情形合法）。 */
export function effectiveRequires(
  spec: WorkflowSpec,
  artifact: WorkflowArtifact,
  track: FeatureTrack,
): string[] {
  const override = artifact.requires_by_track?.[track];
  if (override) return [...override];
  return artifact.requires.filter((r) => {
    const ra = spec.artifacts.find((x) => x.id === r);
    return !ra || ra.scope === 'global' || artifactInTrack(ra, track);
  });
}

/** track 过滤后的拓扑序（Kahn + ready 字典序，与 listWorkflowPhases 同法——full 轨输出与其等值）。 */
function trackOrderedPhases(spec: WorkflowSpec, track: FeatureTrack): string[] {
  const arts = spec.artifacts.filter((a) => artifactInTrack(a, track));
  const idSet = new Set(arts.map((a) => a.id));
  const indegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const a of arts) {
    indegree.set(a.id, 0);
    adj.set(a.id, []);
  }
  for (const a of arts) {
    for (const r of effectiveRequires(spec, a, track)) {
      if (!idSet.has(r)) continue;
      adj.get(r)!.push(a.id);
      indegree.set(a.id, (indegree.get(a.id) ?? 0) + 1);
    }
  }
  const ready = arts.map((a) => a.id).filter((id) => (indegree.get(id) ?? 0) === 0);
  ready.sort();
  const out: string[] = [];
  while (ready.length > 0) {
    const u = ready.shift()!;
    out.push(u);
    for (const v of adj.get(u)!) {
      indegree.set(v, (indegree.get(v) ?? 0) - 1);
      if (indegree.get(v) === 0) ready.push(v);
    }
    ready.sort();
  }
  if (out.length !== arts.length) {
    throw new Error(`[runtime-policy] track "${track}" 的 phase DAG 存在环`);
  }
  return out;
}

/** workflow feature-scope phase id，拓扑序（按 track 过滤；不按 canonical 枚举过滤——新 phase 一等公民）。 */
export function workflowFeaturePhases(spec: WorkflowSpec, track: FeatureTrack = 'full'): string[] {
  const featureIds = new Set(
    spec.artifacts.filter((a) => a.scope === 'feature').map((a) => a.id),
  );
  return trackOrderedPhases(spec, track).filter((id) => featureIds.has(id));
}

export function isWorkflowFeaturePhase(spec: WorkflowSpec, phase: string): boolean {
  return spec.artifacts.some((a) => a.id === phase && a.scope === 'feature');
}

export interface PhaseChain {
  /** 该 track 下全部 phase（含 global），拓扑序。 */
  ordered: string[];
  /** 该 track 下 feature-scope phase，拓扑序。 */
  featureOrdered: string[];
  /** 该 track 合法 phase id 集（含 global）。 */
  idSet: Set<string>;
  track: FeatureTrack;
  /** 该轨显式 auto_chain（full=spec.auto_chain；其它轨=auto_chain_by_track[track]；loader 保证非 full 轨必有）。 */
  autoChain?: readonly string[];
}

/**
 * 解析某 track 的合法 phase 集与顺序（按成员资格过滤 + effectiveRequires 拓扑）。
 * schema 1.0（无 tracks 字段）= full 单轨：lite/full 输出一致。
 * 只做一致性解析，不做隐式推导（auto_chain_by_track 缺失/不互洽由 loader FAIL——C1 决策 19）。
 */
export function resolvePhaseChain(spec: WorkflowSpec, track: FeatureTrack = 'full'): PhaseChain {
  const ordered = trackOrderedPhases(spec, track);
  const featureIds = new Set(
    spec.artifacts.filter((a) => a.scope === 'feature').map((a) => a.id),
  );
  const autoChain = track === 'full' ? spec.auto_chain : spec.auto_chain_by_track?.[track];
  return {
    ordered,
    featureOrdered: ordered.filter((id) => featureIds.has(id)),
    idSet: new Set(ordered),
    track,
    autoChain,
  };
}

/** 校验 phase 属于 workflow feature phase；否则抛错（含合法集提示）。 */
export function assertWorkflowFeaturePhase(spec: WorkflowSpec, phase: string): void {
  if (!isWorkflowFeaturePhase(spec, phase)) {
    const valid = workflowFeaturePhases(spec).join('|');
    throw new Error(`[runtime-policy] phase "${phase}" 不在 workflow feature phase 合法集（${valid}）`);
  }
}

/** 探索适用 phase：有 spec 时从 workflow 派生（feature phase 去 testing），否则回退常量。 */
export function explorationPhases(spec?: WorkflowSpec): readonly string[] {
  if (!spec) return LEGACY_EXPLORATION_PHASES;
  return workflowFeaturePhases(spec).filter((p) => p !== 'testing');
}

/** compat.yaml 合法 phase 集：探索集 + legacy alias。 */
export function compatAllowedPhases(spec?: WorkflowSpec): Set<string> {
  return new Set([...explorationPhases(spec), 'prd', 'design']);
}

// ---------------------------------------------------------------------------
// 路由 / 判档 / 证据判定
// ---------------------------------------------------------------------------

export interface RequestRouteSignals {
  /** 请求明确指向（或建档为）一个 feature。 */
  targets_feature: boolean;
}

/**
 * 入口路由：direct（L0，不进管线）| feature。
 * L0 是入口路由决策而非 track（codex 三轮 P1）；判定信号由入口层装配。
 */
export function classifyRequestRoute(signals: RequestRouteSignals): RequestRoute {
  return signals.targets_feature ? 'feature' : 'direct';
}

export interface FeatureTrackDecl {
  track?: string;
}

/** feature.yaml 缺失或未声明 → full（默认零变化不变式）。 */
export function resolveFeatureTrack(decl?: FeatureTrackDecl | null): FeatureTrack {
  if (decl && decl.track === 'lite') return 'lite';
  return 'full';
}

export interface EvidenceProfileConfig {
  /** framework.config.json 顶层 evidence_profile（C2 引入；缺省 strict）。 */
  evidence_profile?: string;
}

const STRICT_EVIDENCE: EvidencePolicy = {
  verifier: 'required',
  receipt: 'required',
  trace: 'required',
  exploration: 'required',
};

/**
 * 证据档位求解。
 * C0 阶段 config 尚无 evidence_profile 段 → 恒 strict（与现状逐一等值）；
 * headless/goal 一律强制 strict（无人值守自报无效——不吃任何降档）。
 * C2 verification-matrix 在此接入 balanced/minimal 矩阵。
 */
export function resolveEvidencePolicy(
  _track: FeatureTrack,
  ctx: RuntimeContext,
  _config?: EvidenceProfileConfig | null,
): EvidencePolicy {
  if (ctx.mode !== 'interactive') {
    return { ...STRICT_EVIDENCE };
  }
  // C0：交互态同样恒 strict（evidence_profile 未引入）；C2 起按矩阵求解。
  return { ...STRICT_EVIDENCE };
}

/** 构造当前（C0=恒 strict）policy 快照，随 .current-phase.json 落盘供 Stop hook 消费。 */
export function buildPolicySnapshot(track: FeatureTrack = 'full'): PolicySnapshot {
  return {
    policy_schema_version: POLICY_SCHEMA_VERSION,
    track,
    evidence: { ...STRICT_EVIDENCE },
  };
}

/**
 * 解析落盘的 policy 快照；缺失 / 版本不符 / 形状非法 → null。
 * 消费方（Stop hook / check-receipt）对 null 必须 fail-safe 按 full+strict 处理。
 */
export function parsePolicySnapshot(raw: unknown): PolicySnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const snap = raw as Partial<PolicySnapshot>;
  if (snap.policy_schema_version !== POLICY_SCHEMA_VERSION) return null;
  if (snap.track !== 'lite' && snap.track !== 'full') return null;
  const ev = snap.evidence as Partial<EvidencePolicy> | undefined;
  const levels: EvidenceLevel[] = ['required', 'optional', 'off', 'not_applicable'];
  if (
    !ev ||
    !levels.includes(ev.verifier as EvidenceLevel) ||
    !levels.includes(ev.receipt as EvidenceLevel) ||
    !levels.includes(ev.trace as EvidenceLevel) ||
    !levels.includes(ev.exploration as EvidenceLevel)
  ) {
    return null;
  }
  return {
    policy_schema_version: snap.policy_schema_version,
    track: snap.track,
    evidence: {
      verifier: ev.verifier as EvidenceLevel,
      receipt: ev.receipt as EvidenceLevel,
      trace: ev.trace as EvidenceLevel,
      exploration: ev.exploration as EvidenceLevel,
    },
  };
}

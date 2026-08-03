/**
 * Load goal_capability from adapter.yaml for goal-runner preflight.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import type { UnattendedContract } from './goal-manifest';
import { validateUnattendedContract } from './goal-manifest';
import { USAGE_CAPTURE_METHODS, type UsageCaptureMethod } from './usage-capture';

export type GoalCapabilityMode = 'native_goal' | 'external_runner' | 'hook_loop';

/**
 * t3a（plan f7a3d9c2）：adapter 工具事件证据源能力声明——verified 回执生产的前提。
 * - none（缺省）：headless 输出无结构化工具事件 → 恒 unverified；
 * - structured_events：CLI stdout 可输出结构化事件流（NDJSON）→ 分流写 agent-events.jsonl，
 *   attestation 绑定该文件（不绑 stdout/stderr 混合的人读 agent-output.log）；
 * - session_transcript：CLI 本地留有会话 transcript（含 tool_use 记录），runner 事后读取。
 * 解析器契约：**只接受结构化事件，禁止从普通文本正则猜测 Read**（codex 红线）。
 */
export const TOOL_EVENT_PROVENANCE_MODES = ['none', 'structured_events', 'session_transcript'] as const;
export type ToolEventProvenance = (typeof TOOL_EVENT_PROVENANCE_MODES)[number];

export interface GoalCapabilityNative {
  goal_condition_template?: string;
  supports_resume?: boolean;
}

export interface GoalCapabilityExternal {
  headless_invoke?: string;
  unattended?: Partial<UnattendedContract>;
}

/** P1-7（plan d9b4f7e2）：headless 输出交付方式（静态能力声明，宿主 --help 核实后填）。 */
export type OutputDelivery = 'streaming' | 'buffered' | 'unknown';
export const OUTPUT_DELIVERY_MODES = ['streaming', 'buffered', 'unknown'] as const;
export const GOAL_HANDOFF_MODES = ['none', 'to_detached', 'bidirectional'] as const;
export type GoalHandoffMode = (typeof GOAL_HANDOFF_MODES)[number];

export interface GoalCapabilitySpec {
  mode: GoalCapabilityMode;
  native_goal?: GoalCapabilityNative;
  external_runner?: GoalCapabilityExternal;
  /** C-ab-eval：用量采集方式声明（缺省 none；非法值在 load 时计入 issues） */
  usage_capture?: UsageCaptureMethod;
  /** t3a（f7a3d9c2）：工具事件证据源声明（缺省 none=恒 unverified） */
  tool_event_provenance?: ToolEventProvenance;
  /** P1-7：输出交付方式（缺省 unknown——buffered/unknown 时断流哨兵可能失效，
   * 被杀 attempt 的 agent-output.log 可为 0 字节）；透传 agent_invoke_end 供排障。 */
  output_delivery?: OutputDelivery;
  in_session_reconcile: boolean;
  phase_context_isolation: boolean;
  supports_resume: boolean;
  handoff: GoalHandoffMode;
  /** a4f7e2b1 t3：声明式生存能力（launch/liveness/wakeup）；无实证的声明会被降级 */
  survival?: SurvivalCapabilityDecl;
}

export interface GoalCapabilityLoadResult {
  adapter: string;
  present: boolean;
  valid: boolean;
  capability?: GoalCapabilitySpec;
  issues: string[];
}

export function loadGoalCapability(
  frameworkRoot: string,
  adapterName: string,
): GoalCapabilityLoadResult {
  const yamlPath = path.join(frameworkRoot, 'agents', adapterName, 'adapter.yaml');
  const issues: string[] = [];
  if (!fs.existsSync(yamlPath)) {
    return { adapter: adapterName, present: false, valid: false, issues: ['adapter.yaml 不存在'] };
  }
  const raw = YAML.parse(fs.readFileSync(yamlPath, 'utf-8')) as Record<string, unknown>;
  const gc = raw?.goal_capability as Record<string, unknown> | undefined;
  if (!gc || typeof gc !== 'object') {
    return {
      adapter: adapterName,
      present: false,
      valid: false,
      issues: ['goal_capability 未声明'],
    };
  }
  const mode = gc.mode as GoalCapabilityMode | undefined;
  const allowed = new Set(['native_goal', 'external_runner', 'hook_loop']);
  if (!mode || !allowed.has(mode)) {
    issues.push('goal_capability.mode 必须为 native_goal|external_runner|hook_loop');
  }
  let usageCapture: UsageCaptureMethod = 'none';
  if (gc.usage_capture !== undefined) {
    if (
      typeof gc.usage_capture === 'string' &&
      (USAGE_CAPTURE_METHODS as readonly string[]).includes(gc.usage_capture)
    ) {
      usageCapture = gc.usage_capture as UsageCaptureMethod;
    } else {
      issues.push(
        `goal_capability.usage_capture 非法（${String(gc.usage_capture)}）；合法值 ${USAGE_CAPTURE_METHODS.join('|')}`,
      );
    }
  }
  let toolEventProvenance: ToolEventProvenance = 'none';
  if (gc.tool_event_provenance !== undefined) {
    if (
      typeof gc.tool_event_provenance === 'string' &&
      (TOOL_EVENT_PROVENANCE_MODES as readonly string[]).includes(gc.tool_event_provenance)
    ) {
      toolEventProvenance = gc.tool_event_provenance as ToolEventProvenance;
    } else {
      issues.push(
        `goal_capability.tool_event_provenance 非法（${String(gc.tool_event_provenance)}）；合法值 ${TOOL_EVENT_PROVENANCE_MODES.join('|')}`,
      );
    }
  }
  let outputDelivery: OutputDelivery = 'unknown';
  if (gc.output_delivery !== undefined) {
    if (
      typeof gc.output_delivery === 'string' &&
      (OUTPUT_DELIVERY_MODES as readonly string[]).includes(gc.output_delivery)
    ) {
      outputDelivery = gc.output_delivery as OutputDelivery;
    } else {
      issues.push(
        `goal_capability.output_delivery 非法（${String(gc.output_delivery)}）；合法值 ${OUTPUT_DELIVERY_MODES.join('|')}`,
      );
    }
  }
  const boolField = (name: string): boolean => {
    const value = gc[name];
    if (value === undefined) return false;
    if (typeof value !== 'boolean') {
      issues.push(`goal_capability.${name} 必须为 boolean`);
      return false;
    }
    return value;
  };
  const inSessionReconcile = boolField('in_session_reconcile');
  const phaseContextIsolation = boolField('phase_context_isolation');
  const supportsResume = boolField('supports_resume');
  const handoff = typeof gc.handoff === 'string' &&
    (GOAL_HANDOFF_MODES as readonly string[]).includes(gc.handoff)
    ? gc.handoff as GoalHandoffMode
    : 'none';
  if (gc.handoff !== undefined && handoff === 'none' && gc.handoff !== 'none') {
    issues.push(`goal_capability.handoff 非法（${String(gc.handoff)}）`);
  }
  if (handoff !== 'none' && !supportsResume) issues.push('handoff 要求 supports_resume=true');
  if (inSessionReconcile && !phaseContextIsolation) {
    issues.push('in_session_reconcile 要求 phase_context_isolation=true');
  }
  const capability: GoalCapabilitySpec = {
    mode: mode ?? 'external_runner',
    native_goal: gc.native_goal as GoalCapabilityNative | undefined,
    external_runner: gc.external_runner as GoalCapabilityExternal | undefined,
    usage_capture: usageCapture,
    tool_event_provenance: toolEventProvenance,
    output_delivery: outputDelivery,
    in_session_reconcile: inSessionReconcile,
    phase_context_isolation: phaseContextIsolation,
    supports_resume: supportsResume,
    handoff,
    ...(gc.survival && typeof gc.survival === 'object'
      ? { survival: gc.survival as SurvivalCapabilityDecl }
      : {}),
  };
  return {
    adapter: adapterName,
    present: true,
    valid: issues.length === 0,
    capability,
    issues,
  };
}

export function validateGoalCapabilityForRunner(
  frameworkRoot: string,
  adapterName: string,
  manifestUnattended?: UnattendedContract,
): { ok: boolean; issues: string[] } {
  const loaded = loadGoalCapability(frameworkRoot, adapterName);
  const issues = [...loaded.issues];
  if (!loaded.present || !loaded.capability) {
    return { ok: false, issues };
  }

  const ext = loaded.capability.external_runner;
  const unattended =
    manifestUnattended ?? (ext?.unattended as UnattendedContract | undefined);
  issues.push(...validateUnattendedContract(unattended));

  if (loaded.capability.mode === 'external_runner' && !ext?.headless_invoke?.trim()) {
    issues.push('external_runner.headless_invoke 缺失');
  }

  return { ok: issues.length === 0, issues };
}


// ---------------------------------------------------------------------------
// plan a4f7e2b1 t3：声明式 launch / liveness / wakeup —— **先探针后声明**
// ---------------------------------------------------------------------------
// 生存策略由配置解析而非硬编码。但配置**不等于**能力：a7f2e5d1 的教训是
// 「tier 虚标要么实证要么降级」——一个 adapter 自称能后台存活、实际不能，
// supervisor 会一直往一个起不来的东西上撞。
//
// 因此本解析器的核心不是「读到什么就信什么」，而是：
//   声明 + **实证样本引用**（verified_by）齐备 → 采信；
//   只有声明、没有实证       → **降级为 unsupported** 并给出诚实原因；
//   什么都没有               → unsupported。
// 探针法参照 c7a9e2f4 T0：实证样本须由宿主实跑产生并落档，不接受口头声明。
// ---------------------------------------------------------------------------

export type SurvivalFacet = 'launch' | 'liveness' | 'wakeup';

export interface SurvivalFacetDecl {
  /** adapter 自称支持该能力 */
  supported?: boolean;
  /** 实证样本引用（宿主实跑产物路径 / probe 记录 id）——缺失即降级 */
  verified_by?: string;
  /** 该能力的具体机制（诊断用，不参与判定） */
  mechanism?: string;
}

export interface SurvivalCapabilityDecl {
  launch?: SurvivalFacetDecl;
  liveness?: SurvivalFacetDecl;
  wakeup?: SurvivalFacetDecl;
}

export type SurvivalFacetResolution =
  | { facet: SurvivalFacet; supported: true; verified_by: string; mechanism: string | null }
  | { facet: SurvivalFacet; supported: false; reason: string };

/**
 * 单能力解析。**无实证不采信**——这是本函数存在的全部意义。
 */
export function resolveSurvivalFacet(
  facet: SurvivalFacet,
  decl: SurvivalFacetDecl | undefined,
): SurvivalFacetResolution {
  if (!decl || decl.supported !== true) {
    return { facet, supported: false, reason: `${facet} 未声明支持` };
  }
  const verified = typeof decl.verified_by === 'string' ? decl.verified_by.trim() : '';
  if (!verified) {
    return {
      facet,
      supported: false,
      reason:
        `${facet} 已声明 supported=true 但缺 verified_by 实证样本——按「先探针后声明」降级为不支持` +
        '（虚标的能力会让 supervisor 一直撞一个起不来的东西）',
    };
  }
  return {
    facet,
    supported: true,
    verified_by: verified,
    mechanism: typeof decl.mechanism === 'string' && decl.mechanism.trim() ? decl.mechanism.trim() : null,
  };
}

export function resolveSurvivalCapability(
  decl: SurvivalCapabilityDecl | undefined,
): Record<SurvivalFacet, SurvivalFacetResolution> {
  return {
    launch: resolveSurvivalFacet('launch', decl?.launch),
    liveness: resolveSurvivalFacet('liveness', decl?.liveness),
    wakeup: resolveSurvivalFacet('wakeup', decl?.wakeup),
  };
}

/** 从已加载的 adapter capability 取生存声明（缺省空——不代表支持）。 */
export function survivalCapabilityOf(
  loaded: GoalCapabilityLoadResult,
): Record<SurvivalFacet, SurvivalFacetResolution> {
  return resolveSurvivalCapability(loaded.capability?.survival);
}

export type GoalRunMode = 'attended' | 'unattended';
export type GoalCapabilityRoute =
  | { kind: 'in_session'; reason: string }
  | { kind: 'manual'; reason: string }
  | { kind: 'external_runner'; reason: string }
  | { kind: 'halt'; reason: string };

export function routeGoalCapability(
  loaded: GoalCapabilityLoadResult,
  requested: GoalRunMode,
  options: { requireHandoff?: boolean; unattendedPreflightOk?: boolean } = {},
): GoalCapabilityRoute {
  const capability = loaded.capability;
  if (!loaded.present || !loaded.valid || !capability) {
    return requested === 'attended'
      ? { kind: 'manual', reason: 'adapter 未声明有效会话内能力，回退为手动 harness+assess' }
      : { kind: 'halt', reason: 'adapter goal capability 缺失或非法，不能无人值守执行' };
  }
  if (options.requireHandoff && (
    !capability.supports_resume || capability.handoff === 'none'
  )) {
    return { kind: 'halt', reason: 'adapter 未声明 resume+handoff 能力' };
  }
  if (requested === 'attended') {
    if (capability.in_session_reconcile && capability.phase_context_isolation) {
      return { kind: 'in_session', reason: 'adapter 支持会话内调和与 phase 隔离' };
    }
    return { kind: 'manual', reason: 'adapter 不支持 phase 隔离，回退为手动 harness+assess' };
  }
  if (options.unattendedPreflightOk !== true) {
    return { kind: 'halt', reason: '无人值守 preflight 未通过' };
  }
  if (!capability.external_runner?.headless_invoke?.trim()) {
    return { kind: 'halt', reason: 'adapter 未声明 external_runner.headless_invoke' };
  }
  return { kind: 'external_runner', reason: 'adapter 与无人值守 preflight 均满足' };
}

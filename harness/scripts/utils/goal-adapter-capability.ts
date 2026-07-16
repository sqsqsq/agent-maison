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
  const capability: GoalCapabilitySpec = {
    mode: mode ?? 'external_runner',
    native_goal: gc.native_goal as GoalCapabilityNative | undefined,
    external_runner: gc.external_runner as GoalCapabilityExternal | undefined,
    usage_capture: usageCapture,
    tool_event_provenance: toolEventProvenance,
    output_delivery: outputDelivery,
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

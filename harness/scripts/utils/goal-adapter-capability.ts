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

export interface GoalCapabilityNative {
  goal_condition_template?: string;
  supports_resume?: boolean;
}

export interface GoalCapabilityExternal {
  headless_invoke?: string;
  unattended?: Partial<UnattendedContract>;
}

export interface GoalCapabilitySpec {
  mode: GoalCapabilityMode;
  native_goal?: GoalCapabilityNative;
  external_runner?: GoalCapabilityExternal;
  /** C-ab-eval：用量采集方式声明（缺省 none；非法值在 load 时计入 issues） */
  usage_capture?: UsageCaptureMethod;
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
  const capability: GoalCapabilitySpec = {
    mode: mode ?? 'external_runner',
    native_goal: gc.native_goal as GoalCapabilityNative | undefined,
    external_runner: gc.external_runner as GoalCapabilityExternal | undefined,
    usage_capture: usageCapture,
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

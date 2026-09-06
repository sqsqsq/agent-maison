// ============================================================================
// effective-vision-context.ts — 当前执行视觉能力解析
// ----------------------------------------------------------------------------
// 本模块只回答一个问题：当前 run/invocation 能不能读图。
// 产物质量由当次 gate 判断，不在这里落跨轮状态，也不得反向改写模型能力。
// ============================================================================

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { featureDir, loadFrameworkConfig } from '../../config';
import { inferRepoLayout } from '../../repo-layout';
import { loadLocalConfig } from './framework-local-config';
import {
  canaryAdmissibleForExecution,
  isVisionCanaryFresh,
  probeAdapterImageInput,
} from './multimodal-probe';

export type VisionCapabilityVerdict = 'tool_read' | 'native' | 'none' | 'unknown';
export type VisionCapabilityScope = 'adapter_declared' | 'run_probed';

export interface VisionCapabilityAxis {
  verdict: VisionCapabilityVerdict;
  scope: VisionCapabilityScope;
  evidence: {
    /** 只有 canary 分支写它——它同时是「本 axis 来源为 probe」的唯一判据（plan 8d2b4f60 D1）。 */
    canary_probed_at?: string;
    canary_run_id?: string;
    reason: string;
  };
}

export interface EffectiveVisionContext {
  vision_capability: VisionCapabilityAxis;
}

export interface ResolveVisionContextArgs {
  projectRoot: string;
  feature: string;
  runId?: string;
  adapter?: string;
  modelPin?: string;
  frameworkRoot?: string;
}

export function visionArtifactsDir(projectRoot: string, feature: string): string {
  return path.join(featureDir(projectRoot, feature), 'vision');
}

export function sha256File(absPath: string): string | null {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(absPath)).digest('hex');
  } catch {
    return null;
  }
}

function resolveAdapter(args: ResolveVisionContextArgs): string {
  const explicit = (args.adapter ?? '').trim();
  if (explicit) return explicit;
  try {
    return (loadFrameworkConfig(args.projectRoot).agent_adapter ?? 'generic').trim() || 'generic';
  } catch {
    return 'generic';
  }
}

function resolveCapabilityAxis(args: ResolveVisionContextArgs): VisionCapabilityAxis {
  const adapter = resolveAdapter(args);

  let local: ReturnType<typeof loadLocalConfig> = null;
  try {
    local = loadLocalConfig(args.projectRoot);
  } catch {
    local = null;
  }

  const override = local?.vision?.image_input_override;
  if (override) {
    return {
      verdict: override === 'none' ? 'none' : override === 'native_attach' ? 'native' : 'tool_read',
      scope: 'run_probed',
      evidence: { reason: `vision.image_input_override=${override}（用户显式声明）` },
    };
  }

  const canary = local?.vision?.canary;
  if (
    isVisionCanaryFresh(canary, adapter) &&
    canaryAdmissibleForExecution(canary, { runId: args.runId, modelPin: args.modelPin })
  ) {
    return {
      verdict: canary!.verdict === 'tool_read' ? 'tool_read' : canary!.verdict === 'none' ? 'none' : 'unknown',
      scope: 'run_probed',
      evidence: {
        canary_probed_at: canary!.probed_at,
        ...(canary!.run_id ? { canary_run_id: canary!.run_id } : {}),
        reason: `canary ${canary!.verdict}（${canary!.probed_via ?? 'goal'}${canary!.model ? `，model=${canary!.model}` : ''}）`,
      },
    };
  }

  try {
    const frameworkRoot = args.frameworkRoot ?? inferRepoLayout(args.projectRoot).frameworkRoot;
    const probe = probeAdapterImageInput(args.projectRoot, frameworkRoot, adapter);
    return {
      verdict: probe.imageInput === 'none' ? 'none' : probe.imageInput === 'native_attach' ? 'native' : 'tool_read',
      scope: 'adapter_declared',
      evidence: { reason: `adapter 声明（${probe.reason}）——未经实测，仅表示可尝试` },
    };
  } catch (error) {
    return {
      verdict: 'unknown',
      scope: 'adapter_declared',
      evidence: { reason: `adapter 声明不可读（${(error as Error).message}）` },
    };
  }
}

export function resolveEffectiveVisionContext(args: ResolveVisionContextArgs): EffectiveVisionContext {
  return { vision_capability: resolveCapabilityAxis(args) };
}

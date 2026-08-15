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
export type VisionCapabilityScope = 'adapter_declared' | 'run_probed' | 'invocation_bound';

export interface VisionCapabilityAxis {
  verdict: VisionCapabilityVerdict;
  scope: VisionCapabilityScope;
  evidence: {
    canary_probed_at?: string;
    canary_run_id?: string;
    binding_path?: 'route_equality' | 'inline_canary';
    reason: string;
  };
}

export interface CapabilityReceipt {
  schema_version: '1.0';
  adapter: string;
  run_id: string;
  invoke_id: string;
  binding_path: 'route_equality' | 'inline_canary';
  verdict: Exclude<VisionCapabilityVerdict, 'unknown'>;
  provider?: string;
  model?: string;
  at: string;
}

export interface EffectiveVisionContext {
  vision_capability: VisionCapabilityAxis;
}

export interface ResolveVisionContextArgs {
  projectRoot: string;
  feature: string;
  runId?: string;
  invokeId?: string;
  adapter?: string;
  modelPin?: string;
  frameworkRoot?: string;
}

export function visionArtifactsDir(projectRoot: string, feature: string): string {
  return path.join(featureDir(projectRoot, feature), 'vision');
}

export function capabilityReceiptPath(projectRoot: string, feature: string): string {
  return path.join(visionArtifactsDir(projectRoot, feature), 'capability-receipt.json');
}

export function sha256File(absPath: string): string | null {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(absPath)).digest('hex');
  } catch {
    return null;
  }
}

export function readCapabilityReceipt(projectRoot: string, feature: string): CapabilityReceipt | null {
  const receiptPath = capabilityReceiptPath(projectRoot, feature);
  if (!fs.existsSync(receiptPath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(receiptPath, 'utf-8')) as CapabilityReceipt;
    return parsed?.schema_version === '1.0' && parsed.invoke_id && parsed.binding_path ? parsed : null;
  } catch {
    return null;
  }
}

/** Runner-owned current-invocation receipt. */
export function writeCapabilityReceipt(
  projectRoot: string,
  feature: string,
  receipt: Omit<CapabilityReceipt, 'schema_version' | 'at'> & { at?: string },
): CapabilityReceipt {
  const full: CapabilityReceipt = {
    schema_version: '1.0',
    at: receipt.at ?? new Date().toISOString(),
    adapter: receipt.adapter,
    run_id: receipt.run_id,
    invoke_id: receipt.invoke_id,
    binding_path: receipt.binding_path,
    verdict: receipt.verdict,
    ...(receipt.provider ? { provider: receipt.provider } : {}),
    ...(receipt.model ? { model: receipt.model } : {}),
  };
  const receiptPath = capabilityReceiptPath(projectRoot, feature);
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  fs.writeFileSync(receiptPath, `${JSON.stringify(full, null, 2)}\n`, 'utf-8');
  return full;
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

  if (args.invokeId) {
    const receipt = readCapabilityReceipt(args.projectRoot, args.feature);
    if (
      receipt &&
      receipt.invoke_id === args.invokeId &&
      (!args.runId || receipt.run_id === args.runId) &&
      receipt.adapter === adapter &&
      (!args.modelPin || receipt.model === args.modelPin)
    ) {
      return {
        verdict: receipt.verdict,
        scope: 'invocation_bound',
        evidence: {
          binding_path: receipt.binding_path,
          reason: `runner receipt（${receipt.binding_path}）`,
        },
      };
    }
  }

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

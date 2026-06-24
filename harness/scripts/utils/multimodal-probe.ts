// ============================================================================
// multimodal-probe.ts — adapter 多模态可用性探测（M3）
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import { inferRepoLayout } from '../../repo-layout';
import type { UnattendedContract } from './goal-manifest';
import {
  isGoalOrchestrationEnv,
  MAISON_GOAL_ALLOWED_TOOLS_ENV,
} from './phase-state';

export type ImageInputMode = 'none' | 'tool_read' | 'native_attach';

export interface MultimodalProbeResult {
  imageInput: ImageInputMode;
  /** tool_read | native_attach → true */
  supported: boolean;
  adapter: string;
  reason: string;
}

const IMAGE_INPUT_VALUES = new Set<ImageInputMode>(['none', 'tool_read', 'native_attach']);

/** goal headless：tool_read 依赖的读图工具名（claude --allowedTools） */
export const GOAL_TOOL_READ_TOOL_NAMES = ['Read'] as const;

const deprecatedMultimodalWarned = new Set<string>();

function warnDeprecatedMultimodalOnce(adapter: string): void {
  const key = adapter.trim() || 'generic';
  if (deprecatedMultimodalWarned.has(key)) return;
  deprecatedMultimodalWarned.add(key);
  process.stderr.write(
    `[multimodal-probe] WARN: adapter "${key}" 使用已弃用字段 multimodal:boolean；请改用 image_input（none|tool_read|native_attach）。\n`,
  );
}

function parseImageInputFromDoc(
  doc: Record<string, unknown>,
  adapter: string,
): { imageInput: ImageInputMode; reason: string } | null {
  const raw = doc.image_input;
  if (typeof raw === 'string' && IMAGE_INPUT_VALUES.has(raw as ImageInputMode)) {
    return { imageInput: raw as ImageInputMode, reason: `adapter.yaml image_input=${raw}` };
  }
  if (typeof doc.multimodal === 'boolean') {
    warnDeprecatedMultimodalOnce(adapter);
    return {
      imageInput: doc.multimodal ? 'tool_read' : 'none',
      reason: `adapter.yaml multimodal=${doc.multimodal} (deprecated→${doc.multimodal ? 'tool_read' : 'none'})`,
    };
  }
  return null;
}

function heuristicImageInput(adapter: string): ImageInputMode {
  return adapter === 'cursor' || adapter === 'claude' ? 'tool_read' : 'none';
}

function toProbeResult(
  adapter: string,
  imageInput: ImageInputMode,
  reason: string,
): MultimodalProbeResult {
  return {
    imageInput,
    supported: imageInput === 'tool_read' || imageInput === 'native_attach',
    adapter,
    reason,
  };
}

/** 读取 agents/<adapter>/adapter.yaml 的 image_input / multimodal 声明 */
export function probeAdapterImageInput(
  projectRoot: string,
  frameworkRoot: string,
  adapterName: string | undefined,
): MultimodalProbeResult {
  const adapter = (adapterName ?? 'generic').trim() || 'generic';
  const adapterYaml = path.join(frameworkRoot, 'agents', adapter, 'adapter.yaml');
  if (!fs.existsSync(adapterYaml)) {
    const imageInput = heuristicImageInput(adapter);
    return toProbeResult(
      adapter,
      imageInput,
      `adapter.yaml 缺失；回退 heuristic（cursor/claude=tool_read）`,
    );
  }
  try {
    const doc = YAML.parse(fs.readFileSync(adapterYaml, 'utf-8')) as Record<string, unknown>;
    const parsed = parseImageInputFromDoc(doc, adapter);
    if (parsed) {
      return toProbeResult(adapter, parsed.imageInput, parsed.reason);
    }
  } catch {
    /* fall through */
  }
  const imageInput = heuristicImageInput(adapter);
  return toProbeResult(
    adapter,
    imageInput,
    `adapter.yaml 未声明 image_input/multimodal；heuristic ${imageInput}`,
  );
}

/** @deprecated 使用 probeAdapterImageInput；保留布尔兼容入口 */
export function probeAdapterMultimodal(
  projectRoot: string,
  frameworkRoot: string,
  adapterName: string | undefined,
): MultimodalProbeResult {
  return probeAdapterImageInput(projectRoot, frameworkRoot, adapterName);
}

export function resolveAdapterImageInput(
  projectRoot: string,
  adapterName: string | undefined,
): ImageInputMode {
  const layout = inferRepoLayout(projectRoot);
  return probeAdapterImageInput(projectRoot, layout.frameworkRoot, adapterName).imageInput;
}

export function resolveAdapterMultimodal(
  projectRoot: string,
  adapterName: string | undefined,
): boolean {
  const layout = inferRepoLayout(projectRoot);
  return probeAdapterImageInput(projectRoot, layout.frameworkRoot, adapterName).supported;
}

/**
 * goal 态 effective image_input：tool_read 但 allowed_tools 缺 Read → 诚实降级 none。
 */
export function resolveGoalEffectiveImageInput(
  projectRoot: string,
  frameworkRoot: string,
  adapterName: string | undefined,
  unattended?: UnattendedContract,
): MultimodalProbeResult {
  const base = probeAdapterImageInput(projectRoot, frameworkRoot, adapterName);
  if (base.imageInput !== 'tool_read') {
    return base;
  }
  if (!unattended?.allowed_tools?.length) {
    return base;
  }
  const hasRead = unattended.allowed_tools.some(t =>
    GOAL_TOOL_READ_TOOL_NAMES.some(r => r.toLowerCase() === t.trim().toLowerCase()),
  );
  if (hasRead) {
    return base;
  }
  return toProbeResult(
    base.adapter,
    'none',
    `${base.reason}；goal allowed_tools=[${unattended.allowed_tools.join(',')}] 缺 Read→降级 none`,
  );
}

/** 从 goal-runner 注入的环境变量解析 allowed_tools（仅 goal 编排态生效）。 */
export function parseGoalAllowedToolsFromEnv(): string[] | undefined {
  if (!isGoalOrchestrationEnv()) return undefined;
  const raw = process.env[MAISON_GOAL_ALLOWED_TOOLS_ENV]?.trim();
  if (!raw) return undefined;
  const tools = raw.split(',').map(t => t.trim()).filter(Boolean);
  return tools.length ? tools : undefined;
}

/**
 * harness 上下文 effective image_input：goal 编排态叠加 allowed_tools 降级；否则读 adapter 声明。
 */
export function resolveContextAdapterImageInput(
  projectRoot: string,
  frameworkRoot: string,
  adapterName: string | undefined,
): MultimodalProbeResult {
  const tools = parseGoalAllowedToolsFromEnv();
  if (tools?.length) {
    return resolveGoalEffectiveImageInput(projectRoot, frameworkRoot, adapterName, {
      allowed_tools: tools,
      write_mode: 'workspace-write',
      approval_mode: 'never',
    });
  }
  return probeAdapterImageInput(projectRoot, frameworkRoot, adapterName);
}

/** 从 spec visual handoff 收集图片路径用于多模态注入 */
export function collectAuthoritativeImagePaths(
  projectRoot: string,
  specMarkdown: string,
  resolvePath: (p: string) => string | null,
): string[] {
  const paths: string[] = [];
  const re = /path:\s*([^\n]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(specMarkdown)) !== null) {
    const raw = m[1].trim().replace(/^['"]|['"]$/g, '');
    if (!/\.(png|jpe?g|webp|gif)$/i.test(raw)) continue;
    const abs = resolvePath(raw);
    if (abs && fs.existsSync(abs)) paths.push(abs);
  }
  return paths;
}

/** @internal 测试用：重置弃用警告去重 */
export function __resetMultimodalProbeWarningsForTest(): void {
  deprecatedMultimodalWarned.clear();
}

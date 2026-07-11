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
import { loadLocalConfig, type FrameworkLocalConfigVisionCanary } from './framework-local-config';

export type ImageInputMode = 'none' | 'tool_read' | 'native_attach';

export interface MultimodalProbeResult {
  imageInput: ImageInputMode;
  /** tool_read | native_attach → true */
  supported: boolean;
  adapter: string;
  reason: string;
  /** I2（plan b7e42d19）：存在该 adapter 的 interactive 金丝雀缓存但已超龄——本结果已回退声明式/heuristic，非采信旧 verdict。 */
  staleInteractiveCanary?: boolean;
}

/**
 * I2 单点收口（plan b7e42d19）：交互式金丝雀缓存 TTL——IDE 模型随手切换，per-adapter 缓存
 * 会静默过期。常量不进 schema（避免 config 膨胀）。goal 来源不受 TTL 影响（headless 模型稳定）。
 */
export const VISION_CANARY_INTERACTIVE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * 金丝雀缓存是否可当"新鲜实测"采信——三消费点（resolveBaseImageInput /
 * readCanaryOcrCapableSignal / goal-preflight.decideVisionCanaryProbe）唯一判据：
 *   - adapter 不符 → false（换 adapter 即失效，既有语义）；
 *   - probed_via='interactive' 且 probed_at 超过 24h TTL → false（超龄，不再静默采信）；
 *   - probed_via='goal' 或缺省（向后兼容 E1 旧缓存）→ 仅看 adapter 匹配，不受 TTL 影响。
 */
export function isVisionCanaryFresh(
  canary: FrameworkLocalConfigVisionCanary | undefined | null,
  adapter: string,
  now: number = Date.now(),
): boolean {
  if (!canary || canary.adapter !== adapter) return false;
  if (canary.probed_via === 'interactive') {
    const probedAtMs = Date.parse(canary.probed_at);
    if (!Number.isFinite(probedAtMs)) return false; // 时间戳坏 → 保守判不新鲜
    if (now - probedAtMs > VISION_CANARY_INTERACTIVE_TTL_MS) return false;
  }
  return true;
}

/**
 * 交互式自测卷 SKIP 专用判据（codex P1 修复 plan b7e42d19）：只认**新鲜的 interactive**
 * 缓存。goal/缺省来源的旧缓存**不得**阻止交互式当前会话实测——goal 缓存来自另一次
 * headless 上下文，而交互式 IDE 模型是下拉框随手切换的（本 plan 要解决的核心场景）；
 * 用 isVisionCanaryFresh 会因 goal 来源永不过 TTL 而误 SKIP，把套壳/换模型的洞放回来。
 * 注：harness 消费面（resolveBaseImageInput 等）仍用 isVisionCanaryFresh——采信 goal 实测
 * 结果是对的；差异仅在"交互式该不该重新自测"这一问上。
 */
export function isFreshInteractiveCanary(
  canary: FrameworkLocalConfigVisionCanary | undefined | null,
  adapter: string,
  now: number = Date.now(),
): boolean {
  return canary?.probed_via === 'interactive' && isVisionCanaryFresh(canary, adapter, now);
}

/** 超龄 interactive 缓存（本 adapter 有缓存但 isVisionCanaryFresh=false 仅因超 TTL）。 */
function isStaleInteractiveCanary(
  canary: FrameworkLocalConfigVisionCanary | undefined | null,
  adapter: string,
  now: number = Date.now(),
): boolean {
  return Boolean(
    canary &&
      canary.adapter === adapter &&
      canary.probed_via === 'interactive' &&
      !isVisionCanaryFresh(canary, adapter, now),
  );
}

const staleCanaryWarned = new Set<string>();

function warnStaleInteractiveCanaryOnce(adapter: string, probedAt: string): void {
  const key = `${adapter}@${probedAt}`;
  if (staleCanaryWarned.has(key)) return;
  staleCanaryWarned.add(key);
  process.stderr.write(
    `[multimodal-probe] advisory: adapter "${adapter}" 的交互式视觉金丝雀缓存已超 24h（probed_at=${probedAt}）——` +
      `已回退声明式探测，不再采信旧 verdict；UI 相关阶段建议重跑自测卷（interactive-vision-canary）。\n`,
  );
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

/**
 * E1（多模态降级阶梯 plan d4a8f3c6）：framework.local.json 读取失败（非法 schema）不阻断
 * 探测——回退声明式路径，探测本身不该被一份格式有误的个人配置文件卡死。
 */
function tryLoadLocalConfig(projectRoot: string): ReturnType<typeof loadLocalConfig> {
  try {
    return loadLocalConfig(projectRoot);
  } catch {
    return null;
  }
}

/**
 * E1：解析链最前——本地 image_input_override（用户显式声明，跳过探测）> 新鲜金丝雀实测
 * 缓存（adapter 与缓存一致才算新鲜——adapter 变更即失效）> 原 adapter.yaml 声明/heuristic。
 * 治案A（mx 2.7 纯文本模型套 claude 壳）：声明式探测会被套壳骗过，此处插入实测/用户声明。
 */
function resolveBaseImageInput(
  projectRoot: string,
  frameworkRoot: string,
  adapterName: string | undefined,
): MultimodalProbeResult {
  const adapter = (adapterName ?? 'generic').trim() || 'generic';
  const local = tryLoadLocalConfig(projectRoot);
  const override = local?.vision?.image_input_override;
  if (override) {
    return toProbeResult(
      adapter,
      override,
      `framework.local.json vision.image_input_override=${override}（用户显式声明，跳过探测）`,
    );
  }
  const canary = local?.vision?.canary;
  // I2：唯一新鲜度判据——超龄 interactive 缓存不再当"新鲜实测"采信（①②），回退声明式/heuristic 并标 stale（③）。
  if (isVisionCanaryFresh(canary, adapter)) {
    const cachedImageInput: ImageInputMode = canary!.verdict === 'tool_read' ? 'tool_read' : 'none';
    return toProbeResult(
      adapter,
      cachedImageInput,
      `金丝雀实测缓存（${canary!.probed_at}，verdict=${canary!.verdict}）${canary!.reason ? '：' + canary!.reason : ''}`,
    );
  }
  if (isStaleInteractiveCanary(canary, adapter)) {
    warnStaleInteractiveCanaryOnce(adapter, canary!.probed_at);
    const base = probeAdapterImageInput(projectRoot, frameworkRoot, adapterName);
    return {
      ...base,
      staleInteractiveCanary: true,
      reason: `interactive_canary_stale（缓存 ${canary!.probed_at} 超 24h TTL，回退声明式）；${base.reason}`,
    };
  }
  return probeAdapterImageInput(projectRoot, frameworkRoot, adapterName);
}

/**
 * E1：金丝雀 verdict=ocr_capable 信号——vision 仍 none，但供 E2 FidelityCapability.ocrAvailable
 * 参考（agent 自身展示了从图片提取文字的能力，即便主探测判定其无视觉）。adapter 变更即失效。
 * I2（④）：超龄 interactive 缓存不再贡献 ocr_capable（走 isVisionCanaryFresh 单点判据）。
 */
export function readCanaryOcrCapableSignal(
  projectRoot: string,
  adapterName: string | undefined,
): boolean {
  const adapter = (adapterName ?? 'generic').trim() || 'generic';
  const canary = tryLoadLocalConfig(projectRoot)?.vision?.canary;
  return Boolean(canary && isVisionCanaryFresh(canary, adapter) && canary.verdict === 'ocr_capable');
}

/**
 * T8/t6⑥（plan c6d8f2b4）：fresh 金丝雀 verdict=tool_read = **真视觉实测在位**。
 * 与 adapterImageInput 的区别：后者可来自 adapter.yaml 声明/heuristic（未实测）；
 * 本信号只认实测缓存——几何/颜色题全对。ocr_capable 不算（仅文字题对、vision 仍 none）。
 */
export function readCanaryToolReadSignal(
  projectRoot: string,
  adapterName: string | undefined,
): boolean {
  const adapter = (adapterName ?? 'generic').trim() || 'generic';
  const canary = tryLoadLocalConfig(projectRoot)?.vision?.canary;
  return Boolean(canary && isVisionCanaryFresh(canary, adapter) && canary.verdict === 'tool_read');
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
  const base = resolveBaseImageInput(projectRoot, frameworkRoot, adapterName);
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
  return resolveBaseImageInput(projectRoot, frameworkRoot, adapterName);
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

/** @internal 测试用：重置弃用警告 + stale 金丝雀 advisory 去重（跨用例隔离） */
export function __resetMultimodalProbeWarningsForTest(): void {
  deprecatedMultimodalWarned.clear();
  staleCanaryWarned.clear();
}

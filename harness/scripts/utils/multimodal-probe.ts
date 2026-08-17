// ============================================================================
// multimodal-probe.ts — adapter 多模态可用性探测（M3）
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import { inferRepoLayout } from '../../repo-layout';
import type { UnattendedContract } from './goal-manifest';
import { MAISON_GOAL_MODEL_PIN_ENV } from './phase-state';
import { loadLocalConfig, type FrameworkLocalConfigVisionCanary } from './framework-local-config';
import { isClaudeKernelAdapter } from './types';
import { VISION_CANARY_PROBE_VERSION } from './vision-canary';

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
 * plan d7f3a9c4 t3：金丝雀**执行身份**（{runId, modelPin} 二元）——
 *  - 子进程消费方（gate harness / check-receipt / profile 门禁）由 env 注入、不显式传参；
 *  - runner 进程内消费方（goal-runner 的 fidelity/LKG 面）显式传 manifest 派生身份。
 * 取不到 pin 即按无 pin 处理（现状语义），不得臆造。
 */
export interface CanaryExecutionIdentity {
  /** goal run id（与 canaryAdmissibleForRun 的 runId 同语义） */
  runId?: string;
  /** 最终裁决后的 model pin value（无 pin 时不传） */
  modelPin?: string;
}

/** 显式身份缺省时回退 env（子进程注入链：gateInjectedEnv / agent extraEnv / phase-state child env）。 */
function resolveCanaryExecutionIdentity(explicit?: CanaryExecutionIdentity): CanaryExecutionIdentity {
  if (explicit) return explicit;
  const runId = process.env.MAISON_GOAL_RUN_ID?.trim();
  const modelPin = process.env[MAISON_GOAL_MODEL_PIN_ENV]?.trim();
  return { runId: runId || undefined, modelPin: modelPin || undefined };
}

/**
 * 「这份 canary 能否被当前 run 采信为 run_probed 实测」——**唯一判据**（plan d8c5f3a7 T1）。
 *
 * 背景（2026-07-24 bc-openCard 事故）：判定曾一分为二——goal-preflight 的
 * `decideVisionCanaryProbe` 只看 `isVisionCanaryFresh`（TTL）决定「要不要重探」，而三轴
 * resolver 另加「goal 来源须 run_id 命中当前 run」决定「可不可采信」。两把尺子打架的后果是
 * **同一份缓存「新到不必再探」且「旧到不能采信」**：07-18 实测 tool_read（4/4 全对）的
 * canary 在 07-24 的新 run 上既不被重探、也不被采信 → hasVision=false → pixel_1to1 被钳成
 * semantic_layout → 盲档协议接管 → UI 大幅倒退。
 *
 * 本谓词由 resolver 与 preflight **共同消费**：resolver 用它判采信，preflight 用
 * 「fresh ∧ admissible」判是否跳过重探——不可采信即当场重探，悖论自然消解。
 *
 * 语义：
 *  - `interactive` 来源：不绑 run（IDE 会话内实测），fresh 即可采信；
 *  - `goal` 来源（含缺省）：`run_probed 不跨 run`——须 `runId` 在场且与 `canary.run_id` 相等；
 *  - 旧缓存无 `run_id` 字段者一律不可采信（无从证明属于本 run）。
 *
 * 注意：本谓词**不含新鲜度判定**，调用方须自行合取 `isVisionCanaryFresh`（两者关注点分离：
 * 新鲜度=证据是否过期，采信度=证据是否属于当前执行身份）。
 */
export function canaryAdmissibleForRun(
  canary: { probed_via?: string; run_id?: string } | undefined | null,
  args: { runId?: string },
): boolean {
  if (!canary) return false;
  const viaGoal = (canary.probed_via ?? 'goal') === 'goal';
  if (!viaGoal) return true;
  return Boolean(args.runId && canary.run_id && canary.run_id === args.runId);
}

/**
 * plan d7f3a9c4 t3：**执行身份**共享谓词——`{runId, modelPin}` 二元。
 *
 * 语义（v6 收敛，见 plan 硬约束 5/6）：
 *   canaryAdmissibleForExecution(canary, {runId, modelPin}) =
 *     canaryAdmissibleForRun(canary, {runId}) &&
 *     (!modelPin || canary.model === modelPin)
 *
 *  - **run 必查**：复用 canaryAdmissibleForRun（interactive 不绑 run、goal 须 run_id 命中
 *    当前 run）——只比 model 不够，同模型跨 run 的旧缓存仍须拒（visual-capability-truth
 *    `run_probed SHALL NOT cross runs`，spec L18）。
 *  - **model 按 pin 追加**：pin 缺席时 `(!modelPin || …)` 短路为 true，谓词精确退化为
 *    canaryAdmissibleForRun——调用方据此保证无 pin 时中央两处等价现状。
 *  - 本谓词**不含新鲜度判定**，调用方须自行合取 `isVisionCanaryFresh`（与 canaryAdmissibleForRun
 *    同款关注点分离：新鲜度=证据是否过期，执行身份=证据是否属于当前 {run, model} 执行身份）。
 */
export function canaryAdmissibleForExecution(
  canary: { probed_via?: string; run_id?: string; model?: string } | undefined | null,
  args: { runId?: string; modelPin?: string },
): boolean {
  if (!canary) return false;
  if (!canaryAdmissibleForRun(canary, { runId: args.runId })) return false;
  return !args.modelPin || canary.model === args.modelPin;
}

/**
 * plan d7f3a9c4 t3：**旁路消费面**统一判据——`fresh && (!modelPin || canaryAdmissibleForExecution)`。
 *  - 无 pin 时精确退化为仅 `isVisionCanaryFresh`（现状逐分支一致，跨 run 复用属既有行为）；
 *  - 有 pin 时追加 `{runId, modelPin}` 全套身份检查（旧模型/跨 run 缓存不得流入旁路）。
 * 中央两处（重探判定 / 三轴 resolver）**不用本函数**，而是始终合取
 * `canaryAdmissibleForExecution`（run 绑定一步不少）——见 effective-vision-context / goal-preflight。
 */
export function isFreshCanaryForExecution(
  canary: FrameworkLocalConfigVisionCanary | undefined | null,
  adapter: string,
  identity: CanaryExecutionIdentity,
  now: number = Date.now(),
): boolean {
  return (
    isVisionCanaryFresh(canary, adapter, now) &&
    (!identity.modelPin || canaryAdmissibleForExecution(canary, { runId: identity.runId, modelPin: identity.modelPin }))
  );
}

/**
 * I2 单点收口（plan b7e42d19）：交互式金丝雀缓存 TTL——IDE 模型随手切换，per-adapter 缓存
 * 会静默过期。常量不进 schema（避免 config 膨胀）。goal 来源不受 TTL 影响（headless 模型稳定）。
 */
export const VISION_CANARY_INTERACTIVE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * plan c7d2e9a4 t4：goal 来源不再永久采信——CLI 模型路由/账号权限会静默变。
 * 负结论（none/ocr_capable）24h（重探成本=一次 headless 调用，可接受）；
 * 正结论（tool_read）7d（每周一次重探成本可忽略）。interactive 维持既有 24h。
 */
export const VISION_CANARY_NEGATIVE_TTL_MS = 24 * 60 * 60 * 1000;
export const VISION_CANARY_POSITIVE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** rev5(codex P2)：未来时间戳容差——超前超过 5 分钟视为时钟异常写入,拒绝采信
 * (否则曾超前的时钟写出的 probed_at 会让缓存 fresh 到未来时刻,实际寿命远超 TTL)。 */
export const VISION_CANARY_CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000;

/**
 * 金丝雀缓存是否可当"新鲜实测"采信——三消费点（resolveBaseImageInput /
 * readCanaryOcrCapableSignal / goal-preflight.decideVisionCanaryProbe）唯一判据：
 *   - adapter 不符 → false（换 adapter 即失效，既有语义）；
 *   - probe_version ≠ 当前协议版本（含缺失=v1 旧缓存）→ false（plan c7d2e9a4：
 *     协议升级自动失效重探，2026-07-12 假 none 毒缓存借此自愈，用户零操作）；
 *   - probed_via='interactive' 且超 24h TTL → false（IDE 模型随手切，既有语义）；
 *   - probed_via='goal'：tool_read 超 7d / none·ocr_capable 超 24h → false
 *     （rev4：拒绝永久采信——模型路由/额度/权限会静默变）。
 */
export function isVisionCanaryFresh(
  canary: FrameworkLocalConfigVisionCanary | undefined | null,
  adapter: string,
  now: number = Date.now(),
): boolean {
  if (!canary || canary.adapter !== adapter) return false;
  if (canary.probe_version !== VISION_CANARY_PROBE_VERSION) return false;
  const probedAtMs = Date.parse(canary.probed_at);
  if (!Number.isFinite(probedAtMs)) return false; // 时间戳坏 → 保守判不新鲜
  const ageMs = now - probedAtMs;
  // rev5(codex P2)：未来时间戳(超容差)拒绝——负 age 只查上限会 fresh 到未来时刻
  if (ageMs < -VISION_CANARY_CLOCK_SKEW_TOLERANCE_MS) return false;
  if (canary.probed_via === 'interactive') {
    return ageMs <= VISION_CANARY_INTERACTIVE_TTL_MS;
  }
  return ageMs <= (canary.verdict === 'tool_read' ? VISION_CANARY_POSITIVE_TTL_MS : VISION_CANARY_NEGATIVE_TTL_MS);
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

/**
 * 超龄 interactive 缓存——**仅真 TTL 超龄**才标 stale 并打"已超 24h" advisory。
 * rev5(codex P3)：版本不符(协议升级)/坏时间戳不属"超 24h",归因错误会误导用户
 * (刚写不久的旧协议缓存被解释成超龄)——这两类走普通声明回退,不打超龄 advisory。
 */
function isStaleInteractiveCanary(
  canary: FrameworkLocalConfigVisionCanary | undefined | null,
  adapter: string,
  now: number = Date.now(),
): boolean {
  if (!canary || canary.adapter !== adapter || canary.probed_via !== 'interactive') return false;
  if (canary.probe_version !== VISION_CANARY_PROBE_VERSION) return false; // protocol_stale,非超龄
  const probedAtMs = Date.parse(canary.probed_at);
  if (!Number.isFinite(probedAtMs)) return false; // invalid_timestamp,非超龄
  return now - probedAtMs > VISION_CANARY_INTERACTIVE_TTL_MS;
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

// GOAL_TOOL_READ_TOOL_NAMES 已退役（plan a8e5c3f9 t1）：--allowedTools 审批面整体移除，
// image_input 能力判断不再消费任何工具清单。

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
  // 家族谓词（plan c7a9e2f4）：codeagent 内核同 claude，Read 可读 sidecar 图片
  return adapter === 'cursor' || isClaudeKernelAdapter(adapter) ? 'tool_read' : 'none';
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
  identity?: CanaryExecutionIdentity,
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
  // plan d7f3a9c4 t3：旁路消费面规则 `fresh && (!modelPin || canaryAdmissibleForExecution(...))`——
  // 无 pin 时精确退化为仅 fresh（既有行为逐分支一致）；pin 在场时追加 {runId, modelPin} 全套身份检查。
  if (isFreshCanaryForExecution(canary, adapter, resolveCanaryExecutionIdentity(identity))) {
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
  identity?: CanaryExecutionIdentity,
): boolean {
  const adapter = (adapterName ?? 'generic').trim() || 'generic';
  const canary = tryLoadLocalConfig(projectRoot)?.vision?.canary;
  // plan d7f3a9c4 t3：旁路规则 `fresh && (!modelPin || canaryAdmissibleForExecution(...))`。
  return Boolean(canary && isFreshCanaryForExecution(canary, adapter, resolveCanaryExecutionIdentity(identity)) && canary.verdict === 'ocr_capable');
}

/**
 * T8/t6⑥（plan c6d8f2b4）：fresh 金丝雀 verdict=tool_read = **真视觉实测在位**。
 * 与 adapterImageInput 的区别：后者可来自 adapter.yaml 声明/heuristic（未实测）；
 * 本信号只认实测缓存——几何/颜色题全对。ocr_capable 不算（仅文字题对、vision 仍 none）。
 */
export function readCanaryToolReadSignal(
  projectRoot: string,
  adapterName: string | undefined,
  identity?: CanaryExecutionIdentity,
): boolean {
  const adapter = (adapterName ?? 'generic').trim() || 'generic';
  const canary = tryLoadLocalConfig(projectRoot)?.vision?.canary;
  // plan d7f3a9c4 t3：旁路规则 `fresh && (!modelPin || canaryAdmissibleForExecution(...))`。
  return Boolean(canary && isFreshCanaryForExecution(canary, adapter, resolveCanaryExecutionIdentity(identity)) && canary.verdict === 'tool_read');
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
 * goal 态 effective image_input（plan a8e5c3f9 t1：allowed_tools 降级链退役）。
 * headless 全权限（bypass）下工具审批清单不存在，「allowed_tools 缺 Read → 降级 none」
 * 不再成立；unattended 权限字段不再参与能力判断。保留函数名与签名以稳住调用面，
 * 语义 = resolveBaseImageInput。
 */
export function resolveGoalEffectiveImageInput(
  projectRoot: string,
  frameworkRoot: string,
  adapterName: string | undefined,
  _unattended?: UnattendedContract,
  identity?: CanaryExecutionIdentity,
): MultimodalProbeResult {
  return resolveBaseImageInput(projectRoot, frameworkRoot, adapterName, identity);
}

// parseGoalAllowedToolsFromEnv 已退役（plan a8e5c3f9 t1）：MAISON_GOAL_ALLOWED_TOOLS
// 环境变量注入与消费一并删除——allowed_tools 是审批清单，不构成任何能力/权限判断的输入。

/**
 * harness 上下文 effective image_input：读 adapter 声明（本地 override/金丝雀链在
 * resolveBaseImageInput 内）；goal 态不再叠加 allowed_tools 降级（plan a8e5c3f9 t1）。
 */
export function resolveContextAdapterImageInput(
  projectRoot: string,
  frameworkRoot: string,
  adapterName: string | undefined,
  identity?: CanaryExecutionIdentity,
): MultimodalProbeResult {
  return resolveBaseImageInput(projectRoot, frameworkRoot, adapterName, identity);
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
